import './db-app-env';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  AccountType,
  DeviceStatus,
  MemberRole,
  OrganizationStatus,
  PaymentMethod,
  PlanType,
  Prisma,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { Caller } from '../src/common/decorators/access.decorator';
import { DomainException } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PaymentsService } from '../src/modules/billing/payments.service';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { HandoverService } from '../src/modules/rentals/handover.service';

// The rental flow the acceptance suites of test:db share (rentals and billing task 6.2 and 5.2):
// AppModule compiled against the disposable database without init, so after-commit listeners and
// scheduled jobs stay off and no email is sent, plus fixtures and the steps from request to
// handover through the real services. Every fixture carries a fresh run ID and is never deleted.

// A 1 x 1 PNG, the smallest signature the handover accepts.
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const DAY_MS = 86_400_000;
export const at = (iso: string) => new Date(iso);

// Every contract starts on 2 November 2026: term 1 from 09:00 UTC+7 that day.
export const START_DATE = at('2026-11-02T00:00:00.000Z');
export const TERM_START = at('2026-11-02T02:00:00.000Z');
const REQUESTED_AT = at('2026-10-25T02:00:00.000Z');
const APPROVED_AT = at('2026-10-26T02:00:00.000Z');
const PAID_AT = at('2026-10-27T02:00:00.000Z');

export interface ContractTerms {
  planType?: PlanType;
  dayPlanDays?: number | null;
  dayPremium?: string | null;
  monthlyUnitPriceVnd?: bigint;
}

export const compileRentalFlow = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
    throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const get = <T>(type: new (...args: never[]) => T): T => moduleRef.get(type, { strict: false });
  const prisma = moduleRef.get(PrismaService);
  const repository = get(ContractsRepository);
  const decisions = get(ContractDecisionsService);
  const handover = get(HandoverService);
  const payments = get(PaymentsService);
  const runId = randomUUID().slice(0, 8);
  let serial = 0;

  const next = () => {
    serial += 1;
    return `${runId}-${serial}`;
  };

  const user = async (accountType: AccountType) =>
    (
      await prisma.user.create({
        data: { email: `flow-${next()}@example.invalid`, fullName: `Flow ${serial}`, accountType },
      })
    ).id;

  const staff: Caller = {
    id: await user(AccountType.TREKLINK),
    roles: ['STAFF'],
    organizationId: null,
  };
  const admin = async (): Promise<Caller> => ({
    id: await user(AccountType.TREKLINK),
    roles: ['ADMIN'],
    organizationId: null,
  });

  // An ACTIVE organization with one Manager, who signs the handovers and labels holders.
  const organization = async () => {
    const id = (
      await prisma.organization.create({
        data: {
          code: `FL-${next()}`,
          legalName: 'Flow organization',
          taxCode: `flow-${next()}`,
          address: 'Test address',
          contactEmail: `flow-${next()}@example.invalid`,
          contactPhone: '0900000000',
          status: OrganizationStatus.ACTIVE,
        },
      })
    ).id;
    const managerId = await user(AccountType.ORGANIZATION);
    await prisma.organizationMember.create({
      data: { userId: managerId, organizationId: id, role: MemberRole.MANAGER },
    });
    const manager: Caller = { id: managerId, roles: ['ORG_MANAGER'], organizationId: id };
    return { id, manager };
  };

  const variant = async (remainingValueSchedule: Prisma.InputJsonValue = []) =>
    (
      await prisma.hardwareVariant.create({
        data: {
          code: `fl-${next()}`,
          name: 'Flow variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule,
        },
      })
    ).id;

  const availableDevices = async (
    variantId: string,
    count: number,
    acquiredAt = at('2026-01-01T00:00:00.000Z'),
  ) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const device = await prisma.device.create({
        data: {
          assetTag: `FL-${next()}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt,
          registeredById: staff.id,
          status: DeviceStatus.AVAILABLE,
        },
      });
      ids.push(device.id);
    }
    return ids;
  };

  // A REQUESTED contract with the price snapshot of the request (default: monthly, 450,000 VND).
  const requested = (
    organizationId: string,
    managerId: string,
    variantId: string,
    quantity: number,
    terms: ContractTerms = {},
  ) =>
    prisma.$transaction((tx) =>
      repository.insertRequested(
        {
          organizationId,
          planType: terms.planType ?? PlanType.MONTHLY,
          dayPlanDays: terms.dayPlanDays ?? null,
          hardwareVariantId: variantId,
          quantity,
          requestedStartDate: START_DATE,
          monthlyUnitPriceVnd: terms.monthlyUnitPriceVnd ?? 450_000n,
          dayPremium: terms.dayPremium ? new Prisma.Decimal(terms.dayPremium) : null,
          holdingFeeRatio: new Prisma.Decimal('0.5'),
          requestedById: managerId,
        },
        REQUESTED_AT,
        tx,
      ),
    );

  const contractRow = (id: string) => prisma.rentalContract.findUniqueOrThrow({ where: { id } });
  const version = async (id: string) => (await contractRow(id)).version;
  const status = async (id: string) => (await contractRow(id)).status;

  const approve = async (id: string) =>
    decisions.approve(
      id,
      { handoverAt: TERM_START, expectedVersion: await version(id) },
      staff,
      APPROVED_AT,
    );

  // Pays what each invoice of the contract still owes at the counter.
  const payAll = async (contractId: string, when: Date = PAID_AT) => {
    for (const invoice of await prisma.invoice.findMany({ where: { contractId } })) {
      const owed = invoice.totalVnd - invoice.paidVnd;
      if (owed <= 0n) continue;
      await payments.recordCounter(
        invoice.id,
        { method: PaymentMethod.CASH, amountVnd: owed, reference: `FL-${next()}` },
        staff,
        when,
      );
    }
  };

  const handOver = async (contractId: string, managerId: string, deviceIds: string[]) => {
    const { organizationId } = await contractRow(contractId);
    const { channelKeyVersion } = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    for (const deviceId of deviceIds) {
      await handover.provision(
        contractId,
        deviceId,
        channelKeyVersion,
        staff,
        at('2026-11-02T01:00:00.000Z'),
      );
    }
    return handover.complete(
      contractId,
      {
        signedByUserId: managerId,
        identityChecked: 'CCCD 001',
        signaturePng: SIGNATURE,
        deviceChecks: deviceIds.map((deviceId) => ({ deviceId, batteryPct: 90, gpsFixOk: true })),
        acknowledgeLowBattery: false,
        expectedVersion: await version(contractId),
      },
      staff,
      at('2026-11-02T03:00:00.000Z'),
    );
  };

  // A contract ACTIVE since 2 November with every unit out, through approval, payment and handover.
  const rented = async (quantity: number, terms: ContractTerms = {}) => {
    const org = await organization();
    const variantId = await variant();
    const deviceIds = await availableDevices(variantId, quantity);
    const contract = await requested(org.id, org.manager.id, variantId, quantity, terms);
    await approve(contract.id);
    await payAll(contract.id);
    await handOver(contract.id, org.manager.id, deviceIds);
    const tags = (
      await prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { assetTag: true } })
    ).map((device) => device.assetTag);
    return { contract, org, variantId, deviceIds, tags };
  };

  // The error code a refused call answers with; null when it went through.
  const codeOf = (call: Promise<unknown>) =>
    call.then(
      () => null,
      (error: unknown) =>
        error instanceof DomainException
          ? ((error.getResponse() as { errorCode?: string }).errorCode ?? null)
          : String(error),
    );

  return {
    moduleRef,
    get,
    prisma,
    staff,
    admin,
    next,
    user,
    organization,
    variant,
    availableDevices,
    requested,
    version,
    status,
    approve,
    payAll,
    handOver,
    rented,
    codeOf,
    close: () => moduleRef.close(),
  };
};

export type RentalFlow = Awaited<ReturnType<typeof compileRentalFlow>>;

// Demo seed (specs/platform tasks.md 1.12, US-X02). Loads the data api-design/00-api-testing-guide.md §2
// assumes, on top of the migration seed (roles, permissions, business parameters):
//
//   - one account per role: admin@, staff@, manager@ and operator@treklink.local
//   - one ACTIVE organization, ORG-0001, with the Manager and the Operator as members, and one
//     roster shift with the Operator as primary and the Manager as backup (MF-03 routing)
//   - hardware variants treklink-v2 to treklink-v4, a price schedule each, two damage rates
//   - fourteen AVAILABLE devices (ten treklink-v3, so two requests at the minimum order of five can be
//     approved), and two RENTED devices on one ACTIVE monthly contract, RC-2026-0001
//   - a second ACTIVE monthly contract, RC-2026-0002, on two more RENTED devices with holder labels
//     and a paid first (TERM) invoice, so MF-05 (term end, return, balance invoice, close) has a
//     contract to walk end to end without the MF-03 demo SOS on RC-2026-0001's devices blocking its
//     close on OPEN_INCIDENTS (D-078, 2026-11-01 demo)
//   - one UNROUTED incident on TL-0001, a device in no custody, so TrekLink Staff can walk the
//     authority report of UC-35 (report, then case closed) from /t/incidents (D-078, 2026-11-01 demo)
//   - one Field Station of ORG-0001, `fs-org-0001-1`, for the MF-02 sync status page
//   - one DEFAULTED monthly contract, RC-2026-0003, on one RENTED device, TL-0019, so the contract
//     authority report of incidents api-design 10 can be walked from /t/incidents (D-078); it carries
//     its first-term TERM invoice, holding fee paid and term balance unpaid, so the contract page
//     shows a balance due now (dry-run defect 16)
//
// Idempotent: every row is found by its natural key and created only when absent, and the history rows of
// a parent (transitions, intake checks, provisioning) are written only when the parent is created. A second
// run writes nothing; `--expect-unchanged` makes that run exit 1 if it would create anything. Nothing is
// updated, so a changed SEED_*_PASSWORD applies only to a fresh database.
//
// Out of scope: RC-2026-0001 still carries no invoice, payment or signed handover note. Billing exists
// now (RC-2026-0002 below is seeded with a paid invoice); backfilling RC-2026-0001 is left open and
// noted in the PR that added RC-2026-0002. The seed does not populate a signed handover note for either
// contract; the handover flow writes one at the counter.
//
// Passwords come from SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD, SEED_MANAGER_PASSWORD and
// SEED_OPERATOR_PASSWORD, never from the repository. All names, codes and numbers are fictitious.
// SEED_ORG_API_KEY, when set, adds one organization API key for ORG-0001 with that secret (organizations
// 2.7, the organization API demo); only its SHA-256 hash is stored.
//
// Run: npm run seed:demo   (after `prisma migrate deploy`)

import {
  ContractStatus,
  DeviceStatus,
  InvoiceKind,
  InvoiceLineType,
  MemberRole,
  OrganizationStatus,
  IncidentConfidence,
  IncidentSource,
  IncidentState,
  PaymentMethod,
  PlanType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
// Pure helpers reused from billing so the MF-05 invoice below (D-078) matches production money and
// numbering exactly. A prisma/ script importing src/ already has precedent in demo-term-end.ts.
import { invoiceNumberYear, invoiceStatusOf } from '../src/modules/billing/invoices.repository';
import { holdingFeeVnd, termFeeVnd } from '../src/modules/billing/money';

type Tx = Prisma.TransactionClient;

export interface SeedPasswords {
  admin: string;
  staff: string;
  manager: string;
  operator: string;
}

export interface SeedOptions {
  now: Date;
  bcryptCost: number;
  // An organization API key for ORG-0001, `tlk_` and 43 base64url characters; none when absent.
  apiKey?: string;
}

// The shape organizations 2.7 generates: `tlk_` and 32 random bytes in base64url.
export const API_KEY_FORMAT = /^tlk_[A-Za-z0-9_-]{43}$/;
const DEMO_API_KEY_NAME = 'Demo integration';

const ORGANIZATION_CODE = 'ORG-0001';
// MF-02 sync status chain: the demo Field Station's MQTT username, `fs-<org code lower-case>-<n>`.
const FIELD_STATION_USERNAME = 'fs-org-0001-1';
const CONTRACT_CODE = 'RC-2026-0001';
// Chain 4 (D-078): holder label of each rented unit on RC-2026-0001, written when absent.
const HOLDER_LABELS: readonly (readonly [string, string, string])[] = [
  ['TL-0009', 'Le Thi E', '0912000009'],
  ['TL-0010', 'Pham Van F', '0912000010'],
];
const CONTRACT_VARIANT = 'treklink-v3';

// MF-05 second demo contract (D-078, Sunday 2026-11-01 demo): kept in its own block, separate from
// DEVICES, CONTRACT_CODE and HOLDER_LABELS above, so other chains editing this file rebase cleanly.
const CONTRACT_CODE_2 = 'RC-2026-0002';
// The device of the seeded UNROUTED incident (authority report demo): AVAILABLE, in no custody.
const AUTHORITY_DEMO_DEVICE = 'TL-0001';

// The DEFAULTED contract of the contract authority report demo (incidents api-design 10, D-078).
const DEFAULTED_CONTRACT_CODE = 'RC-2026-0003';
const DEFAULTED_DEVICE = { assetTag: 'TL-0019', nodeNum: 0xde000013n };

const MF05_DEVICES: { assetTag: string; nodeNum: bigint }[] = [
  { assetTag: 'TL-0017', nodeNum: 0xde000011n },
  { assetTag: 'TL-0018', nodeNum: 0xde000012n },
];
const HOLDER_LABELS_2: readonly (readonly [string, string, string])[] = [
  ['TL-0017', 'Hoang Thi Mai', '0912000017'],
  ['TL-0018', 'Vu Van Nam', '0912000018'],
];

const ACCOUNTS = [
  { key: 'admin', email: 'admin@treklink.local', fullName: 'Demo Admin', role: 'ADMIN' },
  { key: 'staff', email: 'staff@treklink.local', fullName: 'Demo Staff', role: 'STAFF' },
  {
    key: 'manager',
    email: 'manager@treklink.local',
    fullName: 'Demo Manager',
    role: 'ORG_MANAGER',
  },
  {
    key: 'operator',
    email: 'operator@treklink.local',
    fullName: 'Demo Operator',
    role: 'ORG_OPERATOR',
  },
] as const;

const REMAINING_VALUE = [
  { fromMonths: 0, valueVnd: 2500000 },
  { fromMonths: 12, valueVnd: 1800000 },
  { fromMonths: 24, valueVnd: 1200000 },
];
const SERVICE_CHECKLIST = [
  'Battery health',
  'Antenna and connector',
  'Enclosure seal',
  'Button and buzzer',
];
const SERVICE_INTERVAL_DAYS = 180;

// Sensors per firmware ground truth §5 and the variant headers: v2 carries an ICM-20948, v4 a QMI8658,
// v3 has no IMU. MQTT is compiled into all three (only v1 excludes it, and v1 is out of the demo set, D-005).
const VARIANTS = [
  {
    code: 'treklink-v2',
    name: 'TrekLink v2 (GPS, SOS button, motion sensor)',
    hasMotionSensor: true,
    firmwareBaseline: '2.7.19-treklink.2',
    monthlyPriceVnd: 400000n,
  },
  {
    code: 'treklink-v3',
    name: 'TrekLink v3 (GPS, SOS button)',
    hasMotionSensor: false,
    firmwareBaseline: '2.7.19-treklink.3',
    monthlyPriceVnd: 450000n,
  },
  {
    code: 'treklink-v4',
    name: 'TrekLink v4 (GPS, SOS, fall detection)',
    hasMotionSensor: true,
    firmwareBaseline: '2.7.19-treklink.4',
    monthlyPriceVnd: 480000n,
  },
] as const;

const DAMAGE_RATES = [
  { code: 'ANTENNA_BROKEN', label: 'Antenna broken', amountVnd: 300000n },
  { code: 'CASING_CRACKED', label: 'Casing cracked', amountVnd: 400000n },
];

// Node numbers are placeholders in an unused 0xDE00xxxx block. gateway-sync task 1.2 captures golden
// fixtures from real devices; the rented units then take the fixture node numbers so a replay lands on
// this contract.
const DEVICES: { assetTag: string; nodeNum: bigint; variant: string; rented: boolean }[] = [
  { assetTag: 'TL-0001', nodeNum: 0xde000001n, variant: 'treklink-v2', rented: false },
  { assetTag: 'TL-0002', nodeNum: 0xde000002n, variant: 'treklink-v2', rented: false },
  { assetTag: 'TL-0003', nodeNum: 0xde000003n, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0004', nodeNum: 0xde000004n, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0005', nodeNum: 0xde000005n, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0006', nodeNum: 0xde000006n, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0007', nodeNum: 0xde000007n, variant: 'treklink-v4', rented: false },
  { assetTag: 'TL-0008', nodeNum: 0xde000008n, variant: 'treklink-v4', rented: false },
  { assetTag: 'TL-0009', nodeNum: 0xde000009n, variant: CONTRACT_VARIANT, rented: true },
  { assetTag: 'TL-0010', nodeNum: 0xde00000an, variant: CONTRACT_VARIANT, rented: true },
  // Six more v3 units: with TL-0003 to TL-0006 the demo can approve a request of rentals.minOrderQuantity
  // (5) devices twice (MF-01). Added after the first seed run, so an existing database gains only these.
  { assetTag: 'TL-0011', nodeNum: 0xde00000bn, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0012', nodeNum: 0xde00000cn, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0013', nodeNum: 0xde00000dn, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0014', nodeNum: 0xde00000en, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0015', nodeNum: 0xde00000fn, variant: 'treklink-v3', rented: false },
  { assetTag: 'TL-0016', nodeNum: 0xde000010n, variant: 'treklink-v3', rented: false },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};
const utcDate = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Mirrors billing InvoicesService's `line()` rounding rule: the quantity stays whole only when the
// amount divides evenly by it, so quantity x unit always equals the amount (billing task 1.2).
const invoiceLineShape = (
  amountVnd: bigint,
  quantity: number,
): { quantity: number; unitVnd: bigint } =>
  amountVnd % BigInt(quantity) === 0n
    ? { quantity, unitVnd: amountVnd / BigInt(quantity) }
    : { quantity: 1, unitVnd: amountVnd };

async function parameterValue(tx: Tx, key: string): Promise<unknown> {
  const row = await tx.businessParameter.findUnique({ where: { key } });
  if (!row)
    throw new Error(`business parameter ${key} is missing; run prisma migrate deploy first`);
  return row.value;
}

/**
 * Loads the demo data. Returns a label per created row group; an empty list means nothing changed.
 */
export async function seedDemo(
  prisma: PrismaClient,
  passwords: SeedPasswords,
  { now, bcryptCost, apiKey }: SeedOptions,
): Promise<string[]> {
  const created: string[] = [];
  if (apiKey !== undefined && !API_KEY_FORMAT.test(apiKey)) {
    throw new Error('SEED_ORG_API_KEY must be tlk_ followed by 43 base64url characters');
  }

  return prisma.$transaction(
    async (tx) => {
      const minLength = Number(await parameterValue(tx, 'auth.passwordMinLength'));
      const short = ACCOUNTS.filter((a) => passwords[a.key].length < minLength).map(
        (a) => `SEED_${a.key.toUpperCase()}_PASSWORD`,
      );
      if (short.length > 0) {
        throw new Error(`${short.join(', ')} shorter than auth.passwordMinLength (${minLength})`);
      }

      const roles = new Map((await tx.role.findMany()).map((r) => [r.key, r]));
      const users = new Map<string, { id: string }>();
      for (const account of ACCOUNTS) {
        const role = roles.get(account.role);
        if (!role)
          throw new Error(`role ${account.role} is missing; run prisma migrate deploy first`);
        let user = await tx.user.findUnique({ where: { email: account.email } });
        if (!user) {
          user = await tx.user.create({
            data: {
              email: account.email,
              fullName: account.fullName,
              accountType: role.accountType,
              passwordHash: await bcrypt.hash(passwords[account.key], bcryptCost),
              roles: { create: { roleId: role.id } },
            },
          });
          created.push(`user ${account.email}`);
        }
        users.set(account.key, user);
      }
      const admin = users.get('admin')!.id;
      const staff = users.get('staff')!.id;
      const manager = users.get('manager')!.id;
      const operator = users.get('operator')!.id;

      let organization = await tx.organization.findUnique({ where: { code: ORGANIZATION_CODE } });
      if (!organization) {
        organization = await tx.organization.create({
          data: {
            code: ORGANIZATION_CODE,
            legalName: 'TrekLink Demo Tours Co., Ltd.',
            taxCode: '0000000001',
            address: '1 Demo Street, Da Lat, Lam Dong',
            contactEmail: 'manager@treklink.local',
            contactPhone: '0900000000',
            status: OrganizationStatus.ACTIVE,
            statusChangedAt: now,
            verifiedAt: now,
            verifiedById: staff,
            verificationMethod: 'IN_PERSON',
            masterContractRef: 'MC-DEMO-0001',
            ndaSigned: true,
            softwareLicenceSigned: true,
            decidedAt: now,
            decidedById: admin,
          },
        });
        await tx.organizationTransition.createMany({
          data: [
            { organizationId: organization.id, toStatus: 'PENDING', actorId: manager },
            {
              organizationId: organization.id,
              fromStatus: 'PENDING',
              toStatus: 'ACTIVE',
              actorId: admin,
            },
          ],
        });
        created.push(`organization ${ORGANIZATION_CODE}`);
      }
      for (const [userId, role] of [
        [manager, MemberRole.MANAGER],
        [operator, MemberRole.OPERATOR],
      ] as const) {
        if (!(await tx.organizationMember.findUnique({ where: { userId } }))) {
          await tx.organizationMember.create({
            data: { userId, organizationId: organization.id, role, invitedById: admin },
          });
          created.push(`member ${role}`);
        }
      }

      // One on-duty shift for MF-03: the Operator is primary and the Manager backup, from a day
      // before the seed for a year, so a demo SOS routes to NOTIFY_PRIMARY (incidents 2.2).
      if (!(await tx.rosterShift.findFirst({ where: { organizationId: organization.id } }))) {
        const memberOf = async (userId: string) =>
          (await tx.organizationMember.findUniqueOrThrow({ where: { userId } })).id;
        await tx.rosterShift.create({
          data: {
            organizationId: organization.id,
            startsAt: new Date(now.getTime() - 24 * 3600 * 1000),
            endsAt: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
            primaryMemberId: await memberOf(operator),
            backupMemberId: await memberOf(manager),
            createdById: manager,
          },
        });
        created.push('roster shift');
      }

      const variants = new Map<string, { id: string }>();
      for (const v of VARIANTS) {
        let variant = await tx.hardwareVariant.findUnique({ where: { code: v.code } });
        if (!variant) {
          variant = await tx.hardwareVariant.create({
            data: {
              code: v.code,
              name: v.name,
              hasGps: true,
              hasMotionSensor: v.hasMotionSensor,
              mqttCapable: true,
              firmwareBaseline: v.firmwareBaseline,
              remainingValueSchedule: REMAINING_VALUE,
              serviceIntervalDays: SERVICE_INTERVAL_DAYS,
              serviceChecklist: SERVICE_CHECKLIST,
            },
          });
          created.push(`variant ${v.code}`);
        }
        variants.set(v.code, variant);
        if (!(await tx.priceSchedule.findFirst({ where: { hardwareVariantId: variant.id } }))) {
          await tx.priceSchedule.create({
            data: {
              hardwareVariantId: variant.id,
              monthlyPriceVnd: v.monthlyPriceVnd,
              effectiveFrom: now,
              createdById: admin,
            },
          });
          created.push(`price ${v.code}`);
        }
      }
      // findFirst: a NULL variant cannot be looked up through the (code, hardwareVariantId) unique.
      for (const rate of DAMAGE_RATES) {
        if (
          !(await tx.damageRate.findFirst({ where: { code: rate.code, hardwareVariantId: null } }))
        ) {
          await tx.damageRate.create({ data: { ...rate, createdById: admin } });
          created.push(`damage rate ${rate.code}`);
        }
      }

      const devices = new Map<string, { id: string; created: boolean }>();
      for (const d of DEVICES) {
        const variant = VARIANTS.find((v) => v.code === d.variant)!;
        const existing = await tx.device.findUnique({ where: { assetTag: d.assetTag } });
        if (existing) {
          devices.set(d.assetTag, { id: existing.id, created: false });
          continue;
        }
        const device = await tx.device.create({
          data: {
            assetTag: d.assetTag,
            nodeNum: d.nodeNum,
            hardwareVariantId: variants.get(d.variant)!.id,
            firmwareVersion: variant.firmwareBaseline,
            acquiredAt: addMonths(now, -3),
            status: d.rented ? DeviceStatus.RENTED : DeviceStatus.AVAILABLE,
            statusChangedAt: now,
            registeredById: staff,
            serviceDueAt: utcDate(addDays(now, SERVICE_INTERVAL_DAYS)),
            ...(d.rented && {
              keyVersion: 1,
              keyOrganizationId: organization.id,
              provisionedAt: now,
            }),
          },
        });
        await tx.intakeCheck.create({
          data: {
            deviceId: device.id,
            gpsFixOk: true,
            radioOk: true,
            batteryOk: true,
            motionOk: variant.hasMotionSensor ? true : null,
            passed: true,
            checkedById: staff,
          },
        });
        await tx.deviceTransition.createMany({
          data: [
            { deviceId: device.id, toStatus: 'IN_INTAKE', actorId: staff, reason: 'REGISTERED' },
            {
              deviceId: device.id,
              fromStatus: 'IN_INTAKE',
              toStatus: 'AVAILABLE',
              actorId: staff,
              reason: 'INTAKE_PASSED',
            },
          ],
        });
        devices.set(d.assetTag, { id: device.id, created: true });
        created.push(`device ${d.assetTag}`);
      }

      const rented = DEVICES.filter((d) => d.rented);
      let contract = await tx.rentalContract.findUnique({ where: { code: CONTRACT_CODE } });
      if (!contract) {
        const holdingFeeRatio = new Prisma.Decimal(
          String(await parameterValue(tx, 'billing.holdingFeeRatio')),
        );
        contract = await tx.rentalContract.create({
          data: {
            code: CONTRACT_CODE,
            organizationId: organization.id,
            planType: PlanType.MONTHLY,
            hardwareVariantId: variants.get(CONTRACT_VARIANT)!.id,
            quantity: rented.length,
            requestedStartDate: utcDate(now),
            monthlyUnitPriceVnd: VARIANTS.find((v) => v.code === CONTRACT_VARIANT)!.monthlyPriceVnd,
            holdingFeeRatio,
            status: 'ACTIVE',
            statusChangedAt: now,
            requestedById: manager,
            decidedById: staff,
            decidedAt: now,
            handedOverAt: now,
            handedOverById: staff,
            terms: { create: { seq: 1, startsAt: now, endsAt: addMonths(now, 1) } },
          },
        });
        await tx.contractTransition.createMany({
          data: [
            { contractId: contract.id, toStatus: 'REQUESTED', actorId: manager },
            {
              contractId: contract.id,
              fromStatus: 'REQUESTED',
              toStatus: 'APPROVED',
              actorId: staff,
            },
            { contractId: contract.id, fromStatus: 'APPROVED', toStatus: 'ACTIVE', actorId: staff },
          ],
        });
        created.push(`contract ${CONTRACT_CODE}`);
      }
      for (const d of rented) {
        const device = devices.get(d.assetTag)!;
        if (await tx.contractDevice.findFirst({ where: { deviceId: device.id } })) continue;
        await tx.contractDevice.create({
          data: {
            contractId: contract.id,
            deviceId: device.id,
            reservedAt: now,
            handedOverAt: now,
          },
        });
        if (device.created) {
          await tx.deviceProvisioning.create({
            data: {
              deviceId: device.id,
              organizationId: organization.id,
              keyVersion: 1,
              provisionedById: staff,
            },
          });
          const ref = { refType: 'CONTRACT', refId: contract.id, actorId: staff };
          await tx.deviceTransition.createMany({
            data: [
              {
                deviceId: device.id,
                fromStatus: 'AVAILABLE',
                toStatus: 'RESERVED',
                reason: 'RESERVED',
                ...ref,
              },
              {
                deviceId: device.id,
                fromStatus: 'RESERVED',
                toStatus: 'RENTED',
                reason: 'HANDED_OVER',
                ...ref,
              },
            ],
          });
        }
        created.push(`contract device ${d.assetTag}`);
      }

      // Chain 4 (D-078, MF-03 demo): holder labels for the two rented units, so the SOS alert and the
      // incident pages name a holder. Written only while the label is still empty; fictitious names.
      for (const [assetTag, holderName, holderPhone] of HOLDER_LABELS) {
        const { count } = await tx.contractDevice.updateMany({
          where: { contractId: contract.id, deviceId: devices.get(assetTag)!.id, holderName: null },
          data: { holderName, holderPhone },
        });
        if (count > 0) created.push(`holder label ${assetTag}`);
      }

      // --- MF-05 second demo contract (D-078, 2026-11-01 demo) ------------------------------------
      // A second ACTIVE monthly contract on two more RENTED devices, so MF-05 (term end, return,
      // balance invoice, close) can be walked end to end without the MF-03 demo SOS on RC-2026-0001's
      // devices (TL-0009, TL-0010) blocking its close on OPEN_INCIDENTS. Additive and idempotent, kept
      // separate from the RC-2026-0001 block above so other chains editing this file rebase cleanly.
      const mf05VariantStatic = VARIANTS.find((v) => v.code === CONTRACT_VARIANT)!;
      const mf05Devices = new Map<string, { id: string; created: boolean }>();
      for (const d of MF05_DEVICES) {
        const existing = await tx.device.findUnique({ where: { assetTag: d.assetTag } });
        if (existing) {
          mf05Devices.set(d.assetTag, { id: existing.id, created: false });
          continue;
        }
        const device = await tx.device.create({
          data: {
            assetTag: d.assetTag,
            nodeNum: d.nodeNum,
            hardwareVariantId: variants.get(CONTRACT_VARIANT)!.id,
            firmwareVersion: mf05VariantStatic.firmwareBaseline,
            acquiredAt: addMonths(now, -3),
            status: DeviceStatus.RENTED,
            statusChangedAt: now,
            registeredById: staff,
            serviceDueAt: utcDate(addDays(now, SERVICE_INTERVAL_DAYS)),
            keyVersion: 1,
            keyOrganizationId: organization.id,
            provisionedAt: now,
          },
        });
        await tx.intakeCheck.create({
          data: {
            deviceId: device.id,
            gpsFixOk: true,
            radioOk: true,
            batteryOk: true,
            motionOk: mf05VariantStatic.hasMotionSensor ? true : null,
            passed: true,
            checkedById: staff,
          },
        });
        await tx.deviceTransition.createMany({
          data: [
            { deviceId: device.id, toStatus: 'IN_INTAKE', actorId: staff, reason: 'REGISTERED' },
            {
              deviceId: device.id,
              fromStatus: 'IN_INTAKE',
              toStatus: 'AVAILABLE',
              actorId: staff,
              reason: 'INTAKE_PASSED',
            },
          ],
        });
        mf05Devices.set(d.assetTag, { id: device.id, created: true });
        created.push(`device ${d.assetTag}`);
      }

      let contract2 = await tx.rentalContract.findUnique({ where: { code: CONTRACT_CODE_2 } });
      if (!contract2) {
        const holdingFeeRatio2 = new Prisma.Decimal(
          String(await parameterValue(tx, 'billing.holdingFeeRatio')),
        );
        contract2 = await tx.rentalContract.create({
          data: {
            code: CONTRACT_CODE_2,
            organizationId: organization.id,
            planType: PlanType.MONTHLY,
            hardwareVariantId: variants.get(CONTRACT_VARIANT)!.id,
            quantity: MF05_DEVICES.length,
            requestedStartDate: utcDate(now),
            monthlyUnitPriceVnd: mf05VariantStatic.monthlyPriceVnd,
            holdingFeeRatio: holdingFeeRatio2,
            status: 'ACTIVE',
            statusChangedAt: now,
            requestedById: manager,
            decidedById: staff,
            decidedAt: now,
            handedOverAt: now,
            handedOverById: staff,
            terms: { create: { seq: 1, startsAt: now, endsAt: addMonths(now, 1) } },
          },
        });
        await tx.contractTransition.createMany({
          data: [
            { contractId: contract2.id, toStatus: 'REQUESTED', actorId: manager },
            {
              contractId: contract2.id,
              fromStatus: 'REQUESTED',
              toStatus: 'APPROVED',
              actorId: staff,
            },
            {
              contractId: contract2.id,
              fromStatus: 'APPROVED',
              toStatus: 'ACTIVE',
              actorId: staff,
            },
          ],
        });
        created.push(`contract ${CONTRACT_CODE_2}`);
      }
      for (const d of MF05_DEVICES) {
        const device = mf05Devices.get(d.assetTag)!;
        if (await tx.contractDevice.findFirst({ where: { deviceId: device.id } })) continue;
        await tx.contractDevice.create({
          data: {
            contractId: contract2.id,
            deviceId: device.id,
            reservedAt: now,
            handedOverAt: now,
          },
        });
        if (device.created) {
          await tx.deviceProvisioning.create({
            data: {
              deviceId: device.id,
              organizationId: organization.id,
              keyVersion: 1,
              provisionedById: staff,
            },
          });
          const ref = { refType: 'CONTRACT', refId: contract2.id, actorId: staff };
          await tx.deviceTransition.createMany({
            data: [
              {
                deviceId: device.id,
                fromStatus: 'AVAILABLE',
                toStatus: 'RESERVED',
                reason: 'RESERVED',
                ...ref,
              },
              {
                deviceId: device.id,
                fromStatus: 'RESERVED',
                toStatus: 'RENTED',
                reason: 'HANDED_OVER',
                ...ref,
              },
            ],
          });
        }
        created.push(`contract device ${d.assetTag}`);
      }

      // Holder labels for the two rented units (FR-CON-14, BR-33), the same pattern RC-2026-0001 uses
      // above: written only while the label is still empty, fictitious names.
      for (const [assetTag, holderName, holderPhone] of HOLDER_LABELS_2) {
        const { count } = await tx.contractDevice.updateMany({
          where: {
            contractId: contract2.id,
            deviceId: mf05Devices.get(assetTag)!.id,
            holderName: null,
          },
          data: { holderName, holderPhone },
        });
        if (count > 0) created.push(`holder label ${assetTag}`);
      }

      // Paid first (TERM) invoice for RC-2026-0002: a holding-fee line due at the term start and a
      // balance line due at the term end, matching InvoicesService.issueTermInvoice and money.ts
      // (replicated inline since this script runs outside the Nest DI container), paid in full by one
      // demo counter payment, so MF-05's balance invoice and close steps start from a settled first
      // term. RC-2026-0001 carries no invoice yet (see the file header); that gap is not touched here.
      const term2 = await tx.contractTerm.findFirstOrThrow({
        where: { contractId: contract2.id, seq: 1 },
        select: { id: true, seq: true, startsAt: true, endsAt: true },
      });
      if (!(await tx.invoice.findUnique({ where: { termId: term2.id } }))) {
        const feeVnd = termFeeVnd(mf05VariantStatic.monthlyPriceVnd, MF05_DEVICES.length);
        const holdingVnd = holdingFeeVnd(
          mf05VariantStatic.monthlyPriceVnd,
          MF05_DEVICES.length,
          contract2.holdingFeeRatio,
        );
        const balanceVnd = feeVnd - holdingVnd;
        const totalVnd = feeVnd;
        const devicesLabel = `${MF05_DEVICES.length} x ${CONTRACT_VARIANT}`;

        // Same numbering as InvoicesRepository.nextNumber: INV-<year>-<6 digits>, serialized under an
        // advisory lock per year so a real invoice issued the same demo day never collides.
        const invoiceYear = invoiceNumberYear(now);
        const invoicePrefix = `INV-${invoiceYear}-`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:invoice:${invoiceYear}`}))`;
        const latestInvoice = await tx.invoice.findFirst({
          where: { number: { startsWith: invoicePrefix } },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const invoiceSequence = latestInvoice
          ? Number(latestInvoice.number.slice(invoicePrefix.length)) + 1
          : 1;
        const invoiceNumber = `${invoicePrefix}${String(invoiceSequence).padStart(6, '0')}`;

        const invoice = await tx.invoice.create({
          data: {
            number: invoiceNumber,
            organizationId: organization.id,
            contractId: contract2.id,
            termId: term2.id,
            kind: InvoiceKind.TERM,
            status: invoiceStatusOf(totalVnd, 0n),
            totalVnd,
            paidVnd: 0n,
            issuedAt: now,
            lines: {
              create: [
                {
                  seq: 1,
                  type: InvoiceLineType.HOLDING_FEE,
                  description: `Term ${term2.seq} holding fee, ${devicesLabel}`,
                  dueAt: term2.startsAt,
                  createdById: null,
                  amountVnd: holdingVnd,
                  ...invoiceLineShape(holdingVnd, MF05_DEVICES.length),
                },
                {
                  seq: 2,
                  type: InvoiceLineType.TERM_BALANCE,
                  description: `Term ${term2.seq} balance, ${devicesLabel}`,
                  dueAt: term2.endsAt,
                  createdById: null,
                  amountVnd: balanceVnd,
                  ...invoiceLineShape(balanceVnd, MF05_DEVICES.length),
                },
              ],
            },
          },
          include: { lines: true },
        });

        const paymentReference = `DEMO-${CONTRACT_CODE_2}-01`;
        await tx.payment.create({
          data: {
            reference: paymentReference,
            organizationId: organization.id,
            contractId: contract2.id,
            invoiceId: invoice.id,
            amountVnd: totalVnd,
            method: PaymentMethod.CASH,
            status: 'CONFIRMED',
            isSandbox: false,
            recordedById: staff,
            confirmedAt: now,
          },
        });
        for (const invoiceLine of invoice.lines) {
          await tx.invoiceLine.update({
            where: { id: invoiceLine.id },
            data: { paidVnd: invoiceLine.amountVnd },
          });
        }
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidVnd: totalVnd, status: invoiceStatusOf(totalVnd, totalVnd) },
        });
        created.push(`invoice ${invoiceNumber}`);
        created.push(`payment ${paymentReference}`);
      }
      // --- end MF-05 second demo contract -----------------------------------------------------------

      // --- MF-03 step 7 authority report demo (D-078, 2026-11-01 demo) ----------------------------
      // One UNROUTED incident on TL-0001, which no contract holds, as an SOS from it would route
      // (incidents REQ-EVT-03): transition 1 CREATED to DETECTED, transition 2 ROUTED to UNROUTED,
      // version 1 as after one IncidentLifecycle.apply. No field event backs it, so `openedByEventId`
      // is null. Created only while TL-0001 has no incident at all, so a run after the demo closed it
      // adds nothing. The code takes the next number of the year, as IncidentsRepository.nextCode does.
      const reportDevice = devices.get(AUTHORITY_DEMO_DEVICE)!.id;
      if (!(await tx.incident.findFirst({ where: { deviceId: reportDevice } }))) {
        const prefix = `INC-${now.getUTCFullYear()}-`;
        const latest = await tx.incident.findFirst({
          where: { code: { startsWith: prefix } },
          orderBy: { code: 'desc' },
          select: { code: true },
        });
        const code = `${prefix}${String(latest ? Number(latest.code.slice(prefix.length)) + 1 : 1).padStart(6, '0')}`;
        const openedAt = new Date(now.getTime() - 10 * 60 * 1000);
        const incident = await tx.incident.create({
          data: {
            code,
            deviceId: reportDevice,
            state: IncidentState.UNROUTED,
            stateChangedAt: openedAt,
            source: IncidentSource.DEVICE_SOS,
            confidence: IncidentConfidence.CONFIRMED,
            firstEventAt: openedAt,
            lastEventAt: openedAt,
            lastLatitude: 11.9404,
            lastLongitude: 108.4583,
            lastPositionAt: openedAt,
            version: 1,
            createdAt: openedAt,
          },
        });
        await tx.incidentTransition.createMany({
          data: [
            {
              incidentId: incident.id,
              seq: 1,
              fromState: null,
              toState: IncidentState.DETECTED,
              reason: 'CREATED',
              createdAt: openedAt,
            },
            {
              incidentId: incident.id,
              seq: 2,
              fromState: IncidentState.DETECTED,
              toState: IncidentState.UNROUTED,
              reason: 'ROUTED',
              createdAt: openedAt,
            },
          ],
        });
        created.push(`incident ${code}`);
      }
      // --- end MF-03 step 7 authority report demo -------------------------------------------------

      // --- Contract authority report demo (incidents api-design 10, D-078) -----------------------
      // One monthly contract that ran its course to DEFAULTED, as the rentals 3.2 jobs would have
      // moved it: handed over two months ago, its only term ended a month ago with notice given,
      // RETURN_DUE at the term end, OVERDUE a week later, DEFAULTED yesterday. Its one device, TL-0019,
      // stays RENTED in the renter's custody. Everything is written only when the contract is absent,
      // and TL-0019 only when it is absent, so a second run adds nothing.
      if (!(await tx.rentalContract.findUnique({ where: { code: DEFAULTED_CONTRACT_CODE } }))) {
        const defaultedVariant = VARIANTS.find((v) => v.code === CONTRACT_VARIANT)!;
        const handedOverAt = addMonths(now, -2);
        const termEndsAt = addMonths(now, -1);
        const overdueAt = addDays(termEndsAt, 7);
        const defaultedAt = addDays(now, -1);
        let device = await tx.device.findUnique({ where: { assetTag: DEFAULTED_DEVICE.assetTag } });
        const deviceCreated = !device;
        if (!device) {
          device = await tx.device.create({
            data: {
              assetTag: DEFAULTED_DEVICE.assetTag,
              nodeNum: DEFAULTED_DEVICE.nodeNum,
              hardwareVariantId: variants.get(CONTRACT_VARIANT)!.id,
              firmwareVersion: defaultedVariant.firmwareBaseline,
              acquiredAt: addMonths(now, -4),
              status: DeviceStatus.RENTED,
              statusChangedAt: handedOverAt,
              registeredById: staff,
              serviceDueAt: utcDate(addDays(now, SERVICE_INTERVAL_DAYS)),
              keyVersion: 1,
              keyOrganizationId: organization.id,
              provisionedAt: handedOverAt,
            },
          });
          await tx.intakeCheck.create({
            data: {
              deviceId: device.id,
              gpsFixOk: true,
              radioOk: true,
              batteryOk: true,
              motionOk: defaultedVariant.hasMotionSensor ? true : null,
              passed: true,
              checkedById: staff,
            },
          });
          created.push(`device ${DEFAULTED_DEVICE.assetTag}`);
        }
        const contract3 = await tx.rentalContract.create({
          data: {
            code: DEFAULTED_CONTRACT_CODE,
            organizationId: organization.id,
            planType: PlanType.MONTHLY,
            hardwareVariantId: variants.get(CONTRACT_VARIANT)!.id,
            quantity: 1,
            requestedStartDate: utcDate(handedOverAt),
            monthlyUnitPriceVnd: defaultedVariant.monthlyPriceVnd,
            holdingFeeRatio: new Prisma.Decimal(
              String(await parameterValue(tx, 'billing.holdingFeeRatio')),
            ),
            status: ContractStatus.DEFAULTED,
            statusChangedAt: defaultedAt,
            requestedById: manager,
            decidedById: staff,
            decidedAt: handedOverAt,
            handedOverAt,
            handedOverById: staff,
            endsAt: termEndsAt,
            noticeGivenAt: addDays(termEndsAt, -14),
            noticeGivenById: manager,
            returnDueAt: termEndsAt,
            overdueAt,
            defaultedAt,
            terms: {
              create: {
                seq: 1,
                startsAt: handedOverAt,
                endsAt: termEndsAt,
                status: 'CLOSED',
                closedAt: termEndsAt,
              },
            },
          },
        });
        const S = ContractStatus;
        const steps: [ContractStatus | null, ContractStatus, Date, string][] = [
          [null, S.REQUESTED, handedOverAt, manager],
          [S.REQUESTED, S.APPROVED, handedOverAt, staff],
          [S.APPROVED, S.ACTIVE, handedOverAt, staff],
          [S.ACTIVE, S.ENDING, addDays(termEndsAt, -14), manager],
          [S.ENDING, S.RETURN_DUE, termEndsAt, staff],
          [S.RETURN_DUE, S.OVERDUE, overdueAt, staff],
          [S.OVERDUE, S.DEFAULTED, defaultedAt, staff],
        ];
        await tx.contractTransition.createMany({
          data: steps.map(([fromStatus, toStatus, createdAt, actorId]) => ({
            contractId: contract3.id,
            fromStatus,
            toStatus,
            actorId,
            createdAt,
          })),
        });
        await tx.contractDevice.create({
          data: {
            contractId: contract3.id,
            deviceId: device.id,
            reservedAt: handedOverAt,
            handedOverAt,
            holderName: 'Dang Van Long',
            holderPhone: '0912000019',
          },
        });
        if (deviceCreated) {
          await tx.deviceProvisioning.create({
            data: {
              deviceId: device.id,
              organizationId: organization.id,
              keyVersion: 1,
              provisionedById: staff,
            },
          });
          const ref = { refType: 'CONTRACT', refId: contract3.id, actorId: staff };
          await tx.deviceTransition.createMany({
            data: [
              { deviceId: device.id, toStatus: 'IN_INTAKE', actorId: staff, reason: 'REGISTERED' },
              {
                deviceId: device.id,
                fromStatus: 'IN_INTAKE',
                toStatus: 'AVAILABLE',
                actorId: staff,
                reason: 'INTAKE_PASSED',
              },
              {
                deviceId: device.id,
                fromStatus: 'AVAILABLE',
                toStatus: 'RESERVED',
                reason: 'RESERVED',
                ...ref,
              },
              {
                deviceId: device.id,
                fromStatus: 'RESERVED',
                toStatus: 'RENTED',
                reason: 'HANDED_OVER',
                ...ref,
              },
            ],
          });
        }
        created.push(`contract ${DEFAULTED_CONTRACT_CODE}`);
      }
      // --- end contract authority report demo -------------------------------------------------------

      // --- DEFAULTED contract balance demo (dry-run defect 16, D-078) -----------------------------
      // What RC-2026-0003's default is for: the TERM invoice of its first term, issued at handover as
      // InvoicesService.issueTermInvoice does (money from money.ts, the contract's own snapshot of the
      // price and the holding fee ratio). The holding fee was paid at the counter at handover, because
      // the handover is refused with FIRST_PAYMENT_MISSING until it is (BR-09); the term balance, due
      // at the term end, was never paid, so the contract page shows it as Due now. No LATE_FEE line:
      // ChargesService.chargeLate runs only at check-in and the overdue and default job charges
      // nothing, so a default with the device still out carries none. Found by the term's invoice, so
      // a database seeded before this block gains it on the next run and a second run adds nothing.
      const defaultedContract = await tx.rentalContract.findUnique({
        where: { code: DEFAULTED_CONTRACT_CODE },
        select: {
          id: true,
          quantity: true,
          monthlyUnitPriceVnd: true,
          holdingFeeRatio: true,
          handedOverAt: true,
        },
      });
      const defaultedTerm = defaultedContract
        ? await tx.contractTerm.findFirst({
            where: { contractId: defaultedContract.id, seq: 1 },
            select: { id: true, seq: true, startsAt: true, endsAt: true },
          })
        : null;
      if (
        defaultedContract &&
        defaultedTerm &&
        defaultedContract.handedOverAt &&
        !(await tx.invoice.findUnique({ where: { termId: defaultedTerm.id } }))
      ) {
        const feeVnd = termFeeVnd(
          defaultedContract.monthlyUnitPriceVnd,
          defaultedContract.quantity,
        );
        const holdingVnd = holdingFeeVnd(
          defaultedContract.monthlyUnitPriceVnd,
          defaultedContract.quantity,
          defaultedContract.holdingFeeRatio,
        );
        const balanceVnd = feeVnd - holdingVnd;
        const issuedAt = defaultedContract.handedOverAt;
        const devicesLabel = `${defaultedContract.quantity} x ${CONTRACT_VARIANT}`;

        // Same numbering as above and as InvoicesRepository.nextNumber, by the year of the issue time.
        const defaultedYear = invoiceNumberYear(issuedAt);
        const defaultedPrefix = `INV-${defaultedYear}-`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:invoice:${defaultedYear}`}))`;
        const latestDefaulted = await tx.invoice.findFirst({
          where: { number: { startsWith: defaultedPrefix } },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const defaultedNumber = `${defaultedPrefix}${String(
          latestDefaulted ? Number(latestDefaulted.number.slice(defaultedPrefix.length)) + 1 : 1,
        ).padStart(6, '0')}`;

        const defaultedInvoice = await tx.invoice.create({
          data: {
            number: defaultedNumber,
            organizationId: organization.id,
            contractId: defaultedContract.id,
            termId: defaultedTerm.id,
            kind: InvoiceKind.TERM,
            status: invoiceStatusOf(feeVnd, holdingVnd),
            totalVnd: feeVnd,
            paidVnd: holdingVnd,
            issuedAt,
            lines: {
              create: [
                {
                  seq: 1,
                  type: InvoiceLineType.HOLDING_FEE,
                  description: `Term ${defaultedTerm.seq} holding fee, ${devicesLabel}`,
                  dueAt: defaultedTerm.startsAt,
                  createdById: null,
                  amountVnd: holdingVnd,
                  paidVnd: holdingVnd,
                  ...invoiceLineShape(holdingVnd, defaultedContract.quantity),
                },
                {
                  seq: 2,
                  type: InvoiceLineType.TERM_BALANCE,
                  description: `Term ${defaultedTerm.seq} balance, ${devicesLabel}`,
                  dueAt: defaultedTerm.endsAt,
                  createdById: null,
                  amountVnd: balanceVnd,
                  ...invoiceLineShape(balanceVnd, defaultedContract.quantity),
                },
              ],
            },
          },
        });
        const defaultedPaymentRef = `DEMO-${DEFAULTED_CONTRACT_CODE}-01`;
        await tx.payment.create({
          data: {
            reference: defaultedPaymentRef,
            organizationId: organization.id,
            contractId: defaultedContract.id,
            invoiceId: defaultedInvoice.id,
            amountVnd: holdingVnd,
            method: PaymentMethod.CASH,
            status: 'CONFIRMED',
            isSandbox: false,
            recordedById: staff,
            confirmedAt: issuedAt,
          },
        });
        created.push(`invoice ${defaultedNumber}`);
        created.push(`payment ${defaultedPaymentRef}`);
      }
      // --- end DEFAULTED contract balance demo -------------------------------------------------------

      // --- Organization API key (organizations 2.7, monitoring 3.2) ------------------------------
      // One key for ORG-0001 from SEED_ORG_API_KEY, found by its hash, so a second run adds nothing and
      // a changed secret adds a second key. The secret itself is never stored.
      if (apiKey !== undefined) {
        const keyHash = createHash('sha256').update(apiKey).digest('hex');
        if (!(await tx.apiKey.findUnique({ where: { keyHash } }))) {
          await tx.apiKey.create({
            data: {
              organizationId: organization.id,
              name: DEMO_API_KEY_NAME,
              prefix: apiKey.slice(0, 8),
              keyHash,
              createdById: manager,
              createdAt: now,
            },
          });
          created.push(`api key ${apiKey.slice(0, 8)}`);
        }
      }
      // --- end organization API key ----------------------------------------------------------------

      // --- MF-02 sync status chain (D-078) ----------------------------------------------------------
      // One Field Station of ORG-0001, so the gateway simulator's health report
      // (GATEWAY_FS_USERNAME=fs-org-0001-1) lands on the Staff sync status page. The secret is random
      // and discarded: credential issue and the broker hooks are organizations 2.8 and gateway-sync
      // 3.1, and the local broker is open. Written only while the username is absent.
      if (
        !(await tx.fieldStation.findUnique({ where: { mqttUsername: FIELD_STATION_USERNAME } }))
      ) {
        await tx.fieldStation.create({
          data: {
            organizationId: organization.id,
            name: 'Ta Nang basecamp laptop',
            mqttUsername: FIELD_STATION_USERNAME,
            secretHash: await bcrypt.hash(
              `fs_${randomBytes(32).toString('base64url')}`,
              bcryptCost,
            ),
            createdById: manager,
          },
        });
        created.push(`field station ${FIELD_STATION_USERNAME}`);
      }
      // --- end MF-02 sync status chain ----------------------------------------------------------------

      return created;
    },
    { timeout: 60_000 },
  );
}

function readPasswords(env: NodeJS.ProcessEnv): SeedPasswords {
  const names = ACCOUNTS.map((a) => [a.key, `SEED_${a.key.toUpperCase()}_PASSWORD`] as const);
  const missing = names.filter(([, name]) => !env[name]).map(([, name]) => name);
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
  return Object.fromEntries(
    names.map(([key, name]) => [key, env[name]!]),
  ) as unknown as SeedPasswords;
}

async function main() {
  // The same files and order as ConfigModule in app.module.ts; a variable already set is kept.
  for (const file of ['.env', '../.env']) if (existsSync(file)) process.loadEnvFile(file);
  const expectUnchanged = process.argv.includes('--expect-unchanged');
  const passwords = readPasswords(process.env);
  const bcryptCost = Number(process.env.BCRYPT_COST ?? 12);
  const prisma = new PrismaClient();
  try {
    const apiKey = process.env.SEED_ORG_API_KEY || undefined;
    const created = await seedDemo(prisma, passwords, { now: new Date(), bcryptCost, apiKey });
    for (const label of created) console.log(`created ${label}`);
    console.log(`Demo seed: ${created.length} row group(s) created.`);
    if (expectUnchanged && created.length > 0) {
      console.error('Demo seed is not idempotent: a repeated run created rows.');
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

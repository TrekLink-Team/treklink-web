// Demo seed (specs/platform tasks.md 1.12, US-X02). Loads the data api-design/00-api-testing-guide.md §2
// assumes, on top of the migration seed (roles, permissions, business parameters):
//
//   - one account per role: admin@, staff@, manager@ and operator@treklink.local
//   - one ACTIVE organization, ORG-0001, with the Manager and the Operator as members
//   - hardware variants treklink-v2 to treklink-v4, a price schedule each, two damage rates
//   - eight AVAILABLE devices, and two RENTED devices on one ACTIVE monthly contract, RC-2026-0001
//
// Idempotent: every row is found by its natural key and created only when absent, and the history rows of
// a parent (transitions, intake checks, provisioning) are written only when the parent is created. A second
// run writes nothing; `--expect-unchanged` makes that run exit 1 if it would create anything. Nothing is
// updated, so a changed SEED_*_PASSWORD applies only to a fresh database.
//
// Out of scope: the contract carries no invoice, payment or signed handover note, because billing and the
// handover flow do not exist yet. Recreate the database once they do.
//
// Passwords come from SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD, SEED_MANAGER_PASSWORD and
// SEED_OPERATOR_PASSWORD, never from the repository. All names, codes and numbers are fictitious.
//
// Run: npm run seed:demo   (after `prisma migrate deploy`)

import {
  DeviceStatus,
  MemberRole,
  OrganizationStatus,
  PlanType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';

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
}

const ORGANIZATION_CODE = 'ORG-0001';
const CONTRACT_CODE = 'RC-2026-0001';
const CONTRACT_VARIANT = 'treklink-v3';

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
  { now, bcryptCost }: SeedOptions,
): Promise<string[]> {
  const created: string[] = [];

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
    const created = await seedDemo(prisma, passwords, { now: new Date(), bcryptCost });
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

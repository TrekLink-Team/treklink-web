// Demo time shift for MF-05 (D-078 demo, 2026-11-01). Moves a contract's open term end into the past
// and runs the real `rentals.termRollover` job once, so a contract under notice reaches RETURN_DUE
// without waiting a month. Optionally makes one device due for service within
// `devices.maintenanceLeadDays`, so its passed inspection opens a SCHEDULED maintenance record.
//
// Run (from the repository root, against a development or demo database only):
//   npm --prefix backend run demo:term-end -- RC-2026-0001
//   npm --prefix backend run demo:term-end -- RC-2026-0001 --service-due TL-0009
//
// It refuses to run when NODE_ENV is production. It writes contract_terms.endsAt (and startsAt only
// when the term would otherwise end before it starts) and devices.serviceDueAt directly, then calls
// TermRolloverJob.run() through a Nest application context with MQTT ingestion off, so a running
// backend keeps its broker session. A contract that is ACTIVE (no notice given) renews instead of
// moving to RETURN_DUE: give notice first.

import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { latestRentalDailyCutoff } from '../src/modules/rentals/rental-daily-cutoff';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const BUSINESS_ZONE_OFFSET_MS = 7 * 60 * MINUTE_MS;

// The job closes only terms due by the latest daily cutoff (`rentals.termRolloverHourLocal`), so the
// term ends one minute before it, which is never in the future and at most a day ago.
export const rolloverTermEnd = (now: Date, hourLocal: number): Date =>
  new Date(latestRentalDailyCutoff(now, hourLocal).getTime() - MINUTE_MS);

export interface DemoArgs {
  contractCode: string;
  serviceDueTag: string | null;
}

export const parseArgs = (argv: readonly string[]): DemoArgs => {
  const positional: string[] = [];
  let serviceDueTag: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--service-due') {
      serviceDueTag = argv[i + 1] ?? null;
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 1 || (argv.includes('--service-due') && !serviceDueTag)) {
    throw new Error('Usage: demo:term-end -- <contract code> [--service-due <asset tag>]');
  }
  return { contractCode: positional[0], serviceDueTag };
};

// Tomorrow in UTC+7, as the midnight-UTC value of a date column: inside any lead time of a day or more.
export const tomorrowBusinessDay = (now: Date): Date => {
  const local = new Date(now.getTime() + BUSINESS_ZONE_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + DAY_MS,
  );
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('demo:term-end refuses to run with NODE_ENV=production.');
  }
  const args = parseArgs(process.argv.slice(2));
  // Before AppModule loads its configuration: a second MQTT client with the backend's client id
  // would take over the running backend's broker session.
  process.env.MQTT_INGESTION_ENABLED = 'false';

  const prisma = new PrismaClient();
  const now = new Date();
  try {
    const contract = await prisma.rentalContract.findUnique({
      where: { code: args.contractCode },
      select: { id: true, status: true, planType: true },
    });
    if (!contract) throw new Error(`No contract ${args.contractCode}.`);
    console.log(`${args.contractCode}: ${contract.planType}, ${contract.status}`);
    if (contract.status === 'ACTIVE' && contract.planType === 'MONTHLY') {
      console.warn(
        'No notice given: the rollover will renew the term. Give notice first for MF-05.',
      );
    }

    const term = await prisma.contractTerm.findFirst({
      where: { contractId: contract.id, status: 'OPEN' },
      orderBy: { seq: 'desc' },
      select: { id: true, seq: true, startsAt: true, endsAt: true },
    });
    if (!term) throw new Error(`${args.contractCode} has no open term.`);
    const hour = await prisma.businessParameter.findUnique({
      where: { key: 'rentals.termRolloverHourLocal' },
      select: { value: true },
    });
    const endsAt = rolloverTermEnd(now, Number(hour?.value));
    const startsAt = term.startsAt < endsAt ? term.startsAt : new Date(endsAt.getTime() - DAY_MS);
    await prisma.contractTerm.update({ where: { id: term.id }, data: { startsAt, endsAt } });
    console.log(
      `Term ${term.seq} now ends ${endsAt.toISOString()} (was ${term.endsAt.toISOString()}).`,
    );

    if (args.serviceDueTag) {
      const serviceDueAt = tomorrowBusinessDay(now);
      const { count } = await prisma.device.updateMany({
        where: { assetTag: args.serviceDueTag },
        data: { serviceDueAt },
      });
      if (count === 0) throw new Error(`No device ${args.serviceDueTag}.`);
      console.log(`${args.serviceDueTag} service due ${serviceDueAt.toISOString().slice(0, 10)}.`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // Loaded only now, so the environment above applies.
  const { AppModule } = await import('../src/app.module');
  const { TermRolloverJob } = await import('../src/modules/rentals/term-rollover.job');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const outcome = await app.get(TermRolloverJob, { strict: false }).run(new Date());
    console.log(
      `Term rollover: ${outcome.renewed} renewed, ${outcome.returnDue} to RETURN_DUE, ${outcome.returned} to RETURNED.`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

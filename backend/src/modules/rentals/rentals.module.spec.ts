import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTODY_RESOLVER, LOSS_CASE_LISTENERS, LossCaseListener } from '../devices';
import { validate } from '../platform/config/environment-variables';
import {
  ALLOWED_TRANSITIONS,
  CONTRACT_CLOSE_CHECKS,
  CONTRACT_STATUS_CHANGED,
  ContractLifecycleService,
  ContractsService,
  isAllowedTransition,
  RentalsModule,
} from './index';
import { RentalsCustodyResolver } from './providers/custody-resolver.provider';
import { RentalsLossCaseListener } from './providers/loss-case-listener.provider';

// Values a developer's shell already holds win, as in test/e2e-env.ts.
const TEST_ENVIRONMENT: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATABASE_DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
  MAIL_TRANSPORT: 'console',
};

const compileRentals = () =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
      EventEmitterModule.forRoot(),
      ScheduleModule.forRoot(),
      PrismaModule,
      RentalsModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

// The module wires its repository and exports its services through the public surface.
describe('RentalsModule', () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) process.env[name] ??= value;
  });

  it('compiles and exports the lifecycle and contract services', async () => {
    const moduleRef = await compileRentals();

    expect(moduleRef.get(ContractLifecycleService)).toBeInstanceOf(ContractLifecycleService);
    expect(moduleRef.get(ContractsService)).toBeInstanceOf(ContractsService);
    await moduleRef.close();
  });

  // Task 1.3: `rentals` provides the ports `devices` declares, so `devices` never imports it.
  it('provides CUSTODY_RESOLVER and adds its listener to the LOSS_CASE_LISTENERS array', async () => {
    const moduleRef = await compileRentals();
    const listeners = moduleRef.get<LossCaseListener[]>(LOSS_CASE_LISTENERS, { strict: false });
    const rentalsListener = moduleRef.get(RentalsLossCaseListener);
    await moduleRef.init(); // runs the boot hooks, so the listener registers itself as at startup

    expect(moduleRef.get(CUSTODY_RESOLVER, { strict: false })).toBeInstanceOf(
      RentalsCustodyResolver,
    );
    expect(listeners).toContain(rentalsListener);
    await moduleRef.close();
  });

  it('exposes the port token, the event name and the lifecycle table', () => {
    expect(CONTRACT_CLOSE_CHECKS.description).toBe('CONTRACT_CLOSE_CHECKS');
    expect(CONTRACT_STATUS_CHANGED).toBe('contract.statusChanged');
    expect(isAllowedTransition('RETURNED', 'CLOSED')).toBe(true);
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
  });
});

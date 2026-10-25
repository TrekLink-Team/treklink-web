import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
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

// Values a developer's shell already holds win, as in test/e2e-env.ts.
const TEST_ENVIRONMENT: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATABASE_DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
  MAIL_TRANSPORT: 'console',
};

// The module wires its repository and exports its services through the public surface.
describe('RentalsModule', () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) process.env[name] ??= value;
  });

  it('compiles and exports the lifecycle and contract services', async () => {
    const moduleRef = await Test.createTestingModule({
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

    expect(moduleRef.get(ContractLifecycleService)).toBeInstanceOf(ContractLifecycleService);
    expect(moduleRef.get(ContractsService)).toBeInstanceOf(ContractsService);
    await moduleRef.close();
  });

  it('exposes the port token, the event name and the lifecycle table', () => {
    expect(CONTRACT_CLOSE_CHECKS.description).toBe('CONTRACT_CLOSE_CHECKS');
    expect(CONTRACT_STATUS_CHANGED).toBe('contract.statusChanged');
    expect(isAllowedTransition('RETURNED', 'CLOSED')).toBe(true);
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
  });
});

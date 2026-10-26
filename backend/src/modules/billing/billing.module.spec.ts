import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validate } from '../platform/config/environment-variables';
import {
  BalanceService,
  BillingModule,
  ceilVnd,
  ChargesService,
  dayPlanFeeVnd,
  holdingFeeVnd,
  InvoicesService,
  PAYMENT_CONFIRMED,
  PaymentsService,
  termFeeVnd,
} from './index';

// Values a developer's shell already holds win, as in test/e2e-env.ts.
const TEST_ENVIRONMENT: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATABASE_DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
  MAIL_TRANSPORT: 'console',
};

// The module wires its repositories and exports its services through the public surface.
describe('BillingModule', () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) process.env[name] ??= value;
  });

  it('compiles and exports the invoice, charge, balance and payment services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        PrismaModule,
        BillingModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(InvoicesService)).toBeInstanceOf(InvoicesService);
    expect(moduleRef.get(ChargesService)).toBeInstanceOf(ChargesService);
    expect(moduleRef.get(BalanceService)).toBeInstanceOf(BalanceService);
    expect(moduleRef.get(PaymentsService)).toBeInstanceOf(PaymentsService);
    await moduleRef.close();
  });

  it('exposes the money helpers and the payment event name', () => {
    expect(ceilVnd('0.5')).toBe(1n);
    expect(termFeeVnd(1n, 2)).toBe(2n);
    expect(holdingFeeVnd(2n, 1, '0.5')).toBe(1n);
    expect(dayPlanFeeVnd(30n, '1', 1, 1)).toBe(1n);
    expect(PAYMENT_CONFIRMED).toBe('payment.confirmed');
  });
});

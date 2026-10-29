import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp } from '../src/app.setup';
import { BalanceService } from '../src/modules/billing/balance.service';
import { InvoicesRepository } from '../src/modules/billing/invoices.repository';
import { PaymentsRepository } from '../src/modules/billing/payments.repository';
import { SepayController } from '../src/modules/billing/sepay.controller';
import { SepayService } from '../src/modules/billing/sepay.service';
import { SepayWebhookGuard } from '../src/modules/billing/sepay-webhook.guard';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// No database or external payment connection: exercise the guard before the real validation pipe.
describe('SePay webhook authentication before body validation (review of #92)', () => {
  const KEY = 'e2e-sepay-key';
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SepayController],
      providers: [
        SepayService,
        SepayWebhookGuard,
        ...[
          InvoicesRepository,
          BalanceService,
          PaymentsRepository,
          ParameterService,
          TransactionalEvents,
        ].map((provide) => ({ provide, useValue: {} })),
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              ({
                SEPAY_WEBHOOK_API_KEY: KEY,
                HTTP_BODY_LIMIT: '1mb',
                CORS_ORIGINS: 'http://localhost:5173',
              })[name],
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([undefined, 'Apikey wrong'])(
    'answers 401 for invalid credentials %s even when the body is invalid',
    async (authorization) => {
      const call = request(app.getHttpServer())
        .post('/api/payments/sepay/webhook')
        .send({ transferAmount: -1, unknownField: true });
      if (authorization) call.set('Authorization', authorization);
      const response = await call.expect(401);
      expect(response.body).toMatchObject({
        result: { errorCode: 'WEBHOOK_UNAUTHENTICATED' },
      });
      expect((response.body as { message: string }).message).not.toMatch(
        /transferAmount|unknownField|id/,
      );
    },
  );

  it('validates the body after accepting the API key', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/payments/sepay/webhook')
      .set('Authorization', `Apikey ${KEY}`)
      .send({ transferAmount: -1 })
      .expect(400);
    expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
  });
});

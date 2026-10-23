import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validate } from '../platform/config/environment-variables';
import { AuthModule, JwtAuthGuard, MAIL_PORT } from './index';

// Values a developer's shell already holds win, as in test/e2e-env.ts.
const TEST_ENVIRONMENT: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATABASE_DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_ACCESS_TTL: '15m',
  MAIL_TRANSPORT: 'console',
};

// The module wires its providers, the JWT signer and the mail port from configuration.
describe('AuthModule', () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(TEST_ENVIRONMENT)) process.env[name] ??= value;
  });

  it('compiles with the console mail transport and signs HS256 tokens with JWT_ACCESS_TTL', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        PrismaModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(moduleRef.get(MAIL_PORT)).toBeDefined();

    const jwt = moduleRef.get(JwtService);
    const token = await jwt.signAsync({ sub: 'user-1' });
    const decoded = jwt.decode<{ exp: number; iat: number }>(token);
    expect(decoded.exp - decoded.iat).toBe(900);
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toMatchObject({
      alg: 'HS256',
    });
    await moduleRef.close();
  });
});

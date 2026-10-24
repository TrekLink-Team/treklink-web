import { randomUUID } from 'node:crypto';
import { AccountType, OtpPurpose } from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { hashCode, OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const MAX_ATTEMPTS = 5;
const RIGHT = '482913';
const WRONG = '000000';
const PURPOSE = OtpPurpose.PASSWORD_RESET;

// The code attempt limit under concurrent guesses (auth task 3.1, REQ-ERR-03). Run only through
// test:db against a migrated disposable database. Never deletes data: the account carries a fresh run
// ID and each test spends the codes before it.
describe('one-time code attempts against Postgres (REQ-ERR-03)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const accounts = new AccountsRepository(prisma);
  const parameters = {
    get: (key: string) => Promise.resolve(key === 'auth.codeMaxAttempts' ? MAX_ATTEMPTS : 10),
  } as unknown as ParameterService;
  const codes = new OneTimeCodeService(accounts, parameters);
  const runId = randomUUID();
  let userId: string;

  const freshCode = async (expiresAt = new Date(Date.now() + 600_000)): Promise<string> => {
    await accounts.consumeLiveCodes(userId, PURPOSE, new Date());
    await accounts.createCode({ userId, purpose: PURPOSE, codeHash: hashCode(RIGHT), expiresAt });
    return (await accounts.findLiveCode(userId, PURPOSE))!.id;
  };

  const attemptsOf = async (id: string): Promise<number> =>
    (await prisma.oneTimeCode.findUniqueOrThrow({ where: { id } })).attempts;

  const guess = (code: string) => codes.verify(userId, PURPOSE, code, new Date());

  beforeAll(async () => {
    await prisma.$connect();
    userId = (
      await prisma.user.create({
        data: {
          email: `code-test-${runId}@example.invalid`,
          fullName: 'Code test account',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets no more than auth.codeMaxAttempts of 40 concurrent wrong guesses be counted', async () => {
    const id = await freshCode();

    const results = await Promise.allSettled(Array.from({ length: 40 }, () => guess(WRONG)));

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(await attemptsOf(id)).toBe(MAX_ATTEMPTS);
    await expect(guess(RIGHT)).rejects.toMatchObject({ errorCode: ErrorCode.CODE_INVALID });
  });

  it('accepts the right code at most once in a burst, and never counts past the limit', async () => {
    const id = await freshCode();

    const burst = [...Array.from({ length: 40 }, () => guess(WRONG)), guess(RIGHT)];
    const results = await Promise.allSettled(burst);

    expect(results.filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    expect(await attemptsOf(id)).toBe(MAX_ATTEMPTS);
  });

  it('accepts the right code on the last attempt after four wrong ones', async () => {
    const id = await freshCode();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      await expect(guess(WRONG)).rejects.toMatchObject({ errorCode: ErrorCode.CODE_INVALID });
    }

    await expect(guess(RIGHT)).resolves.toBe(id);
    expect(await attemptsOf(id)).toBe(MAX_ATTEMPTS);
  });

  it('refuses an expired code without counting an attempt', async () => {
    const id = await freshCode(new Date(Date.now() - 1_000));

    await expect(guess(RIGHT)).rejects.toMatchObject({ errorCode: ErrorCode.CODE_INVALID });
    expect(await attemptsOf(id)).toBe(0);
  });
});

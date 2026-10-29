import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SepayWebhookDto } from './billing-queries.dto';

// billing api-design 12 (review of #92): the webhook body is validated, so a missing or negative
// amount is refused before it reaches BigInt or the ledger.
describe('SepayWebhookDto', () => {
  const BODY = {
    id: 92704,
    gateway: 'Vietcombank',
    transactionDate: '2026-11-02 10:15:00',
    accountNumber: '0010000000355',
    code: null,
    content: 'TL7K2Q9M4D thanh toan',
    transferType: 'in',
    transferAmount: 1_125_000,
    accumulated: 19_077_000,
    subAccount: null,
    referenceCode: 'FT26306XXXX',
    description: 'BankAPINotify TL7K2Q9M4D',
  };
  const problems = async (body: object) =>
    (
      await validate(plainToInstance(SepayWebhookDto, body), {
        forbidNonWhitelisted: true,
        whitelist: true,
      })
    ).map((error) => error.property);

  it('accepts every field SePay sends', async () => {
    await expect(problems(BODY)).resolves.toEqual([]);
  });

  it.each([
    ['a missing amount', { transferAmount: undefined }],
    ['a negative amount', { transferAmount: -5 }],
    ['an amount of 0', { transferAmount: 0 }],
    ['a fractional amount', { transferAmount: 10.5 }],
    ['a missing id', { id: undefined }],
    ['an unknown transfer type', { transferType: 'sideways' }],
  ])('refuses %s', async (_, change) => {
    await expect(problems({ ...BODY, ...change })).resolves.not.toEqual([]);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOrganizationDto } from './profile.dto';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateOrganizationDto, plain);
  return { dto, errors: await validate(dto) };
};

describe('UpdateOrganizationDto (organizations api-design 04)', () => {
  it('takes any subset of the contact details, trimmed, with the version the caller saw', async () => {
    const { dto, errors } = await check({
      address: '  2 Test Street ',
      contactEmail: ' ops@acme.vn ',
      contactPhone: '0287654321',
      legalName: ' ACME Trek JSC ',
      expectedVersion: 3,
    });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({
      address: '2 Test Street',
      contactEmail: 'ops@acme.vn',
      legalName: 'ACME Trek JSC',
    });
    expect((await check({ expectedVersion: 0 })).errors).toEqual([]);
  });

  it('refuses a blank or oversized text, a bad email or phone, and a missing or bad version', async () => {
    for (const bad of [
      { address: '   ' },
      { address: 'x'.repeat(301) },
      { legalName: '' },
      { legalName: 'x'.repeat(201) },
      { contactEmail: 'not-an-email' },
      { contactPhone: 'call me' },
    ]) {
      expect((await check({ ...bad, expectedVersion: 0 })).errors).toHaveLength(1);
    }
    for (const expectedVersion of [-1, 1.5, '3', undefined]) {
      expect((await check({ address: 'x', expectedVersion })).errors).toHaveLength(1);
    }
  });
});

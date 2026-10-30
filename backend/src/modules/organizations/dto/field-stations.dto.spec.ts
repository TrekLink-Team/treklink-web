import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFieldStationDto, RevokeFieldStationDto } from './field-stations.dto';

const check = async <T extends object>(type: new () => T, plain: Record<string, unknown>) => {
  const dto = plainToInstance(type, plain);
  return { dto, errors: await validate(dto) };
};

describe('Field Station DTOs (organizations api-design 24, 25)', () => {
  it('trims the name of a station and accepts a name of up to 100 characters', async () => {
    const { dto, errors } = await check(CreateFieldStationDto, { name: '  Ta Nang laptop  ' });
    expect(errors).toEqual([]);
    expect(dto.name).toBe('Ta Nang laptop');

    expect((await check(CreateFieldStationDto, { name: 'x'.repeat(100) })).errors).toEqual([]);
    expect((await check(CreateFieldStationDto, { name: 'x'.repeat(101) })).errors).toHaveLength(1);
  });

  it('refuses a blank or missing name as "name is required." (MSG02)', async () => {
    for (const plain of [{ name: '   ' }, { name: '' }, {}, { name: 5 }]) {
      const { errors } = await check(CreateFieldStationDto, plain);
      expect(errors).toHaveLength(1);
    }
    const blank = await check(CreateFieldStationDto, { name: '  ' });
    expect(Object.values(blank.errors[0].constraints ?? {})).toContain('name is required.');
  });

  it('takes a reason that is optional, trimmed and at most 500 characters', async () => {
    expect((await check(RevokeFieldStationDto, {})).errors).toEqual([]);
    const { dto, errors } = await check(RevokeFieldStationDto, { reason: '  Laptop stolen ' });
    expect(errors).toEqual([]);
    expect(dto.reason).toBe('Laptop stolen');
    expect((await check(RevokeFieldStationDto, { reason: 'x'.repeat(501) })).errors).toHaveLength(
      1,
    );
    expect((await check(RevokeFieldStationDto, { reason: 7 })).errors).toHaveLength(1);
  });
});

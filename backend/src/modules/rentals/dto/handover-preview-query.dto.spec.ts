import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HandoverPreviewQueryDto } from './contract-decision.dto';

const D1 = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';

const queryOf = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(HandoverPreviewQueryDto, plain);
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('HandoverPreviewQueryDto (rentals api-design 08)', () => {
  it('needs no checks', async () => {
    const { dto, errors } = await queryOf({});
    expect(errors).toHaveLength(0);
    expect(dto.checks).toBeUndefined();
  });

  it('reads the JSON list of readings the counter holds', async () => {
    const { dto, errors } = await queryOf({
      checks: JSON.stringify([{ deviceId: D1, batteryPct: 96, gpsFixOk: true }]),
    });
    expect(errors).toHaveLength(0);
    expect(dto.checks).toEqual([{ deviceId: D1, batteryPct: 96, gpsFixOk: true }]);
  });

  it.each([
    ['not JSON', 'battery=96'],
    ['not a list', JSON.stringify({ deviceId: D1, batteryPct: 96, gpsFixOk: true })],
    ['a battery above 100', JSON.stringify([{ deviceId: D1, batteryPct: 101, gpsFixOk: true }])],
    [
      'a device id that is not a uuid',
      JSON.stringify([{ deviceId: 'TL-1', batteryPct: 9, gpsFixOk: true }]),
    ],
    [
      'an unknown field',
      JSON.stringify([{ deviceId: D1, batteryPct: 9, gpsFixOk: true, key: 'x' }]),
    ],
  ])('refuses %s', async (_label, checks) => {
    const { errors } = await queryOf({ checks });
    expect(errors.length).toBeGreaterThan(0);
  });
});

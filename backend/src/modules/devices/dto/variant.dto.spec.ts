import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateVariantDto } from './variant.dto';

const errorsOf = async (body: object) =>
  (await validate(plainToInstance(UpdateVariantDto, body))).map((error) => error.property);

// devices api-design 03 (review of treklink-web#382): a field may be left out, never sent as null.
describe('UpdateVariantDto', () => {
  it('accepts a body with only the version, and the edited fields alone', async () => {
    expect(await errorsOf({ expectedVersion: 3 })).toEqual([]);
    expect(await errorsOf({ name: 'TrekLink v3', isActive: false, expectedVersion: 3 })).toEqual(
      [],
    );
  });

  it.each([
    'name',
    'firmwareBaseline',
    'serviceChecklist',
    'isActive',
    'hasGps',
    'hasMotionSensor',
    'mqttCapable',
  ])('refuses %s: null, which would reach Prisma and answer 500', async (field) => {
    expect(await errorsOf({ [field]: null, expectedVersion: 3 })).toEqual([field]);
  });

  it('keeps null on serviceIntervalDays, which removes the periodic service', async () => {
    expect(await errorsOf({ serviceIntervalDays: null, expectedVersion: 3 })).toEqual([]);
  });
});

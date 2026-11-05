import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../../common/decorators/access.decorator';
import { FirmwareReleaseService } from './firmware-release.service';
import {
  FirmwareImageQueryDto,
  FirmwareReleaseQueryDto,
  FirmwareReleasesController,
} from './firmware-releases.controller';

// devices api-design 28 and 29 (task 8.2).
describe('FirmwareReleasesController', () => {
  const service = { list: jest.fn().mockResolvedValue([]), image: jest.fn().mockResolvedValue({}) };
  const controller = new FirmwareReleasesController(service as unknown as FirmwareReleaseService);
  const method = (name: 'list' | 'image') =>
    Object.getOwnPropertyDescriptor(FirmwareReleasesController.prototype, name)?.value as object;
  const policies = (name: 'list' | 'image') =>
    Reflect.getMetadata(CHECK_POLICIES_KEY, method(name)) as PolicyHandler[];

  it('checks device.read for the list and device.operate for an image', () => {
    const can = jest.fn().mockReturnValue(true);
    expect(policies('list').every((handler) => handler({ can }))).toBe(true);
    expect(can).toHaveBeenLastCalledWith('read', 'Device');
    expect(policies('image').every((handler) => handler({ can }))).toBe(true);
    expect(can).toHaveBeenLastCalledWith('operate', 'Device');
  });

  it('sends Cache-Control: no-store with an image', () => {
    expect(Reflect.getMetadata('__headers__', method('image'))).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);
  });

  it('passes the variant filter and the image kind, APP by default', async () => {
    await controller.list({ variantCode: 'treklink-v3' });
    expect(service.list).toHaveBeenCalledWith('treklink-v3');
    await controller.image('2.7.26-treklink.2', 'treklink-v3', {});
    expect(service.image).toHaveBeenLastCalledWith('2.7.26-treklink.2', 'treklink-v3', 'APP');
    await controller.image('2.7.26-treklink.2', 'treklink-v3', { kind: 'FACTORY' });
    expect(service.image).toHaveBeenLastCalledWith('2.7.26-treklink.2', 'treklink-v3', 'FACTORY');
  });

  it('refuses a kind other than APP or FACTORY and a malformed variant code', async () => {
    expect(
      await validate(plainToInstance(FirmwareImageQueryDto, { kind: 'BOOT' })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(FirmwareReleaseQueryDto, { variantCode: 'Treklink V3' })),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(FirmwareReleaseQueryDto, { variantCode: 'treklink-v3' })),
    ).toHaveLength(0);
  });
});

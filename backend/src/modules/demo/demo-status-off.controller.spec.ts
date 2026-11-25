import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  AUTHENTICATED_ONLY_KEY,
  CHECK_POLICIES_KEY,
  IS_PUBLIC_KEY,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DEMO_STATUS_OFF, DemoStatusOffController } from './demo-status-off.controller';
import { DemoStatusOffModule } from './demo-status-off.module';

const metadataTarget = () =>
  Object.getOwnPropertyDescriptor(DemoStatusOffController.prototype, 'status')!.value as object;
const metadataOf = (key: string) => Reflect.getMetadata(key, metadataTarget()) as unknown;

describe('DemoStatusOffController (D-113, specs/demo api-design 01)', () => {
  it('answers every field of the status at its off value', () => {
    expect(new DemoStatusOffController().status()).toEqual({
      enabled: false,
      quickEnabled: false,
      roleSwitchEnabled: false,
      databaseLocal: false,
      lastStaged: null,
    });
  });

  it('returns a copy, so a caller cannot change the off values', () => {
    const first = new DemoStatusOffController().status();
    first.enabled = true;
    expect(new DemoStatusOffController().status().enabled).toBe(false);
    expect(DEMO_STATUS_OFF.enabled).toBe(false);
  });

  it('keeps the token check of DemoController.status and adds no policy', () => {
    expect(metadataOf(AUTHENTICATED_ONLY_KEY)).toBe(true);
    expect(metadataOf(IS_PUBLIC_KEY)).toBeUndefined();
    expect(metadataOf(CHECK_POLICIES_KEY)).toBeUndefined();
    expect(metadataOf(RESPONSE_MESSAGE_KEY)).toBe('OK');
  });

  it('routes only GET /demo/status, and its module offers nothing else', () => {
    const methods = Object.getOwnPropertyNames(DemoStatusOffController.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual(['status']);
    expect(Reflect.getMetadata('path', DemoStatusOffController)).toBe('demo');
    expect(Reflect.getMetadata('path', metadataTarget())).toBe('status');
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DemoStatusOffModule)).toEqual([
      DemoStatusOffController,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DemoStatusOffModule)).toBeUndefined();
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, DemoStatusOffModule)).toBeUndefined();
  });
});

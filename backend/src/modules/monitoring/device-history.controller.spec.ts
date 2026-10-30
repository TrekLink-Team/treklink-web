import { createMongoAbility } from '@casl/ability';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DeviceHistoryController } from './device-history.controller';
import { DeviceHistoryService } from './device-history.service';

const CONFIG = {
  get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
} as never;

const metadataOf = (key: string): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(DeviceHistoryController.prototype, 'list')?.value as object,
  );

const allows = (rules: { action: string; subject: string }[]): boolean =>
  (metadataOf(CHECK_POLICIES_KEY) as PolicyHandler[]).every((handler) =>
    handler(createMongoAbility(rules) as PolicyAbility),
  );

describe('DeviceHistoryController (monitoring api-design 07)', () => {
  it('needs device.read and answers OK', () => {
    expect(allows([{ action: 'read', subject: 'Device' }])).toBe(true);
    expect(allows([{ action: 'operate', subject: 'Organization' }])).toBe(false);
    expect(allows([])).toBe(false);
    expect(metadataOf(RESPONSE_MESSAGE_KEY)).toBe('OK');
  });

  it('pages the history of one device', async () => {
    const history = { history: jest.fn().mockResolvedValue([[{ kind: 'STATE' }], 21]) };
    const controller = new DeviceHistoryController(
      history as unknown as DeviceHistoryService,
      CONFIG,
    );
    await expect(controller.list('d-1', { pageNumber: 2, pageSize: 20 })).resolves.toEqual({
      items: [{ kind: 'STATE' }],
      pageNumber: 2,
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
    });
    expect(history.history).toHaveBeenCalledWith('d-1', 20, 20);
  });
});

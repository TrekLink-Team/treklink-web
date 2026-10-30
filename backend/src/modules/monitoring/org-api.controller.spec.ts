import { ErrorCode } from '../../common/errors';
import type { RequestPrincipal } from '../auth';
import { ApiRateLimiter } from './api-rate-limiter';
import { OrgApiController } from './org-api.controller';
import { OrgApiService } from './org-api.service';
import { REPLAY_BATCH_SIZE } from './replay.service';

const KEY = { kind: 'API_KEY', apiKeyId: 'k-1', organization: { id: 'org-1' } } as RequestPrincipal;
const ACCOUNT = { id: 'u-1', organization: { id: 'org-1' } } as unknown as RequestPrincipal;

describe('OrgApiController (monitoring 3.2)', () => {
  const orgApi = {
    devicesOf: jest.fn().mockResolvedValue({ cursor: 1, devices: [] }),
    streamOf: jest.fn().mockResolvedValue({ entries: [], nextCursor: 5, hasMore: false }),
  };
  const limiter = { hit: jest.fn().mockResolvedValue(undefined) };
  const controller = new OrgApiController(
    orgApi as unknown as OrgApiService,
    limiter as unknown as ApiRateLimiter,
  );

  it('reads the devices of the key organization after counting the request', async () => {
    await expect(controller.devices(KEY)).resolves.toEqual({ cursor: 1, devices: [] });
    expect(limiter.hit).toHaveBeenCalledWith('k-1');
    expect(orgApi.devicesOf).toHaveBeenCalledWith('org-1');
  });

  it('streams after the cursor, 500 at most by default', async () => {
    await controller.stream({ after: 5 }, KEY);
    expect(orgApi.streamOf).toHaveBeenCalledWith('org-1', 5, REPLAY_BATCH_SIZE);
    await controller.stream({ after: 5, limit: 20 }, KEY);
    expect(orgApi.streamOf).toHaveBeenLastCalledWith('org-1', 5, 20);
  });

  it('refuses an access token with 403: the organization API takes a key only', async () => {
    await expect(controller.devices(ACCOUNT)).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
    await expect(controller.stream({ after: 0 }, ACCOUNT)).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
  });
});

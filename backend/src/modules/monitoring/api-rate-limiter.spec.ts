import { ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ApiRateLimiter } from './api-rate-limiter';

describe('ApiRateLimiter (monitoring 3.2, REQ-EVT-05)', () => {
  const parameters = { get: jest.fn().mockResolvedValue(60) };
  let limiter: ApiRateLimiter;

  beforeEach(() => {
    limiter = new ApiRateLimiter(parameters as unknown as ParameterService);
  });

  it('allows monitoring.apiRateLimitPerMinute requests a minute and refuses the next with 429', async () => {
    for (let i = 0; i < 60; i += 1) await limiter.hit('k-1', 1_000 + i);
    await expect(limiter.hit('k-1', 2_000)).rejects.toMatchObject({
      errorCode: ErrorCode.RATE_LIMITED,
      httpStatus: 429,
    });
    expect(parameters.get).toHaveBeenCalledWith('monitoring.apiRateLimitPerMinute');
  });

  it('counts each key on its own', async () => {
    for (let i = 0; i < 60; i += 1) await limiter.hit('k-1', 1_000);
    await expect(limiter.hit('k-2', 1_000)).resolves.toBeUndefined();
  });

  it('starts a new window a minute after the first request', async () => {
    for (let i = 0; i < 60; i += 1) await limiter.hit('k-1', 1_000);
    await expect(limiter.hit('k-1', 61_000)).resolves.toBeUndefined();
  });

  it('uses the clock when no time is given', async () => {
    await expect(limiter.hit('k-3')).resolves.toBeUndefined();
  });
});

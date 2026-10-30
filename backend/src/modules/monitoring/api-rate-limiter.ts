import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';

const WINDOW_MS = 60_000;

interface Window {
  startedAt: number;
  count: number;
}

// `monitoring.apiRateLimitPerMinute` per API key (REQ-EVT-05, E04-5): a fixed one-minute window per
// key, counted in this process. One backend instance serves the API (D-010), so no shared store is
// needed; a second instance would need one.
@Injectable()
export class ApiRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly parameters: ParameterService) {}

  // Counts one request of the key, or throws 429 RATE_LIMITED when the minute's limit is spent.
  async hit(apiKeyId: string, now: number = Date.now()): Promise<void> {
    const limit = await this.parameters.get('monitoring.apiRateLimitPerMinute');
    this.prune(now);
    const window = this.windows.get(apiKeyId);
    if (!window || now - window.startedAt >= WINDOW_MS) {
      this.windows.set(apiKeyId, { startedAt: now, count: 1 });
      return;
    }
    if (window.count >= limit) {
      throw new DomainException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many requests. Try again in a minute.',
      );
    }
    window.count += 1;
  }

  // Drops the windows of keys that have not called for a minute, so revoked keys do not accumulate.
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= WINDOW_MS) this.windows.delete(key);
    }
  }
}

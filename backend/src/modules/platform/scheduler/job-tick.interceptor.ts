import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { waitUntil } from '@vercel/functions';
import { Observable, concatMap } from 'rxjs';
import { ValidatedEnvironment } from '../config/environment-variables';
import { JobRunnerService } from './job-runner.service';

// How long the request that starts a tick waits for it before answering; the rest runs on.
export const TICK_HOLD_MS = 5_000;

// D-090 rule 1, design §4.6: with JOBS_TICK_ON_REQUEST, a request starts a job tick, at most once per
// instance per minute. The production showed that a Vercel function in server mode is frozen as soon as
// its response is sent, `waitUntil` notwithstanding (2026-11-01: ticks cut off mid-job), so the request
// that starts a tick holds its response until the tick settles or TICK_HOLD_MS passes. `/api/health` is
// never held: the landing page probes it with a short timeout. `waitUntil` is still called, for a
// runtime that honours it; on any other host it does nothing.
@Injectable()
export class JobTickInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(
    private readonly jobs: JobRunnerService,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.enabled = config.get('JOBS_TICK_ON_REQUEST', { infer: true }) === true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();
    const url = context.switchToHttp().getRequest<{ url?: string }>()?.url ?? '';
    const hold = !url.startsWith('/api/health');
    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        const tick = this.jobs.tickIfDue();
        if (tick) {
          waitUntil(tick);
          if (hold) await Promise.race([tick, delay(TICK_HOLD_MS)]);
        }
        return body;
      }),
    );
  }
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

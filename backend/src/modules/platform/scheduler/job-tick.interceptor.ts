import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { waitUntil } from '@vercel/functions';
import { Observable, finalize } from 'rxjs';
import { ValidatedEnvironment } from '../config/environment-variables';
import { JobRunnerService } from './job-runner.service';

// D-090 rule 1, design §4.6: with JOBS_TICK_ON_REQUEST, every request ends by starting a job tick, at
// most once per instance per minute. `waitUntil` keeps a Vercel function alive until the tick settles
// after the response is sent; on any other host it does nothing and the tick simply runs on.
@Injectable()
export class JobTickInterceptor implements NestInterceptor {
  private readonly enabled: boolean;

  constructor(
    private readonly jobs: JobRunnerService,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.enabled = config.get('JOBS_TICK_ON_REQUEST', { infer: true }) === true;
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();
    return next.handle().pipe(
      finalize(() => {
        const tick = this.jobs.tickIfDue();
        if (tick) waitUntil(tick);
      }),
    );
  }
}

import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, of } from 'rxjs';
import { ValidatedEnvironment } from '../config/environment-variables';
import { JobRunnerService } from './job-runner.service';
import { JobTickInterceptor } from './job-tick.interceptor';

const waitUntil = jest.fn();
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>): void => {
    waitUntil(p);
  },
}));

const interceptor = (enabled: boolean, tick: Promise<void> | null) => {
  const tickIfDue = jest.fn(() => tick);
  const jobs = { tickIfDue } as unknown as JobRunnerService;
  const config = {
    get: (key: string) => (key === 'JOBS_TICK_ON_REQUEST' ? enabled : undefined),
  } as unknown as ConfigService<ValidatedEnvironment, true>;
  return { tickIfDue, interceptor: new JobTickInterceptor(jobs, config) };
};
const handler: CallHandler = { handle: () => of('body') };
const context = {} as ExecutionContext;

beforeEach(() => waitUntil.mockReset());

describe('JobTickInterceptor (D-090 rule 1)', () => {
  it('hands a due tick to waitUntil after the response', async () => {
    const tick = Promise.resolve();
    const { tickIfDue, interceptor: subject } = interceptor(true, tick);
    await expect(lastValueFrom(subject.intercept(context, handler))).resolves.toBe('body');
    expect(tickIfDue).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(tick);
  });

  it('calls nothing when a tick ran within the minute', async () => {
    const { interceptor: subject } = interceptor(true, null);
    await lastValueFrom(subject.intercept(context, handler));
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('never ticks when JOBS_TICK_ON_REQUEST is off', async () => {
    const { tickIfDue, interceptor: subject } = interceptor(false, Promise.resolve());
    await lastValueFrom(subject.intercept(context, handler));
    expect(tickIfDue).not.toHaveBeenCalled();
  });
});

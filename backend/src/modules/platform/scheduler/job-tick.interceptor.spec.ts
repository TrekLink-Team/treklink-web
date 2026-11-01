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
const at = (url: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ url }) }) }) as unknown as ExecutionContext;
const context = at('/api/plans');

beforeEach(() => waitUntil.mockReset());

describe('JobTickInterceptor (D-090 rule 1)', () => {
  it('holds the response until a due tick settles, and hands it to waitUntil', async () => {
    let settle: () => void = () => undefined;
    const tick = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { interceptor: subject } = interceptor(true, tick);
    let answered = false;
    const response = lastValueFrom(subject.intercept(context, handler)).then((body) => {
      answered = true;
      return body;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(answered).toBe(false);
    expect(waitUntil).toHaveBeenCalledWith(tick);
    settle();
    await expect(response).resolves.toBe('body');
  });

  it('answers after TICK_HOLD_MS while a slow tick runs on', async () => {
    jest.useFakeTimers();
    try {
      const { interceptor: subject } = interceptor(true, new Promise<void>(() => undefined));
      const response = lastValueFrom(subject.intercept(context, handler));
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(response).resolves.toBe('body');
    } finally {
      jest.useRealTimers();
    }
  });

  it('never holds /api/health, which the landing page probes with a short timeout', async () => {
    const { tickIfDue, interceptor: subject } = interceptor(
      true,
      new Promise<void>(() => undefined),
    );
    await expect(lastValueFrom(subject.intercept(at('/api/health'), handler))).resolves.toBe(
      'body',
    );
    expect(tickIfDue).toHaveBeenCalledTimes(1);
  });

  it('hands a due tick to waitUntil', async () => {
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

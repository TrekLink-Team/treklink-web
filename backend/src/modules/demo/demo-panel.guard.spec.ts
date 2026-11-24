import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { DemoPanelFailures } from './demo-panel-failures';
import { DemoPanelGuard, PanelRequest } from './demo-panel.guard';
import * as passwordModule from './demo-panel-password';
import { hashPanelPassword } from './demo-panel-password';

const PASSWORD = 'panel password for tests';

const contextOf = (request: PanelRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const requestWith = (password?: string, remoteAddress = '203.0.113.5'): PanelRequest => ({
  socket: { remoteAddress },
  headers: password === undefined ? {} : { 'x-demo-panel-password': password },
});

describe('DemoPanelGuard (REQ-PNL-02, REQ-PNL-10, REQ-PNL-11)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPanelPassword(PASSWORD);
  });

  const guardWith = (value: string | undefined, failures = new DemoPanelFailures()) => {
    const config = {
      get: (key: string) =>
        key === 'DEMO_PANEL_PASSWORD_HASH'
          ? value
          : key === 'DISPLAY_TIMEZONE_DEFAULT'
            ? 'Asia/Ho_Chi_Minh'
            : undefined,
    } as unknown as ConfigService<ValidatedEnvironment, true>;
    return new DemoPanelGuard(config, failures);
  };

  const refusal = async (promise: Promise<boolean>) => {
    try {
      await promise;
    } catch (error) {
      return error as DomainException;
    }
    throw new Error('expected a refusal');
  };

  it('answers 404 when the hash is unset or malformed', async () => {
    for (const value of [undefined, '', 'scrypt:bad']) {
      const error = await refusal(guardWith(value).canActivate(contextOf(requestWith(PASSWORD))));
      expect(error.getStatus()).toBe(404);
    }
  });

  it('answers 401 DEMO_PANEL_PASSWORD_INVALID without the header or with a wrong password', async () => {
    for (const typed of [undefined, '', 'wrong password']) {
      const error = await refusal(guardWith(hash).canActivate(contextOf(requestWith(typed))));
      expect(error.getStatus()).toBe(401);
      expect(error.errorCode).toBe('DEMO_PANEL_PASSWORD_INVALID');
      expect(error.message).toBe('Enter the panel password.');
    }
  });

  it('lets the right password through and records the client address', async () => {
    const request = requestWith(PASSWORD);
    await expect(guardWith(hash).canActivate(contextOf(request))).resolves.toBe(true);
    expect(request.demoPanelClient).toBe('203.0.113.5');
  });

  it('answers 429 RATE_LIMITED after five failures, even for the right password', async () => {
    const guard = guardWith(hash);
    for (let i = 0; i < 5; i += 1) {
      expect((await refusal(guard.canActivate(contextOf(requestWith('nope'))))).getStatus()).toBe(
        401,
      );
    }
    const blocked = await refusal(guard.canActivate(contextOf(requestWith(PASSWORD))));
    expect(blocked.getStatus()).toBe(429);
    expect(blocked.errorCode).toBe('RATE_LIMITED');
    expect(blocked.message).toMatch(
      /^Too many wrong panel passwords\. Try again after \d\d:\d\d\.$/,
    );
    // Another address is unaffected.
    await expect(guard.canActivate(contextOf(requestWith(PASSWORD, '198.51.100.8')))).resolves.toBe(
      true,
    );
  });

  it('never logs the typed password or the hash', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await refusal(guardWith(hash).canActivate(contextOf(requestWith('secret typed value'))));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('secret typed value');
    expect(logged).not.toContain(hash.split(':')[2]);
    warn.mockRestore();
  });
});

describe('DemoPanelGuard under parallel guesses (review of treklink-web#541)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPanelPassword(PASSWORD);
  });
  const config = (value: string) =>
    ({
      get: (key: string) =>
        key === 'DEMO_PANEL_PASSWORD_HASH'
          ? value
          : key === 'DISPLAY_TIMEZONE_DEFAULT'
            ? 'UTC'
            : undefined,
    }) as unknown as ConfigService<ValidatedEnvironment, true>;

  it('compares at most the limit of 50 parallel wrong passwords from one address; the rest get 429', async () => {
    const guard = new DemoPanelGuard(config(hash), new DemoPanelFailures());
    const derive = jest.spyOn(passwordModule, 'verifyPanelPassword');
    const outcomes = await Promise.allSettled(
      Array.from({ length: 50 }, () => guard.canActivate(contextOf(requestWith('wrong guess')))),
    );
    const statuses = outcomes.map((o) =>
      o.status === 'rejected' ? (o.reason as DomainException).getStatus() : 200,
    );
    expect(derive).toHaveBeenCalledTimes(5);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(45);
    derive.mockRestore();
  });

  it('gives a right password its attempt back, so right passwords never add up to a block', async () => {
    const guard = new DemoPanelGuard(config(hash), new DemoPanelFailures());
    // The panel sends at most a read and a write at once; up to the limit may be in flight together.
    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => guard.canActivate(contextOf(requestWith(PASSWORD)))),
    );
    expect(parallel.every(Boolean)).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      await expect(guard.canActivate(contextOf(requestWith(PASSWORD)))).resolves.toBe(true);
    }
  });
});

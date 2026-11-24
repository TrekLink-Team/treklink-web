import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { DemoPanelFailures } from './demo-panel-failures';
import { DemoPanelGuard, PanelRequest } from './demo-panel.guard';
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

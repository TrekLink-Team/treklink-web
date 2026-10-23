import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ConsoleMailTransport } from './console.transport';
import { createMailPort } from './mail.factory';

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<ValidatedEnvironment, true>;

describe('mail', () => {
  it('console transport logs one line per mail (REQ-OPT-01)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const transport = new ConsoleMailTransport('TrekLink <no-reply@treklink.local>');

    await transport.send({ to: 'a@b.vn', subject: 'Your code', text: 'Code: 123456' });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'from=TrekLink <no-reply@treklink.local> to=a@b.vn subject="Your code" text="Code: 123456"',
    );
    log.mockRestore();
  });

  it('the factory builds the console transport from MAIL_TRANSPORT', () => {
    const port = createMailPort(
      configWith({ MAIL_TRANSPORT: 'console', MAIL_FROM: 'TrekLink <x@y.vn>' }),
    );
    expect(port).toBeInstanceOf(ConsoleMailTransport);
  });

  it('the factory stops the boot for a transport that is not available yet', () => {
    expect(() => createMailPort(configWith({ MAIL_TRANSPORT: 'smtp' }))).toThrow(
      'MAIL_TRANSPORT=smtp is not available yet; use console.',
    );
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ConsoleMailTransport } from './console.transport';
import { createMailPort } from './mail.factory';
import { SmtpMailTransport } from './smtp.transport';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const SMTP_URL = 'smtps://user%40example.test:app-password@smtp.example.test:465';
const FROM = 'TrekLink <x@y.vn>';

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<ValidatedEnvironment, true>;

describe('mail', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'm-1' });

  beforeEach(() => {
    sendMail.mockClear();
    jest.mocked(createTransport).mockReturnValue({ sendMail } as never);
  });

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

  it('smtp transport sends from MAIL_FROM through the server in SMTP_URL (auth task 1.3)', async () => {
    const transport = new SmtpMailTransport(SMTP_URL, FROM);

    await transport.send({ to: 'a@b.vn', subject: 'Your code', text: 'Code: 123456' });

    expect(createTransport).toHaveBeenCalledWith(SMTP_URL);
    expect(sendMail).toHaveBeenCalledWith({
      from: FROM,
      to: 'a@b.vn',
      subject: 'Your code',
      text: 'Code: 123456',
    });
  });

  it('smtp transport passes a failed send to the caller, which logs it without the code', async () => {
    sendMail.mockRejectedValueOnce(new Error('535 authentication failed'));

    await expect(
      new SmtpMailTransport(SMTP_URL, FROM).send({ to: 'a@b.vn', subject: 's', text: 't' }),
    ).rejects.toThrow('535 authentication failed');
  });

  it.each(['development', 'test'])(
    'the factory builds the console transport under NODE_ENV=%s',
    (env) => {
      const port = createMailPort(
        configWith({ MAIL_TRANSPORT: 'console', MAIL_FROM: FROM, NODE_ENV: env }),
      );
      expect(port).toBeInstanceOf(ConsoleMailTransport);
    },
  );

  it('the factory builds the smtp transport from SMTP_URL, in production too', () => {
    const port = createMailPort(
      configWith({ MAIL_TRANSPORT: 'smtp', SMTP_URL, MAIL_FROM: FROM, NODE_ENV: 'production' }),
    );
    expect(port).toBeInstanceOf(SmtpMailTransport);
  });

  it('the factory stops the boot for smtp without SMTP_URL', () => {
    expect(() => createMailPort(configWith({ MAIL_TRANSPORT: 'smtp', MAIL_FROM: FROM }))).toThrow(
      'MAIL_TRANSPORT=smtp needs SMTP_URL.',
    );
  });

  it('the factory refuses the console transport in production (D-063 rule 4, AC-06)', () => {
    expect(() =>
      createMailPort(
        configWith({ MAIL_TRANSPORT: 'console', MAIL_FROM: FROM, NODE_ENV: 'production' }),
      ),
    ).toThrow(
      'MAIL_TRANSPORT=console writes codes to the log and is for development and CI only; ' +
        'set MAIL_TRANSPORT=smtp in production.',
    );
  });
});

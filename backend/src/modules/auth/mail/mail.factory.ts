import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ConsoleMailTransport } from './console.transport';
import { MailPort } from './mail.port';
import { SmtpMailTransport } from './smtp.transport';

// Chooses the transport from MAIL_TRANSPORT, and stops the boot rather than run a misconfigured one:
// SMTP needs SMTP_URL, and the console transport, which writes codes to the log, never runs in
// production (D-063 rule 4, AC-06, REQ-OPT-01).
export const createMailPort = (config: ConfigService<ValidatedEnvironment, true>): MailPort => {
  const from = config.get('MAIL_FROM', { infer: true });

  if (config.get('MAIL_TRANSPORT', { infer: true }) === 'smtp') {
    const url = config.get('SMTP_URL', { infer: true });
    if (!url) throw new Error('MAIL_TRANSPORT=smtp needs SMTP_URL.');
    return new SmtpMailTransport(url, from);
  }

  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    throw new Error(
      'MAIL_TRANSPORT=console writes codes to the log and is for development and CI only; ' +
        'set MAIL_TRANSPORT=smtp in production.',
    );
  }
  return new ConsoleMailTransport(from);
};

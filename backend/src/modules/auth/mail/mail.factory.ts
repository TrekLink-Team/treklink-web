import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ConsoleMailTransport } from './console.transport';
import { MailPort } from './mail.port';

// Chooses the transport from MAIL_TRANSPORT. The SMTP transport ships with the first story that
// sends mail (US-UC09, auth task 3.2); until then `smtp` stops the process at boot instead of
// silently dropping email.
export const createMailPort = (config: ConfigService<ValidatedEnvironment, true>): MailPort => {
  const transport = config.get('MAIL_TRANSPORT', { infer: true });
  if (transport === 'console') {
    return new ConsoleMailTransport(config.get('MAIL_FROM', { infer: true }));
  }
  throw new Error(`MAIL_TRANSPORT=${transport} is not available yet; use console.`);
};

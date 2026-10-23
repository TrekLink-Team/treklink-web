import { Logger } from '@nestjs/common';
import { MailMessage, MailPort } from './mail.port';

// MAIL_TRANSPORT=console: writes each email to the server log instead of sending it, for local
// development and CI only (REQ-OPT-01).
export class ConsoleMailTransport implements MailPort {
  private readonly logger = new Logger('Mail');

  constructor(private readonly from: string) {}

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `from=${this.from} to=${message.to} subject=${JSON.stringify(message.subject)} ` +
        `text=${JSON.stringify(message.text)}`,
    );
    return Promise.resolve();
  }
}

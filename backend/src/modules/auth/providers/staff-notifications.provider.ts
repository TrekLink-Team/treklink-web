import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffNotifications } from '../../platform/ports';
import { AccountsRepository } from '../accounts.repository';
import { MAIL_PORT, MailPort } from '../mail/mail.port';

@Injectable()
export class AuthStaffNotifications implements StaffNotifications {
  private readonly logger = new Logger(AuthStaffNotifications.name);

  constructor(
    private readonly accounts: AccountsRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async send(subject: string, text: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const recipients = await this.accounts.staffEmailRecipients(tx);
    if (recipients.length === 0) {
      this.logger.warn('Operational email has no active Staff or Admin recipient.');
      return false;
    }
    let delivered = true;
    for (const recipient of recipients) {
      try {
        await this.mail.send({ to: recipient.email, subject, text });
      } catch {
        delivered = false;
        this.logger.warn(`Operational email failed for account ${recipient.id}.`);
      }
    }
    return delivered;
  }
}

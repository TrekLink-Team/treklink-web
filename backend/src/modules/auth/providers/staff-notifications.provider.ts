import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StaffDelivery, StaffNotifications } from '../../platform/ports';
import { AccountsRepository } from '../accounts.repository';
import { MAIL_PORT, MailPort } from '../mail/mail.port';

@Injectable()
export class AuthStaffNotifications implements StaffNotifications {
  private readonly logger = new Logger(AuthStaffNotifications.name);

  constructor(
    private readonly accounts: AccountsRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  async send(subject: string, text: string, tx?: Prisma.TransactionClient): Promise<StaffDelivery> {
    const recipients = await this.accounts.staffEmailRecipients(tx);
    if (recipients.length === 0) {
      this.logger.warn('Operational email has no active Staff or Admin recipient.');
      return { accepted: 0, failed: 0 };
    }
    const delivery: StaffDelivery = { accepted: 0, failed: 0 };
    for (const recipient of recipients) {
      try {
        await this.mail.send({ to: recipient.email, subject, text });
        delivery.accepted += 1;
      } catch {
        delivery.failed += 1;
        this.logger.warn(`Operational email failed for account ${recipient.id}.`);
      }
    }
    return delivery;
  }
}

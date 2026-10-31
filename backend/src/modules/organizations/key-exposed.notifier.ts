import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountsService, MAIL_PORT, type MailPort } from '../auth';
import { MembersRepository } from './members.repository';
import { ORGANIZATION_KEY_EXPOSED, type OrganizationKeyExposedEvent } from './organization-events';
import { OrganizationsService } from './organizations.service';

const SUBJECT = 'Your organization channel key is exposed';
const TEXT =
  'A device in your organization custody was lost, so the channel key of your organization is ' +
  'treated as exposed. TrekLink Staff will rotate it at the counter, and your devices take the ' +
  'new key when they are re-provisioned there.';

// REQ-EVT-13, AC-11: tells the live Managers of an organization that its channel key is exposed. It runs
// after the commit that set `channelKeyExposedAt`. With no live Manager with an address, the contact
// address given at registration is used. A failed send is logged and never thrown: the flag is already
// saved, and Staff see it on screen 3.6.
@Injectable()
export class KeyExposedNotifier {
  private readonly logger = new Logger(KeyExposedNotifier.name);

  constructor(
    private readonly members: MembersRepository,
    private readonly accounts: AccountsService,
    private readonly organizations: OrganizationsService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  @OnEvent(ORGANIZATION_KEY_EXPOSED)
  async onKeyExposed({ organizationId }: OrganizationKeyExposedEvent): Promise<void> {
    try {
      const userIds = await this.members.liveManagerUserIds(organizationId);
      const cards = await this.accounts.contactCard(userIds);
      const addresses = cards
        .filter((card) => card.isActive && card.email)
        .map((card) => card.email);
      if (addresses.length === 0) {
        await this.organizations.emailContact(organizationId, SUBJECT, TEXT);
        return;
      }
      if (!this.mail) return;
      for (const to of addresses) {
        await this.mail.send({ to, subject: SUBJECT, text: TEXT }).catch((error: unknown) => {
          this.logger.warn(
            `Key exposure email to a Manager of ${organizationId} failed: ${String(error)}`,
          );
        });
      }
    } catch (error) {
      this.logger.error(
        `Managers of ${organizationId} were not told of the exposed key: ${String(error)}`,
      );
    }
  }
}

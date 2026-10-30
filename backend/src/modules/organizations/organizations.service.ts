import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService, MAIL_PORT, type MailPort } from '../auth';
import { MembersRepository } from './members.repository';
import {
  FieldStationHealthRow,
  OrganizationLabel,
  OrganizationsRepository,
} from './organizations.repository';

export interface MemberView {
  id: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  invitationPending: boolean;
  deactivatedAt: Date | null;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

// The methods other modules call (design §5). `assertActive` for rentals 2.1; the member list, the
// channel key version and the live-Manager check for the counter handover (rentals 2.3, 2.4); task
// 2.4 builds the rest of the lifecycle around them.
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: MembersRepository,
    private readonly accounts: AccountsService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  // Task 2.4 part, built by LongLP for rentals 3.2 (REQ-EVT-13, D-035): a contract that defaulted
  // suspends its ACTIVE organization, by SYSTEM, in the caller's transaction, with a transition naming
  // the contract. An organization in any other status is left as it is. Returns whether it changed.
  async suspendForDefault(
    organizationId: string,
    contractCode: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const current = await this.organizations.lockById(organizationId, tx);
    if (!current || current.status !== OrganizationStatus.ACTIVE) return false;
    const saved = await this.organizations.update(
      organizationId,
      current.version,
      { status: OrganizationStatus.SUSPENDED, statusChangedAt: at },
      tx,
    );
    if (!saved) return false;
    await this.organizations.addTransition(
      {
        organizationId,
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.SUSPENDED,
        actorId: null,
        reason: `Contract ${contractCode} defaulted`,
      },
      tx,
    );
    return true;
  }

  // Emails the organization's contact address, the Manager given at registration (rentals 3.2
  // reminders). Returns whether the transport accepted it; a failed send is logged, never thrown, so
  // a job carries on with the next contract. `tx` reads the address in the caller's transaction.
  async emailContact(
    organizationId: string,
    subject: string,
    text: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const to = await this.organizations.contactEmail(organizationId, tx);
    if (!to || !this.mail) return false;
    try {
      await this.mail.send({ to, subject, text });
      return true;
    } catch (error) {
      this.logger.warn(`Email to organization ${organizationId} failed: ${String(error)}`);
      return false;
    }
  }

  // organizations api-design 12, read-only part of task 2.5: a member reads its own organization,
  // TrekLink Staff any; another organization answers 404. `invitationPending` is true while the
  // account is still inactive (it has not set its password).
  async membersOf(
    organizationId: string,
    includeDeactivated: boolean,
    caller: Caller,
  ): Promise<MemberView[]> {
    if (caller.organizationId !== null && caller.organizationId !== organizationId)
      throw notFound();
    if ((await this.organizations.findStatus(organizationId)) === null) throw notFound();
    const rows = await this.members.membersOf(organizationId, includeDeactivated);
    const cards = await this.accounts.contactCard(rows.map((row) => row.userId));
    const cardOf = new Map(cards.map((card) => [card.id, card]));
    return rows.map((row) => {
      const card = cardOf.get(row.userId);
      return {
        id: row.id,
        userId: row.userId,
        email: card?.email ?? null,
        fullName: card?.fullName ?? null,
        role: row.role,
        // An invited account is created active; it waits for its password until the code is used.
        invitationPending: card ? !card.passwordSet && row.deactivatedAt === null : false,
        deactivatedAt: row.deactivatedAt,
      };
    });
  }

  // organizations api-design 03, the head only: the counter handover (screen 5.4) needs the key
  // version to write. A member reads its own organization, TrekLink Staff any; another is 404.
  async summary(organizationId: string, caller: Caller) {
    if (caller.organizationId !== null && caller.organizationId !== organizationId)
      throw notFound();
    const row = await this.organizations.findSummary(organizationId);
    if (!row) throw notFound();
    return row;
  }

  // The version of the channel key the organization's devices must carry (D-021); 404 when unknown.
  async channelKeyVersion(organizationId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const version = await this.organizations.channelKeyVersion(organizationId, tx);
    if (version === null) throw notFound();
    return version;
  }

  // Whether the account is a live Manager of the organization (the handover signer, rentals 2.4).
  async isActiveManager(
    organizationId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const member = await this.members.findLiveMember(organizationId, userId, tx);
    return member?.role === MemberRole.MANAGER;
  }

  // An organization that is not ACTIVE may not request devices: 409 ORGANIZATION_NOT_ACTIVE naming
  // its status (FR-CON-02, rentals api-design 01); an unknown id is 404.
  async assertActive(organizationId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const status = await this.organizations.findStatus(organizationId, tx);
    if (status === null) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    if (status !== OrganizationStatus.ACTIVE) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ORGANIZATION_NOT_ACTIVE,
        `Your organization cannot request devices while it is ${status}.`,
      );
    }
  }

  // Full names by account id, for the incident owner, status authors and MSG27 (incidents 5.1, 4.1).
  // An unknown or soft-deleted account is absent.
  async memberNames(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const cards = await this.accounts.contactCard([...new Set(userIds)]);
    return new Map(cards.map((card) => [card.id, card.fullName]));
  }

  // Code and legal name by organization id, for the contract and invoice reads of rentals and
  // billing; an unknown id is absent. In the caller's transaction when it passes one.
  async labelsOf(
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, OrganizationLabel>> {
    if (ids.length === 0) return new Map();
    const rows = await this.organizations.labels([...new Set(ids)], tx);
    return new Map(rows.map((row) => [row.id, row]));
  }

  // --- live map read (monitoring api-design 02, FR-EVT-13) ---
  // The Field Stations the live map lists with their last sync time: one organization's, or the
  // whole fleet's for null. A revoked station is not listed.
  fieldStationHealth(organizationId: string | null): Promise<FieldStationHealthRow[]> {
    return this.organizations.activeFieldStations(organizationId);
  }
  // --- end live map read ---
}

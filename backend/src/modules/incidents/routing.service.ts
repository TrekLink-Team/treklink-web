import { Injectable } from '@nestjs/common';
import { IncidentState, Prisma } from '@prisma/client';
import { AccountsService } from '../auth';
import { RosterService } from '../organizations';
import { IncidentRecipients } from './incident-lifecycle';

export interface Attribution {
  organizationId: string | null;
  contractId: string | null;
}

export interface Route {
  to: Extract<IncidentState, 'NOTIFY_PRIMARY' | 'UNROUTED'>;
  recipients: IncidentRecipients;
}

// Staff recipients of UNROUTED stay empty until task 2.2 takes them; ESCALATED reads them from `auth`
// in recipientsOf (D-079).
const NO_STAFF: readonly string[] = [];

// Task 2.2 (FR-INC-03, BR-32, BR-36). The incident goes to the contract and organization the
// triggering event was attributed to, whatever that contract's state is now; the device's current
// holder is never consulted. An unattributed event, or an organization with nobody to alert, goes to
// UNROUTED. Empty tiers are skipped by the lifecycle.
@Injectable()
export class RoutingService {
  constructor(
    private readonly roster: RosterService,
    private readonly accounts: AccountsService,
  ) {}

  async route(attribution: Attribution, at: Date, tx: Prisma.TransactionClient): Promise<Route> {
    const { organizationId } = attribution;
    if (!organizationId) return this.unrouted();
    const tiers = await this.roster.tiersAt(organizationId, at, tx);
    if (tiers.primary.length + tiers.backup.length + tiers.managers.length === 0)
      return this.unrouted();
    return { to: 'NOTIFY_PRIMARY', recipients: { ...tiers, staff: NO_STAFF } };
  }

  // The tiers of the organization an incident is already routed to, and the active TrekLink Staff,
  // for a timer's transition (task 3.1). The lifecycle alerts Staff only on ESCALATED (MSG34, D-079).
  // No organization alerts nobody.
  async recipientsOf(
    organizationId: string | null,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<IncidentRecipients> {
    if (!organizationId) return this.unrouted().recipients;
    const tiers = await this.roster.tiersAt(organizationId, at, tx);
    return { ...tiers, staff: await this.accounts.activeStaffIds(tx) };
  }

  private unrouted(): Route {
    return {
      to: 'UNROUTED',
      recipients: { primary: [], backup: [], managers: [], staff: NO_STAFF },
    };
  }
}

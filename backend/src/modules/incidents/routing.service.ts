import { Injectable } from '@nestjs/common';
import { IncidentState, Prisma } from '@prisma/client';
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

// Staff recipients wait for the leader's ruling on how `incidents` reads TrekLink Staff accounts:
// platform design Figure 3 has no `incidents --> auth` edge (tasks.md 2.2 note, MF-03 session).
const NO_STAFF: readonly string[] = [];

// Task 2.2 (FR-INC-03, BR-32, BR-36). The incident goes to the contract and organization the
// triggering event was attributed to, whatever that contract's state is now; the device's current
// holder is never consulted. An unattributed event, or an organization with nobody to alert, goes to
// UNROUTED. Empty tiers are skipped by the lifecycle.
@Injectable()
export class RoutingService {
  constructor(private readonly roster: RosterService) {}

  async route(attribution: Attribution, at: Date, tx: Prisma.TransactionClient): Promise<Route> {
    const { organizationId } = attribution;
    if (!organizationId) return this.unrouted();
    const tiers = await this.roster.tiersAt(organizationId, at, tx);
    if (tiers.primary.length + tiers.backup.length + tiers.managers.length === 0)
      return this.unrouted();
    return { to: 'NOTIFY_PRIMARY', recipients: { ...tiers, staff: NO_STAFF } };
  }

  private unrouted(): Route {
    return {
      to: 'UNROUTED',
      recipients: { primary: [], backup: [], managers: [], staff: NO_STAFF },
    };
  }
}

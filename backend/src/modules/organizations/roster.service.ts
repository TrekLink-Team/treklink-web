import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RosterRepository } from './roster.repository';

// Account ids per alert tier. Incident owners and alert rows reference accounts, so these are user
// ids, never member ids.
export interface RosterTiers {
  primary: string[];
  backup: string[];
  managers: string[];
}

// Task 2.6, the `tiersAt` read only, built for incidents routing (MF-03, 2026-10-29). Shift create,
// edit, delete and list join here with the rest of 2.6.
@Injectable()
export class RosterService {
  constructor(private readonly roster: RosterRepository) {}

  // Who is alerted for the organization at this instant: the shift's primary and backup while they
  // are live members, and every live Manager. No shift, or an empty slot, gives an empty tier, which
  // the incident lifecycle skips. The organization's status is not checked: a suspended organization
  // is still routed (BR-36).
  async tiersAt(
    organizationId: string,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<RosterTiers> {
    const [slots, managers] = await Promise.all([
      this.roster.slotsAt(organizationId, at, tx),
      this.roster.managerUserIds(organizationId, tx),
    ]);
    return {
      primary: slots.primaryUserId ? [slots.primaryUserId] : [],
      backup: slots.backupUserId ? [slots.backupUserId] : [],
      managers,
    };
  }
}

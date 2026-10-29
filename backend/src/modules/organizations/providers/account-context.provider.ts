import { Injectable } from '@nestjs/common';
import { AccountContextProvider, AccountMembership, AccountOrganization } from '../../auth';
import { MembersRepository } from '../members.repository';

// Provides ACCOUNT_CONTEXT_PROVIDER for `auth` (task 1.3, D-060 rule 1): the organization, its code and
// legal name, the member role and the organization status. Null for a TrekLink account, which has no
// member row, and for a deactivated member. `auth` decides what each status allows (REQ-STA-03).
@Injectable()
export class OrganizationAccountContextProvider implements AccountContextProvider {
  constructor(private readonly members: MembersRepository) {}

  forUser(userId: string): Promise<AccountMembership | null> {
    return this.members.findLiveMembership(userId);
  }

  // auth api-design 17: the authentication log names each account's organization and filters by it,
  // so a deactivated member still counts.
  organizationsOf(userIds: readonly string[]): Promise<Map<string, AccountOrganization>> {
    return this.members.organizationsOfUsers(userIds);
  }

  async memberUserIds(organizationId: string): Promise<string[]> {
    const rows = await this.members.membersOf(organizationId, true);
    return rows.map((row) => row.userId);
  }
}

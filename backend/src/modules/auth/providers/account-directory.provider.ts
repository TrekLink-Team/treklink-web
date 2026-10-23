import { Injectable } from '@nestjs/common';
import { AccountDirectory } from '../../platform/ports';
import { AccountsRepository } from '../accounts.repository';

// Provides platform's ACCOUNT_DIRECTORY: the display names of actors in the parameter history and the
// audit log (platform design §2.1).
@Injectable()
export class AuthAccountDirectory implements AccountDirectory {
  constructor(private readonly accounts: AccountsRepository) {}

  namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.accounts.namesOf(userIds);
  }
}

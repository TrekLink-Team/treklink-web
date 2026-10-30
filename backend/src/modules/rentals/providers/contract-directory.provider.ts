import { Injectable } from '@nestjs/common';
import { ContractDirectory, ContractLabel } from '../../billing';
import { OrganizationsService } from '../../organizations';
import { ContractsRepository } from '../contracts.repository';

// Provides billing's CONTRACT_DIRECTORY: the contract code, organization code and term sequence the
// invoice and payment reads show (billing design §4), and each contract's variant for revenue.
@Injectable()
export class RentalsContractDirectory implements ContractDirectory {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
  ) {}

  async describe(contractIds: readonly string[], termIds: readonly string[]) {
    const [rows, terms] = await Promise.all([
      contractIds.length > 0 ? this.contracts.codes(contractIds) : Promise.resolve([]),
      termIds.length > 0 ? this.contracts.termSeqs(termIds) : Promise.resolve([]),
    ]);
    const organizations = await this.organizations.labelsOf(rows.map((row) => row.organizationId));
    return {
      contracts: new Map<string, ContractLabel>(
        rows.map((row) => [
          row.id,
          { code: row.code, organizationCode: organizations.get(row.organizationId)?.code ?? null },
        ]),
      ),
      termSeqs: new Map(terms.map((term) => [term.id, term.seq])),
    };
  }

  async variantsOf(contractIds: readonly string[]) {
    if (contractIds.length === 0) return new Map<string, string>();
    const rows = await this.contracts.variantsOf(contractIds);
    return new Map(rows.map((row) => [row.id, row.hardwareVariantId]));
  }
}

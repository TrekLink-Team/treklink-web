// Display codes for billing read models (api-design 08, 09, 14): the contract code, the
// organization code and the term sequence. Declared by `billing`, which may not read
// `rental_contracts` or `contract_terms` (owned by `rentals`); provided by `rentals`, which depends on
// `billing` (platform design §2.1, the D-032 pattern). Without a provider every code is null.
export const CONTRACT_DIRECTORY = Symbol('CONTRACT_DIRECTORY');

export interface ContractLabel {
  code: string;
  organizationCode: string | null;
}

export interface ContractDirectory {
  // An unknown id is absent from either map.
  describe(
    contractIds: readonly string[],
    termIds: readonly string[],
  ): Promise<{ contracts: Map<string, ContractLabel>; termSeqs: Map<string, number> }>;
}

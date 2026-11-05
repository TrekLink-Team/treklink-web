// Display codes for billing read models (api-design 08, 09, 14): the contract code, the
// organization code and the term sequence. Declared by `billing`, which may not read
// `rental_contracts` or `contract_terms` (owned by `rentals`); provided by `rentals`, which depends on
// `billing` (platform design §2.1, the D-032 pattern). Without a provider every code is null.
export const CONTRACT_DIRECTORY = Symbol('CONTRACT_DIRECTORY');

export interface ContractLabel {
  code: string;
  organizationCode: string | null;
}

// The buyer block of an invoice (screen 6.1, billing api-design 09): the organization's registered
// legal name, tax code and address, as the organization review recorded them.
export interface InvoiceBuyer {
  legalName: string;
  taxCode: string;
  address: string;
}

export interface ContractDirectory {
  // An unknown id is absent from either map.
  describe(
    contractIds: readonly string[],
    termIds: readonly string[],
  ): Promise<{ contracts: Map<string, ContractLabel>; termSeqs: Map<string, number> }>;
  // The hardware variant of each contract, for revenue per variant (billing task 2.4, monitoring
  // api-design 08). Kept apart from the display labels, which the invoice reads answer as they are.
  variantsOf(contractIds: readonly string[]): Promise<Map<string, string>>;
  // The buyer of an invoice of this organization; null for an unknown id.
  buyerOf(organizationId: string): Promise<InvoiceBuyer | null>;
}

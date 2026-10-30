// Counts other modules supply to the organization detail (api-design 03). Declared by `organizations`;
// `rentals` provides `runningContracts` and `incidents` provides `openIncidents`, because
// `organizations` may not read their tables. The token holds an array the providers add themselves to
// when their module starts, like ORGANIZATION_EXIT_CHECKS; a count with no provider is reported as 0.
export const ORGANIZATION_COUNTS = Symbol('ORGANIZATION_COUNTS');

export type OrganizationCountName = 'runningContracts' | 'openIncidents';

export interface OrganizationCountProvider {
  readonly name: OrganizationCountName;
  count(organizationId: string): Promise<number>;
}

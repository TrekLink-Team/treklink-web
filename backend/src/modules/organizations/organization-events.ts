// Emitted after commit by every change of an organization's status (design §5, platform design §2.3).
export const ORGANIZATION_STATUS_CHANGED = 'organization.statusChanged';

export interface OrganizationStatusChangedEvent {
  organizationId: string;
  from: string;
  to: string;
}

// Emitted after commit by every change of an organization's status (design §5, platform design §2.3).
export const ORGANIZATION_STATUS_CHANGED = 'organization.statusChanged';

// Emitted after commit when a loss in renter custody marks an organization's channel key exposed
// (organizations 2.9, REQ-EVT-13, D-045). The Managers are told by email.
export const ORGANIZATION_KEY_EXPOSED = 'organization.keyExposed';

export interface OrganizationKeyExposedEvent {
  organizationId: string;
  at: Date;
}

export interface OrganizationStatusChangedEvent {
  organizationId: string;
  from: string;
  to: string;
  // The reason given with the change, when there is one (the rejection reason shown to the Manager).
  reason?: string | null;
}

// Emitted after commit when a Guest registers an organization (REQ-EVT-01): TrekLink Staff are told.
export const ORGANIZATION_REGISTERED = 'organization.registered';

export interface OrganizationRegisteredEvent {
  organizationId: string;
  code: string;
  legalName: string;
}

// Emitted after commit when Staff record a verification (REQ-EVT-02): Admins are told it awaits approval.
export const ORGANIZATION_VERIFIED = 'organization.verified';

export interface OrganizationVerifiedEvent {
  organizationId: string;
  code: string;
  legalName: string;
}

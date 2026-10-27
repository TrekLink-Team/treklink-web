import type { SessionUser } from '../../entities/session/model';

/** Who the workspace belongs to: the organization (name and code) or TrekLink for staff. */
export const workspaceOf = (user: SessionUser): { name: string; code: string | null } =>
  user.organization
    ? { name: user.organization.legalName, code: user.organization.code }
    : { name: 'TrekLink', code: user.roles.includes('ADMIN') ? 'Admin' : 'Staff' };


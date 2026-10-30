import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { OrganizationsRepository } from './organizations.repository';

export interface RotatedChannelKey {
  id: string;
  channelKeyVersion: number;
  channelKeyExposedAt: null;
}

const ROTATABLE: readonly OrganizationStatus[] = [
  OrganizationStatus.ACTIVE,
  OrganizationStatus.SUSPENDED,
];

// Channel key rotation (task 2.9, api-design 27, D-045, D-021): TrekLink Staff record that the key was
// rotated with the counter's provisioning tool. `channelKeyVersion` increases and
// `channelKeyExposedAt` is cleared, compare-and-set on the organization's `version`; devices take the
// new version as they are re-provisioned. `markKeyExposed` for devices stays with task 2.9.
@Injectable()
export class ChannelKeyService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly events: TransactionalEvents,
  ) {}

  rotate(
    organizationId: string,
    reason: string,
    expectedVersion: number,
    staff: Caller,
  ): Promise<RotatedChannelKey> {
    return this.events.transaction(async (tx) => {
      const current = await this.organizations.lockById(organizationId, tx);
      if (!current) {
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Organization not found.',
        );
      }
      if (!ROTATABLE.includes(current.status)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${current.status}.`,
        );
      }
      const saved = await this.organizations.update(
        organizationId,
        expectedVersion,
        { channelKeyVersion: { increment: 1 }, channelKeyExposedAt: null },
        tx,
      );
      if (!saved) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'This was changed by someone else. Reload and try again.',
        );
      }
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: staff.id,
        actorRoles: staff.roles,
        organizationId,
        action: 'organization.rotateKey',
        subjectType: 'Organization',
        subjectId: organizationId,
        before: { channelKeyVersion: current.channelKeyVersion },
        after: { channelKeyVersion: saved.channelKeyVersion, reason },
      } satisfies AuditRecordEvent);
      return {
        id: saved.id,
        channelKeyVersion: saved.channelKeyVersion,
        channelKeyExposedAt: null,
      };
    });
  }
}

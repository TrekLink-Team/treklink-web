import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { hkdfSync } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { channelKeyExposed } from './channel-key-exposed.error';
import { ORGANIZATION_KEY_EXPOSED, OrganizationKeyExposedEvent } from './organization-events';
import { OrganizationsRepository } from './organizations.repository';

export interface RotatedChannelKey {
  id: string;
  channelKeyVersion: number;
  channelKeyExposedAt: null;
}

// What rentals api-design 21 returns: the derived key and the version it was derived for. The key is
// never stored, logged or audited (REQ-UBI-03); this object lives for one response.
export interface DerivedChannelKey {
  keyHex: string;
  keyVersion: number;
}

const KEY_BYTES = 32;

const ROTATABLE: readonly OrganizationStatus[] = [
  OrganizationStatus.ACTIVE,
  OrganizationStatus.SUSPENDED,
];

// Channel key rotation (task 2.9, api-design 27, D-045, D-021): TrekLink Staff record that the key was
// rotated with the counter's provisioning tool. `channelKeyVersion` increases and
// `channelKeyExposedAt` is cleared, compare-and-set on the organization's `version`; devices take the
// new version as they are re-provisioned. `markKeyExposed` is the other direction: `devices` calls it
// when a loss in renter custody exposes the key, and the flag stays until the next rotation.
@Injectable()
export class ChannelKeyService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // devices design section 8.6 decision 1 (D-082): HKDF-SHA256 of the deployment's CHANNEL_KEY_MASTER with
  // the organization id as salt and `treklink-channel-key/v{version}` as info, 32 bytes. Deterministic, so
  // the same organization and version always give the same key and nothing is stored; a rotation is a
  // version bump (`rotate`). An unknown organization is 404, and one whose key is flagged exposed is 409
  // CHANNEL_KEY_EXPOSED. The caller has checked who may ask.
  async deriveKey(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DerivedChannelKey> {
    const state = await this.organizations.channelKeyState(organizationId, tx);
    if (state === null) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    // REQ-ERR-20: a key flagged exposed is not issued again before the rotation.
    if (state.channelKeyExposedAt !== null) throw channelKeyExposed();
    const version = state.channelKeyVersion;
    const master = this.config.get('CHANNEL_KEY_MASTER', { infer: true });
    const key = Buffer.from(
      hkdfSync('sha256', master, organizationId, `treklink-channel-key/v${version}`, KEY_BYTES),
    );
    return { keyHex: key.toString('hex'), keyVersion: version };
  }

  // REQ-EVT-13, AC-11: sets `channelKeyExposedAt`, in the caller's transaction, and has the Managers told
  // after commit (KeyExposedNotifier). Any status qualifies, because the key is exposed whatever the
  // organization is doing. A second call while the flag is set keeps the first time and tells nobody
  // again: it returns false. An unknown organization is 404. `actor` is the Staff who triaged the loss.
  async markKeyExposed(
    organizationId: string,
    at: Date,
    actor: Caller | null,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const current = await this.organizations.lockById(organizationId, tx);
    if (!current) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    if (current.channelKeyExposedAt !== null) return false;
    // The row is locked, so the version read above is still the current one; a null here means the
    // write did not happen, and then nothing is emitted.
    const saved = await this.organizations.update(
      organizationId,
      current.version,
      { channelKeyExposedAt: at },
      tx,
    );
    if (!saved) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'This was changed by someone else. Reload and try again.',
      );
    }
    this.events.emitAfterCommit(ORGANIZATION_KEY_EXPOSED, {
      organizationId,
      at,
    } satisfies OrganizationKeyExposedEvent);
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor?.id ?? null,
      actorRoles: actor?.roles ?? [],
      organizationId,
      action: 'organization.keyExposed',
      subjectType: 'Organization',
      subjectId: organizationId,
      before: { channelKeyExposedAt: null },
      after: { channelKeyExposedAt: at },
    } satisfies AuditRecordEvent);
    return true;
  }

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

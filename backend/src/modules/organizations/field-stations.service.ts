import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { FIELD_STATION_REVOKED, FieldStationRevokedEvent } from './field-station-events';
import {
  FieldStationRelease,
  FieldStationReleaseService,
  isOutdatedAgainst,
} from './field-station-release.service';
import {
  FieldStationRow,
  FieldStationsRepository,
  StationCredential,
  StationHealth,
} from './field-stations.repository';
import { OrganizationsRepository } from './organizations.repository';

export const FIELD_STATION_SECRET_PREFIX = 'fs_';

// `fs_` and 43 base64url characters from 32 random bytes (design §4, REQ-EVT-09).
export const generateStationSecret = (): string =>
  FIELD_STATION_SECRET_PREFIX + randomBytes(32).toString('base64url');

export interface StationView {
  id: string;
  name: string;
  mqttUsername: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSyncAt: Date | null;
  // Queued events per priority, null until the station first reports (ruling 2026-10-30).
  queueDepth: { p0: number; p1: number; p2: number; p3: number } | null;
  oldestRetryCount: number;
  version: string | null;
  outdated: boolean;
}

export interface StationList {
  items: StationView[];
  limit: number;
}

// The secret and the broker address are returned once, by `create` only (REQ-UBI-03).
export type CreatedStation = StationView & { mqttSecret: string; brokerUrl: string };

const organizationNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

const stationNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Field Station not found.');

const toView = (row: FieldStationRow, release: FieldStationRelease | null): StationView => ({
  id: row.id,
  name: row.name,
  mqttUsername: row.mqttUsername,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
  lastSyncAt: row.lastSyncAt,
  queueDepth:
    row.queueDepth.length === 4
      ? {
          p0: row.queueDepth[0],
          p1: row.queueDepth[1],
          p2: row.queueDepth[2],
          p3: row.queueDepth[3],
        }
      : null,
  oldestRetryCount: row.oldestRetryCount ?? 0,
  version: row.version,
  outdated: isOutdatedAgainst(row.version, release?.version ?? null),
});

// Field Station credentials of an organization (task 2.8, api-design 23 to 26, UC-06, D-037). A member
// reaches only its own organization and any other answers 404 (REQ-ERR-05); TrekLink Staff and Admin
// read any organization and revoke any station. The secret is stored as a bcrypt hash and returned
// once by `create`; it is in no list, response or audit entry after that (REQ-UBI-03). `gateway-sync`
// calls `byUsername` for the broker check and `recordStationHealth` for the minute report.
@Injectable()
export class FieldStationsService {
  private readonly cost: number;
  private readonly brokerUrl: string;

  constructor(
    private readonly stations: FieldStationsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly release: FieldStationReleaseService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.cost = config.get('BCRYPT_COST', { infer: true });
    this.brokerUrl =
      config.get('FIELD_STATION_BROKER_URL', { infer: true }) ??
      config.get('MQTT_BROKER_URL', { infer: true });
  }

  async list(organizationId: string, caller: Caller): Promise<StationList> {
    await this.assertReadable(organizationId, caller);
    const [rows, limit, release] = await Promise.all([
      this.stations.list(organizationId),
      this.parameters.get('organizations.maxFieldStations'),
      this.release.currentOrNull(),
    ]);
    return { items: rows.map((row) => toView(row, release)), limit };
  }

  // api-design 26: the current release and one download per operating system.
  async currentRelease(organizationId: string, caller: Caller): Promise<FieldStationRelease> {
    await this.assertReadable(organizationId, caller);
    return this.release.current();
  }

  // The organization row is locked first, so two creates at the limit cannot both pass the count and
  // two creates cannot take one number. The hash is computed before the transaction, because bcrypt is
  // slow on purpose. A station is created for an ACTIVE organization only.
  async create(organizationId: string, name: string, caller: Caller): Promise<CreatedStation> {
    this.assertScope(organizationId, caller);
    const limit = await this.parameters.get('organizations.maxFieldStations');
    const secret = generateStationSecret();
    const secretHash = await bcrypt.hash(secret, this.cost);
    return this.events.transaction(async (tx) => {
      const organization = await this.organizations.lockById(organizationId, tx);
      if (!organization) throw organizationNotFound();
      if (organization.status !== OrganizationStatus.ACTIVE) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${organization.status}.`,
        );
      }
      if ((await this.stations.countActive(organizationId, tx)) >= limit) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STATION_LIMIT,
          'Revoke an unused Field Station before creating another.',
        );
      }
      const number = await this.stations.nextNumber(organizationId, tx);
      const saved = await this.stations.insert(
        {
          organizationId,
          name,
          mqttUsername: `fs-${organization.code.toLowerCase()}-${number}`,
          secretHash,
          createdById: caller.id,
        },
        tx,
      );
      this.audit(caller, organizationId, 'fieldStation.create', saved.id, null, {
        name: saved.name,
        mqttUsername: saved.mqttUsername,
      });
      return { ...toView(saved, null), mqttSecret: secret, brokerUrl: this.brokerUrl };
    });
  }

  // The Manager of the organization, TrekLink Staff and Admin revoke; Staff and Admin give a reason
  // (api-design 25). Revoking a revoked station answers it as it is and emits nothing again, before
  // the reason is checked, so a repeat revoke without a reason stays a 200, not a 400.
  async revoke(
    organizationId: string,
    stationId: string,
    reason: string | undefined,
    caller: Caller,
  ): Promise<StationView> {
    this.assertScope(organizationId, caller);
    const release = await this.release.currentOrNull();
    return this.events.transaction(async (tx) => {
      const current = await this.stations.find(organizationId, stationId, tx);
      if (!current) throw stationNotFound();
      if (current.revokedAt) return toView(current, release);
      if (caller.organizationId === null && !reason) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'reason is required.',
        );
      }
      const saved = await this.stations.revoke(
        organizationId,
        stationId,
        caller.id,
        new Date(),
        tx,
      );
      if (!saved) {
        return toView(
          (await this.stations.find(organizationId, stationId, tx)) ?? current,
          release,
        );
      }
      this.audit(
        caller,
        organizationId,
        'fieldStation.revoke',
        stationId,
        { revokedAt: null },
        { revokedAt: saved.revokedAt, reason: reason ?? null },
      );
      this.events.emitAfterCommit(FIELD_STATION_REVOKED, {
        organizationId,
        fieldStationId: stationId,
        mqttUsername: saved.mqttUsername,
      } satisfies FieldStationRevokedEvent);
      return toView(saved, release);
    });
  }

  // For `gateway-sync`: the station behind a broker username with its secret hash and revocation, or
  // null for an unknown username. The hash is for the bcrypt compare and goes nowhere else.
  byUsername(mqttUsername: string): Promise<StationCredential | null> {
    return this.stations.findByUsername(mqttUsername);
  }

  // For `gateway-sync` (FR-EVT-13, FR-EVT-18): the minute report of a station.
  recordStationHealth(id: string, health: StationHealth): Promise<void> {
    return this.stations.updateHealth(id, health);
  }

  private assertScope(organizationId: string, caller: Caller): void {
    if (caller.organizationId !== null && caller.organizationId !== organizationId) {
      throw organizationNotFound();
    }
  }

  private async assertReadable(organizationId: string, caller: Caller): Promise<void> {
    this.assertScope(organizationId, caller);
    if ((await this.organizations.findStatus(organizationId)) === null)
      throw organizationNotFound();
  }

  private audit(
    actor: Caller,
    organizationId: string,
    action: string,
    subjectId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'FieldStation',
      subjectId,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

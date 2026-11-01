import { ConfigService } from '@nestjs/config';
import { OrganizationStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { FIELD_STATION_REVOKED } from './field-station-events';
import { FieldStationReleaseService } from './field-station-release.service';
import { FieldStationRow, FieldStationsRepository } from './field-stations.repository';
import { FieldStationsService, generateStationSecret } from './field-stations.service';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-30T03:00:00.000Z');
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const RELEASE = { version: '1.2.0', publishedAt: AT.toISOString(), files: [] };

const row = (overrides: Partial<FieldStationRow> = {}): FieldStationRow => ({
  id: 'fs-1',
  name: 'Ta Nang laptop',
  mqttUsername: 'fs-org-0007-1',
  createdAt: AT,
  revokedAt: null,
  lastSyncAt: null,
  queueDepth: [],
  oldestRetryCount: null,
  version: null,
  ...overrides,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error.errorCode;
    throw error;
  }
  return 'NONE';
};

describe('FieldStationsService (organizations 2.8, api-design 23 to 25, UC-06)', () => {
  let stations: Record<string, jest.Mock>;
  let organizations: { findStatus: jest.Mock; lockById: jest.Mock };
  let release: { current: jest.Mock; currentOrNull: jest.Mock };
  let parameters: { get: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let env: Record<string, string | number | undefined>;
  let service: FieldStationsService;

  const build = () => {
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    return new FieldStationsService(
      stations as unknown as FieldStationsRepository,
      organizations as unknown as OrganizationsRepository,
      release as unknown as FieldStationReleaseService,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      { get: (key: string) => env[key] } as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  };

  beforeEach(() => {
    stations = {
      list: jest.fn().mockResolvedValue([]),
      countActive: jest.fn().mockResolvedValue(0),
      nextNumber: jest.fn().mockResolvedValue(1),
      insert: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          row({ name: data.name as string, mqttUsername: data.mqttUsername as string }),
        ),
      find: jest.fn().mockResolvedValue(null),
      revoke: jest.fn(),
      findByUsername: jest.fn(),
      findIdentityByUsername: jest.fn(),
      updateHealth: jest.fn().mockResolvedValue(undefined),
    };
    organizations = {
      findStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE),
      lockById: jest
        .fn()
        .mockResolvedValue({ id: 'org-1', code: 'ORG-0007', status: OrganizationStatus.ACTIVE }),
    };
    release = {
      current: jest.fn().mockResolvedValue(RELEASE),
      currentOrNull: jest.fn().mockResolvedValue(RELEASE),
    };
    parameters = { get: jest.fn().mockResolvedValue(5) };
    emitted = [];
    env = { BCRYPT_COST: 4, MQTT_BROKER_URL: 'mqtt://localhost:1883' };
    service = build();
  });

  describe('list and release (api-design 23, 26)', () => {
    it('lists the stations with the health, the limit and the outdated flag', async () => {
      stations.list.mockResolvedValue([
        row({
          id: 'fs-1',
          lastSyncAt: AT,
          queueDepth: [0, 0, 3, 12],
          oldestRetryCount: 2,
          version: '1.1.0',
        }),
        row({
          id: 'fs-2',
          mqttUsername: 'fs-org-0007-2',
          version: '1.2.0',
          queueDepth: [1, 2, 3, 4],
        }),
        row({ id: 'fs-3', mqttUsername: 'fs-org-0007-3' }),
      ]);

      const result = await service.list('org-1', MANAGER);

      expect(parameters.get).toHaveBeenCalledWith('organizations.maxFieldStations');
      expect(result.limit).toBe(5);
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'fs-1',
          lastSyncAt: AT,
          queueDepth: { p0: 0, p1: 0, p2: 3, p3: 12 },
          oldestRetryCount: 2,
          version: '1.1.0',
          outdated: true,
        }),
        expect.objectContaining({
          id: 'fs-2',
          outdated: false,
          queueDepth: { p0: 1, p1: 2, p2: 3, p3: 4 },
        }),
        expect.objectContaining({
          id: 'fs-3',
          queueDepth: null,
          oldestRetryCount: 0,
          version: null,
          outdated: false,
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain('secretHash');
    });

    it('never fails the list because the release cannot be read', async () => {
      release.currentOrNull.mockResolvedValue(null);
      stations.list.mockResolvedValue([row({ version: '0.1.0' })]);
      await expect(service.list('org-1', MANAGER)).resolves.toMatchObject({
        items: [{ outdated: false }],
      });
    });

    it('lets TrekLink Staff read any organization and answers 404 for another member or a missing one', async () => {
      await expect(service.list('org-9', STAFF)).resolves.toMatchObject({ items: [] });
      expect(await codeOf(service.list('org-9', MANAGER))).toBe(ErrorCode.NOT_FOUND);
      organizations.findStatus.mockResolvedValueOnce(null);
      expect(await codeOf(service.list('org-1', MANAGER))).toBe(ErrorCode.NOT_FOUND);
    });

    it('returns the current release under the same scope, and its failure as it is', async () => {
      await expect(service.currentRelease('org-1', MANAGER)).resolves.toBe(RELEASE);
      expect(await codeOf(service.currentRelease('org-9', MANAGER))).toBe(ErrorCode.NOT_FOUND);

      release.current.mockRejectedValue(
        new DomainException(
          503,
          ErrorCode.RELEASE_UNAVAILABLE,
          'The Field Station download is unavailable.',
        ),
      );
      expect(await codeOf(service.currentRelease('org-1', STAFF))).toBe(
        ErrorCode.RELEASE_UNAVAILABLE,
      );
    });
  });

  describe('create (api-design 24)', () => {
    it('stores only the bcrypt hash, numbers the username from the organization code, and returns the secret once', async () => {
      const created = await service.create('org-1', 'Ta Nang laptop', MANAGER);

      expect(organizations.lockById).toHaveBeenCalledWith('org-1', TX);
      expect(stations.nextNumber).toHaveBeenCalledWith('org-1', TX);
      const [data, client] = stations.insert.mock.calls[0] as [Record<string, string>, unknown];
      expect(client).toBe(TX);
      expect(data).toMatchObject({
        organizationId: 'org-1',
        name: 'Ta Nang laptop',
        mqttUsername: 'fs-org-0007-1',
        createdById: 'u-mgr',
      });
      expect(created.mqttSecret).toMatch(/^fs_[A-Za-z0-9_-]{43}$/);
      expect(await bcrypt.compare(created.mqttSecret, data.secretHash)).toBe(true);
      expect(data.secretHash).not.toContain(created.mqttSecret);
      expect(created).toMatchObject({
        mqttUsername: 'fs-org-0007-1',
        brokerUrl: 'mqtt://localhost:1883',
        queueDepth: null,
        lastSyncAt: null,
        version: null,
        outdated: false,
        oldestRetryCount: 0,
        revokedAt: null,
      });
    });

    it('uses the next number the repository gives, so a revoked number is not taken again', async () => {
      stations.nextNumber.mockResolvedValue(4);
      stations.insert.mockImplementation((data: Record<string, unknown>) =>
        row({ mqttUsername: data.mqttUsername as string }),
      );
      await expect(service.create('org-1', 'Spare', MANAGER)).resolves.toMatchObject({
        mqttUsername: 'fs-org-0007-4',
      });
    });

    it('gives the broker address of FIELD_STATION_BROKER_URL when it is set', async () => {
      env.FIELD_STATION_BROKER_URL = 'mqtts://mqtt.treklink.vn:8883';
      service = build();
      await expect(service.create('org-1', 'Laptop', MANAGER)).resolves.toMatchObject({
        brokerUrl: 'mqtts://mqtt.treklink.vn:8883',
      });
    });

    it('records the creation without the secret or its hash', async () => {
      const created = await service.create('org-1', 'Ta Nang laptop', MANAGER);
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            actorId: 'u-mgr',
            organizationId: 'org-1',
            action: 'fieldStation.create',
            subjectType: 'FieldStation',
            subjectId: 'fs-1',
            before: null,
            after: { name: 'Ta Nang laptop', mqttUsername: 'fs-org-0007-1' },
          }),
        ],
      ]);
      expect(JSON.stringify(emitted)).not.toContain(created.mqttSecret);
    });

    it('refuses a create at the limit with 409 STATION_LIMIT and stores nothing', async () => {
      stations.countActive.mockResolvedValue(5);
      const error = await service.create('org-1', 'Sixth', MANAGER).catch((e: unknown) => e);
      expect((error as DomainException).errorCode).toBe(ErrorCode.STATION_LIMIT);
      expect((error as DomainException).message).toBe(
        'Revoke an unused Field Station before creating another.',
      );
      expect(stations.insert).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);

      stations.countActive.mockResolvedValue(4);
      await expect(service.create('org-1', 'Fifth', MANAGER)).resolves.toBeDefined();
    });

    it.each([
      OrganizationStatus.PENDING,
      OrganizationStatus.SUSPENDED,
      OrganizationStatus.REJECTED,
      OrganizationStatus.CLOSED,
    ])('refuses an organization that is %s with MSG28', async (status) => {
      organizations.lockById.mockResolvedValue({ id: 'org-1', code: 'ORG-0007', status });
      const error = await service.create('org-1', 'Laptop', MANAGER).catch((e: unknown) => e);
      expect((error as DomainException).errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      expect((error as DomainException).message).toBe(`This cannot be done while it is ${status}.`);
      expect(stations.insert).not.toHaveBeenCalled();
    });

    it('answers 404 for another organization and for a row that is gone', async () => {
      expect(await codeOf(service.create('org-9', 'Laptop', MANAGER))).toBe(ErrorCode.NOT_FOUND);
      expect(organizations.lockById).not.toHaveBeenCalled();
      organizations.lockById.mockResolvedValue(null);
      expect(await codeOf(service.create('org-1', 'Laptop', MANAGER))).toBe(ErrorCode.NOT_FOUND);
    });

    it('generates a secret of fs_ and 43 base64url characters each time', () => {
      const a = generateStationSecret();
      const b = generateStationSecret();
      expect(a).toMatch(/^fs_[A-Za-z0-9_-]{43}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('revoke (api-design 25)', () => {
    const LIVE = row({ version: '1.1.0' });
    const REVOKED = row({ version: '1.1.0', revokedAt: AT });

    it('lets the Manager revoke without a reason, and tells gateway-sync after commit', async () => {
      stations.find.mockResolvedValue(LIVE);
      stations.revoke.mockResolvedValue(REVOKED);

      const view = await service.revoke('org-1', 'fs-1', undefined, MANAGER);

      expect(stations.revoke).toHaveBeenCalledWith('org-1', 'fs-1', 'u-mgr', expect.any(Date), TX);
      expect(view).toMatchObject({ id: 'fs-1', revokedAt: AT, outdated: true });
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            action: 'fieldStation.revoke',
            subjectId: 'fs-1',
            before: { revokedAt: null },
            after: { revokedAt: AT, reason: null },
          }),
        ],
        [
          FIELD_STATION_REVOKED,
          { organizationId: 'org-1', fieldStationId: 'fs-1', mqttUsername: 'fs-org-0007-1' },
        ],
      ]);
    });

    it('lets TrekLink Staff revoke in any organization with a reason, and refuses them without one', async () => {
      stations.find.mockResolvedValue(LIVE);
      stations.revoke.mockResolvedValue(REVOKED);

      await expect(service.revoke('org-9', 'fs-1', 'Laptop stolen', STAFF)).resolves.toMatchObject({
        id: 'fs-1',
      });
      expect(emitted[0][1]).toMatchObject({ after: { reason: 'Laptop stolen' } });

      expect(await codeOf(service.revoke('org-9', 'fs-1', undefined, STAFF))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect(stations.revoke).toHaveBeenCalledTimes(1);
    });

    it('answers a station that is already revoked as it is, and emits nothing again', async () => {
      stations.find.mockResolvedValue(REVOKED);
      await expect(service.revoke('org-1', 'fs-1', undefined, MANAGER)).resolves.toMatchObject({
        revokedAt: AT,
      });
      expect(stations.revoke).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('stays idempotent for TrekLink Staff repeating a revoke without a reason', async () => {
      stations.find.mockResolvedValue(REVOKED);
      await expect(service.revoke('org-1', 'fs-1', undefined, STAFF)).resolves.toMatchObject({
        revokedAt: AT,
      });
      expect(stations.revoke).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers the current state when another revoke won the race', async () => {
      stations.find.mockResolvedValueOnce(LIVE).mockResolvedValueOnce(REVOKED);
      stations.revoke.mockResolvedValue(null);
      await expect(service.revoke('org-1', 'fs-1', undefined, MANAGER)).resolves.toMatchObject({
        revokedAt: AT,
      });
      expect(emitted).toEqual([]);

      stations.find.mockResolvedValueOnce(LIVE).mockResolvedValueOnce(null);
      await expect(service.revoke('org-1', 'fs-1', undefined, MANAGER)).resolves.toMatchObject({
        revokedAt: null,
      });
    });

    it('answers 404 for an unknown station and for another organization', async () => {
      expect(await codeOf(service.revoke('org-1', 'fs-9', undefined, MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
      expect(stations.find).toHaveBeenCalledWith('org-1', 'fs-9', TX);
      expect(await codeOf(service.revoke('org-9', 'fs-1', undefined, MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('for gateway-sync', () => {
    it('finds the station behind a broker username and records its health report', async () => {
      const credential = {
        id: 'fs-1',
        mqttUsername: 'fs-org-0007-1',
        secretHash: 'h',
        revokedAt: null,
      };
      stations.findByUsername.mockResolvedValue(credential);
      await expect(service.byUsername('fs-org-0007-1')).resolves.toBe(credential);
      expect(stations.findByUsername).toHaveBeenCalledWith('fs-org-0007-1');

      const identity = {
        id: 'fs-1',
        organizationId: 'org-1',
        mqttUsername: 'fs-org-0007-1',
        revokedAt: null,
      };
      stations.findIdentityByUsername.mockResolvedValue(identity);
      await expect(service.stationByUsername('fs-org-0007-1')).resolves.toBe(identity);
      expect(stations.findIdentityByUsername).toHaveBeenCalledWith('fs-org-0007-1');

      const health = {
        queueDepth: [0, 1, 2, 3] as const,
        oldestRetryCount: 1,
        version: '1.2.0',
        at: AT,
      };
      await service.recordStationHealth('fs-1', health);
      expect(stations.updateHealth).toHaveBeenCalledWith('fs-1', health);
    });

    it('lists the active stations with their health for the sync status read', async () => {
      stations.activeWithHealth = jest.fn().mockResolvedValue([{ id: 'fs-1' }]);
      await expect(service.activeWithHealth()).resolves.toEqual([{ id: 'fs-1' }]);
      expect(stations.activeWithHealth).toHaveBeenCalledWith();
    });
  });
});

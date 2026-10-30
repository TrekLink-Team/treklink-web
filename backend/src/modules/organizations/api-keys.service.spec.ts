import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { hashApiKey } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { API_KEY_REVOKED } from './api-key-events';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService, generateApiKey } from './api-keys.service';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const OTHER = '6c2e3d1f-8a4b-4f32-8d9e-2b3c4d5e6f70';
const MANAGER = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: ORG };
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const CREATED = new Date('2026-10-30T03:00:00.000Z');

const view = (overrides: Record<string, unknown> = {}) => ({
  id: 'k-1',
  name: 'ERP integration',
  prefix: 'tlk_7Hc2',
  createdAt: CREATED,
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

describe('ApiKeysService (organizations 2.7, api-design 20 to 22)', () => {
  let keys: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let parameters: { get: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: ApiKeysService;

  beforeEach(() => {
    keys = {
      list: jest.fn().mockResolvedValue([view()]),
      countActive: jest.fn().mockResolvedValue(0),
      insert: jest
        .fn()
        .mockImplementation((row: Record<string, unknown>) =>
          Promise.resolve(view({ name: row.name, prefix: row.prefix })),
        ),
      find: jest.fn().mockResolvedValue(view()),
      revoke: jest.fn().mockResolvedValue(view({ revokedAt: CREATED })),
    };
    organizations = {
      findStatus: jest.fn().mockResolvedValue('ACTIVE'),
      lockById: jest.fn().mockResolvedValue({ id: ORG }),
    };
    parameters = { get: jest.fn().mockResolvedValue(5) };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new ApiKeysService(
      keys as unknown as ApiKeysRepository,
      organizations as unknown as OrganizationsRepository,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  describe('generateApiKey', () => {
    it('is tlk_ and 43 base64url characters, different every time', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^tlk_[A-Za-z0-9_-]{43}$/);
      expect(generateApiKey()).not.toBe(key);
    });
  });

  describe('list', () => {
    it('returns the items with organizations.maxApiKeys as the limit', async () => {
      await expect(service.list(ORG, MANAGER)).resolves.toEqual({ items: [view()], limit: 5 });
      expect(parameters.get).toHaveBeenCalledWith('organizations.maxApiKeys');
      expect(keys.list).toHaveBeenCalledWith(ORG);
    });

    it('lets TrekLink Staff read any organization', async () => {
      await expect(service.list(OTHER, STAFF)).resolves.toMatchObject({ limit: 5 });
    });

    it('answers 404 to a member of another organization, without reading', async () => {
      await expect(service.list(OTHER, MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(keys.list).not.toHaveBeenCalled();
    });

    it('answers 404 for an organization that does not exist', async () => {
      organizations.findStatus.mockResolvedValue(null);
      await expect(service.list(ORG, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('stores the prefix and the SHA-256 hash, returns the key once and audits no secret', async () => {
      const created = await service.create(ORG, 'ERP integration', MANAGER);

      expect(created.key).toMatch(/^tlk_[A-Za-z0-9_-]{43}$/);
      const [row, client] = keys.insert.mock.calls[0] as [Record<string, string>, unknown];
      expect(row).toEqual({
        organizationId: ORG,
        name: 'ERP integration',
        prefix: created.key.slice(0, 8),
        keyHash: hashApiKey(created.key),
        createdById: 'u-mgr',
      });
      expect(client).toBe(TX);
      expect(organizations.lockById).toHaveBeenCalledWith(ORG, TX);
      expect(emitted).toHaveLength(1);
      expect(emitted[0][0]).toBe(AUDIT_RECORD);
      expect(emitted[0][1]).toMatchObject({ action: 'apiKey.create', subjectType: 'ApiKey' });
      expect(JSON.stringify(emitted)).not.toContain(created.key);
    });

    it('answers 409 KEY_LIMIT at organizations.maxApiKeys active keys', async () => {
      keys.countActive.mockResolvedValue(5);
      await expect(service.create(ORG, 'Sixth', MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.KEY_LIMIT,
        httpStatus: 409,
      });
      expect(keys.insert).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers 404 for another organization or a missing one', async () => {
      await expect(service.create(OTHER, 'x', MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      organizations.lockById.mockResolvedValue(null);
      await expect(service.create(ORG, 'x', MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('revoke', () => {
    it('sets the revocation, audits it and emits apiKey.revoked', async () => {
      await expect(service.revoke(ORG, 'k-1', MANAGER)).resolves.toMatchObject({
        revokedAt: CREATED,
      });
      expect(keys.revoke).toHaveBeenCalledWith(ORG, 'k-1', 'u-mgr', expect.any(Date), TX);
      expect(emitted.map(([name]) => name)).toEqual([AUDIT_RECORD, API_KEY_REVOKED]);
      expect(emitted[1][1]).toEqual({ organizationId: ORG, apiKeyId: 'k-1' });
    });

    it('answers an already revoked key as it is and emits nothing', async () => {
      keys.find.mockResolvedValue(view({ revokedAt: CREATED }));
      await expect(service.revoke(ORG, 'k-1', MANAGER)).resolves.toMatchObject({
        revokedAt: CREATED,
      });
      expect(keys.revoke).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers the current row when a concurrent revoke won the update', async () => {
      keys.revoke.mockResolvedValue(null);
      keys.find.mockResolvedValueOnce(view()).mockResolvedValueOnce(view({ revokedAt: CREATED }));
      await expect(service.revoke(ORG, 'k-1', MANAGER)).resolves.toMatchObject({
        revokedAt: CREATED,
      });
      expect(emitted).toEqual([]);
    });

    it('falls back to the row it read when the key vanished meanwhile', async () => {
      keys.revoke.mockResolvedValue(null);
      keys.find.mockResolvedValueOnce(view()).mockResolvedValueOnce(null);
      await expect(service.revoke(ORG, 'k-1', MANAGER)).resolves.toMatchObject({ id: 'k-1' });
    });

    it('answers 404 API key not found for an unknown key or another organization', async () => {
      keys.find.mockResolvedValue(null);
      await expect(service.revoke(ORG, 'k-9', MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'API key not found.',
      });
      await expect(service.revoke(OTHER, 'k-1', MANAGER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });
});

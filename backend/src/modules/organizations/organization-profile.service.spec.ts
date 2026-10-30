import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { UpdateOrganizationDto } from './dto/profile.dto';
import { MembersRepository } from './members.repository';
import { OrganizationProfileService } from './organization-profile.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationCountProvider } from './ports/counts.port';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'org-1',
  code: 'ORG-0001',
  legalName: 'ACME Trek',
  taxCode: '0312345678',
  address: '1 Test Street',
  contactEmail: 'ops@acme.vn',
  contactPhone: '0281234567',
  status: OrganizationStatus.ACTIVE,
  statusChangedAt: new Date('2026-10-20T03:00:00.000Z'),
  verifiedAt: new Date('2026-10-20T03:00:00.000Z'),
  verifiedById: 'u-staff',
  verificationMethod: 'IN_PERSON',
  documentsSeen: ['Business registration'],
  masterContractRef: 'MC-2026-0007',
  ndaSigned: true,
  softwareLicenceSigned: true,
  decidedAt: new Date('2026-10-20T03:00:00.000Z'),
  rejectionReason: null,
  channelKeyVersion: 1,
  channelKeyExposedAt: null,
  version: 3,
  createdAt: new Date('2026-10-19T03:00:00.000Z'),
  ...over,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return ((error as DomainException).getResponse() as { errorCode: string }).errorCode;
  }
  return 'none';
};

const errorOf = async (promise: Promise<unknown>): Promise<DomainException> => {
  try {
    await promise;
  } catch (error) {
    return error as DomainException;
  }
  throw new Error('expected a DomainException');
};

describe('OrganizationProfileService (api-design 03 and 04)', () => {
  let organizations: { findDetail: jest.Mock; lockById: jest.Mock; update: jest.Mock };
  let members: { countActive: jest.Mock };
  let accounts: { contactCard: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let counts: OrganizationCountProvider[];
  let service: OrganizationProfileService;

  const build = (providers: OrganizationCountProvider[] | undefined = counts) =>
    new OrganizationProfileService(
      organizations as unknown as OrganizationsRepository,
      members as unknown as MembersRepository,
      accounts as unknown as AccountsService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
          emitted.push([name, payload]),
      } as unknown as TransactionalEvents,
      providers,
    );

  beforeEach(() => {
    organizations = {
      findDetail: jest.fn().mockResolvedValue(row()),
      lockById: jest.fn().mockResolvedValue(row()),
      update: jest.fn().mockResolvedValue(row({ version: 4 })),
    };
    members = { countActive: jest.fn().mockResolvedValue(4) };
    accounts = {
      contactCard: jest.fn().mockResolvedValue([{ id: 'u-staff', fullName: 'Tran Thi B' }]),
    };
    emitted = [];
    counts = [
      { name: 'runningContracts', count: jest.fn().mockResolvedValue(1) },
      { name: 'openIncidents', count: jest.fn().mockResolvedValue(2) },
    ];
    service = build();
  });

  describe('detail', () => {
    it('answers the row with the verification record and the counts', async () => {
      const result = await service.detail('org-1', STAFF);

      expect(result).toMatchObject({
        id: 'org-1',
        code: 'ORG-0001',
        version: 3,
        verification: {
          method: 'IN_PERSON',
          documentsSeen: ['Business registration'],
          masterContractRef: 'MC-2026-0007',
          verifiedBy: 'Tran Thi B',
        },
        counts: { members: 4, runningContracts: 1, openIncidents: 2 },
      });
      expect(result).not.toHaveProperty('verifiedById');
      expect(accounts.contactCard).toHaveBeenCalledWith(['u-staff']);
    });

    it('lets a member read its own organization and hides every other one', async () => {
      await expect(service.detail('org-1', MANAGER)).resolves.toMatchObject({ id: 'org-1' });
      expect(await codeOf(service.detail('org-2', MANAGER))).toBe(ErrorCode.NOT_FOUND);
      expect(organizations.findDetail).toHaveBeenCalledTimes(1);
    });

    it('answers 404 for an unknown organization', async () => {
      organizations.findDetail.mockResolvedValue(null);
      expect(await codeOf(service.detail('org-1', ADMIN))).toBe(ErrorCode.NOT_FOUND);
    });

    it('has no verification record before the counter verified it, and counts 0 with no provider', async () => {
      organizations.findDetail.mockResolvedValue(
        row({ verifiedAt: null, verifiedById: null, status: OrganizationStatus.PENDING }),
      );

      const result = await build([]).detail('org-1', STAFF);

      expect(result.verification).toBeNull();
      expect(result.counts).toEqual({ members: 4, runningContracts: 0, openIncidents: 0 });
      expect(accounts.contactCard).not.toHaveBeenCalled();
    });

    it('works without the counts port, and names no verifier the account directory no longer has', async () => {
      accounts.contactCard.mockResolvedValue([]);

      const result = await new OrganizationProfileService(
        organizations as unknown as OrganizationsRepository,
        members as unknown as MembersRepository,
        accounts as unknown as AccountsService,
        {} as unknown as TransactionalEvents,
      ).detail('org-1', STAFF);

      expect(result.verification?.verifiedBy).toBeNull();
      expect(result.counts.runningContracts).toBe(0);
    });
  });

  describe('update', () => {
    const input = (over: Partial<UpdateOrganizationDto> = {}): UpdateOrganizationDto =>
      Object.assign(new UpdateOrganizationDto(), { expectedVersion: 3, ...over });

    it('saves the changed contact details under the lock and records what they were', async () => {
      organizations.findDetail.mockResolvedValue(row({ version: 4, contactPhone: '0287654321' }));

      const result = await service.update('org-1', input({ contactPhone: '0287654321' }), MANAGER);

      expect(organizations.lockById).toHaveBeenCalledWith('org-1', TX);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        { contactPhone: '0287654321' },
        TX,
      );
      expect(result.version).toBe(4);
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            actorId: 'u-mgr',
            organizationId: 'org-1',
            action: 'organization.updated',
            subjectType: 'Organization',
            subjectId: 'org-1',
            before: { contactPhone: '0281234567' },
            after: { contactPhone: '0287654321' },
          }),
        ],
      ]);
    });

    it('lets an Admin change the legal name of any organization', async () => {
      await service.update('org-1', input({ legalName: 'ACME Trek JSC' }), ADMIN);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        { legalName: 'ACME Trek JSC' },
        TX,
      );
    });

    it('refuses the legal name from a Manager (403) and writes nothing', async () => {
      expect(await codeOf(service.update('org-1', input({ legalName: 'Other' }), MANAGER))).toBe(
        ErrorCode.FORBIDDEN,
      );
      expect(organizations.lockById).not.toHaveBeenCalled();
    });

    it('refuses a body with nothing to change (400) and another organization (404)', async () => {
      expect(await codeOf(service.update('org-1', input(), MANAGER))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect(
        await codeOf(service.update('org-2', input({ address: '2 Test Street' }), MANAGER)),
      ).toBe(ErrorCode.NOT_FOUND);
      expect(organizations.lockById).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown organization', async () => {
      organizations.lockById.mockResolvedValue(null);
      expect(await codeOf(service.update('org-1', input({ address: 'x' }), ADMIN))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });

    it('refuses a CLOSED or REJECTED organization, which is final (409)', async () => {
      for (const status of [OrganizationStatus.CLOSED, OrganizationStatus.REJECTED]) {
        organizations.lockById.mockResolvedValue(row({ status }));
        const error = await errorOf(service.update('org-1', input({ address: 'x' }), ADMIN));
        expect(error.getStatus()).toBe(409);
      }
      expect(organizations.update).not.toHaveBeenCalled();
    });

    it('answers 409 STALE_VERSION when someone saved first, with no audit', async () => {
      organizations.update.mockResolvedValue(null);
      const error = await errorOf(service.update('org-1', input({ address: 'x' }), ADMIN));
      expect(error.getStatus()).toBe(409);
      expect(error.message).toBe('Someone else changed this. Reload to see the latest.');
      expect(emitted).toEqual([]);
    });
  });
});

import { ConfigService } from '@nestjs/config';
import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { MembersRepository } from './members.repository';
import { OrganizationOnboardingService, Verification } from './organization-onboarding.service';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-28T03:00:00.000Z');
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ADMIN = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };

const REGISTRATION = {
  legalName: 'TrekLink Demo Tours Co., Ltd.',
  taxCode: '0312345678',
  address: '1 Le Loi, District 1, Ho Chi Minh City',
  contactPhone: '0901234567',
  managerFullName: 'Demo Manager',
  managerEmail: 'manager@example.com',
  managerPhone: '0907654321',
};

const VERIFICATION: Verification = {
  method: 'IN_PERSON',
  documentsSeen: ['Business registration'],
  masterContractRef: 'MC-2026-0001',
  ndaSigned: true,
  softwareLicenceSigned: true,
  expectedVersion: 0,
};

const PENDING = { id: 'org-1', status: OrganizationStatus.PENDING, verifiedAt: null, version: 0 };

describe('OrganizationOnboardingService (organizations 2.1 to 2.3)', () => {
  let organizations: Record<string, jest.Mock>;
  let members: { addMember: jest.Mock };
  let accounts: { createOrganizationAccount: jest.Mock };
  let parameters: { get: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: OrganizationOnboardingService;

  beforeEach(() => {
    organizations = {
      page: jest.fn().mockResolvedValue([[{ id: 'org-1' }], 1]),
      taxCodeTaken: jest.fn().mockResolvedValue(false),
      nextCode: jest.fn().mockResolvedValue('ORG-0002'),
      createPending: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => ({ id: 'org-1', ...data })),
      addTransition: jest.fn().mockResolvedValue(undefined),
      lockById: jest.fn().mockResolvedValue(PENDING),
      update: jest
        .fn()
        .mockImplementation((id: string, version: number, data: Record<string, unknown>) => ({
          id,
          version: version + 1,
          ...data,
        })),
    };
    members = { addMember: jest.fn().mockResolvedValue(undefined) };
    accounts = { createOrganizationAccount: jest.fn().mockResolvedValue({ id: 'u-mgr' }) };
    parameters = { get: jest.fn().mockResolvedValue(72) };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    const config = { get: (key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20) };
    service = new OrganizationOnboardingService(
      organizations as unknown as OrganizationsRepository,
      members as unknown as MembersRepository,
      accounts as unknown as AccountsService,
      events as unknown as TransactionalEvents,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
      parameters as unknown as ParameterService,
    );
  });

  describe('page (api-design 02)', () => {
    it('passes the status and a trimmed search, and pages with the configured size', async () => {
      const result = await service.page({ status: OrganizationStatus.PENDING, q: '  demo ' });
      expect(organizations.page).toHaveBeenCalledWith(
        { status: OrganizationStatus.PENDING, q: 'demo' },
        0,
        20,
      );
      expect(result).toMatchObject({ items: [{ id: 'org-1' }], totalCount: 1, pageNumber: 1 });
    });

    it('drops a blank search', async () => {
      await service.page({ q: '   ' });
      expect(organizations.page).toHaveBeenCalledWith({ status: undefined, q: undefined }, 0, 20);
    });
  });

  describe('register (api-design 01)', () => {
    it('creates the PENDING organization, the Manager account, the membership and the first transition in one transaction', async () => {
      const organization = await service.register(REGISTRATION);

      expect(parameters.get).toHaveBeenCalledWith('auth.invitationTtlHours');
      expect(organizations.createPending).toHaveBeenCalledWith(
        {
          code: 'ORG-0002',
          legalName: REGISTRATION.legalName,
          taxCode: REGISTRATION.taxCode,
          address: REGISTRATION.address,
          contactEmail: REGISTRATION.managerEmail,
          contactPhone: REGISTRATION.contactPhone,
        },
        TX,
      );
      expect(accounts.createOrganizationAccount).toHaveBeenCalledWith(
        {
          email: REGISTRATION.managerEmail,
          fullName: REGISTRATION.managerFullName,
          phone: REGISTRATION.managerPhone,
          role: 'ORG_MANAGER',
        },
        TX,
      );
      expect(members.addMember).toHaveBeenCalledWith(
        { organizationId: 'org-1', userId: 'u-mgr', role: MemberRole.MANAGER },
        TX,
      );
      expect(organizations.addTransition).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          fromStatus: null,
          toStatus: OrganizationStatus.PENDING,
          actorId: 'u-mgr',
        },
        TX,
      );
      expect(organization).toMatchObject({ id: 'org-1', code: 'ORG-0002' });
    });

    it('refuses a tax code already registered with 409 CONFLICT_UNIQUE (MSG10) and creates nothing', async () => {
      organizations.taxCodeTaken.mockResolvedValue(true);
      await expect(service.register(REGISTRATION)).rejects.toMatchObject({
        errorCode: ErrorCode.CONFLICT_UNIQUE,
        message: 'This tax code is already registered.',
      });
      expect(organizations.createPending).not.toHaveBeenCalled();
    });

    it('turns a unique index violation of a racing registration into 409 CONFLICT_UNIQUE', async () => {
      organizations.createPending.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.register(REGISTRATION)).rejects.toMatchObject({
        errorCode: ErrorCode.CONFLICT_UNIQUE,
        message: 'This organization is already registered.',
      });
    });

    it('passes any other failure through unchanged', async () => {
      const failure = new Error('connection lost');
      accounts.createOrganizationAccount.mockRejectedValue(failure);
      await expect(service.register(REGISTRATION)).rejects.toBe(failure);
    });
  });

  describe('verify (api-design 05, AC-09)', () => {
    it('records the counter check on a PENDING organization and audits it', async () => {
      const saved = await service.verify('org-1', VERIFICATION, STAFF, AT);

      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        0,
        {
          verifiedAt: AT,
          verifiedById: 'u-staff',
          verificationMethod: 'IN_PERSON',
          documentsSeen: ['Business registration'],
          masterContractRef: 'MC-2026-0001',
          ndaSigned: true,
          softwareLicenceSigned: true,
        },
        TX,
      );
      expect(saved).toMatchObject({ id: 'org-1', version: 1 });
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            actorId: 'u-staff',
            action: 'organization.verified',
            subjectId: 'org-1',
            after: { method: 'IN_PERSON', masterContractRef: 'MC-2026-0001' },
          }),
        ],
      ]);
    });

    it.each([
      ['the NDA', { ndaSigned: false }],
      ['the software licence', { softwareLicenceSigned: false }],
    ])(
      'refuses a contract without %s with 400 CONTRACT_TERMS_MISSING and stores nothing',
      async (_, missing) => {
        await expect(
          service.verify('org-1', { ...VERIFICATION, ...missing }, STAFF, AT),
        ).rejects.toMatchObject({ errorCode: ErrorCode.CONTRACT_TERMS_MISSING });
        expect(organizations.lockById).not.toHaveBeenCalled();
        expect(organizations.update).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for an unknown organization', async () => {
      organizations.lockById.mockResolvedValue(null);
      await expect(service.verify('org-9', VERIFICATION, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });

    it('refuses an organization that is no longer PENDING', async () => {
      organizations.lockById.mockResolvedValue({ ...PENDING, status: OrganizationStatus.ACTIVE });
      await expect(service.verify('org-1', VERIFICATION, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
        message: 'This cannot be done while it is ACTIVE.',
      });
    });

    it('answers 409 STALE_VERSION when the version moved, and audits nothing', async () => {
      organizations.update.mockResolvedValue(null);
      await expect(service.verify('org-1', VERIFICATION, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(emitted).toEqual([]);
    });
  });

  describe('approve and reject (api-design 06 and 07)', () => {
    it('approves a verified PENDING organization to ACTIVE with its transition and audit', async () => {
      organizations.lockById.mockResolvedValue({ ...PENDING, verifiedAt: AT });
      const saved = await service.approve('org-1', 1, ADMIN, AT);

      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        1,
        {
          status: OrganizationStatus.ACTIVE,
          statusChangedAt: AT,
          decidedAt: AT,
          decidedById: 'u-admin',
          rejectionReason: null,
        },
        TX,
      );
      expect(organizations.addTransition).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          fromStatus: OrganizationStatus.PENDING,
          toStatus: OrganizationStatus.ACTIVE,
          actorId: 'u-admin',
          reason: null,
        },
        TX,
      );
      expect(saved).toMatchObject({ status: OrganizationStatus.ACTIVE });
      expect(emitted.map(([, payload]) => payload.action)).toEqual(['organization.approved']);
    });

    it('refuses to approve an organization not yet verified with 409 NOT_VERIFIED (MSG21)', async () => {
      await expect(service.approve('org-1', 0, ADMIN, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_VERIFIED,
        message: 'Verify this organization at the counter before approving it.',
      });
      expect(organizations.update).not.toHaveBeenCalled();
    });

    it('rejects a PENDING organization with the reason the Manager sees (MSG16), verified or not', async () => {
      await service.reject('org-1', 'Tax code does not match the licence.', 0, ADMIN, AT);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        0,
        expect.objectContaining({
          status: OrganizationStatus.REJECTED,
          rejectionReason: 'Tax code does not match the licence.',
        }),
        TX,
      );
      expect(organizations.addTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: OrganizationStatus.REJECTED,
          reason: 'Tax code does not match the licence.',
        }),
        TX,
      );
      expect(emitted.map(([, payload]) => payload.action)).toEqual(['organization.rejected']);
    });

    it('refuses a decision on an organization that is not PENDING', async () => {
      organizations.lockById.mockResolvedValue({ ...PENDING, status: OrganizationStatus.REJECTED });
      await expect(service.reject('org-1', 'Again.', 0, ADMIN, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('answers 409 STALE_VERSION and writes no transition when the version moved', async () => {
      organizations.lockById.mockResolvedValue({ ...PENDING, verifiedAt: AT });
      organizations.update.mockResolvedValue(null);
      await expect(service.approve('org-1', 0, ADMIN, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(organizations.addTransition).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown organization', async () => {
      organizations.lockById.mockResolvedValue(null);
      await expect(service.approve('org-9', 0, ADMIN, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });
});

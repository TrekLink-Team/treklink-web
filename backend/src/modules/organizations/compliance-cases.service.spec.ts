import { ConfigService } from '@nestjs/config';
import {
  ComplianceActionKind,
  ComplianceCaseStatus,
  ComplianceCaseType,
  Prisma,
} from '@prisma/client';
import { AccountsService } from '../auth';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ApiKeysService } from './api-keys.service';
import { ComplianceCasesRepository } from './compliance-cases.repository';
import { ComplianceCasesService, OpenCase } from './compliance-cases.service';
import { FieldStationsService } from './field-stations.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ADMIN = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const AT = new Date('2026-10-30T03:00:00.000Z');

const CASE = {
  id: 'case-1',
  code: 'CMP-0002',
  organization: { id: 'org-1', code: 'ORG-0007' },
  type: ComplianceCaseType.OTHER_BREACH,
  status: ComplianceCaseStatus.OPEN,
  evidence: 'Evidence',
  linkedContractIds: [] as string[],
  authorityReference: null,
  outcome: null,
  openedAt: AT,
  actions: [] as { kind: ComplianceActionKind; actorId: string; createdAt: Date }[],
};

const OPEN_INPUT: OpenCase = {
  type: ComplianceCaseType.OTHER_BREACH,
  evidence: 'Evidence',
  linkedContractIds: [],
  linkedLossCaseIds: [],
};

describe('ComplianceCasesService', () => {
  let cases: Record<string, jest.Mock>;
  let organizationRows: { findStatus: jest.Mock };
  let organizations: { suspendFromCompliance: jest.Mock };
  let stations: { revoke: jest.Mock };
  let apiKeys: { revoke: jest.Mock };
  let accounts: { contactCard: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: ComplianceCasesService;

  beforeEach(() => {
    cases = {
      page: jest.fn().mockResolvedValue([[CASE], 1]),
      find: jest.fn().mockResolvedValue(CASE),
      lock: jest.fn().mockResolvedValue(CASE),
      nextCode: jest.fn().mockResolvedValue('CMP-0003'),
      create: jest.fn().mockResolvedValue(CASE),
      addAction: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(true),
    };
    organizationRows = { findStatus: jest.fn().mockResolvedValue('ACTIVE') };
    organizations = { suspendFromCompliance: jest.fn().mockResolvedValue(undefined) };
    stations = { revoke: jest.fn().mockResolvedValue({ id: 'fs-1' }) };
    apiKeys = { revoke: jest.fn().mockResolvedValue({ id: 'key-1', revokedAt: AT }) };
    accounts = {
      contactCard: jest.fn().mockResolvedValue([{ id: 'u-staff', fullName: 'Tran Thi B' }]),
    };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    const config = { get: (key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20) };
    service = new ComplianceCasesService(
      cases as unknown as ComplianceCasesRepository,
      organizationRows as unknown as OrganizationsRepository,
      organizations as unknown as OrganizationsService,
      stations as unknown as FieldStationsService,
      apiKeys as unknown as ApiKeysService,
      accounts as unknown as AccountsService,
      events as unknown as TransactionalEvents,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  describe('page and get', () => {
    it('resolves each action actor through one contactCard call', async () => {
      const withAction = {
        ...CASE,
        actions: [{ kind: ComplianceActionKind.OTHER, actorId: 'u-staff', createdAt: AT }],
      };
      cases.page.mockResolvedValue([[withAction], 1]);
      const result = await service.page({});
      expect(result.items[0].actions[0]).toEqual({
        kind: ComplianceActionKind.OTHER,
        actor: { id: 'u-staff', fullName: 'Tran Thi B' },
        at: AT,
      });
      expect(accounts.contactCard).toHaveBeenCalledWith(['u-staff']);
    });

    it('answers linkedLossCases empty (the devices-module gap)', async () => {
      const result = await service.page({});
      expect(result.items[0].linkedLossCases).toEqual([]);
    });

    it('refuses an unknown case id with 404', async () => {
      cases.find.mockResolvedValue(null);
      await expect(service.get('case-9')).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    });
  });

  describe('open', () => {
    it('opens a case with the next code and audits it', async () => {
      await service.open('org-1', OPEN_INPUT, STAFF);
      expect(cases.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CMP-0003', organizationId: 'org-1' }),
        TX,
      );
      expect(emitted).toEqual([
        ['audit.record', expect.objectContaining({ action: 'complianceCase.open' })],
      ]);
    });

    it('refuses linkedLossCaseIds with 400 (the devices-module gap)', async () => {
      await expect(
        service.open('org-1', { ...OPEN_INPUT, linkedLossCaseIds: ['loss-1'] }, STAFF),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(cases.create).not.toHaveBeenCalled();
    });

    it('refuses an unknown organization with 404', async () => {
      organizationRows.findStatus.mockResolvedValue(null);
      await expect(service.open('org-9', OPEN_INPUT, STAFF)).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
      });
    });
  });

  describe('act', () => {
    it('suspends the organization only when the caller may, else 403 with the api-design 30 message', async () => {
      await service.act(
        'case-1',
        { kind: ComplianceActionKind.SUSPEND_ORGANIZATION, targetId: null, note: 'Default' },
        ADMIN,
        true,
        AT,
      );
      expect(organizations.suspendFromCompliance).toHaveBeenCalledWith(
        'org-1',
        'Compliance case CMP-0002: Default',
        ADMIN,
        AT,
        TX,
      );

      await expect(
        service.act(
          'case-1',
          { kind: ComplianceActionKind.SUSPEND_ORGANIZATION, targetId: null, note: 'Default' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({
        errorCode: 'FORBIDDEN',
        message: 'Ask a TrekLink Admin to suspend the organization.',
      });
    });

    it('revokes a Field Station through FieldStationsService.revoke, ahead of the case transaction', async () => {
      await service.act(
        'case-1',
        { kind: ComplianceActionKind.REVOKE_FIELD_STATION, targetId: 'fs-1', note: 'Stolen' },
        STAFF,
        false,
      );
      // FieldStationsService (treklink-web#134) manages its own transaction and takes no `tx`.
      expect(stations.revoke).toHaveBeenCalledWith('org-1', 'fs-1', 'Stolen', STAFF);
      expect(cases.addAction).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: ComplianceActionKind.REVOKE_FIELD_STATION,
          targetId: 'fs-1',
        }),
        TX,
      );
    });

    it('revokes an API key through ApiKeysService.revoke, in the case transaction', async () => {
      await service.act(
        'case-1',
        { kind: ComplianceActionKind.REVOKE_API_KEY, targetId: 'key-1', note: 'Compromised' },
        STAFF,
        false,
        AT,
      );
      expect(apiKeys.revoke).toHaveBeenCalledWith('org-1', 'key-1', STAFF, TX);
      expect(cases.addAction).toHaveBeenCalledWith(
        expect.objectContaining({ kind: ComplianceActionKind.REVOKE_API_KEY, targetId: 'key-1' }),
        TX,
      );
    });

    it('refuses an API key of no organization with 404', async () => {
      apiKeys.revoke.mockRejectedValue({ errorCode: 'NOT_FOUND' });
      await expect(
        service.act(
          'case-1',
          { kind: ComplianceActionKind.REVOKE_API_KEY, targetId: 'key-9', note: 'x' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    });

    it('answers NOT_FOUND before calling FieldStationsService.revoke when the case does not exist', async () => {
      cases.find.mockResolvedValueOnce(null);
      await expect(
        service.act(
          'case-9',
          { kind: ComplianceActionKind.REVOKE_FIELD_STATION, targetId: 'fs-1', note: 'x' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
      expect(stations.revoke).not.toHaveBeenCalled();
    });

    it('refuses a revocation without targetId with 400', async () => {
      await expect(
        service.act(
          'case-1',
          { kind: ComplianceActionKind.REVOKE_FIELD_STATION, targetId: null, note: 'x' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
    });

    it('records OTHER with no side effect beyond the appended action', async () => {
      await service.act(
        'case-1',
        { kind: ComplianceActionKind.OTHER, targetId: null, note: 'Note' },
        STAFF,
        false,
      );
      expect(organizations.suspendFromCompliance).not.toHaveBeenCalled();
      expect(stations.revoke).not.toHaveBeenCalled();
      expect(cases.addAction).toHaveBeenCalledWith(
        expect.objectContaining({ kind: ComplianceActionKind.OTHER, targetId: null }),
        TX,
      );
    });

    it('refuses an unknown case with 404, and a CLOSED one with 409', async () => {
      cases.lock.mockResolvedValue(null);
      await expect(
        service.act(
          'case-9',
          { kind: ComplianceActionKind.OTHER, targetId: null, note: 'x' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });

      cases.lock.mockResolvedValue({ ...CASE, status: ComplianceCaseStatus.CLOSED });
      await expect(
        service.act(
          'case-1',
          { kind: ComplianceActionKind.OTHER, targetId: null, note: 'x' },
          STAFF,
          false,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' });
    });
  });

  describe('close', () => {
    it('closes an OTHER_BREACH case without a police reference', async () => {
      await service.close('case-1', 'Resolved', null, STAFF);
      expect(cases.close).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({ outcome: 'Resolved', authorityReference: null }),
        TX,
      );
    });

    it.each([ComplianceCaseType.SUSPECTED_FRAUD, ComplianceCaseType.SUSPECTED_THEFT])(
      'refuses closing a %s case without authorityReference with 409 POLICE_REFERENCE_REQUIRED',
      async (type) => {
        cases.lock.mockResolvedValue({ ...CASE, type });
        await expect(service.close('case-1', 'Outcome', null, STAFF)).rejects.toMatchObject({
          errorCode: 'POLICE_REFERENCE_REQUIRED',
        });
        expect(cases.close).not.toHaveBeenCalled();
      },
    );

    it('closes a SUSPECTED_THEFT case once given a police reference', async () => {
      cases.lock.mockResolvedValue({ ...CASE, type: ComplianceCaseType.SUSPECTED_THEFT });
      await service.close('case-1', 'Recovered', 'CA-PD-2026-118', STAFF);
      expect(cases.close).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({ authorityReference: 'CA-PD-2026-118' }),
        TX,
      );
    });

    it('refuses closing an already-CLOSED case with 409', async () => {
      cases.lock.mockResolvedValue({ ...CASE, status: ComplianceCaseStatus.CLOSED });
      await expect(service.close('case-1', 'Outcome', null, STAFF)).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      });
    });
  });
});

import { Logger } from '@nestjs/common';
import { OrganizationStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { MembersRepository } from './members.repository';
import { OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

const TX = {} as Prisma.TransactionClient;
const AT = new Date('2026-11-20T03:00:00Z');

describe('OrganizationsService branches', () => {
  let repository: Record<string, jest.Mock>;
  let mail: { send: jest.Mock };

  const build = (withMail = true) =>
    new OrganizationsService(
      repository as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      {} as OrganizationLifecycle,
      withMail ? mail : undefined,
    );

  beforeEach(() => {
    repository = {
      page: jest.fn(),
      contactEmail: jest.fn().mockResolvedValue('manager@acme.vn'),
      channelKeyState: jest.fn(),
      lockStatus: jest.fn(),
      findStatus: jest.fn(),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
  });

  describe('activeDemoOptions', () => {
    it('lists the first 100 active organizations with their id, code and legal name only', async () => {
      repository.page.mockResolvedValue([
        [
          { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek', taxCode: '0109876543' },
          { id: 'org-2', code: 'ORG-0002', legalName: 'Beta Trek', taxCode: '0100000000' },
        ],
        2,
      ]);
      await expect(build().activeDemoOptions()).resolves.toEqual([
        { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
        { id: 'org-2', code: 'ORG-0002', legalName: 'Beta Trek' },
      ]);
      expect(repository.page).toHaveBeenCalledWith({ status: OrganizationStatus.ACTIVE }, 0, 100);
    });
  });

  describe('emailContact', () => {
    it('sends nothing and answers false when the organization has no contact address', async () => {
      repository.contactEmail.mockResolvedValue(null);
      await expect(build().emailContact('org-1', 'Subject', 'Text')).resolves.toBe(false);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('answers false when no mail transport is configured', async () => {
      await expect(build(false).emailContact('org-1', 'Subject', 'Text')).resolves.toBe(false);
      expect(repository.contactEmail).toHaveBeenCalledWith('org-1', undefined);
    });

    it('sends to the contact address, reading it in the caller transaction', async () => {
      await expect(build().emailContact('org-1', 'Subject', 'Text', TX)).resolves.toBe(true);
      expect(repository.contactEmail).toHaveBeenCalledWith('org-1', TX);
      expect(mail.send).toHaveBeenCalledWith({
        to: 'manager@acme.vn',
        subject: 'Subject',
        text: 'Text',
      });
    });

    it('logs a failed send and answers false instead of throwing', async () => {
      mail.send.mockRejectedValue(new Error('smtp down'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await expect(build().emailContact('org-1', 'Subject', 'Text')).resolves.toBe(false);
      expect((warn.mock.calls[0] as unknown[])[0]).toContain('smtp down');
      warn.mockRestore();
    });
  });

  describe('channelKeyState', () => {
    it('answers the version and the exposure time of the organization', async () => {
      const state = { channelKeyVersion: 2, channelKeyExposedAt: AT };
      repository.channelKeyState.mockResolvedValue(state);
      await expect(build().channelKeyState('org-1', TX)).resolves.toBe(state);
      expect(repository.channelKeyState).toHaveBeenCalledWith('org-1', TX);
    });

    it('answers 404 for an unknown organization', async () => {
      repository.channelKeyState.mockResolvedValue(null);
      await expect(build().channelKeyState('org-9')).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('assertCanUseRentalGroups', () => {
    it.each([OrganizationStatus.ACTIVE, OrganizationStatus.SUSPENDED])(
      'lets a %s organization use groups, reading the status under a share lock in a transaction',
      async (status) => {
        repository.lockStatus.mockResolvedValue(status);
        await expect(build().assertCanUseRentalGroups('org-1', TX)).resolves.toBeUndefined();
        expect(repository.lockStatus).toHaveBeenCalledWith('org-1', TX);
        expect(repository.findStatus).not.toHaveBeenCalled();
      },
    );

    it('reads the status without a lock outside a transaction', async () => {
      repository.findStatus.mockResolvedValue(OrganizationStatus.ACTIVE);
      await expect(build().assertCanUseRentalGroups('org-1')).resolves.toBeUndefined();
      expect(repository.findStatus).toHaveBeenCalledWith('org-1');
      expect(repository.lockStatus).not.toHaveBeenCalled();
    });

    it.each([
      OrganizationStatus.PENDING,
      OrganizationStatus.REJECTED,
      OrganizationStatus.CLOSED,
      null,
    ])('refuses a %s organization with FORBIDDEN', async (status) => {
      repository.findStatus.mockResolvedValue(status);
      await expect(build().assertCanUseRentalGroups('org-1')).rejects.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
    });
  });
});

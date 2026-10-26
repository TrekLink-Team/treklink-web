import { OrganizationStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;

describe('OrganizationsService.assertActive (FR-CON-02, for rentals 2.1)', () => {
  let organizations: { findStatus: jest.Mock };
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = { findStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE) };
    service = new OrganizationsService(organizations as unknown as OrganizationsRepository);
  });

  it('passes an ACTIVE organization, reading in the caller transaction', async () => {
    await expect(service.assertActive('org-1', tx)).resolves.toBeUndefined();
    expect(organizations.findStatus).toHaveBeenCalledWith('org-1', tx);
  });

  it.each([
    OrganizationStatus.PENDING,
    OrganizationStatus.REJECTED,
    OrganizationStatus.SUSPENDED,
    OrganizationStatus.CLOSED,
  ])('refuses a %s organization with 409 ORGANIZATION_NOT_ACTIVE', async (status) => {
    organizations.findStatus.mockResolvedValue(status);
    await expect(service.assertActive('org-1')).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      message: `Your organization cannot request devices while it is ${status}.`,
    });
  });

  it('answers 404 for an unknown organization', async () => {
    organizations.findStatus.mockResolvedValue(null);
    await expect(service.assertActive('org-9')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});

describe('OrganizationsRepository.findStatus', () => {
  it('reads the status, null for an unknown id, on the shared client or a transaction', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: OrganizationStatus.ACTIVE })
      .mockResolvedValueOnce(null);
    const prisma = { organization: { findUnique } };
    const repository = new OrganizationsRepository(prisma as unknown as PrismaService);

    await expect(repository.findStatus('org-1')).resolves.toBe(OrganizationStatus.ACTIVE);
    await expect(
      repository.findStatus('org-9', prisma as unknown as Prisma.TransactionClient),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'org-1' }, select: { status: true } });
  });
});

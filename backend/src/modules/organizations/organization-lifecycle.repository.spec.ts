import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiKeysRepository } from './api-keys.repository';
import { FieldStationsRepository } from './field-stations.repository';
import { OrganizationsRepository } from './organizations.repository';

const AT = new Date('2026-10-30T03:00:00.000Z');

describe('The reads and writes the closing of an organization needs (organizations 2.4)', () => {
  describe('OrganizationsRepository.transitionsOf (api-design 11)', () => {
    it('reads the history of one organization, oldest first', async () => {
      const findMany = jest.fn().mockResolvedValue([{ toStatus: 'ACTIVE' }]);
      const client = {
        organizationTransition: { findMany },
      } as unknown as Prisma.TransactionClient;
      const repository = new OrganizationsRepository({
        organizationTransition: { findMany },
      } as unknown as PrismaService);

      await expect(repository.transitionsOf('org-1')).resolves.toEqual([{ toStatus: 'ACTIVE' }]);
      await repository.transitionsOf('org-1', client);

      expect(findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { fromStatus: true, toStatus: true, actorId: true, reason: true, createdAt: true },
      });
      expect(findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('ApiKeysRepository.revokeAllActive', () => {
    let apiKey: Record<string, jest.Mock>;
    let repository: ApiKeysRepository;

    beforeEach(() => {
      apiKey = {
        findMany: jest.fn().mockResolvedValue([{ id: 'k-1' }, { id: 'k-2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      };
      repository = new ApiKeysRepository({ apiKey } as unknown as PrismaService);
    });

    it('revokes every key of the organization still live and returns their ids', async () => {
      await expect(repository.revokeAllActive('org-1', 'u-admin', AT)).resolves.toEqual([
        'k-1',
        'k-2',
      ]);
      expect(apiKey.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', revokedAt: null },
        select: { id: true },
      });
      expect(apiKey.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', revokedAt: null },
        data: { revokedAt: AT, revokedById: 'u-admin' },
      });
    });

    it('writes nothing when no key is live, and takes the caller transaction', async () => {
      apiKey.findMany.mockResolvedValue([]);
      const tx = { apiKey } as unknown as Prisma.TransactionClient;
      await expect(repository.revokeAllActive('org-1', 'u-admin', AT, tx)).resolves.toEqual([]);
      expect(apiKey.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('FieldStationsRepository.revokeAllActive', () => {
    let fieldStation: Record<string, jest.Mock>;
    let repository: FieldStationsRepository;

    beforeEach(() => {
      fieldStation = {
        findMany: jest.fn().mockResolvedValue([{ id: 'fs-1', mqttUsername: 'fs-org-0007-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      repository = new FieldStationsRepository({ fieldStation } as unknown as PrismaService);
    });

    it('revokes every station of the organization still live and returns what gateway-sync needs', async () => {
      await expect(repository.revokeAllActive('org-1', 'u-admin', AT)).resolves.toEqual([
        { id: 'fs-1', mqttUsername: 'fs-org-0007-1' },
      ]);
      expect(fieldStation.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', revokedAt: null },
        select: { id: true, mqttUsername: true },
      });
      expect(fieldStation.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', revokedAt: null },
        data: { revokedAt: AT, revokedById: 'u-admin' },
      });
    });

    it('writes nothing when no station is live, and takes the caller transaction', async () => {
      fieldStation.findMany.mockResolvedValue([]);
      const tx = { fieldStation } as unknown as Prisma.TransactionClient;
      await expect(repository.revokeAllActive('org-1', 'u-admin', AT, tx)).resolves.toEqual([]);
      expect(fieldStation.updateMany).not.toHaveBeenCalled();
    });
  });
});

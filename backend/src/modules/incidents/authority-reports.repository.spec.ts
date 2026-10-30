import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthorityReportsRepository } from './authority-reports.repository';

// The open-report count closeCase reads before closing an incident (PR #137 review follow-up).
describe('AuthorityReportsRepository.countOpenOnIncident', () => {
  it('counts the incident reports whose case is open, in the caller transaction', async () => {
    const count = jest.fn().mockResolvedValue(2);
    const tx = { authorityReport: { count } } as unknown as Prisma.TransactionClient;
    const repository = new AuthorityReportsRepository({} as PrismaService);
    await expect(repository.countOpenOnIncident('inc-1', tx)).resolves.toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { incidentId: 'inc-1', caseClosedAt: null } });
  });
});

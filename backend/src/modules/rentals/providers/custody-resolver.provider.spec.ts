import { ContractStatus } from '@prisma/client';
import { ContractsRepository, CustodyRow } from '../contracts.repository';
import { RentalsCustodyResolver } from './custody-resolver.provider';

const HANDOVER = new Date('2026-10-20T02:00:00.000Z');
const LAST_SEEN = new Date('2026-10-21T02:00:00.000Z');

const custody = (overrides: Partial<CustodyRow> = {}): CustodyRow => ({
  id: 'cd-1',
  handedOverAt: HANDOVER,
  checkedInAt: null,
  lostAt: null,
  contract: { id: 'c-1', organizationId: 'org-1', status: ContractStatus.OVERDUE },
  ...overrides,
});

describe('RentalsCustodyResolver (CUSTODY_RESOLVER, rentals task 1.3, D-045)', () => {
  let findCustody: jest.Mock;
  let resolver: RentalsCustodyResolver;

  beforeEach(() => {
    findCustody = jest.fn().mockResolvedValue(custody());
    resolver = new RentalsCustodyResolver({ findCustody } as unknown as ContractsRepository);
  });

  it('answers the interval holding the device at the time, whatever the contract state', async () => {
    await expect(resolver.custodyAt('dev-1', LAST_SEEN)).resolves.toEqual({
      contractId: 'c-1',
      organizationId: 'org-1',
      contractDeviceId: 'cd-1',
    });
    expect(findCustody).toHaveBeenCalledWith('dev-1', LAST_SEEN);
  });

  it('answers none when no interval contains the time, or the row was never handed over', async () => {
    findCustody.mockResolvedValueOnce(null);
    await expect(resolver.custodyAt('dev-1', LAST_SEEN)).resolves.toBeNull();

    findCustody.mockResolvedValueOnce(custody({ handedOverAt: null }));
    await expect(resolver.custodyAt('dev-1', LAST_SEEN)).resolves.toBeNull();
  });
});

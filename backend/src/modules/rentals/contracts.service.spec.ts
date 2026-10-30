import { ContractStatus, Prisma } from '@prisma/client';
import { ContractsRepository, CustodyRow } from './contracts.repository';
import { ContractsService } from './contracts.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const HANDOVER = new Date('2026-10-20T02:00:00.000Z');
const CHECK_IN = new Date('2026-10-23T02:00:00.000Z');
const MARGIN_S = 60;

const custody = (overrides: Partial<CustodyRow> = {}): CustodyRow => ({
  id: 'cd-1',
  handedOverAt: HANDOVER,
  checkedInAt: null,
  lostAt: null,
  contract: { id: 'c-1', organizationId: 'org-1', status: ContractStatus.ACTIVE },
  ...overrides,
});

const plus = (at: Date, seconds: number) => new Date(at.getTime() + seconds * 1000);

describe('ContractsService', () => {
  let contracts: Record<string, jest.Mock>;
  let service: ContractsService;

  beforeEach(() => {
    contracts = {
      findCustody: jest.fn().mockResolvedValue(custody()),
      countUnfinishedContracts: jest.fn().mockResolvedValue(0),
      setLostAt: jest.fn().mockResolvedValue(undefined),
    };
    // The request's collaborators are exercised in contracts.service.request.spec.ts.
    service = new ContractsService(
      contracts as unknown as ContractsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  describe('custodyAt (D-040, CUSTODY_RESOLVER)', () => {
    it('returns the interval holding the device, with its contract and organization', async () => {
      const at = plus(HANDOVER, 3600);

      await expect(service.custodyAt('dev-1', at, MARGIN_S)).resolves.toEqual({
        contractDeviceId: 'cd-1',
        contractId: 'c-1',
        organizationId: 'org-1',
        contractStatus: ContractStatus.ACTIVE,
        nearBoundary: false,
      });
      expect(contracts.findCustody).toHaveBeenCalledWith('dev-1', at);
    });

    it.each([
      ['just after the handover', custody(), plus(HANDOVER, 30)],
      ['just before the check-in', custody({ checkedInAt: CHECK_IN }), plus(CHECK_IN, -30)],
      ['just before the loss', custody({ lostAt: CHECK_IN }), plus(CHECK_IN, -60)],
    ])('flags a time %s as near a boundary', async (_label, row, at) => {
      contracts.findCustody.mockResolvedValue(row);
      await expect(service.custodyAt('dev-1', at, MARGIN_S)).resolves.toMatchObject({
        nearBoundary: true,
      });
    });

    it('answers none when no interval contains the time, or the row was never handed over', async () => {
      contracts.findCustody.mockResolvedValueOnce(null);
      await expect(service.custodyAt('dev-1', HANDOVER, MARGIN_S)).resolves.toBeNull();

      contracts.findCustody.mockResolvedValueOnce(custody({ handedOverAt: null }));
      await expect(service.custodyAt('dev-1', HANDOVER, MARGIN_S)).resolves.toBeNull();
    });
  });

  it('lets an organization close only with no unfinished contract (ORGANIZATION_EXIT_CHECKS)', async () => {
    await expect(service.canClose('org-1')).resolves.toBe(true);
    expect(contracts.countUnfinishedContracts).toHaveBeenCalledWith('org-1', undefined);

    contracts.countUnfinishedContracts.mockResolvedValue(1);
    await expect(service.canClose('org-1')).resolves.toBe(false);

    // In the closing transaction of `organizations`, so it reads what that transaction has locked.
    await expect(service.canClose('org-1', tx)).resolves.toBe(false);
    expect(contracts.countUnfinishedContracts).toHaveBeenLastCalledWith('org-1', tx);
  });

  it('ends the custody interval at the loss confirmation, in the caller transaction (REQ-EVT-12)', async () => {
    await service.onLossSettled('cd-1', CHECK_IN, tx);
    expect(contracts.setLostAt).toHaveBeenCalledWith('cd-1', CHECK_IN, tx);
  });
});

describe('ContractsService.visibleDevices (monitoring design §4)', () => {
  it('maps the devices in custody of the caller organization, or of all for none', async () => {
    const contracts = {
      findInCustody: jest.fn().mockResolvedValue([
        {
          deviceId: 'd-1',
          contractId: 'c-1',
          holderName: 'Le Thi E',
          contract: { code: 'RC-2026-0001', organizationId: 'org-1' },
        },
        {
          deviceId: 'd-2',
          contractId: 'c-1',
          holderName: null,
          contract: { code: 'RC-2026-0001', organizationId: 'org-1' },
        },
      ]),
    };
    const service = new ContractsService(
      contracts as unknown as ContractsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.visibleDevices({ organizationId: 'org-1' })).resolves.toEqual([
      {
        deviceId: 'd-1',
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        organizationId: 'org-1',
        holder: { name: 'Le Thi E' },
      },
      {
        deviceId: 'd-2',
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        organizationId: 'org-1',
        holder: null,
      },
    ]);
    expect(contracts.findInCustody).toHaveBeenCalledWith('org-1');
    await service.visibleDevices({ organizationId: null });
    expect(contracts.findInCustody).toHaveBeenLastCalledWith(null);
  });
});

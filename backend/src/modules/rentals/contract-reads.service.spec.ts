import { ConfigService } from '@nestjs/config';
import { ContractStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService } from '../billing';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ContractReadsService } from './contract-reads.service';
import { ContractsRepository } from './contracts.repository';

const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const ORG = { id: 'org-1', code: 'ORG-0001', legalName: 'Demo Trek Co.' };
const ROW = {
  id: 'c-1',
  organizationId: 'org-1',
  hardwareVariantId: 'v-3',
  devices: [{ deviceId: 'd-1' }],
  terms: [],
};

const config = {
  get: (key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100),
} as unknown as ConfigService;

// rentals task 5.1, api-design 02, 03, 18.
describe('ContractReadsService', () => {
  let contracts: Record<string, jest.Mock>;
  let directory: { namesOf: jest.Mock };
  let service: ContractReadsService;

  beforeEach(() => {
    contracts = {
      page: jest.fn().mockResolvedValue([[ROW], 1]),
      detail: jest.fn().mockResolvedValue(ROW),
      transitionsOf: jest.fn().mockResolvedValue([
        {
          fromStatus: null,
          toStatus: ContractStatus.REQUESTED,
          actorId: 'u-mgr',
          reason: null,
          createdAt: new Date('2026-10-26T03:00:00.000Z'),
        },
      ]),
    };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['u-mgr', 'Demo Manager']])) };
    service = new ContractReadsService(
      contracts as unknown as ContractsRepository,
      {
        labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', ORG]])),
      } as unknown as OrganizationsService,
      {
        variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
        assetTags: jest.fn().mockResolvedValue(new Map([['d-1', 'TL-0001']])),
      } as unknown as DevicesService,
      {
        balanceSummary: jest.fn().mockResolvedValue({ dueNowVnd: 0n }),
      } as unknown as BalanceService,
      config as never,
      directory,
    );
  });

  it('scopes a member to its own organization and labels each row', async () => {
    const page = await service.page({ status: ContractStatus.REQUESTED }, MANAGER);
    expect(contracts.page).toHaveBeenCalledWith(
      { organizationId: 'org-1', status: ContractStatus.REQUESTED, planType: undefined },
      0,
      20,
    );
    expect(page.items[0]).toMatchObject({ organization: ORG, variantCode: 'treklink-v3' });
  });

  it("answers 404 for another organization's contract and serves Staff any contract", async () => {
    contracts.detail.mockResolvedValue({ ...ROW, organizationId: 'org-2' });
    await expect(service.detail('c-1', MANAGER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.detail('c-1', STAFF)).resolves.toMatchObject({
      assetTags: new Map([['d-1', 'TL-0001']]),
    });
  });

  it('names the actor of each transition', async () => {
    await expect(service.transitions('c-1', MANAGER)).resolves.toEqual([
      expect.objectContaining({ toStatus: ContractStatus.REQUESTED, actor: 'Demo Manager' }),
    ]);
  });
});

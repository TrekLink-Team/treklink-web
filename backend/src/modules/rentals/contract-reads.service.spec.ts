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
  devices: [{ id: 'cd-1', deviceId: 'd-1', checkedInAt: null }],
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
  let returnChecks: jest.Mock;
  let provisioning: jest.Mock;
  let nextSteps: jest.Mock;

  beforeEach(() => {
    nextSteps = jest.fn().mockResolvedValue(new Map());
    returnChecks = jest.fn().mockResolvedValue(new Map());
    provisioning = jest.fn().mockResolvedValue([]);
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
        returnChecks,
        provisioning,
        nextSteps,
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

  it('lets Staff filter organizations while keeping an organization caller inside its token scope', async () => {
    await service.page({ organizationId: 'org-2' }, STAFF);
    expect(contracts.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-2' }),
      0,
      20,
    );
    await service.page({ organizationId: 'org-2' }, MANAGER);
    expect(contracts.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      0,
      20,
    );
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

  it('asks DevicesService for the reset and inspection of each contract row', async () => {
    const checkedInAt = new Date('2026-10-30T03:00:00.000Z');
    const check = { resetAt: new Date('2026-10-30T03:05:00.000Z'), inspection: null };
    contracts.detail.mockResolvedValue({
      ...ROW,
      devices: [{ id: 'cd-1', deviceId: 'd-1', checkedInAt }],
    });
    returnChecks.mockResolvedValue(new Map([['cd-1', check]]));

    const detail = await service.detail('c-1', STAFF);

    expect(returnChecks).toHaveBeenCalledWith([
      { contractDeviceId: 'cd-1', deviceId: 'd-1', checkedInAt },
    ]);
    expect(detail.returnChecks.get('cd-1')).toEqual(check);
  });

  it('reads the state after the return of checked-in rows for TrekLink callers only (REQ-EVT-19)', async () => {
    const checkedInAt = new Date('2026-10-30T03:00:00.000Z');
    contracts.detail.mockResolvedValue({
      ...ROW,
      devices: [
        { id: 'cd-1', deviceId: 'd-1', checkedInAt },
        { id: 'cd-2', deviceId: 'd-2', checkedInAt: null },
      ],
    });
    const state = { status: 'RETURNED', nextStep: null, lastReturnContractId: 'c-1' };
    nextSteps.mockResolvedValue(new Map([['d-1', state]]));

    const staff = await service.detail('c-1', STAFF);
    expect(nextSteps).toHaveBeenCalledWith(['d-1']);
    expect(staff.returnStates.get('d-1')).toEqual(state);

    nextSteps.mockClear();
    const manager = await service.detail('c-1', MANAGER);
    expect(nextSteps).not.toHaveBeenCalled();
    expect(manager.returnStates.size).toBe(0);
  });

  it('keeps the key version a unit carries for this organization, not another one (frontend 5.4)', async () => {
    contracts.detail.mockResolvedValue({
      ...ROW,
      devices: [
        { id: 'cd-1', deviceId: 'd-1', checkedInAt: null },
        { id: 'cd-2', deviceId: 'd-2', checkedInAt: null },
        { id: 'cd-3', deviceId: 'd-3', checkedInAt: null },
      ],
    });
    provisioning.mockResolvedValue([
      { id: 'd-1', keyOrganizationId: ROW.organizationId, keyVersion: 2 },
      { id: 'd-2', keyOrganizationId: 'org-other', keyVersion: 5 },
      { id: 'd-3', keyOrganizationId: null, keyVersion: null },
    ]);

    const detail = await service.detail('c-1', STAFF);

    expect(provisioning).toHaveBeenCalledWith(['d-1', 'd-2', 'd-3']);
    expect([...detail.provisionedKeyVersions]).toEqual([['d-1', 2]]);
  });

  it('names the actor of each transition', async () => {
    await expect(service.transitions('c-1', MANAGER)).resolves.toEqual([
      expect.objectContaining({ toStatus: ContractStatus.REQUESTED, actor: 'Demo Manager' }),
    ]);
  });
});

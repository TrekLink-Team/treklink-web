import { OrganizationsService } from '../../organizations';
import { ContractsRepository } from '../contracts.repository';
import { RentalsContractDirectory } from './contract-directory.provider';

describe('RentalsContractDirectory (CONTRACT_DIRECTORY, billing design §4)', () => {
  let contracts: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let directory: RentalsContractDirectory;

  beforeEach(() => {
    contracts = {
      codes: jest
        .fn()
        .mockResolvedValue([{ id: 'c-1', code: 'RC-2026-0001', organizationId: 'o-1' }]),
      termSeqs: jest.fn().mockResolvedValue([{ id: 't-1', seq: 2 }]),
      variantsOf: jest.fn().mockResolvedValue([
        { id: 'c-1', hardwareVariantId: 'v-1' },
        { id: 'c-2', hardwareVariantId: 'v-2' },
      ]),
    };
    organizations = {
      labelsOf: jest.fn().mockResolvedValue(new Map([['o-1', { code: 'ORG-0001' }]])),
    };
    directory = new RentalsContractDirectory(
      contracts as unknown as ContractsRepository,
      organizations as unknown as OrganizationsService,
    );
  });

  it('labels each contract with its code and organization code, and each term with its number', async () => {
    const answer = await directory.describe(['c-1'], ['t-1']);
    expect(answer.contracts.get('c-1')).toEqual({
      code: 'RC-2026-0001',
      organizationCode: 'ORG-0001',
    });
    expect(answer.termSeqs.get('t-1')).toBe(2);
  });

  it('reads nothing for empty id lists', async () => {
    const answer = await directory.describe([], []);
    expect(answer.contracts.size).toBe(0);
    expect(contracts.codes).not.toHaveBeenCalled();
    expect(contracts.termSeqs).not.toHaveBeenCalled();
  });

  it('maps each contract to its hardware variant for revenue (billing task 2.4)', async () => {
    await expect(directory.variantsOf(['c-1', 'c-2'])).resolves.toEqual(
      new Map([
        ['c-1', 'v-1'],
        ['c-2', 'v-2'],
      ]),
    );
    expect(contracts.variantsOf).toHaveBeenCalledWith(['c-1', 'c-2']);

    await expect(directory.variantsOf([])).resolves.toEqual(new Map());
    expect(contracts.variantsOf).toHaveBeenCalledTimes(1);
  });
});

import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const CALLER = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: ORG };

const policyOf = (method: 'list' | 'create' | 'revoke'): PolicyHandler => {
  const handler = Object.getOwnPropertyDescriptor(ApiKeysController.prototype, method)!
    .value as object;
  return (Reflect.getMetadata(CHECK_POLICIES_KEY, handler) as PolicyHandler[])[0];
};

describe('ApiKeysController (api-design 20 to 22)', () => {
  const keys = {
    list: jest.fn().mockResolvedValue({ items: [], limit: 5 }),
    create: jest.fn().mockResolvedValue({ id: 'k-1', key: 'tlk_x' }),
    revoke: jest.fn().mockResolvedValue({ id: 'k-1' }),
  };
  const controller = new ApiKeysController(keys as unknown as ApiKeysService);

  it('hands each route to the service with the caller', async () => {
    await expect(controller.list(ORG, CALLER)).resolves.toEqual({ items: [], limit: 5 });
    expect(keys.list).toHaveBeenCalledWith(ORG, CALLER);
    await controller.create(ORG, { name: 'ERP integration' }, CALLER);
    expect(keys.create).toHaveBeenCalledWith(ORG, 'ERP integration', CALLER);
    await controller.revoke(ORG, 'k-1', CALLER);
    expect(keys.revoke).toHaveBeenCalledWith(ORG, 'k-1', CALLER);
  });

  it('reads with read ApiKey and changes with create or revoke ApiKey', () => {
    const asked: [string, string][] = [];
    const ability = {
      can: (action: string, subject: string | object) => {
        asked.push([action, typeof subject === 'string' ? subject : 'object']);
        return true;
      },
    };
    policyOf('list')(ability);
    policyOf('create')(ability);
    policyOf('revoke')(ability);
    expect(asked).toEqual([
      ['read', 'ApiKey'],
      ['create', 'ApiKey'],
      ['revoke', 'ApiKey'],
    ]);
  });
});

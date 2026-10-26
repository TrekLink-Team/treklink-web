import { ExecutionContext } from '@nestjs/common';
import { createMongoAbility } from '@casl/ability';
import { AccountType } from '@prisma/client';
import { ErrorCode } from '../../../common/errors';
import { AbilityFactory, AppAbility } from '../casl/ability.factory';
import { hashApiKey } from '../token.service';
import { API_KEY_PERMISSIONS, ApiKeyGuard } from './api-key.guard';

const KEY = 'tlk_live_0123456789abcdef';
const ABILITY = createMongoAbility<AppAbility>([]);

describe('ApiKeyGuard (auth task 4.3, REQ-EVT-09)', () => {
  let resolver: { resolve: jest.Mock };
  let abilities: { forApiKey: jest.Mock };
  let guard: ApiKeyGuard;

  beforeEach(() => {
    resolver = {
      resolve: jest.fn().mockResolvedValue({ apiKeyId: 'key-1', organizationId: 'org-1' }),
    };
    abilities = { forApiKey: jest.fn().mockResolvedValue(ABILITY) };
    guard = new ApiKeyGuard(abilities as unknown as AbilityFactory, resolver);
  });

  it('resolves the hashed key and authenticates as the organization with the fixed ability', async () => {
    await expect(guard.authenticate(KEY)).resolves.toEqual({
      kind: 'API_KEY',
      apiKeyId: 'key-1',
      accountType: AccountType.ORGANIZATION,
      organization: { id: 'org-1' },
      roles: [],
      ability: ABILITY,
    });
    expect(resolver.resolve).toHaveBeenCalledWith(hashApiKey(KEY));
    expect(abilities.forApiKey).toHaveBeenCalledWith('org-1', API_KEY_PERMISSIONS);
    expect(API_KEY_PERMISSIONS).toEqual([
      'liveMap.read.own',
      'telemetryHistory.read.own',
      'incident.read.own',
    ]);
  });

  it('sets the caller on the request', async () => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { 'x-api-key': KEY },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ kind: 'API_KEY', organization: { id: 'org-1' } });
  });

  it.each([
    ['an unknown or revoked key', KEY],
    ['an empty key', ''],
    ['a repeated header', [KEY, KEY]],
    ['no key at all', undefined],
  ])('answers 401 UNAUTHENTICATED for %s', async (label, key) => {
    if (label === 'an unknown or revoked key') resolver.resolve.mockResolvedValue(null);

    await expect(guard.authenticate(key)).rejects.toMatchObject({
      errorCode: ErrorCode.UNAUTHENTICATED,
      message: 'Authentication required.',
    });
    expect(abilities.forApiKey).not.toHaveBeenCalled();
  });

  it('refuses every key while no module provides the resolver, so it fails closed', async () => {
    const withoutResolver = new ApiKeyGuard(abilities as unknown as AbilityFactory);

    await expect(withoutResolver.authenticate(KEY)).rejects.toMatchObject({
      errorCode: ErrorCode.UNAUTHENTICATED,
    });
  });
});

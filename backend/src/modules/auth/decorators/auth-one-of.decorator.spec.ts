import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ONE_OF_KEY, AuthOneOf, routeAcceptsApiKey } from './auth-one-of.decorator';

class Probe {
  @AuthOneOf('jwt', 'apiKey')
  both() {}

  @AuthOneOf('jwt')
  jwtOnly() {}

  plain() {}
}

const handler = (name: keyof Probe) =>
  Object.getOwnPropertyDescriptor(Probe.prototype, name)?.value as () => void;

const contextFor = (name: keyof Probe, method?: string): ExecutionContext =>
  ({
    getHandler: () => handler(name),
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  }) as unknown as ExecutionContext;

describe('@AuthOneOf and routeAcceptsApiKey (auth task 4.3)', () => {
  const reflector = new Reflector();

  it('stores the accepted credentials', () => {
    expect(reflector.get(AUTH_ONE_OF_KEY, handler('both'))).toEqual(['jwt', 'apiKey']);
  });

  it('accepts a key on a read route marked for it', () => {
    expect(routeAcceptsApiKey(reflector, contextFor('both', 'GET'))).toBe(true);
    expect(routeAcceptsApiKey(reflector, contextFor('both', 'head'))).toBe(true);
  });

  it.each([
    ['a mutating method on a marked route', 'both', 'POST'],
    ['a route marked for tokens only', 'jwtOnly', 'GET'],
    ['an unmarked route', 'plain', 'GET'],
    ['a request without a method', 'both', undefined],
  ] as const)('refuses a key on %s (REQ-UBI-04)', (_label, name, method) => {
    expect(routeAcceptsApiKey(reflector, contextFor(name, method))).toBe(false);
  });
});

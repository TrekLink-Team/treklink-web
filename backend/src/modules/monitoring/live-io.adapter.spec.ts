import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { LiveIoAdapter } from './live-io.adapter';

describe('LiveIoAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows the configured origins with credentials, keeping the other options', () => {
    const create = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({} as ReturnType<IoAdapter['createIOServer']>);
    const adapter = new LiveIoAdapter({} as INestApplicationContext, ['http://localhost:5173']);

    adapter.createIOServer(3000, { namespace: '/live' } as never);

    expect(create).toHaveBeenCalledWith(3000, {
      namespace: '/live',
      cors: { origin: ['http://localhost:5173'], credentials: true },
    });
  });
});

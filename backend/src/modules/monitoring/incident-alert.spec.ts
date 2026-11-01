import { INCIDENT_ALERT } from '../incidents';
import { LiveGateway } from './live.gateway';

describe('LiveGateway handshake', () => {
  it('refuses a socket with UNAUTHENTICATED when the token check fails', async () => {
    const authenticate = jest.fn().mockRejectedValue(new Error('jwt malformed'));
    const gateway = new LiveGateway({ authenticate } as never, {} as never, {} as never);
    let middleware: ((socket: unknown, next: (error?: Error) => void) => void) | undefined;
    gateway.afterInit({
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
    } as never);
    const refused = await new Promise<Error | undefined>((resolve) =>
      middleware!({ handshake: { auth: { token: 'bad' } }, data: {} }, resolve),
    );
    expect(refused?.message).toBe('UNAUTHENTICATED');
  });
});

describe('LiveGateway.onIncidentAlert (monitoring 2.3)', () => {
  it('sends the alert to the recipient room only, outside the stream sequence', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new LiveGateway({} as never, {} as never, {} as never);
    (gateway as unknown as { namespace: { to: jest.Mock } }).namespace = { to };
    const alert = {
      incidentId: 'inc-1',
      kind: 'TRANSITION' as const,
      code: 'INC-2026-000001',
      deviceLabel: 'TL-0042',
      holderName: null,
      at: '2026-10-29T03:15:00.000Z',
      message: 'SOS: TL-0042, 10:15. Acknowledge now.',
    };
    gateway.onIncidentAlert({ recipientId: 'u-1', alert });
    expect(to).toHaveBeenCalledWith('user:u-1');
    expect(emit).toHaveBeenCalledWith('stream', {
      seq: 0,
      type: INCIDENT_ALERT,
      deviceId: null,
      payload: alert,
      createdAt: alert.at,
    });
  });
});

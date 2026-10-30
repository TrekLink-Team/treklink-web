import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors';
import { ListEventsDto } from './dto/gateway-sync-ops.dto';
import { FieldEventQueryService } from './field-event-query.service';
import { GatewaySyncController } from './gateway-sync.controller';
import { SyncStatusService } from './sync-status.service';

const ability = (...held: string[]) => ({
  can: (action: string, subject: string | object) =>
    held.includes(`${action} ${typeof subject === 'string' ? subject : JSON.stringify(subject)}`),
});
const staff = ability('read FieldEvent', 'read FieldStation');

describe('GatewaySyncController (POST /api/gateway-sync, D-027)', () => {
  let events: { listEvents: jest.Mock };
  let status: { status: jest.Mock };
  let controller: GatewaySyncController;

  beforeEach(() => {
    events = { listEvents: jest.fn().mockResolvedValue({ items: [] }) };
    status = { status: jest.fn().mockResolvedValue({ broker: { subscriber: 'up' } }) };
    controller = new GatewaySyncController(
      events as unknown as FieldEventQueryService,
      status as unknown as SyncStatusService,
    );
  });

  it('dispatches listEvents with a typed, validated body', async () => {
    await controller.dispatch(
      {
        op: 'listEvents',
        kind: 'SOS',
        from: '2026-11-01T00:00:00Z',
        order: 'desc',
        pageSize: '20',
      },
      staff,
    );
    const [dto] = events.listEvents.mock.calls[0] as [ListEventsDto];
    expect(dto).toMatchObject({ op: 'listEvents', kind: ['SOS'], order: 'desc', pageSize: 20 });
    expect(dto.from).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('dispatches syncStatus for a caller who may read Field Stations', async () => {
    await expect(
      controller.dispatch({ op: 'syncStatus', windowMinutes: 15 }, staff),
    ).resolves.toEqual({
      broker: { subscriber: 'up' },
    });
    expect(status.status).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'syncStatus', windowMinutes: 15 }),
    );
  });

  it('refuses syncStatus with 403 FORBIDDEN without read FieldStation', async () => {
    await expect(
      controller.dispatch({ op: 'syncStatus' }, ability('read FieldEvent')),
    ).rejects.toMatchObject({ httpStatus: HttpStatus.FORBIDDEN, errorCode: ErrorCode.FORBIDDEN });
    expect(status.status).not.toHaveBeenCalled();
  });

  const badRequests: [string, unknown, string][] = [
    ['no body', undefined, 'op must be one of the following values: listEvents, syncStatus'],
    ['an unknown op', { op: 'listAudit' }, 'op must be one of the following values'],
    [
      'a field another op owns',
      { op: 'syncStatus', deviceId: 'x' },
      'property deviceId should not exist',
    ],
    [
      'a bad window',
      { op: 'syncStatus', windowMinutes: 0 },
      'windowMinutes must not be less than 1',
    ],
    ['a bad kind', { op: 'listEvents', kind: ['NOISE'] }, 'kind'],
    ['a bad order', { op: 'listEvents', order: 'up' }, 'order must be one of the following values'],
  ];

  it.each(badRequests)(
    'answers 400 VALIDATION_FAILED for %s',
    async (_case: string, body: unknown, message: string) => {
      await expect(controller.dispatch(body, staff)).rejects.toMatchObject({
        httpStatus: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCode.VALIDATION_FAILED,
      });
      try {
        await controller.dispatch(body, staff);
        throw new Error('expected dispatch to reject');
      } catch (error) {
        expect((error as Error).message).toContain(message);
      }
    },
  );
});

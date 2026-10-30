import { createMongoAbility } from '@casl/ability';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { AUTH_ONE_OF_KEY } from '../auth/decorators/auth-one-of.decorator';
import { HistoryService } from './history.service';
import { HistoryQueryDto, TelemetryHistoryController } from './telemetry-history.controller';

const handlerOf = () =>
  Object.getOwnPropertyDescriptor(TelemetryHistoryController.prototype, 'get')?.value as object;

const allows = (rules: { action: string; subject: string }[]): boolean =>
  (Reflect.getMetadata(CHECK_POLICIES_KEY, handlerOf()) as PolicyHandler[]).every((handler) =>
    handler(createMongoAbility(rules) as PolicyAbility),
  );

const queryOf = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(HistoryQueryDto, plain);
  return { dto, errors: await validate(dto) };
};

describe('TelemetryHistoryController (monitoring api-design 03)', () => {
  it('needs read TelemetryHistory, answers OK and is closed to API keys', () => {
    expect(allows([{ action: 'read', subject: 'TelemetryHistory' }])).toBe(true);
    expect(allows([{ action: 'read', subject: 'LiveMap' }])).toBe(false);
    expect(allows([])).toBe(false);
    expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf())).toBe('OK');
    expect(Reflect.getMetadata(AUTH_ONE_OF_KEY, handlerOf())).toBeUndefined();
  });

  describe('the query', () => {
    it('reads the dates and one kind as a list', async () => {
      const { dto, errors } = await queryOf({
        from: '2026-10-20T00:00:00Z',
        to: '2026-10-21T00:00:00Z',
        kind: 'POSITION',
        format: 'csv',
      });
      expect(errors).toHaveLength(0);
      expect(dto.from.toISOString()).toBe('2026-10-20T00:00:00.000Z');
      expect(dto.kind).toEqual(['POSITION']);
    });

    it('needs from and to, and refuses a bad date, kind or format', async () => {
      expect((await queryOf({})).errors.map((error) => error.property).sort()).toEqual([
        'from',
        'to',
      ]);
      expect((await queryOf({ from: 'soon', to: '2026-10-21T00:00:00Z' })).errors).toHaveLength(1);
      const good = { from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' };
      expect((await queryOf({ ...good, kind: 'SOS' })).errors).toHaveLength(1);
      expect((await queryOf({ ...good, format: 'xml' })).errors).toHaveLength(1);
    });
  });

  describe('the answer', () => {
    const history = { deviceId: 'd-1', clippedTo: [], points: [], truncated: false };
    const service = {
      history: jest.fn().mockResolvedValue(history),
      csv: jest.fn().mockReturnValue('at,kind,lat,lon,altitude,batteryPct'),
    };
    const controller = new TelemetryHistoryController(service as unknown as HistoryService);
    const caller = { id: 'u-1', roles: ['STAFF'], organizationId: null };
    const ability = createMongoAbility([]) as unknown as PolicyAbility;
    const range = {
      from: new Date('2026-10-20T00:00:00Z'),
      to: new Date('2026-10-21T00:00:00Z'),
    };

    it('is the history as JSON by default', async () => {
      await expect(controller.get('d-1', { ...range }, caller, ability)).resolves.toBe(history);
      expect(service.history).toHaveBeenCalledWith('d-1', expect.anything(), caller, ability);
    });

    it('is the CSV text for format=csv', async () => {
      await expect(
        controller.get('d-1', { ...range, format: 'csv' }, caller, ability),
      ).resolves.toBe('at,kind,lat,lon,altitude,batteryPct');
    });
  });
});

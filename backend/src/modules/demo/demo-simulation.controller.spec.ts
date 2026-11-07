import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as request from 'supertest';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { FieldSimulationService } from '../gateway-sync';
import {
  DemoSimulationController,
  SimulationEventDto,
  StartSimulatedNodeDto,
  UpdateSimulatedNodeDto,
} from './demo-simulation.controller';
import { DemoSimulationGuard } from './demo-simulation.guard';
import { DemoSimulationModule } from './demo-simulation.module';
import { demoSimulationEnabled } from './demo-flag';

const metadataOf = (key: string, method: keyof DemoSimulationController) =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(DemoSimulationController.prototype, method)!.value as object,
  ) as unknown;

const ROUTES = ['overview', 'start', 'update', 'stop', 'raise'] as const;
const CALLER = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };
const NODE_ID = '4b3a2918-0716-4f5e-8d4c-3b2a19080706';

const build = (allowed = true) => {
  const simulation = {
    overview: jest.fn().mockResolvedValue({ trails: [], patterns: [], devices: [], nodes: [] }),
    start: jest.fn().mockResolvedValue('started'),
    update: jest.fn().mockResolvedValue('updated'),
    stop: jest.fn().mockResolvedValue('stopped'),
    raise: jest.fn().mockResolvedValue('raised'),
  };
  const guard = {
    databaseAllowed: jest.fn().mockReturnValue(allowed),
    assertAllowed: jest.fn(() => {
      if (!allowed) throw new Error('DEMO_DATABASE_NOT_ALLOWED');
    }),
  };
  const controller = new DemoSimulationController(
    simulation as unknown as FieldSimulationService,
    guard as unknown as DemoSimulationGuard,
  );
  return { controller, simulation, guard };
};

describe('DemoSimulationController (specs/demo api-design 06 to 10)', () => {
  it.each(ROUTES)('checks %s against simulate on Demo (REQ-SIM-07)', (method) => {
    const can = jest.fn().mockReturnValue(true);
    const handlers = metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[];
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.every((handler) => handler({ can }))).toBe(true);
    expect(can).toHaveBeenCalledWith('simulate', 'Demo');
    const refuse: PolicyAbility = { can: () => false };
    expect(handlers.every((handler) => handler(refuse))).toBe(false);
  });

  it('names its envelope messages', () => {
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'start')).toBe('Simulated node started');
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'raise')).toBe('Simulated event raised');
  });

  it('adds databaseAllowed to the overview, read without the write check', async () => {
    const { controller, guard } = build(false);
    await expect(controller.overview()).resolves.toMatchObject({
      databaseAllowed: false,
      trails: [],
    });
    expect(guard.assertAllowed).not.toHaveBeenCalled();
  });

  it('checks the database before every write and passes the caller as the actor', async () => {
    const { controller, simulation, guard } = build();
    const body = { deviceId: 'd', trailId: 't', pattern: 'WALK' as const };
    await expect(controller.start(body, CALLER)).resolves.toBe('started');
    expect(simulation.start).toHaveBeenCalledWith(body, { id: 'admin-1', roles: ['ADMIN'] });
    await controller.update(NODE_ID, { expectedVersion: 1, pattern: 'STOP' }, CALLER);
    await controller.stop(NODE_ID, { expectedVersion: 2 }, CALLER);
    expect(simulation.stop).toHaveBeenCalledWith(NODE_ID, 2, expect.any(Object));
    await controller.raise(NODE_ID, { kind: 'SOS' }, CALLER);
    expect(simulation.raise).toHaveBeenCalledWith(NODE_ID, 'SOS', expect.any(Object));
    expect(guard.assertAllowed).toHaveBeenCalledTimes(4);
    for (const call of [1, 2, 3, 4])
      expect(guard.assertAllowed).toHaveBeenNthCalledWith(call, CALLER);
  });

  it('changes nothing when the database is not allowed', () => {
    const { controller, simulation } = build(false);
    expect(() =>
      controller.start({ deviceId: 'd', trailId: 't', pattern: 'WALK' }, CALLER),
    ).toThrow('DEMO_DATABASE_NOT_ALLOWED');
    expect(() => controller.raise(NODE_ID, { kind: 'FALL' }, CALLER)).toThrow();
    expect(simulation.start).not.toHaveBeenCalled();
    expect(simulation.raise).not.toHaveBeenCalled();
  });

  it('validates the bodies', async () => {
    const errorsOf = async (cls: new () => object, body: object) =>
      (await validate(plainToInstance(cls, body))).map((e) => e.property);
    expect(
      await errorsOf(StartSimulatedNodeDto, {
        deviceId: NODE_ID,
        trailId: 'ta-nang-phan-dung',
        pattern: 'WALK',
      }),
    ).toEqual([]);
    expect(
      await errorsOf(StartSimulatedNodeDto, {
        deviceId: 'x',
        trailId: 't',
        pattern: 'RUN',
        speedMetresPerMinute: 900,
      }),
    ).toEqual(['deviceId', 'pattern', 'speedMetresPerMinute']);
    expect(await errorsOf(UpdateSimulatedNodeDto, { pattern: 'STRAY' })).toEqual([
      'expectedVersion',
    ]);
    // Design §9.1: a style is optional and one of the eight.
    expect(
      await errorsOf(StartSimulatedNodeDto, {
        deviceId: NODE_ID,
        trailId: 'ta-nang-phan-dung',
        pattern: 'WALK',
        style: 'HIKER',
      }),
    ).toEqual([]);
    expect(
      await errorsOf(StartSimulatedNodeDto, {
        deviceId: NODE_ID,
        trailId: 'ta-nang-phan-dung',
        pattern: 'WALK',
        style: 'SPRINTER',
      }),
    ).toEqual(['style']);
    expect(await errorsOf(UpdateSimulatedNodeDto, { expectedVersion: 0, style: 'CAMPER' })).toEqual(
      [],
    );
    expect(await errorsOf(UpdateSimulatedNodeDto, { expectedVersion: 0, style: 'x' })).toEqual([
      'style',
    ]);
    expect(await errorsOf(SimulationEventDto, { kind: 'SOS_CANCEL' })).toEqual([]);
    expect(await errorsOf(SimulationEventDto, { kind: 'PANIC' })).toEqual(['kind']);
  });
});

// REQ-SIM-01: with DEMO_SIMULATION_ENABLED off the module is not loaded and every simulation route is a 404.
@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return 'ok';
  }
}

describe('DEMO_SIMULATION_ENABLED off', () => {
  let app: INestApplication;
  const previous = process.env.DEMO_SIMULATION_ENABLED;
  beforeAll(async () => {
    process.env.DEMO_SIMULATION_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        ConditionalModule.registerWhen(DemoSimulationModule, demoSimulationEnabled),
      ],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.DEMO_SIMULATION_ENABLED;
    else process.env.DEMO_SIMULATION_ENABLED = previous;
  });

  it('answers 404 on every simulation route', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server).get('/api/probe').expect(200);
    await request(server).get('/api/demo/simulation').expect(404);
    await request(server).post('/api/demo/simulation/nodes').send({}).expect(404);
    await request(server).patch(`/api/demo/simulation/nodes/${NODE_ID}`).send({}).expect(404);
    await request(server).post(`/api/demo/simulation/nodes/${NODE_ID}/stop`).send({}).expect(404);
    await request(server)
      .post(`/api/demo/simulation/nodes/${NODE_ID}/events`)
      .send({ kind: 'SOS' })
      .expect(404);
  });

  it('reads the flag as the simulator does', () => {
    expect(demoSimulationEnabled({ DEMO_SIMULATION_ENABLED: 'true' })).toBe(true);
    expect(demoSimulationEnabled({ DEMO_CONTROLS_ENABLED: 'true' })).toBe(false);
    expect(demoSimulationEnabled({})).toBe(false);
  });
});

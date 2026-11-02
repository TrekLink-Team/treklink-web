import { randomUUID } from 'node:crypto';
import { createMongoAbility } from '@casl/ability';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { IncidentsQueryService } from '../src/modules/incidents/incidents-query.service';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { GatewayIncidentEvents } from '../src/modules/gateway-sync/providers/incident-events.provider';
import { SyncQueryRepository } from '../src/modules/gateway-sync/sync-query.repository';

const url = process.env.DATABASE_URL;
if (
  !url ||
  !process.env.DATABASE_DIRECT_URL ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('API 13 db tests require an explicit disposable local Postgres database.');
}

describe('API 13 episode consistency on disposable Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: url });
  const port = new GatewayIncidentEvents(new SyncQueryRepository(prisma));
  const query = new IncidentsQueryService(
    new IncidentsRepository(prisma),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    port,
  );
  const suffix = randomUUID();
  const at = new Date('2026-11-02T00:00:00Z');
  let organizationId: string;
  let foreignId: string;
  let incidentId: string;
  let emptyId: string;
  const ids = ['a', 'b', 'late', 'foreign', 'unattributed'].map((s) => `${suffix}-${s}`);
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${suffix}@example.invalid`,
        fullName: 'API 13 fixture',
        accountType: 'TREKLINK',
      },
    });
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: suffix,
        name: 'API 13 fixture',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: 'test',
        remainingValueSchedule: [],
      },
    });
    const device = await prisma.device.create({
      data: {
        assetTag: suffix,
        nodeNum: BigInt(`0x${suffix.slice(0, 8)}`),
        hardwareVariantId: variant.id,
        firmwareVersion: 'test',
        acquiredAt: at,
        registeredById: user.id,
      },
    });
    const organizations = await Promise.all(
      ['a', 'b'].map((s) =>
        prisma.organization.create({
          data: {
            code: `${suffix}-${s}`,
            legalName: s,
            taxCode: `${suffix}-${s}`,
            address: 'Fixture',
            contactEmail: 'test@example.invalid',
            contactPhone: '0000000000',
            documentsSeen: [],
          },
        }),
      ),
    );
    [organizationId, foreignId] = organizations.map((o) => o.id);
    const base = {
      deviceId: device.id,
      source: 'DEVICE_SOS' as const,
      confidence: 'CONFIRMED' as const,
      firstEventAt: at,
      lastEventAt: at,
      state: 'CLOSED' as const,
      closedAt: new Date(at.getTime() + 120000),
      organizationId,
    };
    incidentId = (await prisma.incident.create({ data: { ...base, code: `${suffix}-episode` } }))
      .id;
    emptyId = (await prisma.incident.create({ data: { ...base, code: `${suffix}-empty` } })).id;
    const early = new Date(at.getTime() - 60000);
    const late = new Date(at.getTime() + 60000);
    await prisma.fieldEvent.createMany({
      data: [
        ...ids.map((eventId, i) => ({
          eventId,
          deviceId: device.id,
          organizationId: i === 4 ? null : i === 3 ? foreignId : organizationId,
          attribution: i === 4 ? ('UNATTRIBUTED' as const) : ('ATTRIBUTED' as const),
          uplinkKey: 'fixture',
          ingress: 'MQTT_NODE' as const,
          kind: 'POSITION' as const,
          priority: 'P1_LOCATION' as const,
          observedAt: i === 4 ? null : at,
          occurredAt: i < 2 ? early : late,
          timeSource: 'DEVICE_RTC' as const,
          incidentId,
          latitude: 11,
          longitude: 108,
          payload: {},
        })),
        {
          eventId: `${suffix}-different-episode`,
          deviceId: device.id,
          organizationId,
          attribution: 'ATTRIBUTED',
          uplinkKey: 'fixture',
          ingress: 'MQTT_NODE',
          kind: 'SOS',
          priority: 'P0_SOS',
          occurredAt: at,
          timeSource: 'DEVICE_RTC',
          incidentId: null,
          payload: {},
        },
      ],
    });
  });
  afterAll(async () => prisma.$disconnect());
  it('keeps the whole linked episode before and after SOS times, stable by occurrence then event id', async () => {
    const rows = await port.eventsOfIncident(incidentId, {});
    expect(rows.map((r) => r.eventId)).toEqual([ids[0], ids[1], ids[3], ids[2], ids[4]]);
    expect(rows).toHaveLength(5);
    expect(rows[4].observedAt).toBeNull();
    expect(Object.keys(rows[0]).sort()).toEqual([
      'eventId',
      'kind',
      'latitude',
      'longitude',
      'observedAt',
    ]);
  });
  it('returns only immutable member custody attribution and hides foreign/unattributed events', async () => {
    const caller = { id: 'operator', roles: ['ORG_OPERATOR'], organizationId };
    const ability = createMongoAbility([
      { action: 'read', subject: 'Incident', conditions: { organizationId } },
    ]);
    const rows = await query.events(incidentId, caller, ability);
    expect(rows.map((r) => r.eventId)).toEqual([ids[0], ids[1], ids[2]]);
  });
  it('hides cross-organization incidents as 404 and denies an absent policy', async () => {
    const caller = { id: 'operator', roles: ['ORG_OPERATOR'], organizationId: foreignId };
    await expect(
      query.events(
        incidentId,
        caller,
        createMongoAbility([
          { action: 'read', subject: 'Incident', conditions: { organizationId: foreignId } },
        ]),
      ),
    ).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    await expect(query.events(incidentId, caller, createMongoAbility([]))).rejects.toMatchObject({
      errorCode: 'FORBIDDEN',
    });
  });
  it('returns empty evidence and distinguishes a missing incident', async () => {
    const staff = { id: 'staff', roles: ['STAFF'], organizationId: null };
    const ability = createMongoAbility([{ action: 'read', subject: 'Incident' }]);
    await expect(query.events(emptyId, staff, ability)).resolves.toEqual([]);
    await expect(query.events(randomUUID(), staff, ability)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
  });
});

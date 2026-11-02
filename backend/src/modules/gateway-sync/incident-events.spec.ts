import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { INCIDENT_EVENTS, IncidentEvents } from '../incidents';
import { IncidentEventsPortsModule } from './incident-events-ports.module';
import { GatewaySyncModule } from './gateway-sync.module';

@Injectable()
class Consumer {
  constructor(@Inject(INCIDENT_EVENTS) readonly events: IncidentEvents) {}
}

describe('INCIDENT_EVENTS global provider (R2-b)', () => {
  it('resolves globally with private storage and exports only the token', async () => {
    expect(Reflect.getMetadata('imports', GatewaySyncModule)).toContain(IncidentEventsPortsModule);
    const findMany = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({
      imports: [PrismaModule, IncidentEventsPortsModule],
      providers: [Consumer],
    })
      .overrideProvider(PrismaService)
      .useValue({ fieldEvent: { findMany } })
      .compile();
    try {
      expect(Reflect.getMetadata('exports', IncidentEventsPortsModule)).toEqual([INCIDENT_EVENTS]);
      const { events } = module.get(Consumer);
      await expect(events.eventsOfIncident('inc-1', {})).resolves.toEqual([]);
      expect(findMany).toHaveBeenLastCalledWith({
        where: { incidentId: 'inc-1' },
        orderBy: [{ occurredAt: 'asc' }, { eventId: 'asc' }],
        select: { eventId: true, kind: true, observedAt: true, latitude: true, longitude: true },
      });
      await events.eventsOfIncident('inc-1', { organizationId: 'org-a' });
      expect(findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { incidentId: 'inc-1', organizationId: 'org-a', attribution: 'ATTRIBUTED' },
        }),
      );
    } finally {
      await module.close();
    }
  });
});

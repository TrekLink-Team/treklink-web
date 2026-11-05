import { DeviceHistoryService } from './device-history.service';

const at = (iso: string) => new Date(iso);
const noIncidents = { incidentsOfDevice: jest.fn().mockResolvedValue([]) } as never;

describe('DeviceHistoryService (monitoring api-design 07)', () => {
  it('tells a rentals move once, as the contract entry, and keeps the other device rows', async () => {
    const devices = {
      trail: jest.fn().mockResolvedValue([
        {
          at: at('2026-10-01T02:00:00Z'),
          kind: 'STATE',
          summary: 'Available to reserved: RC-2026-0001',
          actorId: 'staff-1',
          refType: 'CONTRACT',
          refId: 'c-1',
        },
        {
          at: at('2026-10-05T02:00:00Z'),
          kind: 'INSPECTION',
          summary: 'Inspection passed',
          actorId: 'staff-1',
          refType: 'INSPECTION',
          refId: 'i-1',
        },
      ]),
    };
    const contracts = {
      contractsOfDevice: jest.fn().mockResolvedValue([
        {
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          organizationId: 'org-1',
          reservedAt: at('2026-10-01T02:00:00Z'),
          releasedAt: null,
          handedOverAt: null,
          checkedInAt: null,
          checkedInById: null,
          lostAt: null,
        },
      ]),
    };
    const organizations = {
      labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', { code: 'ORG-0001' }]])),
    };
    const accounts = {
      contactCard: jest.fn().mockResolvedValue([{ id: 'staff-1', fullName: 'Demo Staff' }]),
    };
    const service = new DeviceHistoryService(
      devices as never,
      contracts as never,
      organizations as never,
      accounts as never,
      noIncidents,
    );

    const [items, total] = await service.history('dev-1', 0, 20);

    expect(total).toBe(2);
    expect(items.map((item) => item.summary)).toEqual([
      'Inspection passed',
      'Reserved for RC-2026-0001 (ORG-0001)',
    ]);
  });

  it('lists a reservation and handover sharing one timestamp newest first', async () => {
    const both = at('2026-10-30T02:00:00Z');
    const service = new DeviceHistoryService(
      { trail: jest.fn().mockResolvedValue([]) } as never,
      {
        contractsOfDevice: jest.fn().mockResolvedValue([
          {
            contractId: 'c-2',
            contractCode: 'RC-2026-0002',
            organizationId: 'org-1',
            reservedAt: both,
            releasedAt: null,
            handedOverAt: both,
            checkedInAt: at('2026-10-30T09:00:00Z'),
            checkedInById: null,
            lostAt: null,
          },
        ]),
      } as never,
      {
        labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', { code: 'ORG-0001' }]])),
      } as never,
      { contactCard: jest.fn().mockResolvedValue([]) } as never,
      noIncidents,
    );

    const [items] = await service.history('dev-1', 0, 20);

    expect(items.map((item) => item.summary)).toEqual([
      'Checked in from RC-2026-0002 (ORG-0001)',
      'Handed over on RC-2026-0002 (ORG-0001)',
      'Reserved for RC-2026-0002 (ORG-0001)',
    ]);
  });

  it('places the unit rows of one time between its reservation and its handover', async () => {
    const both = at('2026-10-30T02:00:00Z');
    const service = new DeviceHistoryService(
      {
        trail: jest.fn().mockResolvedValue([
          {
            at: at('2026-08-01T02:00:00Z'),
            kind: 'STATE',
            summary: 'Registered as In intake',
            actorId: null,
            refType: null,
            refId: null,
          },
          {
            at: both,
            kind: 'PROVISIONING',
            summary: 'Provisioned with key version 1',
            actorId: null,
            refType: 'ORGANIZATION',
            refId: 'org-1',
          },
          {
            at: both,
            kind: 'STATE',
            summary: 'From Available to Reserved (Reserved)',
            actorId: null,
            refType: 'CONTRACT',
            refId: 'c-1',
          },
        ]),
      } as never,
      {
        contractsOfDevice: jest.fn().mockResolvedValue([
          {
            contractId: 'c-1',
            contractCode: 'RC-2026-0001',
            organizationId: 'org-1',
            reservedAt: both,
            releasedAt: null,
            handedOverAt: both,
            checkedInAt: null,
            checkedInById: null,
            lostAt: null,
          },
        ]),
      } as never,
      {
        labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', { code: 'ORG-0001' }]])),
      } as never,
      { contactCard: jest.fn().mockResolvedValue([]) } as never,
      noIncidents,
    );

    const [items, total] = await service.history('dev-1', 0, 20);

    expect(total).toBe(4);
    expect(items.map((item) => item.summary)).toEqual([
      'Handed over on RC-2026-0001 (ORG-0001)',
      'Provisioned with key version 1',
      'Reserved for RC-2026-0001 (ORG-0001)',
      'Registered as In intake',
    ]);
    expect(items[0]).not.toHaveProperty('tie');
  });

  describe('incidents', () => {
    const serviceWith = (incidents: unknown[]) =>
      new DeviceHistoryService(
        { trail: jest.fn().mockResolvedValue([]) } as never,
        { contractsOfDevice: jest.fn().mockResolvedValue([]) } as never,
        { labelsOf: jest.fn().mockResolvedValue(new Map()) } as never,
        {
          contactCard: jest.fn().mockResolvedValue([{ id: 'u-1', fullName: 'Demo Operator' }]),
        } as never,
        { incidentsOfDevice: jest.fn().mockResolvedValue(incidents) } as never,
      );

    it('tells an incident as its opening and one row per later step, with the actor', async () => {
      const service = serviceWith([
        {
          id: 'inc-1',
          code: 'INC-2026-000001',
          openedAt: at('2026-10-29T03:15:00Z'),
          transitions: [
            { fromState: null, toState: 'DETECTED', actorId: null, at: at('2026-10-29T03:15:00Z') },
            {
              fromState: 'NOTIFY_PRIMARY',
              toState: 'ACKNOWLEDGED',
              actorId: 'u-1',
              at: at('2026-10-29T03:16:00Z'),
            },
          ],
        },
      ]);

      const [items, total] = await service.history('dev-1', 0, 20);

      expect(total).toBe(2);
      expect(items).toEqual([
        {
          at: at('2026-10-29T03:16:00Z'),
          kind: 'INCIDENT',
          summary: 'Incident INC-2026-000001: Notifying primary to Acknowledged',
          actor: 'Demo Operator',
          refType: 'INCIDENT',
          refId: 'inc-1',
        },
        {
          at: at('2026-10-29T03:15:00Z'),
          kind: 'INCIDENT',
          summary: 'Incident INC-2026-000001 opened (Detected)',
          actor: 'SYSTEM',
          refType: 'INCIDENT',
          refId: 'inc-1',
        },
      ]);
    });

    it('shows an incident with no recorded transition as opened at its first event', async () => {
      const service = serviceWith([
        {
          id: 'inc-2',
          code: 'INC-2026-000002',
          openedAt: at('2026-10-30T01:00:00Z'),
          transitions: [],
        },
      ]);

      const [items] = await service.history('dev-1', 0, 20);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        at: at('2026-10-30T01:00:00Z'),
        summary: 'Incident INC-2026-000002 opened',
        actor: 'SYSTEM',
      });
    });

    it('merges incident rows with the contract rows newest first', async () => {
      const service = new DeviceHistoryService(
        { trail: jest.fn().mockResolvedValue([]) } as never,
        {
          contractsOfDevice: jest.fn().mockResolvedValue([
            {
              contractId: 'c-1',
              contractCode: 'RC-2026-0001',
              organizationId: 'org-1',
              reservedAt: at('2026-10-01T02:00:00Z'),
              releasedAt: null,
              handedOverAt: at('2026-10-02T02:00:00Z'),
              checkedInAt: at('2026-10-31T02:00:00Z'),
              checkedInById: null,
              lostAt: null,
            },
          ]),
        } as never,
        {
          labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', { code: 'ORG-0001' }]])),
        } as never,
        { contactCard: jest.fn().mockResolvedValue([]) } as never,
        {
          incidentsOfDevice: jest.fn().mockResolvedValue([
            {
              id: 'inc-1',
              code: 'INC-2026-000001',
              openedAt: at('2026-10-29T03:15:00Z'),
              transitions: [
                {
                  fromState: null,
                  toState: 'DETECTED',
                  actorId: null,
                  at: at('2026-10-29T03:15:00Z'),
                },
              ],
            },
          ]),
        } as never,
      );

      const [items] = await service.history('dev-1', 0, 20);

      expect(items.map((item) => item.summary)).toEqual([
        'Checked in from RC-2026-0001 (ORG-0001)',
        'Incident INC-2026-000001 opened (Detected)',
        'Handed over on RC-2026-0001 (ORG-0001)',
        'Reserved for RC-2026-0001 (ORG-0001)',
      ]);
    });
  });
});

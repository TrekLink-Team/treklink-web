import { DeviceHistoryService } from './device-history.service';

const at = (iso: string) => new Date(iso);

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
    );

    const [items] = await service.history('dev-1', 0, 20);

    expect(items.map((item) => item.summary)).toEqual([
      'Checked in from RC-2026-0002 (ORG-0001)',
      'Handed over on RC-2026-0002 (ORG-0001)',
      'Reserved for RC-2026-0002 (ORG-0001)',
    ]);
  });
});

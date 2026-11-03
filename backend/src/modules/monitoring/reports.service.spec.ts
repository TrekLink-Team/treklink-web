import { LossCaseState } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BalanceService } from '../billing';
import { DevicesService, LossCaseService } from '../devices';
import { IncidentsQueryService } from '../incidents';
import { OrganizationsService } from '../organizations';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService } from '../rentals';
import { ReportParamDto, ReportQueryDto, ReportsService, REPORT_COLUMNS } from './reports.service';

const FROM = new Date('2026-10-01T00:00:00.000Z');
const TO = new Date('2026-11-01T00:00:00.000Z');
const NOW = new Date('2026-11-10T00:00:00.000Z');
const query = (overrides: Partial<ReportQueryDto> = {}): ReportQueryDto =>
  Object.assign(new ReportQueryDto(), { from: FROM, to: TO, ...overrides });

describe('ReportsService (monitoring api-design 08)', () => {
  let contracts: Record<string, jest.Mock>;
  let balance: Record<string, jest.Mock>;
  let devices: Record<string, jest.Mock>;
  let lossCases: Record<string, jest.Mock>;
  let incidents: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let parameters: Record<string, jest.Mock>;
  let service: ReportsService;

  beforeEach(() => {
    contracts = {
      utilization: jest.fn().mockResolvedValue([]),
      overdueContracts: jest.fn().mockResolvedValue([]),
      lostUnits: jest.fn().mockResolvedValue([]),
    };
    balance = {
      revenue: jest.fn().mockResolvedValue([]),
      lateFees: jest.fn().mockResolvedValue(new Map()),
    };
    devices = {
      unitsInService: jest.fn().mockResolvedValue([]),
      variants: jest.fn().mockResolvedValue([
        { id: 'v-2', code: 'treklink-v2' },
        { id: 'v-3', code: 'treklink-v3' },
      ]),
      assetTags: jest.fn().mockResolvedValue(new Map()),
    };
    lossCases = { summariesOfContractDevices: jest.fn().mockResolvedValue(new Map()) };
    incidents = { responseTimes: jest.fn().mockResolvedValue([]) };
    organizations = {
      labelsOf: jest.fn().mockResolvedValue(
        new Map([
          ['org-1', { id: 'org-1', code: 'ORG-0001', legalName: 'ACME Trek, Co.' }],
          ['org-2', { id: 'org-2', code: 'ORG-0002', legalName: 'Beta Tours' }],
        ]),
      ),
    };
    parameters = { get: jest.fn().mockResolvedValue(366) };
    service = new ReportsService(
      contracts as unknown as ContractsService,
      balance as unknown as BalanceService,
      devices as unknown as DevicesService,
      lossCases as unknown as LossCaseService,
      incidents as unknown as IncidentsQueryService,
      organizations as unknown as OrganizationsService,
      parameters as unknown as ParameterService,
    );
  });

  describe('the range', () => {
    it('echoes the dates and reads the owning module for the range', async () => {
      const report = await service.report('revenue', query(), NOW);
      expect(report).toEqual({ kind: 'revenue', from: '2026-10-01', to: '2026-11-01', rows: [] });
      expect(balance.revenue).toHaveBeenCalledWith({ from: FROM, to: TO });
      expect(parameters.get).toHaveBeenCalledWith('monitoring.reportMaxRangeDays');
    });

    it.each([
      ['an end equal to the start', { to: FROM }],
      ['an end before the start', { to: new Date('2026-09-01T00:00:00.000Z') }],
      ['a span of more than 366 days', { to: new Date('2027-10-03T00:00:00.000Z') }],
    ])('refuses %s with 400 and reads nothing', async (_name, overrides) => {
      await expect(service.report('revenue', query(overrides), NOW)).rejects.toMatchObject({
        status: 400,
        message: 'to must be after from and at most 366 days later.',
      });
      expect(balance.revenue).not.toHaveBeenCalled();
    });

    it('accepts exactly the longest span and follows the parameter', async () => {
      await expect(
        service.report('revenue', query({ to: new Date('2027-10-02T00:00:00.000Z') }), NOW),
      ).resolves.toMatchObject({ to: '2027-10-02' });
      parameters.get.mockResolvedValue(31);
      await expect(
        service.report('revenue', query({ to: new Date('2026-11-02T00:00:00.000Z') }), NOW),
      ).rejects.toMatchObject({
        status: 400,
        message: 'to must be after from and at most 31 days later.',
      });
    });

    it('fails with 500 when the parameter is not a number', async () => {
      parameters.get.mockResolvedValue('x');
      await expect(service.report('revenue', query(), NOW)).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('utilization', () => {
    it('divides the rented unit-days by the units in service over the days of the range', async () => {
      contracts.utilization.mockResolvedValue([
        { hardwareVariantId: 'v-3', rentedUnitDays: 155 },
        { hardwareVariantId: 'v-2', rentedUnitDays: 15.5 },
      ]);
      devices.unitsInService.mockResolvedValue([
        { hardwareVariantId: 'v-3', units: 10 },
        { hardwareVariantId: 'v-2', units: 5 },
      ]);
      const { rows } = await service.report('utilization', query(), NOW);
      expect(rows).toEqual([
        {
          variant: 'treklink-v2',
          unitsInService: 5,
          rentedUnitDays: 15.5,
          availableUnitDays: 155,
          utilizationPct: 10,
        },
        {
          variant: 'treklink-v3',
          unitsInService: 10,
          rentedUnitDays: 155,
          availableUnitDays: 310,
          utilizationPct: 50,
        },
      ]);
      expect(contracts.utilization).toHaveBeenCalledWith({ from: FROM, to: TO }, NOW);
    });

    it('lists a variant with units but no rental at 0 and one with rentals but no unit in service at 0', async () => {
      contracts.utilization.mockResolvedValue([{ hardwareVariantId: 'v-2', rentedUnitDays: 4 }]);
      devices.unitsInService.mockResolvedValue([{ hardwareVariantId: 'v-3', units: 2 }]);
      const { rows } = await service.report('utilization', query(), NOW);
      expect(rows).toEqual([
        {
          variant: 'treklink-v2',
          unitsInService: 0,
          rentedUnitDays: 4,
          availableUnitDays: 0,
          utilizationPct: 0,
        },
        {
          variant: 'treklink-v3',
          unitsInService: 2,
          rentedUnitDays: 0,
          availableUnitDays: 62,
          utilizationPct: 0,
        },
      ]);
    });

    it('stops counting available days at now, and never reads over 100 percent', async () => {
      contracts.utilization.mockResolvedValue([{ hardwareVariantId: 'v-3', rentedUnitDays: 500 }]);
      devices.unitsInService.mockResolvedValue([{ hardwareVariantId: 'v-3', units: 2 }]);
      const now = new Date('2026-10-11T00:00:00.000Z');
      const { rows } = await service.report('utilization', query(), now);
      expect(rows).toEqual([
        {
          variant: 'treklink-v3',
          unitsInService: 2,
          rentedUnitDays: 500,
          availableUnitDays: 20,
          utilizationPct: 100,
        },
      ]);
    });

    it('names an unknown variant null and sorts it last', async () => {
      contracts.utilization.mockResolvedValue([{ hardwareVariantId: 'v-9', rentedUnitDays: 1 }]);
      devices.unitsInService.mockResolvedValue([{ hardwareVariantId: 'v-2', units: 1 }]);
      const { rows } = await service.report('utilization', query(), NOW);
      expect(rows.map((row) => (row as { variant: string | null }).variant)).toEqual([
        'treklink-v2',
        null,
      ]);
    });
  });

  describe('revenue', () => {
    it('turns the amounts into numbers and keeps the variant code, null included', async () => {
      balance.revenue.mockResolvedValue([
        {
          hardwareVariantId: 'v-3',
          variantCode: 'treklink-v3',
          invoicedVnd: 18_000_000n,
          paidVnd: 13_500_000n,
          outstandingVnd: 4_500_000n,
        },
        {
          hardwareVariantId: null,
          variantCode: null,
          invoicedVnd: 100n,
          paidVnd: 0n,
          outstandingVnd: 100n,
        },
      ]);
      const { rows } = await service.report('revenue', query(), NOW);
      expect(rows).toEqual([
        {
          variant: 'treklink-v3',
          invoicedVnd: 18_000_000,
          paidVnd: 13_500_000,
          outstandingVnd: 4_500_000,
        },
        { variant: null, invoicedVnd: 100, paidVnd: 0, outstandingVnd: 100 },
      ]);
    });
  });

  describe('overdue', () => {
    const contract = (overrides: Record<string, unknown> = {}) => ({
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      organizationId: 'org-1',
      endsAt: new Date('2026-10-20T00:00:00.000Z'),
      daysOverdue: 12,
      unitsOut: 3,
      state: 'OVERDUE',
      ...overrides,
    });

    it('asks as of the end of the range and joins the organization name and the late fees', async () => {
      contracts.overdueContracts.mockResolvedValue([contract()]);
      balance.lateFees.mockResolvedValue(new Map([['c-1', 150_000n]]));
      const { rows } = await service.report('overdue', query(), NOW);
      expect(contracts.overdueContracts).toHaveBeenCalledWith(TO, NOW);
      expect(balance.lateFees).toHaveBeenCalledWith(['c-1']);
      expect(rows).toEqual([
        {
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          organization: 'ACME Trek, Co.',
          endDate: '2026-10-20',
          daysOverdue: 12,
          unitsOut: 3,
          lateFeeVnd: 150_000,
          state: 'OVERDUE',
        },
      ]);
    });

    it('sorts by days overdue, largest first, then by code, and shows no late fee as zero', async () => {
      contracts.overdueContracts.mockResolvedValue([
        contract({ contractId: 'c-1', contractCode: 'RC-B', daysOverdue: 5 }),
        contract({
          contractId: 'c-2',
          contractCode: 'RC-C',
          daysOverdue: 30,
          organizationId: 'org-2',
        }),
        contract({ contractId: 'c-3', contractCode: 'RC-A', daysOverdue: 5 }),
      ]);
      const { rows } = await service.report('overdue', query(), NOW);
      expect(
        (rows as { contractCode: string; lateFeeVnd: number }[]).map((row) => [
          row.contractCode,
          row.lateFeeVnd,
        ]),
      ).toEqual([
        ['RC-C', 0],
        ['RC-A', 0],
        ['RC-B', 0],
      ]);
    });

    it('falls back to the organization id when the directory does not know it', async () => {
      contracts.overdueContracts.mockResolvedValue([contract({ organizationId: 'org-9' })]);
      const { rows } = await service.report('overdue', query(), NOW);
      expect((rows[0] as { organization: string }).organization).toBe('org-9');
    });
  });

  describe('lost', () => {
    const unit = (overrides: Record<string, unknown> = {}) => ({
      contractDeviceId: 'cd-1',
      deviceId: 'd-1',
      lostAt: new Date('2026-10-15T08:00:00.000Z'),
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      organizationId: 'org-1',
      hardwareVariantId: 'v-3',
      ...overrides,
    });

    it('joins the asset tag, variant, organization and the loss case state and charge', async () => {
      contracts.lostUnits.mockResolvedValue([unit()]);
      devices.assetTags.mockResolvedValue(new Map([['d-1', 'TL-0042']]));
      lossCases.summariesOfContractDevices.mockResolvedValue(
        new Map([
          [
            'cd-1',
            { id: 'lc-1', code: 'LOSS-0001', state: LossCaseState.CONFIRMED, chargeVnd: 1_200_000 },
          ],
        ]),
      );
      const { rows } = await service.report('lost', query(), NOW);
      expect(contracts.lostUnits).toHaveBeenCalledWith({ from: FROM, to: TO });
      expect(lossCases.summariesOfContractDevices).toHaveBeenCalledWith(['cd-1']);
      expect(rows).toEqual([
        {
          lossCaseId: 'lc-1',
          assetTag: 'TL-0042',
          variant: 'treklink-v3',
          organization: 'ACME Trek, Co.',
          contractId: 'c-1',
          contractCode: 'RC-2026-0001',
          lostAt: '2026-10-15T08:00:00.000Z',
          lossCaseState: 'CONFIRMED',
          chargeVnd: 1_200_000,
        },
      ]);
    });

    it('shows a unit with no loss case and no known tag with empty fields instead of dropping it', async () => {
      contracts.lostUnits.mockResolvedValue([unit({ hardwareVariantId: 'v-9' })]);
      const { rows } = await service.report('lost', query(), NOW);
      expect(rows).toEqual([
        expect.objectContaining({
          lossCaseId: null,
          assetTag: null,
          variant: null,
          lossCaseState: null,
          chargeVnd: null,
        }),
      ]);
    });

    it('answers no rows and reads no tags for no lost units', async () => {
      const { rows } = await service.report('lost', query(), NOW);
      expect(rows).toEqual([]);
      expect(devices.assetTags).toHaveBeenCalledWith([]);
    });
  });

  describe('incident-times', () => {
    it('carries the row over every incident with a null organization and looks no name up for it', async () => {
      incidents.responseTimes.mockResolvedValue([
        {
          organizationId: 'org-1',
          incidents: 1,
          ackMedianSec: 5,
          ackP95Sec: 5,
          resolveMedianSec: null,
          resolveP95Sec: null,
        },
        {
          organizationId: null,
          incidents: 2,
          ackMedianSec: 5,
          ackP95Sec: 9,
          resolveMedianSec: null,
          resolveP95Sec: null,
        },
      ]);
      const { rows } = await service.report('incident-times', query(), NOW);
      expect(organizations.labelsOf).toHaveBeenCalledWith(['org-1']);
      expect(rows.map((row) => (row as { organization: string | null }).organization)).toEqual([
        'ACME Trek, Co.',
        null,
      ]);
    });

    it('names the organization and carries the four figures, null kept', async () => {
      incidents.responseTimes.mockResolvedValue([
        {
          organizationId: 'org-1',
          incidents: 3,
          ackMedianSec: 42,
          ackP95Sec: 90,
          resolveMedianSec: 840,
          resolveP95Sec: 1800,
        },
        {
          organizationId: 'org-2',
          incidents: 1,
          ackMedianSec: 10,
          ackP95Sec: 10,
          resolveMedianSec: null,
          resolveP95Sec: null,
        },
      ]);
      const { rows } = await service.report('incident-times', query(), NOW);
      expect(incidents.responseTimes).toHaveBeenCalledWith({ from: FROM, to: TO });
      expect(rows).toEqual([
        {
          organization: 'ACME Trek, Co.',
          incidents: 3,
          ackMedianSec: 42,
          ackP95Sec: 90,
          resolveMedianSec: 840,
          resolveP95Sec: 1800,
        },
        {
          organization: 'Beta Tours',
          incidents: 1,
          ackMedianSec: 10,
          ackP95Sec: 10,
          resolveMedianSec: null,
          resolveP95Sec: null,
        },
      ]);
    });
  });

  describe('csv', () => {
    it('writes the header of the kind and one row per record, quoting a name with a comma', async () => {
      incidents.responseTimes.mockResolvedValue([
        {
          organizationId: 'org-1',
          incidents: 3,
          ackMedianSec: 42,
          ackP95Sec: 90,
          resolveMedianSec: null,
          resolveP95Sec: null,
        },
      ]);
      const report = await service.report('incident-times', query(), NOW);
      expect(service.csv(report)).toBe(
        'organization,incidents,ackMedianSec,ackP95Sec,resolveMedianSec,resolveP95Sec\n"ACME Trek, Co.",3,42,90,,',
      );
    });

    it('writes only the header for a report with no rows, for every kind', async () => {
      for (const kind of Object.keys(REPORT_COLUMNS) as (keyof typeof REPORT_COLUMNS)[]) {
        const report = await service.report(kind, query(), NOW);
        expect(service.csv(report)).toBe(REPORT_COLUMNS[kind].join(','));
      }
    });

    it('writes the revenue rows as plain digits', async () => {
      balance.revenue.mockResolvedValue([
        {
          hardwareVariantId: 'v-3',
          variantCode: 'treklink-v3',
          invoicedVnd: 18_000_000n,
          paidVnd: 13_500_000n,
          outstandingVnd: 4_500_000n,
        },
      ]);
      const report = await service.report('revenue', query(), NOW);
      expect(service.csv(report)).toBe(
        'variant,invoicedVnd,paidVnd,outstandingVnd\ntreklink-v3,18000000,13500000,4500000',
      );
    });
  });
});

describe('the report DTOs', () => {
  const check = async (type: new () => object, plain: Record<string, unknown>) =>
    validate(plainToInstance(type, plain));

  it('accepts the five kinds and refuses any other', async () => {
    for (const kind of ['utilization', 'revenue', 'overdue', 'lost', 'incident-times']) {
      expect(await check(ReportParamDto, { kind })).toHaveLength(0);
    }
    expect(await check(ReportParamDto, { kind: 'payroll' })).not.toHaveLength(0);
  });

  it('needs both dates and accepts a plain date, json or csv', async () => {
    expect(await check(ReportQueryDto, { from: '2026-10-01', to: '2026-11-01' })).toHaveLength(0);
    expect(
      await check(ReportQueryDto, { from: '2026-10-01', to: '2026-11-01', format: 'csv' }),
    ).toHaveLength(0);
    expect(await check(ReportQueryDto, { from: '2026-10-01' })).not.toHaveLength(0);
    expect(await check(ReportQueryDto, { from: 'soon', to: '2026-11-01' })).not.toHaveLength(0);
    expect(
      await check(ReportQueryDto, { from: '2026-10-01', to: '2026-11-01', format: 'xml' }),
    ).not.toHaveLength(0);
  });

  it('reads a plain date as midnight UTC', () => {
    const dto = plainToInstance(ReportQueryDto, { from: '2026-10-01', to: '2026-11-01' });
    expect(dto.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

import { HttpStatus, Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService } from '../billing';
import { DevicesService, LossCaseService } from '../devices';
import { IncidentsQueryService } from '../incidents';
import { OrganizationsService } from '../organizations';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService } from '../rentals';
import { isNumber } from './parameter-values';
import { toCsv } from './reports-csv';

const DAY_MS = 86_400_000;

export const REPORT_KINDS = [
  'utilization',
  'revenue',
  'overdue',
  'lost',
  'incident-times',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export class ReportParamDto {
  @IsIn(REPORT_KINDS)
  kind!: ReportKind;
}

// api-design 08: `from` inclusive and `to` exclusive, both dates; the service checks the order and the span.
export class ReportQueryDto {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export interface UtilizationRow {
  variant: string | null;
  unitsInService: number;
  rentedUnitDays: number;
  availableUnitDays: number;
  utilizationPct: number;
}

export interface RevenueRow {
  variant: string | null;
  invoicedVnd: number;
  paidVnd: number;
  outstandingVnd: number;
}

export interface OverdueRow {
  contractId: string;
  contractCode: string;
  organization: string;
  endDate: string;
  daysOverdue: number;
  unitsOut: number;
  lateFeeVnd: number;
  state: string;
}

export interface LostRow {
  lossCaseId: string | null;
  assetTag: string | null;
  variant: string | null;
  organization: string;
  contractId: string;
  contractCode: string;
  lostAt: string;
  lossCaseState: string | null;
  chargeVnd: number | null;
}

export interface IncidentTimesRow {
  // Null for the row over every incident of the period.
  organization: string | null;
  incidents: number;
  ackMedianSec: number | null;
  ackP95Sec: number | null;
  resolveMedianSec: number | null;
  resolveP95Sec: number | null;
}

type Rows = UtilizationRow[] | RevenueRow[] | OverdueRow[] | LostRow[] | IncidentTimesRow[];

export interface ReportView {
  kind: ReportKind;
  from: string;
  to: string;
  rows: Rows;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);
const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const REPORT_COLUMNS: Record<ReportKind, readonly string[]> = {
  utilization: [
    'variant',
    'unitsInService',
    'rentedUnitDays',
    'availableUnitDays',
    'utilizationPct',
  ],
  revenue: ['variant', 'invoicedVnd', 'paidVnd', 'outstandingVnd'],
  overdue: [
    'contractId',
    'contractCode',
    'organization',
    'endDate',
    'daysOverdue',
    'unitsOut',
    'lateFeeVnd',
    'state',
  ],
  lost: [
    'lossCaseId',
    'assetTag',
    'variant',
    'organization',
    'contractId',
    'contractCode',
    'lostAt',
    'lossCaseState',
    'chargeVnd',
  ],
  'incident-times': [
    'organization',
    'incidents',
    'ackMedianSec',
    'ackP95Sec',
    'resolveMedianSec',
    'resolveP95Sec',
  ],
};

// `GET /api/reports/:kind` (api-design 08, UC-59, FR-BILL-10): five reports over a date range, composed from
// the owning modules and returned as JSON or as CSV text. TrekLink Staff and Admin.
@Injectable()
export class ReportsService {
  constructor(
    private readonly contracts: ContractsService,
    private readonly balance: BalanceService,
    private readonly devices: DevicesService,
    private readonly lossCases: LossCaseService,
    private readonly incidents: IncidentsQueryService,
    private readonly organizations: OrganizationsService,
    private readonly parameters: ParameterService,
  ) {}

  async report(kind: ReportKind, query: ReportQueryDto, now = new Date()): Promise<ReportView> {
    await this.checkRange(query);
    const range = { from: query.from, to: query.to };
    const rows = await this.rows(kind, range, now);
    return { kind, from: day(query.from), to: day(query.to), rows };
  }

  // `format=csv`: the same rows as CSV text, which the envelope carries in `result` (api-design 08).
  csv(report: ReportView): string {
    return toCsv(REPORT_COLUMNS[report.kind], report.rows);
  }

  private rows(kind: ReportKind, range: { from: Date; to: Date }, now: Date): Promise<Rows> {
    switch (kind) {
      case 'utilization':
        return this.utilization(range, now);
      case 'revenue':
        return this.revenue(range);
      case 'overdue':
        return this.overdue(range.to, now);
      case 'lost':
        return this.lost(range);
      case 'incident-times':
        return this.incidentTimes(range);
    }
  }

  // Rented unit-days over the units in service now. The count is the current one, not a history of the
  // range, so a unit retired during the range is not in the denominator; the days counted stop at `now`.
  private async utilization(range: { from: Date; to: Date }, now: Date): Promise<UtilizationRow[]> {
    const [rented, inService, variants] = await Promise.all([
      this.contracts.utilization(range, now),
      this.devices.unitsInService(),
      this.devices.variants(false),
    ]);
    const codeOf = new Map(variants.map((variant) => [variant.id, variant.code]));
    const rentedOf = new Map(rented.map((row) => [row.hardwareVariantId, row.rentedUnitDays]));
    const unitsOf = new Map(inService.map((row) => [row.hardwareVariantId, row.units]));
    const days = Math.max(
      0,
      (Math.min(range.to.getTime(), now.getTime()) - range.from.getTime()) / DAY_MS,
    );
    const ids = [...new Set([...rentedOf.keys(), ...unitsOf.keys()])];
    return ids
      .map((id) => {
        const units = unitsOf.get(id) ?? 0;
        const rentedUnitDays = rentedOf.get(id) ?? 0;
        const availableUnitDays = round(units * days, 2);
        // More rented days than available ones (a unit left service during the range) reads as full use.
        const pct =
          availableUnitDays > 0 ? Math.min(100, (rentedUnitDays / availableUnitDays) * 100) : 0;
        return {
          variant: codeOf.get(id) ?? null,
          unitsInService: units,
          rentedUnitDays,
          availableUnitDays,
          utilizationPct: round(pct, 1),
        };
      })
      .sort((a, b) => (a.variant ?? '￿').localeCompare(b.variant ?? '￿'));
  }

  private async revenue(range: { from: Date; to: Date }): Promise<RevenueRow[]> {
    return (await this.balance.revenue(range)).map((row) => ({
      variant: row.variantCode,
      invoicedVnd: Number(row.invoicedVnd),
      paidVnd: Number(row.paidVnd),
      outstandingVnd: Number(row.outstandingVnd),
    }));
  }

  // Contracts in OVERDUE or DEFAULTED now, as of `to` (capped at now), with the late fees charged so far.
  private async overdue(to: Date, now: Date): Promise<OverdueRow[]> {
    const contracts = await this.contracts.overdueContracts(to, now);
    const [labels, lateFees] = await Promise.all([
      this.organizations.labelsOf(contracts.map((row) => row.organizationId)),
      this.balance.lateFees(contracts.map((row) => row.contractId)),
    ]);
    return contracts
      .map((row) => ({
        contractId: row.contractId,
        contractCode: row.contractCode,
        organization: labels.get(row.organizationId)?.legalName ?? row.organizationId,
        endDate: day(row.endsAt),
        daysOverdue: row.daysOverdue,
        unitsOut: row.unitsOut,
        lateFeeVnd: Number(lateFees.get(row.contractId) ?? 0n),
        state: row.state,
      }))
      .sort(
        (a, b) => b.daysOverdue - a.daysOverdue || a.contractCode.localeCompare(b.contractCode),
      );
  }

  private async lost(range: { from: Date; to: Date }): Promise<LostRow[]> {
    const units = await this.contracts.lostUnits(range);
    const [labels, tags, variants, cases] = await Promise.all([
      this.organizations.labelsOf(units.map((row) => row.organizationId)),
      this.devices.assetTags(units.map((row) => row.deviceId)),
      this.devices.variants(false),
      this.lossCases.summariesOfContractDevices(units.map((row) => row.contractDeviceId)),
    ]);
    const codeOf = new Map(variants.map((variant) => [variant.id, variant.code]));
    return units.map((row) => {
      const found = cases.get(row.contractDeviceId);
      return {
        lossCaseId: found?.id ?? null,
        assetTag: tags.get(row.deviceId) ?? null,
        variant: codeOf.get(row.hardwareVariantId) ?? null,
        organization: labels.get(row.organizationId)?.legalName ?? row.organizationId,
        contractId: row.contractId,
        contractCode: row.contractCode,
        lostAt: row.lostAt.toISOString(),
        lossCaseState: found?.state ?? null,
        chargeVnd: found?.chargeVnd ?? null,
      };
    });
  }

  private async incidentTimes(range: { from: Date; to: Date }): Promise<IncidentTimesRow[]> {
    const times = await this.incidents.responseTimes(range);
    const labels = await this.organizations.labelsOf(
      times.flatMap((row) => (row.organizationId === null ? [] : [row.organizationId])),
    );
    return times.map((row) => ({
      organization:
        row.organizationId === null
          ? null
          : (labels.get(row.organizationId)?.legalName ?? row.organizationId),
      incidents: row.incidents,
      ackMedianSec: row.ackMedianSec,
      ackP95Sec: row.ackP95Sec,
      resolveMedianSec: row.resolveMedianSec,
      resolveP95Sec: row.resolveP95Sec,
    }));
  }

  // `to` is after `from` and at most `monitoring.reportMaxRangeDays` days later (REQ-ERR-02).
  private async checkRange(query: ReportQueryDto): Promise<void> {
    const maxDays = await this.parameters.get('monitoring.reportMaxRangeDays');
    if (!isNumber(maxDays)) {
      throw new DomainException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
        'The parameter monitoring.reportMaxRangeDays is not a number.',
      );
    }
    const span = query.to.getTime() - query.from.getTime();
    if (span <= 0 || span > maxDays * DAY_MS) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `to must be after from and at most ${maxDays} days later.`,
      );
    }
  }
}

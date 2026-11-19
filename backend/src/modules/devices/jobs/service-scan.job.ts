import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { AUDIT_RECORD, AuditRecordEvent } from '../../platform/audit/audit-record.event';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { STAFF_NOTIFICATIONS, StaffNotifications } from '../../platform/ports';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { addDays, businessDay, dayString } from '../device-view';
import { DueServiceDevice, MaintenanceRepository } from '../maintenance.repository';
import { MaintenanceService } from '../maintenance.service';

const SERVICE_SCAN_PERIOD_DAYS = 7;
const SERVICE_SCAN_WAKE_CRON = '0 0 * * * *';
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const scheduleParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

export interface ServiceScanOutcome {
  moved: number;
  listedOnly: number;
}

interface ServiceScanLine {
  assetTag: string;
  status: DeviceStatus;
  reason: 'SCHEDULED' | 'FIRMWARE_UPDATE';
  expectedAt: Date;
}

const isScheduledHour = (at: Date, hourLocal: number): boolean => {
  const parts = new Map(scheduleParts.formatToParts(at).map((part) => [part.type, part.value]));
  return parts.get('weekday') === 'Mon' && Number(parts.get('hour')) === hourLocal;
};

const lineOf = (device: DueServiceDevice, dueBefore: Date, at: Date): ServiceScanLine => {
  const scheduled = device.serviceDueAt !== null && device.serviceDueAt < dueBefore;
  return {
    assetTag: device.assetTag,
    status: device.status,
    reason: scheduled ? 'SCHEDULED' : 'FIRMWARE_UPDATE',
    expectedAt: scheduled ? device.serviceDueAt! : businessDay(at),
  };
};

const renderLines = (lines: ServiceScanLine[]): string =>
  lines.length === 0
    ? 'None.'
    : lines
        .map(
          (line) =>
            `- ${line.assetTag} (${line.status}): ${line.reason}, expected ${dayString(line.expectedAt)}`,
        )
        .join('\n');

// The hourly wake lets the business parameter choose any UTC+7 hour. The method performs work only
// on Monday at that hour; JobRunnerService holds the `devices.serviceScan` advisory lock around it.
@Injectable()
export class ServiceScanJob {
  private readonly logger = new Logger(ServiceScanJob.name);

  constructor(
    private readonly records: MaintenanceRepository,
    private readonly maintenance: MaintenanceService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    @Optional() @Inject(STAFF_NOTIFICATIONS) private readonly staff?: StaffNotifications,
  ) {}

  @ScheduledJob('devices.serviceScan', SERVICE_SCAN_WAKE_CRON)
  async run(at: Date = new Date()): Promise<ServiceScanOutcome> {
    const outcome: ServiceScanOutcome = { moved: 0, listedOnly: 0 };
    const hourLocal = await this.parameters.get('devices.serviceScanHourLocal');
    if (!isScheduledHour(at, hourLocal)) return outcome;

    const leadDays = await this.parameters.get('devices.maintenanceLeadDays');
    const dueBefore = addDays(businessDay(at), SERVICE_SCAN_PERIOD_DAYS + leadDays);
    const moved: ServiceScanLine[] = [];
    const listedOnly: ServiceScanLine[] = [];

    for (const device of await this.records.dueDevices(dueBefore)) {
      const line = lineOf(device, dueBefore, at);
      if (device.status !== DeviceStatus.AVAILABLE) {
        listedOnly.push(line);
        continue;
      }
      try {
        const opened = await this.events.transaction(async (tx) => {
          const record = await this.maintenance.openScheduled(device.id, dueBefore, at, tx);
          if (record) this.audit(device, record);
          return record;
        });
        if (opened) {
          moved.push({
            ...line,
            status: DeviceStatus.MAINTENANCE,
            reason: opened.reason,
            expectedAt: opened.expectedAt,
          });
        } else {
          listedOnly.push(line);
        }
      } catch (error) {
        listedOnly.push(line);
        this.logger.error(
          `Service scan did not open maintenance for ${device.assetTag}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    outcome.moved = moved.length;
    outcome.listedOnly = listedOnly.length;
    if (moved.length + listedOnly.length > 0) await this.emailStaff(moved, listedOnly);
    return outcome;
  }

  private audit(
    device: DueServiceDevice,
    record: { id: string; reason: 'SCHEDULED' | 'FIRMWARE_UPDATE'; expectedAt: Date },
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: null,
      actorRoles: [],
      organizationId: null,
      action: 'maintenance.open',
      subjectType: 'MaintenanceRecord',
      subjectId: record.id,
      before: null,
      after: {
        deviceId: device.id,
        assetTag: device.assetTag,
        reason: record.reason,
        status: 'OPEN',
        expectedAt: dayString(record.expectedAt),
      },
    } satisfies AuditRecordEvent);
  }

  private async emailStaff(moved: ServiceScanLine[], listedOnly: ServiceScanLine[]): Promise<void> {
    if (!this.staff) return;
    try {
      const delivery = await this.staff.send(
        'TrekLink weekly device service scan',
        `Moved to MAINTENANCE:\n${renderLines(moved)}\n\nListed only:\n${renderLines(listedOnly)}`,
      );
      if (delivery.accepted === 0) {
        this.logger.warn('Weekly device service scan: no Staff recipient accepted the notice.');
      }
    } catch (error) {
      this.logger.error(`Weekly device service scan notice failed: ${String(error)}`);
    }
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DEVICE_FAULT_REPORTED, DeviceFaultReportedEvent } from './contract-notification.events';
import { FaultReportsRepository } from './fault-reports.repository';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Fault report not found.');

const invalidState = (state: string) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${state}.`,
  );

@Injectable()
export class FaultReportsService {
  constructor(
    private readonly reports: FaultReportsRepository,
    private readonly devices: DevicesService,
    private readonly organizations: OrganizationsService,
    private readonly events: TransactionalEvents,
  ) {}

  async report(contractId: string, deviceId: string, description: string, caller: Caller) {
    const { organizationId } = caller;
    if (organizationId === null) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    }
    await this.organizations.assertCanUseRentalGroups(organizationId);

    return this.events.transaction(async (tx) => {
      if (!(await this.reports.lockOwnContract(contractId, organizationId, tx))) throw notFound();
      const custody = await this.reports.latestCustody(contractId, deviceId, tx);
      if (!custody) throw notFound();
      const status = await this.devices.lockStatus(deviceId, tx);
      if (status !== DeviceStatus.RENTED) throw invalidState(status ?? 'unavailable');
      if (custody.replacedBy) throw invalidState('REPLACED');
      if (custody.checkedInAt) throw invalidState('RETURNED');
      if (custody.lostAt) throw invalidState('LOST');
      if (custody.releasedAt) throw invalidState('RELEASED');
      if (!custody.handedOverAt) throw invalidState('RESERVED');

      const [existing] = custody.faultReports;
      if (existing) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.FAULT_ALREADY_REPORTED,
          'A fault on this device is already reported.',
          { reportId: existing.id },
        );
      }

      const report = await this.reports.insert(
        {
          contractId,
          contractDeviceId: custody.id,
          organizationId,
          deviceId,
          description,
          reportedById: caller.id,
          reportedAt: new Date(),
        },
        tx,
      );
      this.events.emitAfterCommit(DEVICE_FAULT_REPORTED, {
        reportId: report.id,
        contractId,
        deviceId,
        organizationId,
      } satisfies DeviceFaultReportedEvent);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId,
        action: DEVICE_FAULT_REPORTED,
        subjectType: 'DeviceFaultReport',
        subjectId: report.id,
        after: { contractId, contractDeviceId: custody.id, deviceId },
      } satisfies AuditRecordEvent);

      return {
        id: report.id,
        contractId: report.contractId,
        contractDeviceId: report.contractDeviceId,
        deviceId: report.deviceId,
        description: report.description,
        reportedBy: { id: report.reportedById },
        reportedAt: report.reportedAt,
        resolvedAt: report.resolvedAt,
        resolution: report.resolution,
      };
    });
  }

  async ofContract(contractId: string, caller: Caller) {
    const reports = await this.reports.ofContract(contractId, caller.organizationId);
    if (!reports) throw notFound();
    const tags = await this.devices.assetTags([...new Set(reports.map((row) => row.deviceId))]);
    return reports.map((row) => ({ ...row, assetTag: tags.get(row.deviceId) ?? null }));
  }
}

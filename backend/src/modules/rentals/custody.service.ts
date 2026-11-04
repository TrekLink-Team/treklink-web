import { Injectable } from '@nestjs/common';
import { FaultResolution, GroupExit, Prisma } from '@prisma/client';
import { ContractsRepository } from './contracts.repository';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

type Unit = { id: string; deviceId: string };

type Closure =
  | { reason: 'CHECKED_IN'; actorId: string }
  | { reason: 'LOST'; confirmedAt: Date }
  | { reason: 'REPLACED'; actorId: string; checkedIn: boolean; replacement: Unit };

@Injectable()
export class CustodyService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly assignments: GroupsRepository,
    private readonly groups: GroupsService,
  ) {}

  // Callers hold the contract lock. Share the tree lock with group edits before taking group
  // and device locks, so an assignment cannot slip in between ending custody and clearing it.
  async closeCustody(
    organizationId: string,
    rows: readonly Unit[],
    closure: Closure,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const deviceIds = rows.map(({ deviceId }) => deviceId);
    const rowIds = rows.map(({ id }) => id);
    await this.assignments.lockTree(organizationId, tx);
    const open = (await this.assignments.openAssignments(deviceIds, tx)).filter((assignment) =>
      rowIds.includes(assignment.contractDeviceId),
    );
    await this.assignments.lockGroups(
      organizationId,
      open.map(({ groupId }) => groupId),
      tx,
    );
    await this.assignments.lockDevices(
      closure.reason === 'REPLACED' ? [...deviceIds, closure.replacement.deviceId] : deviceIds,
      tx,
    );

    if (closure.reason === 'LOST') {
      for (const id of rowIds) await this.contracts.setLostAt(id, closure.confirmedAt, tx);
    } else if (closure.reason === 'CHECKED_IN' || closure.checkedIn) {
      await this.contracts.markCheckedIn(rowIds, at, closure.actorId, tx);
    }
    // A missing replacement ends the group assignment and resolves the fault immediately.
    // The loss case still owns the physical custody timestamp and eventual contract close.
    await this.contracts.resolveOpenFaults(rowIds, FaultResolution[closure.reason], at, tx);
    if (open.length === 0) return;
    await this.assignments.endAssignments(
      open.map(({ id }) => id),
      GroupExit[closure.reason],
      at,
      tx,
    );

    for (const assignment of open) {
      this.groups.emitGroupChange(organizationId, assignment.deviceId, null);
      if (closure.reason === 'REPLACED') {
        const group = await this.assignments.find(organizationId, assignment.groupId, tx);
        if (!group) throw new Error('An open device assignment has no live group.');
        await this.assignments.openAssignment(
          {
            groupId: group.id,
            deviceId: closure.replacement.deviceId,
            contractDeviceId: closure.replacement.id,
            assignedById: closure.actorId,
          },
          at,
          tx,
        );
        this.groups.emitGroupChange(organizationId, closure.replacement.deviceId, {
          id: group.id,
          name: group.name,
          parentId: group.parentId,
        });
      }
    }
  }
}

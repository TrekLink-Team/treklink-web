import { HttpStatus, Injectable } from '@nestjs/common';
import { GroupExit, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsRepository } from './contracts.repository';
import { CreateGroupDto, UpdateGroupDto } from './dto/groups.dto';
import { GroupRow, GroupsRepository } from './groups.repository';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Group not found.');

const toDay = (date: string | null | undefined) => (date ? new Date(`${date}T00:00:00Z`) : null);
const formatDay = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

function view({ _count, startsOn, endsOn, ...row }: GroupRow) {
  return {
    ...row,
    startsOn: formatDay(startsOn),
    endsOn: formatDay(endsOn),
    deviceCount: _count.assignments,
  };
}

type GroupView = ReturnType<typeof view>;
type GroupNode = GroupView & { children: GroupNode[] };
type GroupLink = { id: string; parentId: string | null };

function childrenOf<T extends GroupLink>(rows: T[]) {
  const result = new Map<string | null, T[]>();
  for (const row of rows) {
    const siblings = result.get(row.parentId);
    if (siblings) siblings.push(row);
    else result.set(row.parentId, [row]);
  }
  return result;
}

function descendants(id: string, links: GroupLink[]) {
  const children = childrenOf(links);
  const nodes = [{ id, height: 0 }];
  for (const node of nodes) {
    for (const child of children.get(node.id) ?? []) {
      nodes.push({ id: child.id, height: node.height + 1 });
    }
  }
  return nodes;
}

function checkDates(startsOn: Date | null, endsOn: Date | null) {
  if (startsOn && endsOn && endsOn < startsOn) {
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Choose an end after the start.',
    );
  }
}

async function withUniqueGroupName<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        'A group with this name already exists here.',
      );
    }
    throw error;
  }
}

export const DEVICE_GROUP_CHANGED = 'device.groupChanged';
export interface DeviceGroupChangedEvent {
  organizationId: string;
  deviceId: string;
  group: { id: string; name: string; parentId: string | null } | null;
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly groups: GroupsRepository,
    private readonly parameters: ParameterService,
    private readonly organizations: OrganizationsService,
    private readonly events: TransactionalEvents,
    private readonly contracts: ContractsRepository,
  ) {}

  async tree(caller: Caller, requestedOrganizationId?: string) {
    const organizationId = caller.organizationId ?? requestedOrganizationId;
    if (!organizationId) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'organizationId is required.',
      );
    }
    if (caller.organizationId) await this.organizations.assertCanUseRentalGroups(organizationId);
    const [rows, maxDepth] = await Promise.all([
      this.groups.list(organizationId),
      this.parameters.getUncached('rentals.groupMaxDepth'),
    ]);
    const children = childrenOf(rows);
    const nested = (parentId: string | null): GroupNode[] =>
      (children.get(parentId) ?? []).map((row) => ({ ...view(row), children: nested(row.id) }));
    return { maxDepth, groups: nested(null) };
  }

  async subgroupIds(organizationId: string, groupId: string): Promise<Set<string>> {
    const links = await this.groups.topology(organizationId);
    if (!links.some(({ id }) => id === groupId)) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Not found.');
    }
    return new Set(descendants(groupId, links).map(({ id }) => id));
  }

  create(input: CreateGroupDto, caller: Caller) {
    return this.editTree(caller, async (organizationId, tx) => {
      const { startsOn, endsOn, parentId = null, ...data } = input;
      const start = toDay(startsOn);
      const end = toDay(endsOn);
      checkDates(start, end);
      if (parentId) {
        await this.groups.lockGroups(organizationId, [parentId], tx);
        await this.checkDepth(parentId, [], await this.groups.topology(organizationId, tx), tx);
      }
      const row = await withUniqueGroupName(
        this.groups.create(
          {
            ...data,
            organizationId,
            parentId,
            startsOn: start,
            endsOn: end,
            createdById: caller.id,
          },
          tx,
        ),
      );
      const after = view(row);
      this.audit('group.created', row.id, organizationId, caller, undefined, after);
      return after;
    });
  }

  update(id: string, input: UpdateGroupDto, caller: Caller) {
    return this.editTree(caller, async (organizationId, tx) => {
      const { expectedVersion, parentId, startsOn, endsOn, ...data } = input;
      await this.groups.lockGroups(organizationId, parentId ? [id, parentId] : [id], tx);
      const current = await this.groups.find(organizationId, id, tx);
      if (!current) throw notFound();
      if (current.version !== expectedVersion) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'This was changed by someone else. Reload and try again.',
        );
      }
      const start = startsOn === undefined ? current.startsOn : toDay(startsOn);
      const end = endsOn === undefined ? current.endsOn : toDay(endsOn);
      checkDates(start, end);
      if (parentId !== undefined && parentId !== current.parentId) {
        const links = await this.groups.topology(organizationId, tx);
        await this.checkDepth(parentId, descendants(id, links), links, tx);
      }
      const after = view(
        await withUniqueGroupName(
          this.groups.update(
            organizationId,
            id,
            {
              ...data,
              parentId,
              startsOn: start,
              endsOn: end,
              version: { increment: 1 },
            },
            tx,
          ),
        ),
      );
      this.audit('group.updated', id, organizationId, caller, view(current), after);
      return after;
    });
  }

  remove(id: string, caller: Caller) {
    return this.editTree(caller, async (organizationId, tx) => {
      const links = await this.groups.topology(organizationId, tx);
      if (!links.some((row) => row.id === id)) throw notFound();
      const ids = descendants(id, links).map((row) => row.id);
      await this.groups.lockGroups(organizationId, ids, tx);
      const deviceIds = await this.groups.remove(organizationId, ids, new Date(), tx);
      this.audit('group.removed', id, organizationId, caller, undefined, {
        removedGroupIds: ids,
        ungroupedDeviceIds: deviceIds,
      });
      for (const deviceId of deviceIds) {
        this.emitGroupChange(organizationId, deviceId, null);
      }
      return { id, removedGroups: ids.length, ungroupedDevices: deviceIds.length };
    });
  }

  assign(groupId: string, deviceIds: string[], caller: Caller) {
    return this.editTree(caller, async (organizationId, tx) => {
      await this.groups.lockGroups(organizationId, [groupId], tx);
      const group = await this.groups.find(organizationId, groupId, tx);
      if (!group) throw notFound();
      await this.groups.lockDevices(deviceIds, tx);
      const held = await this.contracts.liveRowsOfOrganization(organizationId, deviceIds, tx);
      if (held.length !== deviceIds.length) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DEVICE_NOT_HELD,
          'This device is not held by your organization now.',
        );
      }
      const rows = new Map(held.map((row) => [row.deviceId, row]));
      const open = new Map(
        (await this.groups.openAssignments(deviceIds, tx)).map((row) => [row.deviceId, row]),
      );
      const assigned: string[] = [];
      const unchanged: string[] = [];
      const at = new Date();
      for (const deviceId of deviceIds) {
        const previous = open.get(deviceId);
        const custody = rows.get(deviceId)!;
        if (previous?.groupId === groupId && previous.contractDeviceId === custody.id) {
          unchanged.push(deviceId);
          continue;
        }
        if (previous) await this.groups.endAssignments([previous.id], GroupExit.MOVED, at, tx);
        await this.groups.openAssignment(
          {
            groupId,
            deviceId,
            contractDeviceId: custody.id,
            assignedById: caller.id,
          },
          at,
          tx,
        );
        assigned.push(deviceId);
        this.audit(
          'group.deviceAssigned',
          groupId,
          organizationId,
          caller,
          { groupId: previous?.groupId ?? null },
          { groupId, deviceId },
        );
        this.emitGroupChange(organizationId, deviceId, {
          id: group.id,
          name: group.name,
          parentId: group.parentId,
        });
      }
      return { groupId, assigned, unchanged };
    });
  }

  unassign(groupId: string, deviceId: string, caller: Caller) {
    return this.editTree(caller, async (organizationId, tx) => {
      await this.groups.lockGroups(organizationId, [groupId], tx);
      if (!(await this.groups.find(organizationId, groupId, tx))) throw notFound();
      await this.groups.lockDevices([deviceId], tx);
      const [assignment] = await this.groups.openAssignments([deviceId], tx);
      if (assignment?.groupId !== groupId) throw notFound();
      const endedAt = new Date();
      await this.groups.endAssignments([assignment.id], GroupExit.UNASSIGNED, endedAt, tx);
      this.audit(
        'group.deviceUnassigned',
        groupId,
        organizationId,
        caller,
        { groupId, deviceId },
        { groupId: null, deviceId },
      );
      this.emitGroupChange(organizationId, deviceId, null);
      return { groupId, deviceId, endedAt };
    });
  }

  emitGroupChange(
    organizationId: string,
    deviceId: string,
    group: DeviceGroupChangedEvent['group'],
  ) {
    this.events.emitAfterCommit(DEVICE_GROUP_CHANGED, {
      organizationId,
      deviceId,
      group,
    } satisfies DeviceGroupChangedEvent);
  }

  private async checkDepth(
    parentId: string | null,
    subtree: { id: string; height: number }[],
    links: GroupLink[],
    tx: Prisma.TransactionClient,
  ) {
    const maxDepth = await this.parameters.getUncached('rentals.groupMaxDepth', tx);
    const parentOf = new Map(links.map((row) => [row.id, row.parentId]));
    if (parentId !== null && !parentOf.has(parentId)) throw notFound();
    const height = subtree.reduce((max, node) => Math.max(max, node.height), 0);
    let depth = 0;
    let ancestor = parentId;
    while (ancestor !== null && depth + height <= maxDepth) {
      const next = parentOf.get(ancestor);
      if (next === undefined) throw notFound();
      depth += 1;
      ancestor = next;
    }
    if (subtree.some((node) => node.id === parentId)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.GROUP_DEPTH_EXCEEDED,
        'Choose a parent outside this group and its subgroups.',
      );
    }
    if (depth + height > maxDepth) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.GROUP_DEPTH_EXCEEDED,
        `Groups can be nested only ${maxDepth} level(s) deep. Choose a parent with room for this group and its subgroups.`,
      );
    }
  }

  private async editTree<T>(
    caller: Caller,
    write: (organizationId: string, tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const organizationId = caller.organizationId;
    if (!organizationId) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    }
    return this.events.transaction(async (tx) => {
      await this.organizations.assertCanUseRentalGroups(organizationId, tx);
      await this.groups.lockTree(organizationId, tx);
      return write(organizationId, tx);
    });
  }

  private audit(
    action: string,
    id: string,
    organizationId: string,
    caller: Caller,
    before: unknown,
    after: unknown,
  ) {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: caller.id,
      actorRoles: caller.roles,
      organizationId,
      action,
      subjectType: 'Group',
      subjectId: id,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

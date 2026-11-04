import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
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

@Injectable()
export class GroupsService {
  constructor(
    private readonly groups: GroupsRepository,
    private readonly parameters: ParameterService,
    private readonly organizations: OrganizationsService,
    private readonly events: TransactionalEvents,
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
      const row = await this.groups.create(
        {
          ...data,
          organizationId,
          parentId,
          startsOn: start,
          endsOn: end,
          createdById: caller.id,
        },
        tx,
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
        await this.groups.update(
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
        this.events.emitAfterCommit('device.groupChanged', {
          organizationId,
          deviceId,
          group: null,
        });
      }
      return { id, removedGroups: ids.length, ungroupedDevices: deviceIds.length };
    });
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
    if (depth + height > maxDepth || subtree.some((node) => node.id === parentId)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.GROUP_DEPTH_EXCEEDED,
        `Groups can be nested only ${maxDepth} level(s) deep. Choose a top-level group as the parent.`,
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
    try {
      return await this.events.transaction(async (tx) => {
        await this.organizations.assertCanUseRentalGroups(organizationId, tx);
        await this.groups.lockTree(organizationId, tx);
        return write(organizationId, tx);
      });
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

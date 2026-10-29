import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthEventType, Prisma } from '@prisma/client';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { AccountsRepository } from './accounts.repository';
import { AuthEventListQueryDto } from './dto/auth.dto';
import {
  ACCOUNT_CONTEXT_PROVIDER,
  AccountContextProvider,
  AccountOrganization,
} from './ports/account-context.port';

export interface AuthEventItem {
  id: string;
  userId: string | null;
  email: string | null;
  organization: AccountOrganization | null;
  type: AuthEventType;
  ip: string | null;
  createdAt: Date;
}

// Searches the append-only authentication log, newest first (task 6.1, api-design 17, FR-AUTH-08).
// The organization of an event is its account's membership, read through ACCOUNT_CONTEXT_PROVIDER;
// an attempt whose email matched no account belongs to none and never matches `organizationId`,
// and an unknown organization answers an empty page (D-057 rule 4).
@Injectable()
export class AuthEventsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional()
    @Inject(ACCOUNT_CONTEXT_PROVIDER)
    private readonly accountContext?: AccountContextProvider,
  ) {}

  async search(query: AuthEventListQueryDto): Promise<PagedResult<AuthEventItem>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const where = await this.whereOf(query);
    if (!where) return toPagedResult([], 0, page);

    const [rows, total] = await this.accounts.pageAuthEvents(where, page.skip, page.take);
    const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
    const organizations =
      this.accountContext && userIds.length > 0
        ? await this.accountContext.organizationsOf(userIds)
        : new Map<string, AccountOrganization>();
    const items = rows.map((row) => ({
      ...row,
      organization: (row.userId && organizations.get(row.userId)) || null,
    }));
    return toPagedResult(items, total, page);
  }

  // null when the organization filter leaves no account to match.
  private async whereOf(query: AuthEventListQueryDto): Promise<Prisma.AuthEventWhereInput | null> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'from must be earlier than to.',
      );
    }

    let userId: Prisma.AuthEventWhereInput['userId'] = query.userId;
    if (query.organizationId) {
      const members = (await this.accountContext?.memberUserIds(query.organizationId)) ?? [];
      const matching = query.userId ? members.filter((id) => id === query.userId) : members;
      if (matching.length === 0) return null;
      userId = query.userId ?? { in: matching };
    }

    return {
      ...(userId ? { userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    };
  }
}

import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../../common/dto/paging';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../config/environment-variables';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../ports/account-directory.port';
import { ActorRef, resolveActors } from '../ports/actor-names';
import { ParameterListQueryDto } from './parameter-query.dto';
import { ParameterRepository, ParameterRow } from './parameter.repository';

export interface ParameterHistoryItem {
  previousValue: Prisma.JsonValue;
  newValue: Prisma.JsonValue;
  changedBy: ActorRef | null;
  reason: string | null;
  changedAt: Date;
}

// The parameter list and the change history (task 3.1, UC-57, UC-58, api-design 02 and 04).
@Injectable()
export class ParameterReadsService {
  constructor(
    private readonly parameters: ParameterRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  async list(query: ParameterListQueryDto): Promise<PagedResult<ParameterRow>> {
    const page = resolvePage(query, this.bounds());
    const where = query.ownerModule ? { ownerModule: query.ownerModule } : {};
    const [items, total] = await this.parameters.page(where, page.skip, page.take);
    return toPagedResult(items, total, page);
  }

  async history(key: string, query: PagedQueryDto): Promise<PagedResult<ParameterHistoryItem>> {
    const page = resolvePage(query, this.bounds());
    if (!(await this.parameters.findByKey(key))) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Parameter not found.');
    }
    const [rows, total] = await this.parameters.historyPage(key, page.skip, page.take);
    const actorOf = await resolveActors(
      this.directory,
      rows.map((row) => row.changedById),
    );
    const items = rows.map(({ changedById, ...row }) => ({
      ...row,
      changedBy: actorOf(changedById),
    }));
    return toPagedResult(items, total, page);
  }

  private bounds() {
    return pagingBoundsFrom({
      DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
      MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
    });
  }
}

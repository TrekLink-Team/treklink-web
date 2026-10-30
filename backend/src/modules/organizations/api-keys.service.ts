import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { hashApiKey } from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { API_KEY_REVOKED, ApiKeyRevokedEvent } from './api-key-events';
import { ApiKeysRepository, ApiKeyView } from './api-keys.repository';
import { OrganizationsRepository } from './organizations.repository';

export const API_KEY_PREFIX = 'tlk_';
// Characters of the key shown in lists: `tlk_` and the first four random characters.
export const API_KEY_PREFIX_LENGTH = 8;

export interface ApiKeyList {
  items: ApiKeyView[];
  limit: number;
}

export type CreatedApiKey = ApiKeyView & { key: string };

// `tlk_` and 43 base64url characters from 32 random bytes (design §4, REQ-EVT-09).
export const generateApiKey = (): string => API_KEY_PREFIX + randomBytes(32).toString('base64url');

const organizationNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

const keyNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'API key not found.');

// Organization API keys (task 2.7, api-design 20 to 22, UC-06). A member reaches only its own
// organization and any other answers 404 (REQ-ERR-05); TrekLink Staff and Admin read any organization
// through `apiKey.read` and never create or revoke (ruling 2026-10-30). The secret is returned once by
// `create` and is in no list, response or audit entry after that (REQ-UBI-03).
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly keys: ApiKeysRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  async list(organizationId: string, caller: Caller): Promise<ApiKeyList> {
    this.assertScope(organizationId, caller);
    if ((await this.organizations.findStatus(organizationId)) === null)
      throw organizationNotFound();
    const [items, limit] = await Promise.all([
      this.keys.list(organizationId),
      this.parameters.get('organizations.maxApiKeys'),
    ]);
    return { items, limit };
  }

  // The organization row is locked first, so two creates at the limit cannot both pass the count.
  async create(organizationId: string, name: string, caller: Caller): Promise<CreatedApiKey> {
    this.assertScope(organizationId, caller);
    const limit = await this.parameters.get('organizations.maxApiKeys');
    const key = generateApiKey();
    return this.events.transaction(async (tx) => {
      if (!(await this.organizations.lockById(organizationId, tx))) throw organizationNotFound();
      if ((await this.keys.countActive(organizationId, tx)) >= limit) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.KEY_LIMIT,
          'Revoke an unused key before creating another.',
        );
      }
      const saved = await this.keys.insert(
        {
          organizationId,
          name,
          prefix: key.slice(0, API_KEY_PREFIX_LENGTH),
          keyHash: hashApiKey(key),
          createdById: caller.id,
        },
        tx,
      );
      this.audit(caller, organizationId, 'apiKey.create', saved.id, null, {
        name: saved.name,
        prefix: saved.prefix,
      });
      return { ...saved, key };
    });
  }

  // Revoking a revoked key answers it as it is and emits nothing again.
  async revoke(organizationId: string, keyId: string, caller: Caller): Promise<ApiKeyView> {
    this.assertScope(organizationId, caller);
    return this.events.transaction(async (tx) => {
      const current = await this.keys.find(organizationId, keyId, tx);
      if (!current) throw keyNotFound();
      if (current.revokedAt) return current;
      const saved = await this.keys.revoke(organizationId, keyId, caller.id, new Date(), tx);
      if (!saved) return (await this.keys.find(organizationId, keyId, tx)) ?? current;
      this.audit(
        caller,
        organizationId,
        'apiKey.revoke',
        keyId,
        { revokedAt: null },
        { revokedAt: saved.revokedAt },
      );
      this.events.emitAfterCommit(API_KEY_REVOKED, {
        organizationId,
        apiKeyId: keyId,
      } satisfies ApiKeyRevokedEvent);
      return saved;
    });
  }

  private assertScope(organizationId: string, caller: Caller): void {
    if (caller.organizationId !== null && caller.organizationId !== organizationId)
      throw organizationNotFound();
  }

  private audit(
    actor: Caller,
    organizationId: string,
    action: string,
    subjectId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'ApiKey',
      subjectId,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

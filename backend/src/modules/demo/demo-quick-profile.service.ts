import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import { Caller } from '../../common/decorators/access.decorator';
import { ParameterService } from '../platform/parameters/parameter.service';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DemoQuickRepository } from './demo-quick.repository';

export const DEMO_PROFILE = {
  'incidents.primaryAckTimeoutSeconds': 30,
  'incidents.backupAckTimeoutSeconds': 30,
  'incidents.managerAckTimeoutSeconds': 30,
  'incidents.reopenWindowMinutes': 5,
} as const;
interface SavedParameter {
  value: number;
  version: number;
}
type Snapshot = Record<string, SavedParameter>;

@Injectable()
export class DemoQuickProfileService {
  constructor(
    private readonly repository: DemoQuickRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  status() {
    return this.events.transaction(async (tx) => {
      const row = await this.repository.profile(tx);
      return { active: Boolean(row && row.snapshot !== null), version: row?.version ?? 0 };
    });
  }

  change(active: boolean, expectedVersion: number, actor: Caller) {
    return this.events.transaction(async (tx) => {
      const state = await this.repository.lockProfile(tx);
      if (state.version !== expectedVersion)
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'Reload the demo profile and try again.',
        );
      if ((state.snapshot !== null) === active) return { active, version: state.version };
      const previous = state.snapshot as Snapshot | null;
      const snapshot: Snapshot = {};
      for (const [key, demoValue] of Object.entries(DEMO_PROFILE)) {
        const row = await this.parameters.row(key, tx);
        if (!row)
          throw new DomainException(
            HttpStatus.CONFLICT,
            ErrorCode.DEMO_SEED_NOT_CONFIGURED,
            `Parameter ${key} is missing. Apply migrations.`,
          );
        if (!active && row.version !== previous?.[key]?.version)
          throw new DomainException(
            HttpStatus.CONFLICT,
            ErrorCode.STALE_VERSION,
            `${key} changed while the demo profile was active. Restore it from parameter history before retrying.`,
          );
        const updated = await this.parameters.update(
          key,
          {
            value: active ? demoValue : previous![key].value,
            expectedVersion: row.version,
            reason: active ? 'Demo escalation profile enabled' : 'Demo escalation profile restored',
          },
          actor,
          tx,
        );
        snapshot[key] = { value: Number(row.value), version: updated.version };
      }
      const saved = await this.repository.saveProfile(
        state.version,
        active
          ? Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, { ...value }]))
          : null,
        tx,
      );
      return { active, version: saved.version };
    });
  }
}

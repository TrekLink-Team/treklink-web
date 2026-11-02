import { Injectable } from '@nestjs/common';
import { EpisodeEvent, IncidentEvents, IncidentEventScope } from '../../incidents';
import { SyncQueryRepository } from '../sync-query.repository';

@Injectable()
export class GatewayIncidentEvents implements IncidentEvents {
  constructor(private readonly repository: SyncQueryRepository) {}

  eventsOfIncident(incidentId: string, scope: IncidentEventScope): Promise<EpisodeEvent[]> {
    return this.repository.episodeEvents(incidentId, scope.organizationId);
  }
}

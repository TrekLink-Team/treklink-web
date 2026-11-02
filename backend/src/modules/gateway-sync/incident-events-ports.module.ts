import { Global, Module } from '@nestjs/common';
import { INCIDENT_EVENTS } from '../incidents';
import { GatewayIncidentEvents } from './providers/incident-events.provider';
import { SyncQueryRepository } from './sync-query.repository';

// Same global-port pattern as CONTRACT_CLOSE_CHECKS: incidents never imports gateway-sync.
@Global()
@Module({
  providers: [SyncQueryRepository, { provide: INCIDENT_EVENTS, useClass: GatewayIncidentEvents }],
  exports: [INCIDENT_EVENTS],
})
export class IncidentEventsPortsModule {}

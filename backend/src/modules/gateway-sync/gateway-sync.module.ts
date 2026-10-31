import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { IncidentsModule } from '../incidents';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { FieldEventQueryService } from './field-event-query.service';
import { GatewaySyncController } from './gateway-sync.controller';
import { GatewaySyncPortsModule } from './gateway-sync-ports.module';
import { IngestionRepository } from './ingestion.repository';
import { IngestionService } from './ingestion.service';
import { MqttSubscriber } from './mqtt/mqtt-subscriber';
import { Normalizer } from './normalizer/normalizer';
import { StationHealthHandler } from './station-health.handler';
import { SyncAuditService } from './sync-audit.service';
import { SyncQueryRepository } from './sync-query.repository';
import { SyncStatusService } from './sync-status.service';

// Field event ingestion over MQTT (specs/gateway-sync/design.md): the node JSON path into field_events,
// attributed to the custody interval of `rentals`, the device projection, and post-commit
// field.position and field.telemetry, and the SOS hand-off to incidents; the Field Station health report
// (task 2.5 part) and the Staff reads of `POST /api/gateway-sync` (api-design 03, 04 and 07).
@Module({
  imports: [
    PlatformModule,
    OrganizationsModule,
    DevicesModule,
    RentalsModule,
    IncidentsModule,
    GatewaySyncPortsModule,
  ],
  controllers: [GatewaySyncController],
  providers: [
    NodeJsonAdapter,
    Normalizer,
    IngestionRepository,
    IngestionService,
    MqttSubscriber,
    StationHealthHandler,
    SyncQueryRepository,
    FieldEventQueryService,
    SyncStatusService,
    SyncAuditService,
  ],
  exports: [FieldEventQueryService],
})
export class GatewaySyncModule {}

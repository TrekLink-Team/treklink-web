import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { IncidentsModule } from '../incidents';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { BrokerHookSecretGuard } from './broker-hook-secret.guard';
import { BrokerAuthController } from './broker-hooks.controller';
import { BrokerAuthService } from './broker-hooks.service';
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
import { SyncStatsService } from './sync-stats.service';
import { SyncStatusService } from './sync-status.service';
import { UplinkIngress } from './uplink-ingress';

// Field event ingestion over MQTT (specs/gateway-sync/design.md): the node JSON path into field_events,
// attributed to the custody interval of `rentals`, the device projection, and post-commit
// field.position and field.telemetry, and the SOS hand-off to incidents; the Field Station health report
// (task 2.5 part), the Staff reads of `POST /api/gateway-sync` (api-design 03, 04 and 07) and the
// mosquitto-go-auth hooks (task 3.1, api-design 01 and 02).
@Module({
  imports: [
    PlatformModule,
    OrganizationsModule,
    DevicesModule,
    RentalsModule,
    IncidentsModule,
    GatewaySyncPortsModule,
  ],
  controllers: [GatewaySyncController, BrokerAuthController],
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
    SyncStatsService,
    SyncAuditService,
    UplinkIngress,
    BrokerAuthService,
    BrokerHookSecretGuard,
  ],
  exports: [FieldEventQueryService, SyncStatsService, UplinkIngress],
})
export class GatewaySyncModule {}

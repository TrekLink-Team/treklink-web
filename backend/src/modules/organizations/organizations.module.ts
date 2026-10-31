import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { PlatformModule } from '../platform/platform.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { ChannelKeyController } from './channel-key.controller';
import { ChannelKeyService } from './channel-key.service';
import { ComplianceCasesController } from './compliance-cases.controller';
import { ComplianceCasesRepository } from './compliance-cases.repository';
import { ComplianceCasesService } from './compliance-cases.service';
import { FieldStationReleaseService } from './field-station-release.service';
import { FieldStationsController } from './field-stations.controller';
import { FieldStationsRepository } from './field-stations.repository';
import { FieldStationsService } from './field-stations.service';
import { KeyExposedNotifier } from './key-exposed.notifier';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationOnboardingController } from './organization-onboarding.controller';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { OrganizationStatusController } from './organization-status.controller';
import { OrganizationProfileService } from './organization-profile.service';
import { OrganizationStatusService } from './organization-status.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsPortsModule } from './organizations-ports.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { RosterController } from './roster.controller';
import { RosterRepository } from './roster.repository';
import { RosterService } from './roster.service';
import { ShiftsService } from './shifts.service';

// Organizations, members, roster, keys and compliance (specs/organizations/design.md). So far the
// ACCOUNT_CONTEXT_PROVIDER port (task 1.3, D-060 rule 1), `assertActive` for rentals 2.1, the member
// list (api-design 12), the channel key and Manager reads of the counter handover, and onboarding
// (registration, verification, approval, api-design 01, 02, 05 to 07), and the roster `tiersAt` read
// for incidents routing, the API keys (task 2.7, api-design 20 to 22), the Field Station credentials
// and release (task 2.8, api-design 23 to 26), and the channel key rotation and compliance cases of
// screens 3.5 and 3.6 (api-design 27 to 32); task 1.1 adds the remaining repositories and services.
@Module({
  imports: [OrganizationsPortsModule, AuthModule, PlatformModule],
  controllers: [
    OrganizationsController,
    OrganizationOnboardingController,
    OrganizationStatusController,
    ApiKeysController,
    FieldStationsController,
    ChannelKeyController,
    ComplianceCasesController,
    MembersController,
    RosterController,
  ],
  providers: [
    OrganizationsRepository,
    OrganizationsService,
    MembersRepository,
    MembersService,
    OrganizationOnboardingService,
    OrganizationLifecycle,
    OrganizationStatusService,
    OrganizationProfileService,
    RosterRepository,
    RosterService,
    ApiKeysRepository,
    ApiKeysService,
    FieldStationsRepository,
    FieldStationsService,
    FieldStationReleaseService,
    ChannelKeyService,
    KeyExposedNotifier,
    ComplianceCasesRepository,
    ComplianceCasesService,
    ShiftsService,
  ],
  exports: [
    OrganizationsService,
    RosterService,
    FieldStationsService,
    FieldStationReleaseService,
    ChannelKeyService,
  ],
})
export class OrganizationsModule {}

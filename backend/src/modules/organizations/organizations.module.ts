import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { PlatformModule } from '../platform/platform.module';
import { MembersRepository } from './members.repository';
import { OrganizationOnboardingController } from './organization-onboarding.controller';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsPortsModule } from './organizations-ports.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { RosterRepository } from './roster.repository';
import { RosterService } from './roster.service';

// Organizations, members, roster, keys and compliance (specs/organizations/design.md). So far the
// ACCOUNT_CONTEXT_PROVIDER port (task 1.3, D-060 rule 1), `assertActive` for rentals 2.1, the member
// list (api-design 12), the channel key and Manager reads of the counter handover, and onboarding
// (registration, verification, approval, api-design 01, 02, 05 to 07), and the roster `tiersAt` read
// for incidents routing; task 1.1 adds the remaining repositories and services.
@Module({
  imports: [OrganizationsPortsModule, AuthModule, PlatformModule],
  controllers: [OrganizationsController, OrganizationOnboardingController],
  providers: [
    OrganizationsRepository,
    OrganizationsService,
    MembersRepository,
    OrganizationOnboardingService,
    RosterRepository,
    RosterService,
  ],
  exports: [OrganizationsService, RosterService],
})
export class OrganizationsModule {}

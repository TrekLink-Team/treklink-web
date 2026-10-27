import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { MembersRepository } from './members.repository';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsPortsModule } from './organizations-ports.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

// Organizations, members, roster, keys and compliance (specs/organizations/design.md). So far the
// ACCOUNT_CONTEXT_PROVIDER port (task 1.3, D-060 rule 1), `assertActive` for rentals 2.1, the member
// list (api-design 12) and the channel key and Manager reads of the counter handover; task 1.1 adds
// the remaining repositories and services.
@Module({
  imports: [OrganizationsPortsModule, AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService, MembersRepository],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}

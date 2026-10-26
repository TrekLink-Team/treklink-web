import { Module } from '@nestjs/common';
import { OrganizationsPortsModule } from './organizations-ports.module';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

// Organizations, members, roster, keys and compliance (specs/organizations/design.md). So far the
// ACCOUNT_CONTEXT_PROVIDER port (task 1.3, D-060 rule 1) and `assertActive` for rentals 2.1; task
// 1.1 adds the remaining repositories and services.
@Module({
  imports: [OrganizationsPortsModule],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}

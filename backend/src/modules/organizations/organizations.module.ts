import { Module } from '@nestjs/common';
import { OrganizationsPortsModule } from './organizations-ports.module';

// Organizations, members, roster, keys and compliance (specs/organizations/design.md). Only the
// ACCOUNT_CONTEXT_PROVIDER port exists so far (task 1.3, D-060 rule 1); task 1.1 adds the
// repositories and services.
@Module({
  imports: [OrganizationsPortsModule],
})
export class OrganizationsModule {}

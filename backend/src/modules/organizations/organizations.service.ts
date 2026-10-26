import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationLabel, OrganizationsRepository } from './organizations.repository';

// The methods other modules call (design §5). Only `assertActive` exists so far, for rentals 2.1;
// task 2.4 builds the rest of the lifecycle around it.
@Injectable()
export class OrganizationsService {
  constructor(private readonly organizations: OrganizationsRepository) {}

  // An organization that is not ACTIVE may not request devices: 409 ORGANIZATION_NOT_ACTIVE naming
  // its status (FR-CON-02, rentals api-design 01); an unknown id is 404.
  async assertActive(organizationId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const status = await this.organizations.findStatus(organizationId, tx);
    if (status === null) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    if (status !== OrganizationStatus.ACTIVE) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ORGANIZATION_NOT_ACTIVE,
        `Your organization cannot request devices while it is ${status}.`,
      );
    }
  }

  // Code and legal name by organization id, for the contract and invoice reads of rentals and
  // billing; an unknown id is absent.
  async labelsOf(ids: readonly string[]): Promise<Map<string, OrganizationLabel>> {
    if (ids.length === 0) return new Map();
    const rows = await this.organizations.labels([...new Set(ids)]);
    return new Map(rows.map((row) => [row.id, row]));
  }
}

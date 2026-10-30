import { OrganizationStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

export const PHONE = /^\+?[0-9 ]{8,15}$/;

// organizations api-design 01.
export class RegisterOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName!: string;

  @Matches(/^([0-9]{10}|[0-9]{13})$/, { message: 'taxCode must be 10 or 13 digits' })
  taxCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address!: string;

  @Matches(PHONE, { message: 'contactPhone must be a phone number' })
  contactPhone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  managerFullName!: string;

  @IsEmail()
  @MaxLength(254)
  managerEmail!: string;

  @Matches(PHONE, { message: 'managerPhone must be a phone number' })
  managerPhone!: string;
}

// organizations api-design 02.
export class OrganizationQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(Object.values(OrganizationStatus))
  status?: OrganizationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

// organizations api-design 05.
export class VerifyOrganizationDto {
  @IsIn(['IN_PERSON', 'PHONE'])
  method!: 'IN_PERSON' | 'PHONE';

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  documentsSeen!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  masterContractRef!: string;

  @IsBoolean()
  ndaSigned!: boolean;

  @IsBoolean()
  softwareLicenceSigned!: boolean;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// organizations api-design 06.
export class ApproveOrganizationDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// organizations api-design 07.
export class RejectOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

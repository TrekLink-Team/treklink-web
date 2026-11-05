import { ServiceCreditCause, ServiceCreditStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

export const SERVICE_CREDIT_DECISIONS = ['APPROVE', 'REDUCE', 'REJECT'] as const;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Request a credit (design §9.5). The service checks the source and can default the outage start
// from a fault report (REQ-ERR-06). The service computes outageTo.
export class ServiceCreditRequestDto {
  @IsUUID()
  contractDeviceId!: string;

  @IsEnum(ServiceCreditCause)
  cause!: ServiceCreditCause;

  @IsUUID()
  faultInspectionId!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  outageFrom?: Date;

  @IsOptional()
  @IsUUID()
  outageSourceIncidentId?: string;

  @IsOptional()
  @IsUUID()
  outageSourceFaultReportId?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  outageSourceNote?: string;
}

export class ServiceCreditQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsEnum(ServiceCreditStatus)
  status?: ServiceCreditStatus;

  @IsOptional()
  @IsUUID()
  contractId?: string;
}

// The Admin decision (design §9.5): REDUCE takes decidedVnd; REDUCE and REJECT take a reason, which the
// service requires (REQ-ERR-07).
export class ServiceCreditDecisionDto {
  @IsIn(SERVICE_CREDIT_DECISIONS)
  decision!: (typeof SERVICE_CREDIT_DECISIONS)[number];

  @ValidateIf((dto: ServiceCreditDecisionDto) => dto.decision === 'REDUCE')
  @IsInt()
  @Min(1)
  decidedVnd?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ServiceCreditRefundDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference!: string;
}

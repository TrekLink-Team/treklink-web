import { PlanType } from '@prisma/client';
import { IsIn, IsInt, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator';

// rentals api-design 01. The minimum order quantity, the day-plan lengths and "not in the past" are
// checked by ContractsService against their parameters and the UTC+7 calendar.
export class ContractRequestDto {
  @IsIn(Object.values(PlanType))
  planType!: PlanType;

  @ValidateIf((dto: ContractRequestDto) => dto.planType === PlanType.DAY)
  @IsInt()
  @Min(1)
  dayPlanDays?: number;

  @IsUUID()
  hardwareVariantId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;

  // The handover day as a calendar date, yyyy-mm-dd.
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'requestedStartDate must be a date in the form yyyy-mm-dd.',
  })
  requestedStartDate!: string;
}

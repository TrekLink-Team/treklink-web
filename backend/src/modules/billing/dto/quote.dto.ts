import { PlanType } from '@prisma/client';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

// billing api-design 02. The minimum order quantity and the day-plan lengths are checked by the
// service against their parameters, so a configured change applies without a redeploy.
export class QuoteDto {
  @IsIn(Object.values(PlanType))
  planType!: PlanType;

  @ValidateIf((dto: QuoteDto) => dto.planType === PlanType.DAY)
  @IsInt()
  @Min(1)
  dayPlanDays?: number;

  @IsUUID()
  hardwareVariantId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;
}

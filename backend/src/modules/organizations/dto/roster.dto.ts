import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

// A time with an explicit zone ("Z" or an offset), so a shift never depends on the server's clock zone.
const WITH_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const ZONE_MESSAGE = '$property must include a time zone, for example 2026-10-20T00:00:00Z';

// organizations api-design 16.
export class RosterQueryDto {
  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  from!: string;

  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  to!: string;
}

// organizations api-design 17.
export class CreateShiftDto {
  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  startsAt!: string;

  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  endsAt!: string;

  @IsOptional()
  @IsUUID()
  primaryMemberId?: string | null;

  @IsOptional()
  @IsUUID()
  backupMemberId?: string | null;
}

// organizations api-design 18. An absent field is unchanged; a member field set to null empties the slot.
export class UpdateShiftDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(WITH_ZONE, { message: ZONE_MESSAGE })
  endsAt?: string;

  @IsOptional()
  @IsUUID()
  primaryMemberId?: string | null;

  @IsOptional()
  @IsUUID()
  backupMemberId?: string | null;
}

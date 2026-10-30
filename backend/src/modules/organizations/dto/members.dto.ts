import { MemberRole } from '@prisma/client';
import {
  IsIn,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PHONE } from './onboarding.dto';

// organizations api-design 13.
export class InviteMemberDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phoneNumber must be a phone number' })
  phoneNumber?: string;

  @IsIn(Object.values(MemberRole))
  role!: MemberRole;
}

// organizations api-design 14.
export class ChangeMemberRoleDto {
  @IsIn(Object.values(MemberRole))
  role!: MemberRole;
}

// organizations api-design 15.
export class DeactivateMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

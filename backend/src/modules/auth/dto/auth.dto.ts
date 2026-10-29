import { AuthEventType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';
import { TREKLINK_ROLES, type TreklinkRole } from '../accounts.service';

// auth api-design 01
export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

// auth api-design 05
export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

// The code's format is not checked here: a malformed code is a wrong code, answered with MSG08
// (CODE_INVALID) and counted as an attempt.
class CodeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code!: string;
}

// auth api-design 06
export class ResetPasswordDto extends CodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  newPassword!: string;
}

// auth api-design 07
export class SetPasswordDto extends CodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

// auth api-design 08
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  newPassword!: string;
}

// auth api-design 09. `isActive` arrives as the query text `true` or `false`.
export class AccountListQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';
}

// auth api-design 17. `from` is inclusive, `to` exclusive.
export class AuthEventListQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsEnum(AuthEventType)
  type?: AuthEventType;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

// auth api-design 10
export class CreateAccountDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @IsIn(TREKLINK_ROLES)
  role!: TreklinkRole;
}

// auth api-design 11
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ]{8,20}$/, { message: 'phoneNumber must be a phone number' })
  phoneNumber?: string;

  @IsOptional()
  @IsIn(TREKLINK_ROLES)
  role?: TreklinkRole;
}

// auth api-design 12
export class DeactivateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// auth api-design 16: the full list; an empty list removes every permission.
export class ReplacePermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissionKeys!: string[];
}

// auth api-design 02 and 03: the refresh token travels in the body.
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}

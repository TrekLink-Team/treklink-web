import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

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

// auth api-design 02 and 03: the refresh token travels in the body.
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}

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

// auth api-design 02 and 03: the refresh token travels in the body.
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}

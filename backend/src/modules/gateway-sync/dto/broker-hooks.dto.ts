import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ACC_READ, ACC_SUBSCRIBE, ACC_WRITE } from '../broker-hooks.service';

// The JSON bodies mosquitto-go-auth sends in JSON params mode (api-design 01 and 02). MQTT allows a
// topic of up to 65535 bytes; the bounds here only keep an oversized body from reaching bcrypt or a
// pattern match. An empty password or client id is valid input and is refused by the check itself.

// api-design 01.
export class BrokerUserCheckDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  username!: string;

  @IsString()
  @MaxLength(256)
  password!: string;

  @IsString()
  @MaxLength(256)
  clientid!: string;
}

// api-design 02. go-auth's 3 (read and write) is accepted as input and denied by every rule.
export class BrokerAclCheckDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  username!: string;

  @IsString()
  @MaxLength(256)
  clientid!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(65535)
  topic!: string;

  @IsInt()
  @IsIn([ACC_READ, ACC_WRITE, ACC_READ | ACC_WRITE, ACC_SUBSCRIBE])
  acc!: number;
}

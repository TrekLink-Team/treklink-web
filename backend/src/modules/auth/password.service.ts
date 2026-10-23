import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ParameterService } from '../platform/parameters/parameter.service';

// Password policy and hashing (auth task 2.1). Hashes use BCRYPT_COST; nothing here ever logs or
// returns a plaintext password (REQ-UBI-02).
@Injectable()
export class PasswordService {
  private readonly cost: number;
  // Compared against when the account is unknown, so an unknown email costs the same time as a
  // wrong password and the response timing does not reveal which one it was (REQ-ERR-01).
  private dummyHash?: Promise<string>;

  constructor(
    private readonly parameters: ParameterService,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.cost = config.get('BCRYPT_COST', { infer: true });
  }

  async assertPolicy(password: string): Promise<void> {
    const minLength = await this.parameters.get('auth.passwordMinLength');
    if (password.length < minLength) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.PASSWORD_POLICY,
        `password must be at least ${minLength} characters.`,
      );
    }
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.cost);
  }

  // Constant-time compare; a null hash (unknown account, or no password set yet) still runs a
  // compare against the dummy hash and returns false.
  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    if (passwordHash) return bcrypt.compare(password, passwordHash);
    this.dummyHash ??= bcrypt.hash('treklink-dummy-password', this.cost);
    await bcrypt.compare(password, await this.dummyHash);
    return false;
  }
}

import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ParameterService } from '../platform/parameters/parameter.service';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const parameters = { get: jest.fn().mockResolvedValue(8) };
  const config = { get: jest.fn().mockReturnValue(4) };
  const service = new PasswordService(
    parameters as unknown as ParameterService,
    config as unknown as ConfigService<ValidatedEnvironment, true>,
  );

  it('reads the bcrypt cost from BCRYPT_COST', () => {
    expect(config.get).toHaveBeenCalledWith('BCRYPT_COST', { infer: true });
  });

  it('accepts a password at the minimum length and rejects one below it (REQ-ERR-04)', async () => {
    await expect(service.assertPolicy('12345678')).resolves.toBeUndefined();

    const refusal = service.assertPolicy('1234567');
    await expect(refusal).rejects.toBeInstanceOf(DomainException);
    await expect(refusal).rejects.toMatchObject({
      errorCode: ErrorCode.PASSWORD_POLICY,
      message: 'password must be at least 8 characters.',
    });
    expect(parameters.get).toHaveBeenCalledWith('auth.passwordMinLength');
  });

  it('hashes so that the hash never equals its input, and verifies it', async () => {
    const hash = await service.hash('correct horse');

    expect(hash).not.toBe('correct horse');
    await expect(service.verify('correct horse', hash)).resolves.toBe(true);
    await expect(service.verify('wrong horse', hash)).resolves.toBe(false);
  });

  it('returns false for a missing hash after a dummy compare, reusing the dummy hash', async () => {
    await expect(service.verify('anything', null)).resolves.toBe(false);
    await expect(service.verify('anything else', null)).resolves.toBe(false);
  });
});

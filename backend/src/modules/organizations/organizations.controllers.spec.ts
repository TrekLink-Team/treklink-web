import { createMongoAbility } from '@casl/ability';
import { HttpStatus } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  IS_PUBLIC_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { CreateApiKeyDto } from './dto/api-keys.dto';
import { ExpectedVersionDto, OrganizationReasonDto } from './dto/lifecycle.dto';
import { RegisterOrganizationDto } from './dto/onboarding.dto';
import { UpdateOrganizationDto } from './dto/profile.dto';
import { OrganizationOnboardingController } from './organization-onboarding.controller';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { OrganizationRolesViewController } from './organization-roles-view.controller';
import { OrganizationRolesViewService } from './organization-roles-view.service';
import { MembersQueryDto } from './organizations.controller';

type Rule = { action: string; subject: string; conditions?: Record<string, unknown> };
type Controller = { prototype: object };

const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const ID = 'c0ffee00-1234-4abc-9def-001122334455';

const handlerOf = (controller: Controller, name: string) =>
  Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object;

const allows = (controller: Controller, name: string, rules: Rule[]) =>
  (Reflect.getMetadata(CHECK_POLICIES_KEY, handlerOf(controller, name)) as PolicyHandler[]).every(
    (handler) => handler(createMongoAbility(rules) as PolicyAbility),
  );

const messageOf = (controller: Controller, name: string) =>
  Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf(controller, name)) as string;

const statusOf = (controller: Controller, name: string) =>
  Reflect.getMetadata('__httpCode__', handlerOf(controller, name)) as number | undefined;

const errorsOf = <T extends object>(type: new () => T, plain: Record<string, unknown>) =>
  validate(plainToInstance(type, plain));

describe('OrganizationOnboardingController', () => {
  const service = {
    register: jest.fn().mockResolvedValue({ id: 'org-1', code: 'ORG-0001', status: 'PENDING' }),
    page: jest.fn().mockResolvedValue('page'),
    verify: jest.fn().mockResolvedValue('verified'),
    approve: jest.fn().mockResolvedValue('approved'),
    reject: jest.fn().mockResolvedValue('rejected'),
  };
  const controller = new OrganizationOnboardingController(
    service as unknown as OrganizationOnboardingService,
  );

  it('registers with trimmed text and a lowercase manager email, and answers three fields only', async () => {
    const dto = {
      legalName: '  Acme Trek  ',
      taxCode: '0109876543',
      address: '  12 Le Loi  ',
      contactPhone: '0901234567',
      managerFullName: '  Lam Phi Long ',
      managerEmail: '  Long@Acme.VN ',
      managerPhone: '0907654321',
    };
    await expect(controller.register(dto)).resolves.toEqual({
      organizationId: 'org-1',
      code: 'ORG-0001',
      status: 'PENDING',
    });
    expect(service.register).toHaveBeenCalledWith({
      ...dto,
      legalName: 'Acme Trek',
      address: '12 Le Loi',
      managerFullName: 'Lam Phi Long',
      managerEmail: 'long@acme.vn',
    });
  });

  it('lists the review queue through the service', async () => {
    const query = { status: 'PENDING' } as never;
    await expect(controller.page(query)).resolves.toBe('page');
    expect(service.page).toHaveBeenCalledWith(query);
  });

  it('verifies with the master contract reference trimmed', async () => {
    const dto = {
      method: 'IN_PERSON' as const,
      documentsSeen: ['business licence'],
      masterContractRef: '  MC-2026-017  ',
      ndaSigned: true,
      softwareLicenceSigned: false,
      expectedVersion: 1,
    };
    await expect(controller.verify(ID, dto, STAFF)).resolves.toBe('verified');
    expect(service.verify).toHaveBeenCalledWith(
      ID,
      { ...dto, masterContractRef: 'MC-2026-017' },
      STAFF,
    );
  });

  it('approves with the version and rejects with the reason trimmed', async () => {
    await expect(controller.approve(ID, { expectedVersion: 2 }, ADMIN)).resolves.toBe('approved');
    expect(service.approve).toHaveBeenCalledWith(ID, 2, ADMIN);
    await expect(
      controller.reject(ID, { reason: '  Documents do not match  ', expectedVersion: 2 }, ADMIN),
    ).resolves.toBe('rejected');
    expect(service.reject).toHaveBeenCalledWith(ID, 'Documents do not match', 2, ADMIN);
  });

  it('opens registration to anyone and keeps every other action behind a policy', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf(OrganizationOnboardingController, 'register')),
    ).toBe(true);
    for (const name of ['page', 'verify', 'approve', 'reject']) {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf(OrganizationOnboardingController, name)),
      ).toBeUndefined();
    }
  });

  it('lets Staff verify and list, and only an Admin decide', () => {
    const verify = [{ action: 'verify', subject: 'Organization' }];
    const decide = [{ action: 'decide', subject: 'Organization' }];
    for (const name of ['page', 'verify']) {
      expect(allows(OrganizationOnboardingController, name, verify)).toBe(true);
      expect(allows(OrganizationOnboardingController, name, decide)).toBe(false);
    }
    for (const name of ['approve', 'reject']) {
      expect(allows(OrganizationOnboardingController, name, decide)).toBe(true);
      expect(allows(OrganizationOnboardingController, name, verify)).toBe(false);
      expect(allows(OrganizationOnboardingController, name, [])).toBe(false);
    }
  });

  it('answers a static message per action and 200 for the three decisions', () => {
    expect(messageOf(OrganizationOnboardingController, 'register')).toBe(
      'Registration received. Visit the TrekLink counter or call us to verify your organization.',
    );
    expect(messageOf(OrganizationOnboardingController, 'page')).toBe('OK');
    expect(messageOf(OrganizationOnboardingController, 'verify')).toBe('Saved.');
    expect(messageOf(OrganizationOnboardingController, 'approve')).toBe(
      'Your organization is approved. You can now invite members and request devices.',
    );
    expect(messageOf(OrganizationOnboardingController, 'reject')).toBe('Organization rejected');
    for (const name of ['verify', 'approve', 'reject']) {
      expect(statusOf(OrganizationOnboardingController, name)).toBe(HttpStatus.OK);
    }
    expect(statusOf(OrganizationOnboardingController, 'register')).toBeUndefined();
    expect(statusOf(OrganizationOnboardingController, 'page')).toBeUndefined();
  });

  it('takes the registration fields the form sends', async () => {
    const valid = {
      legalName: 'Acme Trek',
      taxCode: '0109876543',
      address: '12 Le Loi',
      contactPhone: '0901234567',
      managerFullName: 'Lam Phi Long',
      managerEmail: 'long@acme.vn',
      managerPhone: '0907654321',
    };
    expect(await errorsOf(RegisterOrganizationDto, valid)).toHaveLength(0);
    expect(
      await errorsOf(RegisterOrganizationDto, { ...valid, managerEmail: 'not-an-email' }),
    ).not.toHaveLength(0);
  });
});

describe('OrganizationRolesViewController', () => {
  const roles = { view: jest.fn().mockResolvedValue('roles') };
  const controller = new OrganizationRolesViewController(
    roles as unknown as OrganizationRolesViewService,
  );

  it('reads the roles of the organization named in the path', async () => {
    await expect(controller.view(ID)).resolves.toBe('roles');
    expect(roles.view).toHaveBeenCalledWith(ID);
    expect(messageOf(OrganizationRolesViewController, 'view')).toBe('OK');
  });

  it('passes only a rule that holds for every organization', () => {
    const unconditional: Rule[] = [{ action: 'read', subject: 'OrganizationRole' }];
    const ownOnly: Rule[] = [
      {
        action: 'read',
        subject: 'OrganizationRole',
        conditions: { organizationId: 'org-1' },
      },
    ];
    expect(allows(OrganizationRolesViewController, 'view', unconditional)).toBe(true);
    expect(allows(OrganizationRolesViewController, 'view', ownOnly)).toBe(false);
    expect(allows(OrganizationRolesViewController, 'view', [])).toBe(false);
    expect(
      allows(OrganizationRolesViewController, 'view', [
        { action: 'update', subject: 'OrganizationRole' },
      ]),
    ).toBe(false);
  });
});

describe('DTO transforms', () => {
  it('reads includeDeactivated from the query string, and leaves any other value to the check', async () => {
    expect(
      plainToInstance(MembersQueryDto, { includeDeactivated: 'true' }).includeDeactivated,
    ).toBe(true);
    expect(
      plainToInstance(MembersQueryDto, { includeDeactivated: 'false' }).includeDeactivated,
    ).toBe(false);
    expect(plainToInstance(MembersQueryDto, { includeDeactivated: 'yes' }).includeDeactivated).toBe(
      'yes',
    );
    expect(await errorsOf(MembersQueryDto, { includeDeactivated: 'yes' })).not.toHaveLength(0);
    expect(await errorsOf(MembersQueryDto, { includeDeactivated: 'true' })).toHaveLength(0);
    expect(await errorsOf(MembersQueryDto, {})).toHaveLength(0);
  });

  it('trims the name of an API key and refuses a blank or a non-text name', async () => {
    expect(plainToInstance(CreateApiKeyDto, { name: '  CI key  ' }).name).toBe('CI key');
    expect(await errorsOf(CreateApiKeyDto, { name: '   ' })).not.toHaveLength(0);
    expect(plainToInstance(CreateApiKeyDto, { name: 12 }).name).toBe(12);
    expect(await errorsOf(CreateApiKeyDto, { name: 12 })).not.toHaveLength(0);
  });

  it('trims the reason of a lifecycle change and refuses a blank or a non-text one', async () => {
    expect(
      plainToInstance(OrganizationReasonDto, { reason: '  Unpaid  ', expectedVersion: 1 }).reason,
    ).toBe('Unpaid');
    expect(
      await errorsOf(OrganizationReasonDto, { reason: '   ', expectedVersion: 1 }),
    ).not.toHaveLength(0);
    expect(plainToInstance(OrganizationReasonDto, { reason: 5, expectedVersion: 1 }).reason).toBe(
      5,
    );
    expect(
      await errorsOf(OrganizationReasonDto, { reason: 5, expectedVersion: 1 }),
    ).not.toHaveLength(0);
    expect(await errorsOf(ExpectedVersionDto, { expectedVersion: 0 })).toHaveLength(0);
    expect(await errorsOf(ExpectedVersionDto, { expectedVersion: -1 })).not.toHaveLength(0);
  });

  it('trims the profile fields it is given and refuses a blank or a non-text one', async () => {
    const trimmed = plainToInstance(UpdateOrganizationDto, {
      address: '  12 Le Loi ',
      contactEmail: ' A@B.vn ',
      legalName: '  Acme  ',
      expectedVersion: 1,
    });
    expect(trimmed.address).toBe('12 Le Loi');
    expect(trimmed.contactEmail).toBe('A@B.vn');
    expect(trimmed.legalName).toBe('Acme');
    expect(await errorsOf(UpdateOrganizationDto, { expectedVersion: 1 })).toHaveLength(0);
    expect(
      await errorsOf(UpdateOrganizationDto, { address: '   ', expectedVersion: 1 }),
    ).not.toHaveLength(0);
    expect(plainToInstance(UpdateOrganizationDto, { address: 7, expectedVersion: 1 }).address).toBe(
      7,
    );
    expect(
      await errorsOf(UpdateOrganizationDto, { address: 7, expectedVersion: 1 }),
    ).not.toHaveLength(0);
    expect(
      await errorsOf(UpdateOrganizationDto, { contactPhone: 'abc', expectedVersion: 1 }),
    ).not.toHaveLength(0);
  });
});

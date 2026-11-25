import { ApiKeysController } from './api-keys.controller';
import { ChannelKeyController } from './channel-key.controller';
import { ComplianceCasesController } from './compliance-cases.controller';
import { FieldStationsController } from './field-stations.controller';
import * as api from './index';
import { MembersController } from './members.controller';
import { OrganizationOnboardingController } from './organization-onboarding.controller';
import { OrganizationRolesViewController } from './organization-roles-view.controller';
import { OrganizationStatusController } from './organization-status.controller';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsModule } from './organizations.module';
import { RosterController } from './roster.controller';

const metadata = (key: string) => Reflect.getMetadata(key, OrganizationsModule) as unknown[];

describe('OrganizationsModule', () => {
  it('serves every controller of the module', () => {
    expect(metadata('controllers')).toEqual(
      expect.arrayContaining([
        OrganizationsController,
        OrganizationOnboardingController,
        OrganizationStatusController,
        ApiKeysController,
        FieldStationsController,
        ChannelKeyController,
        ComplianceCasesController,
        MembersController,
        RosterController,
        OrganizationRolesViewController,
      ]),
    );
    expect(metadata('controllers')).toHaveLength(10);
  });

  it('exports to other modules only the services of the public surface', () => {
    expect(metadata('exports')).toEqual([
      api.OrganizationsService,
      api.OrganizationOnboardingService,
      api.RosterService,
      api.FieldStationsService,
      api.FieldStationReleaseService,
      api.ChannelKeyService,
      api.ComplianceCasesService,
    ]);
  });

  it('provides the services it exports', () => {
    const providers = metadata('providers');
    for (const exported of metadata('exports')) expect(providers).toContain(exported);
  });
});

describe('the public surface of organizations', () => {
  it('exports the module, the services and the events other modules import', () => {
    const names = Object.keys(api).sort();
    expect(names).toEqual(
      [
        'API_KEY_REVOKED',
        'ChannelKeyService',
        'COMPLIANCE_LOSS_CASES',
        'ComplianceCasesService',
        'FIELD_STATION_REVOKED',
        'FieldStationReleaseService',
        'FieldStationsService',
        'ORGANIZATION_COUNTS',
        'ORGANIZATION_EXIT_CHECKS',
        'ORGANIZATION_KEY_EXPOSED',
        'ORGANIZATION_STATUS_CHANGED',
        'OrganizationOnboardingService',
        'OrganizationsModule',
        'OrganizationsService',
        'RosterService',
        'isOutdatedAgainst',
      ].sort(),
    );
  });

  it('names its event tokens, which listeners in other modules read by string', () => {
    expect(api.ORGANIZATION_STATUS_CHANGED).toBe('organization.statusChanged');
    expect(api.API_KEY_REVOKED).toBe('apiKey.revoked');
    expect(api.FIELD_STATION_REVOKED).toBe('fieldStation.revoked');
    expect(api.ORGANIZATION_KEY_EXPOSED).toBe('organization.keyExposed');
  });
});

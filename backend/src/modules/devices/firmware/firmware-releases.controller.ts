import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CheckPolicies } from '../../../common/decorators/access.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { FirmwareReleaseService, type ImageKind } from './firmware-release.service';

const VARIANT_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// devices api-design 28.
export class FirmwareReleaseQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(VARIANT_CODE)
  variantCode?: string;
}

// devices api-design 29.
export class FirmwareImageQueryDto {
  @IsOptional()
  @IsIn(['APP', 'FACTORY'])
  kind?: ImageKind;
}

// The firmware releases and their images for the flash panel (devices task 8.2, design section 9.1): the
// list needs `device.read`, an image `device.operate` (TrekLink Staff; Admin inherits both).
@Controller('firmware-releases')
export class FirmwareReleasesController {
  constructor(private readonly releases: FirmwareReleaseService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  list(@Query() query: FirmwareReleaseQueryDto) {
    return this.releases.list(query.variantCode);
  }

  // The image travels as base64 in the D-002 envelope; the browser never keeps it.
  @Get(':version/images/:variantCode')
  @Header('Cache-Control', 'no-store')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('OK')
  image(
    @Param('version') version: string,
    @Param('variantCode') variantCode: string,
    @Query() query: FirmwareImageQueryDto,
  ) {
    return this.releases.image(version, variantCode, query.kind ?? 'APP');
  }
}

import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'treklink:rawResponse';

// The one exception to the D-002 envelope (D-038): the SePay webhook answers `{ "success": true }`
// as SePay expects. ResponseInterceptor passes a marked handler's body through unwrapped. Failures
// of a marked handler still go through GlobalExceptionFilter.
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

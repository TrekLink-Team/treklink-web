import { HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';

// REQ-ERR-19: while `channelKeyExposedAt` is set, no endpoint hands out or records the organization's
// channel key. Writing a key that is known to be exposed into a fresh unit spreads the exposure; the
// fix is the rotation (api-design 27), which clears the flag.
export const channelKeyExposed = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.CHANNEL_KEY_EXPOSED,
    "The organization's channel key is exposed. Rotate it before writing it to a unit.",
  );

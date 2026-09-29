import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'treklink:responseMessage';

// The envelope `message` of a successful response (specs/platform/design.md §4.1). Each endpoint
// declares the message its api-design/*.md shows; without it the interceptor writes `Success`.
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

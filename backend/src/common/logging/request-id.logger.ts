import { ConsoleLogger } from '@nestjs/common';
import { currentRequestId } from '../context/request-context';

// Prefixes every log line written during a request with its correlation id (REQ-UBI-08). Lines
// written outside a request keep the plain Nest format.
export class RequestIdLogger extends ConsoleLogger {
  protected formatContext(context: string): string {
    const requestId = currentRequestId();
    const formatted = super.formatContext(context);
    return requestId === undefined ? formatted : `${formatted}[req ${requestId}] `;
  }
}

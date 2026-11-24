import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { PANEL_PASSWORD_HEADER } from './demo-panel.constants';
import { clientAddressOf, DemoPanelFailures } from './demo-panel-failures';
import { parsePanelHash, verifyPanelPassword } from './demo-panel-password';

export interface PanelRequest {
  socket?: { remoteAddress?: string | null };
  headers: Record<string, string | string[] | undefined>;
  demoPanelClient?: string;
}

// The panel password guard of every panel route (specs/demo/requirements.md REQ-PNL-02, REQ-PNL-10,
// REQ-PNL-11, design §11). The routes are @Public: no account, no policy (D-110 rule 1). In order: the
// hash must parse (404 otherwise, so a route reached without the module condition still refuses); an
// address over the failure limit is refused before any comparison (429); otherwise the attempt is counted
// first and the header compared in constant time (401), and a right password gives its attempt back. Neither the header nor the hash is ever logged or returned.
@Injectable()
export class DemoPanelGuard implements CanActivate {
  private readonly logger = new Logger(DemoPanelGuard.name);

  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly failures: DemoPanelFailures,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PanelRequest>();
    const hash = parsePanelHash(this.config.get('DEMO_PANEL_PASSWORD_HASH', { infer: true }));
    if (!hash) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Not found.');
    }
    const client = clientAddressOf(request);
    const now = Date.now();
    // The attempt is counted before the comparison, so parallel guesses cannot all pass the check
    // while the first ones are still being derived (review of treklink-web#541).
    const reserved = this.failures.reserve(client, now);
    if ('blockedUntil' in reserved) {
      throw new DomainException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        `Too many wrong panel passwords. Try again after ${this.clock(reserved.blockedUntil)}.`,
      );
    }
    const header = request.headers[PANEL_PASSWORD_HEADER];
    const typed = (Array.isArray(header) ? header[0] : header) ?? '';
    if (!(await verifyPanelPassword(typed, hash))) {
      this.logger.warn(`Demo panel password refused for ${client}.`);
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.DEMO_PANEL_PASSWORD_INVALID,
        'Enter the panel password.',
      );
    }
    this.failures.release(reserved.ticket);
    request.demoPanelClient = client;
    return true;
  }

  private clock(at: number): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: this.config.get('DISPLAY_TIMEZONE_DEFAULT', { infer: true }),
    }).format(new Date(at));
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';

// The one lock of the demo panel (review of treklink-web#541): the reseed wipes in one transaction and
// seeds in a later one, so no action or playback step may run between them, and a reseed may not start
// under an action that is still writing. In process memory: the AWS host runs one backend (design §11).
@Injectable()
export class DemoPanelLock {
  private resettingNow = false;
  private actions = 0;

  get resetting(): boolean {
    return this.resettingNow;
  }

  get actionsInFlight(): number {
    return this.actions;
  }

  // Runs one panel action, refused with 409 DEMO_BUSY while a reseed runs.
  async action<T>(work: () => Promise<T>): Promise<T> {
    if (this.resettingNow)
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEMO_BUSY,
        'The demo data is being reseeded. Try again when the reseed finishes.',
      );
    this.actions += 1;
    try {
      return await work();
    } finally {
      this.actions -= 1;
    }
  }

  // Takes the reseed side; the caller has checked that no action is in flight and no playback runs.
  beginReset(): void {
    this.resettingNow = true;
  }

  endReset(): void {
    this.resettingNow = false;
  }
}

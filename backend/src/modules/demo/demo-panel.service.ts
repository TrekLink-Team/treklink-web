import { Injectable } from '@nestjs/common';
import { PANEL_ACTION_VIEWS } from './demo-panel-actions';

// Options, actions and the panel audit of the demo panel (specs/demo/design.md §11, D-110).
@Injectable()
export class DemoPanelService {
  overview() {
    return { actions: PANEL_ACTION_VIEWS };
  }
}

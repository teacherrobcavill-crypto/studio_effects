/**
 * main-tape-flanging.js
 * Entry point for 1960s Studio Tape Flanging Simulator ("Through the Zero").
 * Coordinates declarative tooltips, master hub audio switching, and DOM mounting.
 */

import { TapeFlangingModule } from './ui/TapeFlangingModule.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

initDeclarativeTips(document.body);

const mountEl = document.getElementById('tape-flanging-mount');
let moduleInstance = null;

if (mountEl) {
  moduleInstance = new TapeFlangingModule(mountEl, {
    onAudioStateChange: (isPlaying) => {
      notifyHubAudioState('app-tape-flanging', isPlaying);
    }
  });

  registerHubAudioCoordinator(() => {
    if (moduleInstance) {
      moduleInstance.suspend();
    }
    notifyHubAudioState('app-tape-flanging', false);
  });
}

export { moduleInstance };

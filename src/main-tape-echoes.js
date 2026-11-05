/**
 * main-tape-echoes.js
 * Entry point for the Roland RE-201 Space Echo & Watkins Copicat Interactive Educational Module.
 * Coordinates declarative tooltips, master hub audio switching, and DOM mounting.
 */

import { TapeEchoModule } from './ui/TapeEchoModule.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

initDeclarativeTips(document.body);

const mountEl = document.getElementById('tape-echoes-mount');
let moduleInstance = null;

if (mountEl) {
  moduleInstance = new TapeEchoModule(mountEl, {
    onAudioStateChange: (isPlaying) => {
      notifyHubAudioState('app-tape-echoes', isPlaying);
    }
  });

  registerHubAudioCoordinator(() => {
    if (moduleInstance) {
      moduleInstance.suspend();
    }
    notifyHubAudioState('app-tape-echoes', false);
  });
}

export { moduleInstance };

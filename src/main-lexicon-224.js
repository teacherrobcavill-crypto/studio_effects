/**
 * main-lexicon-224.js
 * Entry point for the Lexicon 224 Digital Reverb simulator module.
 * Coordinates declarative tooltips, master hub audio switching, and DOM mounting.
 */

import { Lexicon224Module } from './ui/Lexicon224Module.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

// Initialize interactive learning tooltips throughout DOM
initDeclarativeTips(document.body);

const mountEl = document.getElementById('lexicon-mount');
let moduleInstance = null;

if (mountEl) {
  moduleInstance = new Lexicon224Module(mountEl, {
    onAudioStateChange: (isPlaying) => {
      notifyHubAudioState('app-lexicon-224', isPlaying);
    }
  });

  // Hub cross-app audio coordinator: pause playback when another tab is selected in master hub
  registerHubAudioCoordinator(() => {
    if (moduleInstance) {
      moduleInstance.suspend();
    }
    notifyHubAudioState('app-lexicon-224', false);
  });
}

export { moduleInstance };

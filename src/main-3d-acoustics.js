import './style.css';
import { solveRoomAcoustics } from './physics/AcousticMath.js';
import { AudioEngine } from './audio/Room3DAudioEngine.js';
import { SceneManager } from './visualizer/SceneManager.js';
import { UIManager } from './ui/UIManager.js';
import { SCENARIOS } from './ui/Scenarios.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

// Initial Studio State (defaults to Scenario 01: 1950s Live Tracking Room)
const initialScenario = SCENARIOS[0];

const appState = {
  instrument: initialScenario.instrument,
  dimensions: { ...initialScenario.dimensions },
  surfaceMaterials: { ...initialScenario.surfaceMaterials },
  sourcePos: { ...initialScenario.sourcePos },
  micPos: { ...initialScenario.micPos },
  polarPattern: initialScenario.polarPattern,
  micYawDeg: initialScenario.micYawDeg,
  layers: { ...initialScenario.layers }
};

let currentSolution = null;
let sceneManager = null;
let uiManager = null;

// Initialize Audio Engine with callback that spawns 3D expanding wavefront rings on each transient
const audioEngine = new AudioEngine((velocity) => {
  if (sceneManager && sceneManager.rayTracer) {
    sceneManager.rayTracer.spawnWavefront(appState.sourcePos, velocity);
  }
});

/**
 * Re-evaluates all acoustic physics equations and pushes results to 3D Scene, Web Audio DSP, and HUD.
 */
function recomputeAcoustics(forceImpulseRebuild = false) {
  currentSolution = solveRoomAcoustics(appState);

  if (sceneManager) {
    sceneManager.updateVisualsFromSolution(currentSolution);
  }
  if (audioEngine) {
    audioEngine.updateAcoustics(currentSolution, forceImpulseRebuild);
  }
  if (uiManager) {
    uiManager.updateTelemetry(currentSolution);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const viewportEl = document.getElementById('viewport-3d');

  // 1. Initialize 3D Scene Manager
  sceneManager = new SceneManager(viewportEl, appState, () => {
    // Callback invoked at 60fps when user drags Source or Microphone in 3D viewport
    uiManager.syncCoordinateSliders();
    recomputeAcoustics(false);
  });

  // 2. Initialize UI Manager & Control Bindings
  uiManager = new UIManager(appState, {
    onTogglePlay: async () => {
      const playing = await audioEngine.togglePlay(currentSolution, appState.instrument);
      notifyHubAudioState('app-3d-acoustics', playing);
      return playing;
    },
    onTriggerClap: async () => {
      await audioEngine.triggerClap(currentSolution);
    },
    onInstrumentChanged: async (inst) => {
      const playing = await audioEngine.startWithInstrument(inst, currentSolution);
      uiManager.setPlayingUI(playing);
      notifyHubAudioState('app-3d-acoustics', playing);
    },
    onVolumeChanged: (val) => {
      audioEngine.setMasterVolume(val);
    },
    onLayerToggle: (layerKey, enabled) => {
      audioEngine.setLayerEnabled(layerKey, enabled);
      if (layerKey === 'direct' || layerKey === 'earlyReflections') {
        sceneManager.rayTracer.setVisibility(layerKey, enabled);
      }
    },
    onVisualToggle: (visKey, enabled) => {
      sceneManager.rayTracer.setVisibility(visKey, enabled);
    },
    onRoomChanged: () => {
      sceneManager.rebuildRoom();
      uiManager.syncCoordinateSliders();
      recomputeAcoustics(false);
    },
    onCoordinatesChanged: () => {
      sceneManager.setPositions(appState.sourcePos, appState.micPos, appState.micYawDeg);
      recomputeAcoustics(false);
    },
    onPolarChanged: () => {
      sceneManager.setPositions(appState.sourcePos, appState.micPos, appState.micYawDeg);
      sceneManager.updatePolarPatternMesh(appState.polarPattern);
      recomputeAcoustics(false);
    },
    onLoadScenario: async (scen) => {
      appState.instrument = scen.instrument;
      appState.dimensions = { ...scen.dimensions };
      appState.surfaceMaterials = { ...scen.surfaceMaterials };
      appState.sourcePos = { ...scen.sourcePos };
      appState.micPos = { ...scen.micPos };
      appState.polarPattern = scen.polarPattern;
      appState.micYawDeg = scen.micYawDeg;
      appState.layers = { ...scen.layers };

      sceneManager.rayTracer.setVisibility('direct', appState.layers.direct);
      sceneManager.rayTracer.setVisibility('earlyReflections', appState.layers.earlyReflections);

      sceneManager.rebuildRoom();
      sceneManager.updatePolarPatternMesh(appState.polarPattern);
      if (scen.camera) {
        sceneManager.transitionCamera(scen.camera.pos, scen.camera.lookAt);
      }

      uiManager.syncControlsFromState(scen);
      recomputeAcoustics(true);

      const playing = await audioEngine.startWithInstrument(appState.instrument, currentSolution);
      audioEngine.setLayerEnabled('direct', appState.layers.direct);
      audioEngine.setLayerEnabled('earlyReflections', appState.layers.earlyReflections);
      audioEngine.setLayerEnabled('lateReverb', appState.layers.lateReverb);
      uiManager.setPlayingUI(playing);
      notifyHubAudioState('app-3d-acoustics', playing);
    }
  });

  // Sync initial UI state & compute initial room acoustics
  uiManager.syncControlsFromState(initialScenario);
  recomputeAcoustics(true);
  initDeclarativeTips();

  registerHubAudioCoordinator(() => {
    if (audioEngine && audioEngine.isPlaying) {
      audioEngine.togglePlay(currentSolution, appState.instrument).then((playing) => {
        if (uiManager) uiManager.setPlayingUI(playing);
        notifyHubAudioState('app-3d-acoustics', playing);
      });
    }
  });

  // 3. Start 60fps Live Audio FFT & Sabine Decay Visualizer Loop
  const renderAudioHUD = () => {
    const data = audioEngine.getAnalyserData();
    uiManager.renderLiveAudioFrame(data);
    requestAnimationFrame(renderAudioHUD);
  };
  requestAnimationFrame(renderAudioHUD);
});

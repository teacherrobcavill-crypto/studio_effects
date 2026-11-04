/**
 * AudioEngine.js
 * Master 1950s Recording Studio Signal Routing Graph (Stages S-01 through S-09),
 * Equal-Power Dry/1950s Master A/B Crossfader, Real-Time Stage Telemetry,
 * and Authentic 1950s Studio Session Presets.
 */

import { StemGenerator } from './StemGenerator.js';
import { LiveRoomEngine } from './LiveRoomEngine.js';
import { ConsoleEngine } from './ConsoleEngine.js';
import { TapeSystem } from './TapeSystem.js';
import { CuttingLathe } from './CuttingLathe.js';
import micWorkletSource from './worklets/MicWorklet.js?raw';
import variMuWorkletSource from './worklets/VariMuWorklet.js?raw';
import pultecWorkletSource from './worklets/PultecWorklet.js?raw';
import tapeWorkletSource from './worklets/TapeWorklet.js?raw';
import latheWorkletSource from './worklets/LatheWorklet.js?raw';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;

    this.stemGenerator = null;
    this.liveRoom = null;
    this.consoleEngine = null;
    this.tapeSystem = null;
    this.cuttingLathe = null;

    // Equal-power A/B Crossfader (0.0 = Pure Dry Modern Stems, 1.0 = Full 1950s Studio Chain)
    this.abMix = 1.0;
    this.masterVolumeDb = 0.0;

    // Stage-by-stage analysers for S-01 through S-09
    this.stageAnalysers = {};
    this.timeDomainScratch = new Float32Array(256);
    this.freqDomainScratch = new Uint8Array(256);
  }

  /**
   * Initializes AudioContext, registers all 5 AudioWorkletProcessors, and wires S-01 through S-09.
   */
  async init() {
    if (this.isInitialized) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive' });

    // Load all 5 dedicated AudioWorklet files (bundled via Blob URL for Vite dev & production)
    const workletModules = [
      { source: micWorkletSource, path: './src/audio/worklets/MicWorklet.js' },
      { source: variMuWorkletSource, path: './src/audio/worklets/VariMuWorklet.js' },
      { source: pultecWorkletSource, path: './src/audio/worklets/PultecWorklet.js' },
      { source: tapeWorkletSource, path: './src/audio/worklets/TapeWorklet.js' },
      { source: latheWorkletSource, path: './src/audio/worklets/LatheWorklet.js' }
    ];

    for (const mod of workletModules) {
      if (typeof mod.source === 'string' && mod.source.length > 0) {
        const blob = new Blob([mod.source], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          await this.ctx.audioWorklet.addModule(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        await this.ctx.audioWorklet.addModule(mod.path);
      }
    }

    // Instantiate core DSP engines
    this.stemGenerator = new StemGenerator(this.ctx);
    this.liveRoom = new LiveRoomEngine(this.ctx);
    this.consoleEngine = new ConsoleEngine(this.ctx);
    this.tapeSystem = new TapeSystem(this.ctx);
    this.cuttingLathe = new CuttingLathe(this.ctx);

    // Dry Reference Bus (Direct equal-power sum of the 4 dry stems for A/B comparison)
    this.dryReferenceBus = this.ctx.createGain();
    this.dryReferenceBus.gain.value = 0.0; // Default abMix = 1.0 (100% 1950s Wet)

    this.wetMasterBus = this.ctx.createGain();
    this.wetMasterBus.gain.value = 1.0;

    this.masterOutputGain = this.ctx.createGain();
    this.masterOutputGain.gain.value = 1.0;

    // Stereo Master Analysers (Left & Right) for the main VU meters & Oscilloscope
    this.masterSplitter = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    this.analyserL.fftSize = 1024;
    this.analyserR.fftSize = 1024;

    this._wireSignalChain();
    this.syncRoomToConsoleProximity();
    this.isInitialized = true;
  }

  _createStageTap(stageId, sourceNode) {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    sourceNode.connect(analyser);
    this.stageAnalysers[stageId] = analyser;
  }

  /**
   * Wires the complete 9-Stage 1950s Studio Architecture (S-01 through S-09)
   */
  _wireSignalChain() {
    // Stage S-01: 4 Acoustic Stems -> Stage S-02: Live Room 4x4 Acoustic Matrix + Dry A/B Reference
    const s01Sum = this.ctx.createGain();
    s01Sum.gain.value = 0.4;

    for (let i = 0; i < 4; i++) {
      // Connect stem i into Live Room Source i
      this.stemGenerator.outputNodes[i].connect(this.liveRoom.sourceInputs[i]);
      // Connect stem i into S-01 metering sum and Dry Reference Bus
      this.stemGenerator.outputNodes[i].connect(s01Sum);

      const dryPan = this.ctx.createStereoPanner();
      dryPan.pan.value = this.consoleEngine.channels[i].state.panPos;
      const dryScale = this.ctx.createGain();
      dryScale.gain.value = 0.38;
      this.stemGenerator.outputNodes[i].connect(dryScale);
      dryScale.connect(dryPan);
      dryPan.connect(this.dryReferenceBus);
    }
    this._createStageTap('S-01', s01Sum);

    // Stage S-02 -> Stage S-03: Live Room Mic Outputs -> Console Channel MicPreampWorklets
    const s02Sum = this.ctx.createGain();
    s02Sum.gain.value = 0.4;
    for (let m = 0; m < 4; m++) {
      this.liveRoom.micOutputs[m].connect(this.consoleEngine.channels[m].inputNode);
      this.liveRoom.micOutputs[m].connect(s02Sum);
    }
    this._createStageTap('S-02', s02Sum);

    // Stage S-03 Tap (Post MicWorklet / Pre-Fader sum) & Stage S-04 Tap (Console Summing Bus)
    const s03Sum = this.ctx.createGain();
    s03Sum.gain.value = 0.35;
    for (let m = 0; m < 4; m++) {
      this.consoleEngine.channels[m].micWorklet.connect(s03Sum);
    }
    this._createStageTap('S-03', s03Sum);
    this._createStageTap('S-04', this.consoleEngine.summingBus);

    // Stage S-05 Tap (Post Pultec EQP-1A3) & Stage S-06 Tap (Post Fairchild 660 Vari-Mu)
    this._createStageTap('S-05', this.consoleEngine.pultecNode);
    this._createStageTap('S-06', this.consoleEngine.outputNode);

    // Stage S-06 & Console Aux Send -> Stage S-07 (Sun Slapback) & Stage S-08 (Ampex 300 Master Tape)
    this.consoleEngine.outputNode.connect(this.tapeSystem.inputNode);
    this.consoleEngine.auxSendBus.connect(this.tapeSystem.auxSlapbackInput);

    this._createStageTap('S-07', this.tapeSystem.slapReturnGain);
    this._createStageTap('S-08', this.tapeSystem.outputNode);

    // Stage S-08 -> Stage S-09: Ampex 300 Master Tape -> Scully 601 Cutting Lathe & Monitor Sim
    this.tapeSystem.outputNode.connect(this.cuttingLathe.inputNode);
    this._createStageTap('S-09', this.cuttingLathe.outputNode);

    // Connect Wet (1950s Chain) & Dry (Modern Bypass) through Equal-Power A/B Crossfader to Master Output
    this.cuttingLathe.outputNode.connect(this.wetMasterBus);
    this.wetMasterBus.connect(this.masterOutputGain);
    this.dryReferenceBus.connect(this.masterOutputGain);

    // Master Output -> Stereo Splitter -> L/R VU Meter Analysers -> Destination
    this.masterOutputGain.connect(this.masterSplitter);
    this.masterSplitter.connect(this.analyserL, 0);
    this.masterSplitter.connect(this.analyserR, 1);
    this.masterOutputGain.connect(this.ctx.destination);
  }

  /**
   * Synchronizes primary Source-to-Mic distances from the 2D Room into each channel's MicWorklet
   * so moving a microphone closer to its source dynamically increases 1st-order Proximity Bass Boost!
   */
  syncRoomToConsoleProximity() {
    if (!this.liveRoom || !this.consoleEngine) return;
    for (let m = 0; m < 4; m++) {
      const distFt = this.liveRoom.getPrimaryMicDistance(m);
      this.consoleEngine.setChannelDistance(m, distFt);
      this.liveRoom.mics[m].micModel = this.consoleEngine.channels[m].state.micModel;
    }
    this.liveRoom.updateAcoustics();
  }

  /**
   * Equal-power A/B Crossfader:
   *   mix = 0.0 -> 100% Dry Unprocessed Stems
   *   mix = 1.0 -> 100% 1950s Authentic Analog Chain
   */
  setABMix(mix) {
    this.abMix = Math.max(0.0, Math.min(1.0, mix));
    if (!this.isInitialized) return;
    const angle = this.abMix * (Math.PI * 0.5);
    const dryGain = Math.cos(angle);
    const wetGain = Math.sin(angle);
    const now = this.ctx.currentTime;
    this.dryReferenceBus.gain.setTargetAtTime(dryGain, now, 0.015);
    this.wetMasterBus.gain.setTargetAtTime(wetGain, now, 0.015);
  }

  setMasterVolumeDb(db) {
    this.masterVolumeDb = db;
    if (!this.isInitialized) return;
    const linear = Math.pow(10, db / 20);
    this.masterOutputGain.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  /**
   * Computes RMS and Peak levels for Left & Right Master buses + all 9 Signal Flow Stages
   */
  getMeterTelemetry() {
    if (!this.isInitialized) {
      return {
        rmsL: 0,
        rmsR: 0,
        peakL: 0,
        peakR: 0,
        variMuGrDb: 0,
        stages: {}
      };
    }

    const computeRmsPeak = (analyser) => {
      analyser.getFloatTimeDomainData(this.timeDomainScratch);
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < this.timeDomainScratch.length; i++) {
        const v = this.timeDomainScratch[i];
        sumSq += v * v;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      }
      return {
        rms: Math.sqrt(sumSq / this.timeDomainScratch.length),
        peak
      };
    };

    const left = computeRmsPeak(this.analyserL);
    const right = computeRmsPeak(this.analyserR);

    const stages = {};
    for (const [id, analyser] of Object.entries(this.stageAnalysers)) {
      stages[id] = computeRmsPeak(analyser);
    }

    return {
      rmsL: left.rms,
      rmsR: right.rms,
      peakL: left.peak,
      peakR: right.peak,
      variMuGrDb: this.consoleEngine.telemetry.variMuGrDb,
      masterTapeSat: this.tapeSystem.telemetry.masterSaturation,
      latheAccelLim: this.cuttingLathe.telemetry.accelLimiting,
      latheScanHz: this.cuttingLathe.telemetry.scanCutoffHz,
      latheIps: this.cuttingLathe.telemetry.tangentialIps,
      slapDelayMs: this.tapeSystem.telemetry.slapbackDelayMs,
      rt60: this.liveRoom.rt60,
      stages
    };
  }

  /**
   * Loads one of 4 historically accurate 1950s Studio Presets and returns the full UI parameter map
   */
  getPresetConfig(presetId) {
    const presets = {
      sun1954: {
        name: 'Sun Studio Memphis (1954)',
        roomDamping: 0.32,
        reverbMix: 0.22,
        bleedEnabled: true,
        pultec: { lowFreq: 60, lowBoost: 4.5, lowAtten: 3.0, highFreq: 8000, highBoost: 4.8, bandwidth: 4.5, attenFreq: 10000, highAtten: 1.5 },
        variMu: { inputGainDb: 5.5, threshold: 0.52, timeConstant: 2, dcBias: 0.4, outputGainDb: 3.0 },
        tape: { tapeSpeed: 15, recordDriveDb: 4.5, biasTrim: 0.05, wowFlutter: 0.32, hissLevel: 0.20, slapSpeed: 15, slapReturn: 0.55, slapFeedback: 0.22 },
        lathe: { rpm: 45, groovePosition: 0.20, cutterDriveDb: 3.0, accelLimit: 0.55, surfaceWear: 0.22, monoCut: 1, monitorMode: 'altec604' }
      },
      columbia1959: {
        name: 'Columbia 30th St. NYC (1959)',
        roomDamping: 0.20,
        reverbMix: 0.46,
        bleedEnabled: true,
        pultec: { lowFreq: 30, lowBoost: 3.2, lowAtten: 2.0, highFreq: 12000, highBoost: 5.2, bandwidth: 6.5, attenFreq: 20000, highAtten: 0.8 },
        variMu: { inputGainDb: 2.5, threshold: 0.35, timeConstant: 5, dcBias: 0.2, outputGainDb: 2.0 },
        tape: { tapeSpeed: 15, recordDriveDb: 2.0, biasTrim: 0.25, wowFlutter: 0.15, hissLevel: 0.12, slapSpeed: 15, slapReturn: 0.10, slapFeedback: 0.05 },
        lathe: { rpm: 33.3, groovePosition: 0.30, cutterDriveDb: 1.0, accelLimit: 0.65, surfaceWear: 0.12, monoCut: 0, monitorMode: 'altec604' }
      },
      chess1955: {
        name: 'Chess Records Chicago (1955)',
        roomDamping: 0.28,
        reverbMix: 0.38,
        bleedEnabled: true,
        pultec: { lowFreq: 100, lowBoost: 5.8, lowAtten: 4.2, highFreq: 5000, highBoost: 6.0, bandwidth: 3.5, attenFreq: 10000, highAtten: 2.8 },
        variMu: { inputGainDb: 8.5, threshold: 0.68, timeConstant: 1, dcBias: 0.65, outputGainDb: 4.0 },
        tape: { tapeSpeed: 15, recordDriveDb: 7.5, biasTrim: -0.20, wowFlutter: 0.38, hissLevel: 0.28, slapSpeed: 7.5, slapReturn: 0.38, slapFeedback: 0.15 },
        lathe: { rpm: 78, groovePosition: 0.35, cutterDriveDb: 5.0, accelLimit: 0.45, surfaceWear: 0.48, monoCut: 1, monitorMode: 'altec604' }
      },
      amRadio1956: {
        name: '1956 Dashboard AM Car Radio',
        roomDamping: 0.35,
        reverbMix: 0.28,
        bleedEnabled: true,
        pultec: { lowFreq: 100, lowBoost: 5.0, lowAtten: 4.0, highFreq: 4000, highBoost: 5.5, bandwidth: 4.0, attenFreq: 5000, highAtten: 4.5 },
        variMu: { inputGainDb: 7.0, threshold: 0.65, timeConstant: 3, dcBias: 0.55, outputGainDb: 4.5 },
        tape: { tapeSpeed: 7.5, recordDriveDb: 5.5, biasTrim: -0.10, wowFlutter: 0.45, hissLevel: 0.32, slapSpeed: 15, slapReturn: 0.45, slapFeedback: 0.25 },
        lathe: { rpm: 45, groovePosition: 0.75, cutterDriveDb: 4.0, accelLimit: 0.42, surfaceWear: 0.38, monoCut: 1, monitorMode: 'amRadio' }
      }
    };
    return presets[presetId] || presets.sun1954;
  }
}

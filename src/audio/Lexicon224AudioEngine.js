/**
 * Lexicon224AudioEngine.js
 * Signal Routing Engine, AudioWorklet Manager, Procedural Stems & Telemetry Bridge
 * for the 1978 Lexicon 224 Digital Reverberator.
 */

import lexiconWorkletSource from './worklets/Lexicon224Worklet.js?raw';
import { ProceduralStemGenerator } from '../vintage-suite/ProceduralStemGenerator.js';

export class Lexicon224AudioEngine {
  constructor(options = {}) {
    this.externalCtxGetter = options.ensureAudioContext || null;
    this.externalDestGetter = options.getOutputNode || null;
    this.externalSourceGetter = options.getInputNode || null;
    this.externalCtx = options.audioContext || null;
    this.externalDest = options.destination || null;
    this.ctx = this.externalCtx;
    this.ownsContext = false;
    this.isInitialized = false;

    // Nodes
    this.sourceNode = null;
    this.customBuffer = null;
    this.stemBuffers = {};
    this.activeSource = null;
    this.isPlaying = false;
    this.currentStemId = 'drums';

    // Worklet & Routing
    this.workletNode = null;
    this.inputGainNode = null;
    this.masterGainNode = null;
    this.analyserIn = null;
    this.analyserOut = null;

    // Telemetry & Visualizer State
    this.telemetry = {
      tankEnergies: [0, 0, 0, 0],
      lfoPhases: [0, 0, 0, 0],
      inputRms: 0,
      outputRms: 0
    };

    // Scratch buffers for analysers
    this.timeDomainIn = new Float32Array(512);
    this.timeDomainOut = new Float32Array(512);
    this.freqDomainOut = new Uint8Array(256);

    // Queued parameters set before workletNode is created
    this.queuedParams = {
      preDelay: 24.0,
      decay: 2.8,
      damping: 4500.0,
      diffusion: 0.72,
      modRate: 0.85,
      modDepth: 1.5,
      mix: 0.40,
      bypass: 0.0
    };
    this.initPromise = null;

    // Callbacks
    this.onTelemetryUpdate = null;
    this.onPlayStateChange = null;
  }

  /**
   * Synchronously prepares the AudioContext and external slot bus connections
   * so VintageStudioSuite's synchronous rebuildSeriesRouting() always sees our slot!
   */
  prepareSyncRouting() {
    if (!this.ctx && this.externalCtxGetter) {
      this.ctx = this.externalCtxGetter();
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.ownsContext = true;
    }

    if (!this.inputGainNode) {
      this.inputGainNode = this.ctx.createGain();
      this.inputGainNode.gain.value = 1.0;

      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.value = 0.9;

      // Dual stereo analysers for visual feedback
      this.analyserIn = this.ctx.createAnalyser();
      this.analyserIn.fftSize = 1024;
      this.analyserIn.smoothingTimeConstant = 0.8;

      this.analyserOut = this.ctx.createAnalyser();
      this.analyserOut.fftSize = 1024;
      this.analyserOut.smoothingTimeConstant = 0.8;

      this.inputGainNode.connect(this.analyserIn);
      this.analyserOut.connect(this.masterGainNode);

      // Connect external source if running inside an FX rack
      if (this.externalSourceGetter) {
        const srcNode = this.externalSourceGetter();
        if (srcNode) {
          try { srcNode.connect(this.inputGainNode); } catch (_) {}
        }
      }

      const dest = (this.externalDestGetter ? this.externalDestGetter() : null) || this.externalDest || this.ctx.destination;
      this.masterGainNode.connect(dest);

      // Preload Procedural Stems synchronously
      this.stemBuffers['drums'] = ProceduralStemGenerator.create80sDrumStem(this.ctx);
      this.stemBuffers['vocal'] = ProceduralStemGenerator.createVocalPadStem(this.ctx);
      this.stemBuffers['calibration'] = ProceduralStemGenerator.createCalibrationStem(this.ctx);
    }

    return this.ctx;
  }

  /**
   * Lazily initializes the audio context and registers the AudioWorklet.
   */
  async ensureAudioContext() {
    this.prepareSyncRouting();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (this.isInitialized && this.workletNode) {
      return this.ctx;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.ctx;
    }

    this.initPromise = (async () => {
      // Register AudioWorklet using Blob URL for seamless dev & prod execution
      try {
        const blob = new Blob([lexiconWorkletSource], { type: 'application/javascript; charset=utf-8' });
        const moduleUrl = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
      } catch (err) {
        console.warn('Blob worklet load fallback, attempting direct path:', err);
        await this.ctx.audioWorklet.addModule('/src/audio/worklets/Lexicon224Worklet.js');
      }

      // Instantiate AudioWorkletNode
      this.workletNode = new AudioWorkletNode(this.ctx, 'lexicon-224-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit'
      });

      // Apply any queued parameter values
      const now = this.ctx.currentTime;
      for (const [k, v] of Object.entries(this.queuedParams)) {
        const p = this.workletNode.parameters.get(k);
        if (p) p.setValueAtTime(v, now);
      }

      // Telemetry message bridge from AudioWorklet
      this.workletNode.port.onmessage = (event) => {
        if (event.data && event.data.type === 'LEXICON_224_TELEMETRY') {
          this.telemetry.tankEnergies = event.data.energies;
          this.telemetry.lfoPhases = event.data.lfoPhases;
          if (this.onTelemetryUpdate) {
            this.onTelemetryUpdate(this.telemetry);
          }
        }
      };

      // Connect worklet between inputGainNode and analyserOut
      this.inputGainNode.connect(this.workletNode);
      this.workletNode.connect(this.analyserOut);

      this.isInitialized = true;
    })();

    await this.initPromise;
    return this.ctx;
  }

  /**
   * Set AudioParam with exponential or linear smoothing ramp
   */
  setParam(name, value, rampTime = 0.03) {
    this.queuedParams[name] = value;
    if (!this.workletNode || !this.ctx) return;
    const param = this.workletNode.parameters.get(name);
    if (!param) return;
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, Math.max(0.005, rampTime));
  }

  /**
   * Apply hardware program presets
   */
  applyPreset(presetName, rampTime = 0.05) {
    const presets = {
      'concert-hall': {
        preDelay: 35.0,
        decay: 3.8,
        damping: 4200.0,
        diffusion: 0.76,
        modRate: 0.75,
        modDepth: 2.2,
        mix: 0.42
      },
      'vocal-plate': {
        preDelay: 12.0,
        decay: 2.2,
        damping: 7800.0,
        diffusion: 0.92,
        modRate: 1.35,
        modDepth: 0.9,
        mix: 0.35
      },
      'rich-chamber': {
        preDelay: 18.0,
        decay: 1.6,
        damping: 5600.0,
        diffusion: 0.65,
        modRate: 0.90,
        modDepth: 1.4,
        mix: 0.30
      },
      'large-acoustic': {
        preDelay: 50.0,
        decay: 6.8,
        damping: 2600.0,
        diffusion: 0.82,
        modRate: 0.45,
        modDepth: 3.2,
        mix: 0.50
      },
      'infinite-bloom': {
        preDelay: 60.0,
        decay: 14.5,
        damping: 6000.0,
        diffusion: 0.88,
        modRate: 0.60,
        modDepth: 4.5,
        mix: 0.65
      }
    };

    const cfg = presets[presetName];
    if (!cfg) return;

    for (const [key, val] of Object.entries(cfg)) {
      this.setParam(key, val, rampTime);
    }
    return cfg;
  }

  /**
   * Start looping audio stem
   */
  async playStem(stemId = 'drums') {
    await this.ensureAudioContext();
    this.stopStem();

    let buffer = null;
    if (stemId === 'custom' && this.customBuffer) {
      buffer = this.customBuffer;
    } else {
      buffer = this.stemBuffers[stemId] || this.stemBuffers['drums'];
    }

    if (!buffer) return;

    this.activeSource = this.ctx.createBufferSource();
    this.activeSource.buffer = buffer;
    this.activeSource.loop = true;
    this.activeSource.connect(this.inputGainNode);
    this.activeSource.start(0);

    this.isPlaying = true;
    this.currentStemId = stemId;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  /**
   * Stop active audio stem
   */
  stopStem() {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch (_) {}
      this.activeSource = null;
    }
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  /**
   * Triggers an immediate one-shot Snare Transient Hit
   */
  async triggerSnareHit() {
    await this.ensureAudioContext();
    const hitBuffer = ProceduralStemGenerator.createSingleSnareHit(this.ctx);
    const src = this.ctx.createBufferSource();
    src.buffer = hitBuffer;
    src.connect(this.inputGainNode);
    src.start(0);
  }

  /**
   * Triggers an immediate pure 1-sample Dirac Impulse click
   * Perfect for acoustic analysis of the reverb impulse response and decay tail!
   */
  async triggerDiracImpulse() {
    await this.ensureAudioContext();
    const buffer = this.ctx.createBuffer(1, 128, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    data[0] = 1.0; // Pure Dirac Delta function δ[n]
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.inputGainNode);
    src.start(0);
  }

  /**
   * Load custom audio file dropped by the user
   */
  async loadCustomAudioFile(file) {
    await this.ensureAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    this.customBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.currentStemId = 'custom';
    await this.playStem('custom');
    return file.name;
  }

  /**
   * Read real-time levels for VU/peak meters
   */
  getLevels() {
    if (!this.analyserIn || !this.analyserOut) {
      return { inRms: 0, outRms: 0, inPeak: 0, outPeak: 0 };
    }

    this.analyserIn.getFloatTimeDomainData(this.timeDomainIn);
    this.analyserOut.getFloatTimeDomainData(this.timeDomainOut);

    let sumIn = 0;
    let peakIn = 0;
    for (let i = 0; i < this.timeDomainIn.length; i++) {
      const v = Math.abs(this.timeDomainIn[i]);
      sumIn += v * v;
      if (v > peakIn) peakIn = v;
    }

    let sumOut = 0;
    let peakOut = 0;
    for (let i = 0; i < this.timeDomainOut.length; i++) {
      const v = Math.abs(this.timeDomainOut[i]);
      sumOut += v * v;
      if (v > peakOut) peakOut = v;
    }

    return {
      inRms: Math.sqrt(sumIn / this.timeDomainIn.length),
      outRms: Math.sqrt(sumOut / this.timeDomainOut.length),
      inPeak: peakIn,
      outPeak: peakOut
    };
  }

  /**
   * Suspend engine cleanly when hub tab switches
   */
  suspend() {
    this.stopStem();
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }
}

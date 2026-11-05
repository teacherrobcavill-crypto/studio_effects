/**
 * FlangeAudioEngine.js
 * Web Audio DSP Graph for 1960s Studio Tape Flanging ("Through the Zero").
 * 
 * True Through-Zero Delay Topology:
 * Source -> Split:
 *   Path A (Master Reference): Fixed 10ms DelayNode -> GainNode -> Master Sum
 *   Path B (Modulated Slave): Variable DelayNode (0-25ms) -> Azimuth BiquadFilter
 *                            -> Tape Saturation WaveShaper -> Polarity GainNode (-1 / +1)
 *                            -> Master Sum -> Master Analyser -> Destination
 * 
 * Also provides dedicated Deck A & Deck B tap analysers for the CRT Dual-Trace oscilloscope view.
 * Zero-persistence memory cleanup protocol strictly enforced.
 */

import { FlangeStemGenerator } from './FlangeStemGenerator.js';

export class FlangeAudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isPlaying = false;

    // Active stem or custom audio buffer in volatile RAM
    this.activeBuffer = null;
    this.activeStemId = 'drums';
    this.customFileName = null;
    this.customObjectUrl = null;

    // Source playback nodes
    this.sourceNode = null;
    this.playbackStartTime = 0;
    this.playbackPauseOffset = 0;

    // Master bus & Volume
    this.masterGain = null;
    this.masterAnalyser = null;
    this.deckAAnalyser = null;
    this.deckBAnalyser = null;

    // Delay Nodes
    this.delayNodeA = null; // Fixed 0.010 s (10 ms)
    this.delayNodeB = null; // Variable 0.000 s to 0.025 s

    // Deck B processing chain
    this.azimuthFilterB = null; // Dynamic HF loss under friction braking
    this.saturationShaperB = null; // Magnetic tape hysteresis soft clip
    this.polarityGainB = null; // +1.0 or -1.0 (Phase Invert)
    this.levelGainA = null;
    this.levelGainB = null;

    // Controls
    this.isPhaseInverted = false; // false = +1.0 (Normal), true = -1.0 (Invert)
    this.wetDryMix = 1.0; // 0.0 = Dry (Deck A only), 1.0 = Balanced Flange
    this.auditionMode = 'flange'; // 'flange' | 'deckA' | 'deckB' | 'null'
    this.tapeSaturationAmount = 0.5;

    // Pre-generated stems cache in volatile RAM
    this.stemBuffers = new Map();

    // Bind unload cleanup for zero-persistence guarantee
    this._bindUnloadCleanup();
  }

  /**
   * Initializes AudioContext and graph upon first user gesture
   */
  async init() {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass({
      latencyHint: 'interactive'
    });

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // 1. Master Output & Analysers
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterAnalyser.minDecibels = -90;
    this.masterAnalyser.maxDecibels = -10;
    this.masterAnalyser.smoothingTimeConstant = 0.65;

    this.deckAAnalyser = this.ctx.createAnalyser();
    this.deckAAnalyser.fftSize = 1024;
    this.deckAAnalyser.smoothingTimeConstant = 0.65;

    this.deckBAnalyser = this.ctx.createAnalyser();
    this.deckBAnalyser.fftSize = 1024;
    this.deckBAnalyser.smoothingTimeConstant = 0.65;

    // 2. Delay Lines (Through-Zero Topology)
    // Path A: Fixed 10 ms (0.010 s) base reference
    this.delayNodeA = this.ctx.createDelay(0.05);
    this.delayNodeA.delayTime.value = 0.010;

    // Path B: Variable 0 to 25 ms delay line
    this.delayNodeB = this.ctx.createDelay(0.05);
    this.delayNodeB.delayTime.value = 0.010; // start at Zero Point

    // 3. Deck B Tone & Saturation Shaping
    // Dynamic Azimuth / Head Pressure low-pass filter
    this.azimuthFilterB = this.ctx.createBiquadFilter();
    this.azimuthFilterB.type = 'lowpass';
    this.azimuthFilterB.frequency.value = 18000;
    this.azimuthFilterB.Q.value = 0.707;

    // Magnetic hysteresis soft-clipping tape shaper
    this.saturationShaperB = this.ctx.createWaveShaper();
    this.saturationShaperB.curve = this._generateTapeSaturationCurve(this.tapeSaturationAmount);
    this.saturationShaperB.oversample = '2x';

    // Deck B Polarity Inverter (+1.0 normal, -1.0 inverted)
    this.polarityGainB = this.ctx.createGain();
    this.polarityGainB.gain.value = 1.0;

    // Individual Deck Level & Audition Gains
    this.levelGainA = this.ctx.createGain();
    this.levelGainA.gain.value = 0.707;

    this.levelGainB = this.ctx.createGain();
    this.levelGainB.gain.value = 0.707;

    // Connect Deck A Path:
    // delayNodeA -> levelGainA -> masterGain & deckAAnalyser
    this.delayNodeA.connect(this.levelGainA);
    this.levelGainA.connect(this.masterGain);
    this.levelGainA.connect(this.deckAAnalyser);

    // Connect Deck B Path:
    // delayNodeB -> azimuthFilterB -> saturationShaperB -> polarityGainB -> levelGainB -> masterGain & deckBAnalyser
    this.delayNodeB.connect(this.azimuthFilterB);
    this.azimuthFilterB.connect(this.saturationShaperB);
    this.saturationShaperB.connect(this.polarityGainB);
    this.polarityGainB.connect(this.levelGainB);
    this.levelGainB.connect(this.masterGain);
    this.levelGainB.connect(this.deckBAnalyser);

    // Master Bus to Analyser & Output
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    // 4. Pre-render 1960s stems into volatile RAM AudioBuffers
    this._preRenderStems();

    // Default to Drums stem (rich broadband transients perfect for hearing flanging immediately)
    this.activeBuffer = this.stemBuffers.get('drums');
    this.activeStemId = 'drums';

    this.isInitialized = true;
  }

  /**
   * Pre-renders the 5 authentic 1960s stems into volatile AudioBuffers
   */
  _preRenderStems() {
    this.stemBuffers.set('vocals', FlangeStemGenerator.createVocalStem(this.ctx));
    this.stemBuffers.set('drums', FlangeStemGenerator.createDrumStem(this.ctx));
    this.stemBuffers.set('bass', FlangeStemGenerator.createBassStem(this.ctx));
    this.stemBuffers.set('guitars', FlangeStemGenerator.createGuitarStem(this.ctx));
    this.stemBuffers.set('keys', FlangeStemGenerator.createKeysStem(this.ctx));
    this.stemBuffers.set('noise', FlangeStemGenerator.createNoiseStem(this.ctx));
  }

  /**
   * Generates a smooth tape magnetic hysteresis transfer function (tanh-like soft clip)
   */
  _generateTapeSaturationCurve(amount = 0.5) {
    const nSamples = 2048;
    const curve = new Float32Array(nSamples);
    const k = 1.0 + amount * 3.5; // Drive multiplier

    for (let i = 0; i < nSamples; i++) {
      const x = (i * 2) / nSamples - 1;
      // Soft saturation curve with subtle 3rd-harmonic tape warmth
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  /**
   * Start looping audio playback
   */
  async play() {
    if (!this.isInitialized) {
      await this.init();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (this.isPlaying) {
      this.stop();
    }

    if (!this.activeBuffer) {
      this.activeBuffer = this.stemBuffers.get('drums');
    }

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.activeBuffer;
    this.sourceNode.loop = true;

    // Connect source to both delay lines simultaneously
    this.sourceNode.connect(this.delayNodeA);
    this.sourceNode.connect(this.delayNodeB);

    this.sourceNode.start(0, this.playbackPauseOffset % this.activeBuffer.duration);
    this.playbackStartTime = this.ctx.currentTime - this.playbackPauseOffset;
    this.isPlaying = true;
  }

  /**
   * Stop/Pause audio playback
   */
  stop() {
    if (!this.isPlaying) return;

    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }

    if (this.ctx) {
      this.playbackPauseOffset = this.ctx.currentTime - this.playbackStartTime;
    }
    this.isPlaying = false;
  }

  /**
   * Select a pre-rendered 1960s stem
   * @param {string} stemId 'vocals' | 'drums' | 'bass' | 'guitars' | 'keys' | 'noise'
   */
  selectStem(stemId) {
    if (this.stemBuffers.has(stemId)) {
      this.activeStemId = stemId;
      this.activeBuffer = this.stemBuffers.get(stemId);
      this.customFileName = null;
      this._revokeCustomUrl();

      if (this.isPlaying) {
        this.playbackPauseOffset = 0;
        this.play();
      }
    }
  }

  /**
   * Zero-Persistence local file ingestion from user's hard drive
   * @param {File} file
   */
  async loadCustomFile(file) {
    if (!this.isInitialized) {
      await this.init();
    }

    // Clean previous custom URL if any
    this._revokeCustomUrl();

    const result = await FlangeStemGenerator.loadLocalAudioFile(file, this.ctx);
    this.activeBuffer = result.buffer;
    this.customFileName = result.fileName;
    this.activeStemId = 'custom';

    if (this.isPlaying) {
      this.playbackPauseOffset = 0;
      this.play();
    }

    return {
      fileName: result.fileName,
      duration: result.duration
    };
  }

  /**
   * Update delay line B and dynamic filters from Physics Engine telemetry
   * @param {Object} physicsState
   */
  syncPhysicsState(physicsState) {
    if (!this.ctx || !this.delayNodeB) return;

    const now = this.ctx.currentTime;
    const targetDelaySec = physicsState.delayBSec;

    // Smooth delay modulation to prevent zipper noise while retaining authentic Doppler sweep
    this.delayNodeB.delayTime.setTargetAtTime(targetDelaySec, now, 0.008);

    // Dynamic Azimuth / Head Pressure lowpass filter on Deck B:
    // Dips from 18 kHz down to ~6 kHz under heavy thumb braking friction
    const friction = physicsState.frictionIntensity || 0.0;
    const cutoffHz = 18000 - friction * 12500;
    this.azimuthFilterB.frequency.setTargetAtTime(Math.max(4000, cutoffHz), now, 0.02);
  }

  /**
   * Toggle 180° Polarity Inversion on Deck B
   * @param {boolean} invert
   */
  setPhaseInvert(invert) {
    this.isPhaseInverted = Boolean(invert);
    if (this.polarityGainB && this.ctx) {
      const now = this.ctx.currentTime;
      const targetGain = this.isPhaseInverted ? -1.0 : 1.0;
      this.polarityGainB.gain.setTargetAtTime(targetGain, now, 0.005);
    }
  }

  /**
   * Adjust Wet/Dry Balance (0% = Deck A only, 100% = Balanced Flange)
   * @param {number} mix 0.0 to 1.0
   */
  setWetDryMix(mix) {
    this.wetDryMix = Math.max(0.0, Math.min(1.0, mix));
    this._updateRoutingGains();
  }

  /**
   * Change Audition Mode
   * @param {string} mode 'flange' | 'deckA' | 'deckB' | 'null'
   */
  setAuditionMode(mode) {
    this.auditionMode = mode;
    this._updateRoutingGains();
  }

  /**
   * Internal gain calculation based on audition mode and wet/dry mix
   */
  _updateRoutingGains() {
    if (!this.ctx || !this.levelGainA || !this.levelGainB) return;

    const now = this.ctx.currentTime;
    let targetA = 0.707;
    let targetB = 0.707 * this.wetDryMix;

    if (this.auditionMode === 'deckA') {
      targetA = 0.95;
      targetB = 0.0;
    } else if (this.auditionMode === 'deckB') {
      targetA = 0.0;
      targetB = 0.95;
    } else if (this.auditionMode === 'null') {
      // Null Difference monitor: forces 50/50 balance with inverted phase
      targetA = 0.707;
      targetB = 0.707;
      this.setPhaseInvert(true);
    }

    this.levelGainA.gain.setTargetAtTime(targetA, now, 0.015);
    this.levelGainB.gain.setTargetAtTime(targetB, now, 0.015);
  }

  /**
   * Set Master Volume (0.0 to 1.0)
   * @param {number} vol
   */
  setMasterVolume(vol) {
    if (this.masterGain && this.ctx) {
      const clamped = Math.max(0.0, Math.min(1.0, vol));
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  /**
   * Set Tape Saturation Hysteresis Drive
   * @param {number} amount 0.0 to 1.0
   */
  setTapeSaturation(amount) {
    this.tapeSaturationAmount = Math.max(0.0, Math.min(1.0, amount));
    if (this.saturationShaperB) {
      this.saturationShaperB.curve = this._generateTapeSaturationCurve(this.tapeSaturationAmount);
    }
  }

  /**
   * Cleanup protocol for zero-persistence privacy guarantee
   */
  _revokeCustomUrl() {
    if (this.customObjectUrl) {
      try {
        URL.revokeObjectURL(this.customObjectUrl);
      } catch (_) {}
      this.customObjectUrl = null;
    }
  }

  /**
   * Bind cleanup handler to window.onbeforeunload and pagehide
   */
  _bindUnloadCleanup() {
    const cleanup = () => {
      this.stop();
      this._revokeCustomUrl();
      this.activeBuffer = null;
      this.stemBuffers.clear();
      if (this.ctx && this.ctx.state !== 'closed') {
        try {
          this.ctx.close();
        } catch (_) {}
      }
    };

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
  }

  /**
   * Complete teardown of audio engine
   */
  destroy() {
    this.stop();
    this._revokeCustomUrl();
    this.activeBuffer = null;
    this.stemBuffers.clear();
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        this.ctx.close();
      } catch (_) {}
    }
    this.isInitialized = false;
  }
}

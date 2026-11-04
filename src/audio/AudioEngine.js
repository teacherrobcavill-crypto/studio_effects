import { SoundSynthesizer } from './SoundSynthesizer.js';
import { ImpulseGenerator } from './ImpulseGenerator.js';

const BOUNDARY_IDS = ['left', 'right', 'floor', 'ceiling', 'front', 'back'];

export class AudioEngine {
  constructor(onTransientCallback = null) {
    this.ctx = null;
    this.isInitialized = false;
    this.isPlaying = false;
    this.onTransient = onTransientCallback;

    // Layer enable flags for educational isolation
    this.layers = {
      direct: true,
      earlyReflections: true,
      lateReverb: true
    };

    this.masterVolume = 0.85;
    this.reflectionBranches = {};
    this.lastImpulseSignature = '';
    this.impulseDebounceTimer = null;
  }

  init(initialSolution = null) {
    if (this.isInitialized) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // 1. Source Pre-Bus + Boundary Loading Low-Shelf Filter (Half/Quarter/Eighth-Space boost)
    this.sourceInput = this.ctx.createGain();
    this.sourceInput.gain.value = 1.0;

    this.boundaryShelf = this.ctx.createBiquadFilter();
    this.boundaryShelf.type = 'lowshelf';
    this.boundaryShelf.frequency.value = 135;
    this.boundaryShelf.gain.value = 0;

    this.sourceInput.connect(this.boundaryShelf);

    // 2. Direct Sound Path
    this.directDelay = this.ctx.createDelay(1.0);
    this.directDelay.delayTime.value = 0.008;

    this.directAirFilter = this.ctx.createBiquadFilter();
    this.directAirFilter.type = 'lowpass';
    this.directAirFilter.frequency.value = 16500;

    this.directGain = this.ctx.createGain();
    this.directGain.gain.value = 0.75;

    this.directLayerMute = this.ctx.createGain();
    this.directLayerMute.gain.value = this.layers.direct ? 1.0 : 0.0;

    this.directPanner = this.ctx.createStereoPanner();

    this.boundaryShelf.connect(this.directDelay);
    this.directDelay.connect(this.directAirFilter);
    this.directAirFilter.connect(this.directGain);
    this.directGain.connect(this.directLayerMute);
    this.directLayerMute.connect(this.directPanner);

    // 3. Six Discrete First-Order Image-Source Reflection Paths
    this.earlyReflectionsBus = this.ctx.createGain();
    this.earlyReflectionsBus.gain.value = this.layers.earlyReflections ? 1.0 : 0.0;

    for (const id of BOUNDARY_IDS) {
      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.value = 0.015;

      // 3-band surface absorption filter (125Hz lowshelf, 1kHz peaking, 4kHz highshelf)
      const lowFilter = this.ctx.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      lowFilter.frequency.value = 220;

      const midFilter = this.ctx.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = 1000;
      midFilter.Q.value = 0.8;

      const highFilter = this.ctx.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = 2800;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.18;

      const panner = this.ctx.createStereoPanner();

      this.boundaryShelf.connect(delay);
      delay.connect(lowFilter);
      lowFilter.connect(midFilter);
      midFilter.connect(highFilter);
      highFilter.connect(gain);
      gain.connect(panner);
      panner.connect(this.earlyReflectionsBus);

      this.reflectionBranches[id] = {
        delay,
        lowFilter,
        midFilter,
        highFilter,
        gain,
        panner
      };
    }

    // 4. Initialize Impulse Generator & Late Diffuse Reverberant Field (Sabine / Eyring Convolver)
    this.impulseGen = new ImpulseGenerator(this.ctx);

    this.reverbPreDelay = this.ctx.createDelay(1.0);
    this.reverbPreDelay.delayTime.value = 0.012;

    this.convolver = this.ctx.createConvolver();
    // Always seed a valid initial impulse buffer so ConvolverNode is immediately active
    const defaultReverb = initialSolution?.reverb || {
      eyring: { 125: 0.75, 1000: 0.55, 4000: 0.45 }
    };
    this.convolver.buffer = this.impulseGen.generateImpulseBuffer(
      defaultReverb,
      initialSolution?.itdgMs || 8.0
    );

    this.reverbWetGain = this.ctx.createGain();
    this.reverbWetGain.gain.value = 0.38;

    this.reverbLayerMute = this.ctx.createGain();
    this.reverbLayerMute.gain.value = this.layers.lateReverb ? 1.0 : 0.0;

    this.boundaryShelf.connect(this.reverbPreDelay);
    this.reverbPreDelay.connect(this.convolver);
    this.convolver.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.reverbLayerMute);

    // 5. Master Bus, Dynamics Compressor & Real-time FFT Analyser
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -10;
    this.masterCompressor.knee.value = 12;
    this.masterCompressor.ratio.value = 3.0;
    this.masterCompressor.attack.value = 0.004;
    this.masterCompressor.release.value = 0.15;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    // Connect all 3 acoustic layers into Master Bus
    this.directPanner.connect(this.masterCompressor);
    this.earlyReflectionsBus.connect(this.masterCompressor);
    this.reverbLayerMute.connect(this.masterCompressor);

    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // 6. Initialize Procedural Synthesizer
    this.synth = new SoundSynthesizer(this.ctx, this.sourceInput, (vel) => {
      if (this.onTransient) this.onTransient(vel);
    });

    this.isInitialized = true;

    if (initialSolution) {
      this.updateAcoustics(initialSolution, true);
    }
  }

  async ensureRunning(currentSolution = null) {
    if (!this.isInitialized) {
      this.init(currentSolution);
    }
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  async togglePlay(currentSolution = null, instrumentId = null) {
    await this.ensureRunning(currentSolution);

    if (instrumentId && this.synth) {
      this.synth.setInstrument(instrumentId);
    }

    if (this.isPlaying) {
      this.synth.stop();
      this.isPlaying = false;
    } else {
      if (currentSolution) {
        this.updateAcoustics(currentSolution, true);
      }
      this.synth.start();
      this.isPlaying = true;
    }
    return this.isPlaying;
  }

  async startWithInstrument(instrumentId, currentSolution = null) {
    await this.ensureRunning(currentSolution);
    if (this.synth) {
      this.synth.setInstrument(instrumentId);
    }
    if (!this.isPlaying) {
      if (currentSolution) {
        this.updateAcoustics(currentSolution, true);
      }
      this.synth.start();
      this.isPlaying = true;
    }
    return this.isPlaying;
  }

  async triggerClap(currentSolution = null) {
    await this.ensureRunning(currentSolution);
    if (currentSolution) {
      this.updateAcoustics(currentSolution, false);
    }
    this.synth.triggerSinglePulse();
  }

  setInstrument(instrumentId) {
    if (this.synth) {
      this.synth.setInstrument(instrumentId);
    }
  }

  setLayerEnabled(layerName, enabled) {
    this.layers[layerName] = enabled;
    if (!this.isInitialized) return;

    const now = this.ctx.currentTime;
    if (layerName === 'direct') {
      this.directLayerMute.gain.setTargetAtTime(enabled ? 1.0 : 0.0, now, 0.015);
    } else if (layerName === 'earlyReflections') {
      this.earlyReflectionsBus.gain.setTargetAtTime(enabled ? 1.0 : 0.0, now, 0.015);
    } else if (layerName === 'lateReverb') {
      this.reverbLayerMute.gain.setTargetAtTime(enabled ? 1.0 : 0.0, now, 0.015);
    }
  }

  setMasterVolume(val) {
    this.masterVolume = val;
    if (this.isInitialized) {
      this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Smoothly updates all Web Audio DSP parameters from the physics solver at 60fps.
   */
  updateAcoustics(solution, forceImpulseRebuild = false) {
    if (!this.isInitialized || !solution) return;

    const now = this.ctx.currentTime;
    const tau = 0.028; // 28ms time constant prevents clicks & Doppler zipper noise

    // 1. Boundary Loading Low-Shelf Filter
    this.boundaryShelf.frequency.setTargetAtTime(solution.boundaryLoading.turnoverHz, now, tau);
    this.boundaryShelf.gain.setTargetAtTime(solution.boundaryLoading.boostDb, now, tau);

    // 2. Direct Path (Delay, Distance + Polar Signed Gain, Air Roll-Off, Pan)
    const d = solution.direct;
    const directSignedSign = d.polar.signedGain >= 0 ? 1 : -1;
    // Reference distance normalization so studio positions are loud and clear
    const normScale = 1.85;
    const directLinearGain = directSignedSign * Math.min(1.8, Math.max(0.12, d.gain * normScale));

    this.directDelay.delayTime.setTargetAtTime(Math.min(0.95, d.delaySec), now, tau);
    this.directGain.gain.setTargetAtTime(directLinearGain, now, tau);
    this.directPanner.pan.setTargetAtTime(d.polar.pan, now, tau);

    // Off-axis microphone high-frequency rolloff + air absorption
    const offAxisCutoff = 18000 - (d.polar.angleDeg / 180) * 7500 - d.distance * 180;
    this.directAirFilter.frequency.setTargetAtTime(Math.max(2500, offAxisCutoff), now, tau);

    // 3. Six Specular Early Reflection Paths
    for (const refl of solution.reflections) {
      const branch = this.reflectionBranches[refl.id];
      if (!branch) continue;

      branch.delay.delayTime.setTargetAtTime(Math.min(0.95, refl.arrivalTimeSec), now, tau);

      // Base gain from 1kHz band, preserving phase sign for Figure-8 rear lobe
      const sign = refl.polar.signedGain >= 0 ? 1 : -1;
      const baseGain1k = sign * Math.min(1.3, refl.bandGain[1000] * normScale);
      branch.gain.gain.setTargetAtTime(baseGain1k, now, tau);

      // Relative dB tilt at 125Hz and 4kHz relative to 1kHz reflection coefficient
      const r1k = Math.max(0.05, refl.reflectionCoeff[1000]);
      const lowRatioDb = 20 * Math.log10(Math.max(0.05, refl.reflectionCoeff[125]) / r1k);
      const highRatioDb = 20 * Math.log10(Math.max(0.05, refl.reflectionCoeff[4000]) / r1k);

      branch.lowFilter.gain.setTargetAtTime(Math.max(-24, Math.min(12, lowRatioDb)), now, tau);
      branch.midFilter.gain.setTargetAtTime(0, now, tau);
      branch.highFilter.gain.setTargetAtTime(Math.max(-28, Math.min(12, highRatioDb)), now, tau);
      branch.panner.pan.setTargetAtTime(refl.polar.pan, now, tau);
    }

    // 4. Late Diffuse Reverberant Field Gain & Pre-delay
    const firstArrivalSec = solution.firstReflection
      ? solution.firstReflection.arrivalTimeSec
      : d.delaySec + 0.01;
    this.reverbPreDelay.delayTime.setTargetAtTime(Math.min(0.9, firstArrivalSec), now, tau);

    // Reverberant field strength scales with room reflectance (1 - meanAlpha) and critical distance
    const meanAlpha1k = solution.reverb.meanAlpha[1000];
    const diffuseLevel = Math.min(
      1.25,
      (0.65 * Math.sqrt(Math.max(0.02, 1.0 - meanAlpha1k))) / Math.max(0.65, solution.criticalDistance * 0.45)
    );
    this.reverbWetGain.gain.setTargetAtTime(diffuseLevel, now, tau);

    // 5. Rebuild Sabine Impulse Response Buffer only when room RT60 signature changes
    const rev = solution.reverb.eyring;
    const signature = `${rev[125].toFixed(2)}_${rev[1000].toFixed(2)}_${rev[4000].toFixed(2)}`;
    if (forceImpulseRebuild || signature !== this.lastImpulseSignature) {
      this.lastImpulseSignature = signature;
      if (forceImpulseRebuild) {
        this.convolver.buffer = this.impulseGen.generateImpulseBuffer(solution.reverb, solution.itdgMs);
      } else {
        if (this.impulseDebounceTimer) clearTimeout(this.impulseDebounceTimer);
        this.impulseDebounceTimer = setTimeout(() => {
          if (this.ctx) {
            this.convolver.buffer = this.impulseGen.generateImpulseBuffer(solution.reverb, solution.itdgMs);
          }
        }, 90);
      }
    }
  }

  getAnalyserData() {
    if (!this.isInitialized || !this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    return {
      freqData: this.freqData,
      timeData: this.timeData,
      sampleRate: this.ctx.sampleRate
    };
  }
}

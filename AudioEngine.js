/**
 * @fileoverview Stage 2: Web Audio Routing, Source Manager, Parameter Ramping Bridge & Analyser Interface.
 * Includes automatic inline Blob AudioWorklet fallback so the simulator runs cleanly over HTTP or file://.
 */

const WORKLET_PROCESSOR_SOURCE = `
class PlateReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'decay', defaultValue: 3.2, minValue: 0.2, maxValue: 12.0, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 0.35, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'plateSize', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0, automationRate: 'k-rate' },
      { name: 'material', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'lowCut', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.fsScale = this.fs / 48000.0;
    this.numChannels = 16;
    this.bufferSize = 16384;
    this.bufferMask = 16383;
    this.fdnBuffers = new Float32Array(this.numChannels * this.bufferSize);
    this.writePtr = 0;

    const rawBaseDelays = [
      1051, 1297, 1543, 1723, 1993, 2237, 2503, 2713,
      2999, 3229, 3557, 3833, 4153, 4409, 4691, 5011
    ];
    this.baseDelays = new Float32Array(this.numChannels);
    this.currentDelays = new Float32Array(this.numChannels);
    this.targetDelays = new Float32Array(this.numChannels);
    this.feedbackGains = new Float32Array(this.numChannels);
    this.fdnVector = new Float32Array(this.numChannels);
    this.tapVector = new Float32Array(this.numChannels);

    for (let i = 0; i < this.numChannels; i++) {
      this.baseDelays[i] = rawBaseDelays[i] * this.fsScale;
      this.currentDelays[i] = this.baseDelays[i];
      this.targetDelays[i] = this.baseDelays[i];
      this.feedbackGains[i] = 0.85;
    }

    this.numDiffusers = 4;
    this.diffBufferSize = 1024;
    this.diffBufferMask = 1023;
    this.diffBuffers = new Float32Array(this.numDiffusers * this.diffBufferSize);
    this.diffWritePtr = 0;
    this.diffGain = 0.7;

    const rawDiffDelays = [83, 149, 231, 353];
    this.diffDelays = new Int32Array(this.numDiffusers);
    for (let i = 0; i < this.numDiffusers; i++) {
      this.diffDelays[i] = Math.max(1, Math.min(this.diffBufferMask - 1, Math.round(rawDiffDelays[i] * this.fsScale)));
    }

    this.dispStateX = new Float32Array(this.numChannels);
    this.dispStateY = new Float32Array(this.numChannels);
    this.dispStateX2 = new Float32Array(this.numChannels);
    this.dispStateY2 = new Float32Array(this.numChannels);
    this.dampState = new Float32Array(this.numChannels);

    this.presetDispersionA = new Float32Array([-0.38, -0.15, -0.68, -0.56]);
    this.presetCutoffHz = new Float32Array([4500.0, 1400.0, 9500.0, 6500.0]);
    this.presetHfMultiplier = new Float32Array([1.0, 0.68, 1.35, 1.18]);
    this.presetSizeScale = new Float32Array([1.0, 0.72, 1.12, 0.90]);
    this.presetDiffGain = new Float32Array([0.68, 0.76, 0.55, 0.62]);

    this.toneB0 = new Float32Array(4);
    this.toneB1 = new Float32Array(4);
    this.toneB2 = new Float32Array(4);
    this.toneA1 = new Float32Array(4);
    this.toneA2 = new Float32Array(4);
    this._initMaterialToneFilters();

    this.toneLX1 = 0.0; this.toneLX2 = 0.0; this.toneLY1 = 0.0; this.toneLY2 = 0.0;
    this.toneRX1 = 0.0; this.toneRX2 = 0.0; this.toneRY1 = 0.0; this.toneRY2 = 0.0;

    this.overrideMaterial = -1;
    this.overrideLowCut = -1;

    const f0 = 80.0;
    const w0 = (2.0 * Math.PI * f0) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / Math.SQRT2;
    const a0 = 1.0 + alpha;

    this.hpB0 = ((1.0 + cosW0) * 0.5) / a0;
    this.hpB1 = -(1.0 + cosW0) / a0;
    this.hpB2 = ((1.0 + cosW0) * 0.5) / a0;
    this.hpA1 = (-2.0 * cosW0) / a0;
    this.hpA2 = (1.0 - alpha) / a0;

    this.hpLX1 = 0.0; this.hpLX2 = 0.0; this.hpLY1 = 0.0; this.hpLY2 = 0.0;
    this.hpRX1 = 0.0; this.hpRX2 = 0.0; this.hpRY1 = 0.0; this.hpRY2 = 0.0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'SET_MATERIAL' && typeof data.value === 'number') {
        this.overrideMaterial = Math.max(0, Math.min(3, data.value | 0));
      } else if (data.type === 'SET_LOWCUT' && typeof data.value === 'number') {
        this.overrideLowCut = data.value ? 1 : 0;
      } else if (data.type === 'RESET') {
        this.fdnBuffers.fill(0);
        this.diffBuffers.fill(0);
        this.dispStateX.fill(0);
        this.dispStateY.fill(0);
        this.dispStateX2.fill(0);
        this.dispStateY2.fill(0);
        this.dampState.fill(0);
        this.toneLX1 = 0.0; this.toneLX2 = 0.0; this.toneLY1 = 0.0; this.toneLY2 = 0.0;
        this.toneRX1 = 0.0; this.toneRX2 = 0.0; this.toneRY1 = 0.0; this.toneRY2 = 0.0;
      }
    };
  }

  _initMaterialToneFilters() {
    {
      const A = Math.pow(10.0, 3.5 / 40.0);
      const w0 = (2.0 * Math.PI * 3200.0) / this.fs;
      const cosW = Math.cos(w0);
      const alpha = Math.sin(w0) / (2.0 * 0.9);
      const a0 = 1.0 + alpha / A;
      this.toneB0[0] = (1.0 + alpha * A) / a0;
      this.toneB1[0] = (-2.0 * cosW) / a0;
      this.toneB2[0] = (1.0 - alpha * A) / a0;
      this.toneA1[0] = (-2.0 * cosW) / a0;
      this.toneA2[0] = (1.0 - alpha / A) / a0;
    }
    {
      const w0 = (2.0 * Math.PI * 1900.0) / this.fs;
      const cosW = Math.cos(w0);
      const alpha = Math.sin(w0) / (2.0 * 0.85);
      const a0 = 1.0 + alpha;
      this.toneB0[1] = ((1.0 - cosW) * 0.5 * 1.18) / a0;
      this.toneB1[1] = ((1.0 - cosW) * 1.18) / a0;
      this.toneB2[1] = ((1.0 - cosW) * 0.5 * 1.18) / a0;
      this.toneA1[1] = (-2.0 * cosW) / a0;
      this.toneA2[1] = (1.0 - alpha) / a0;
    }
    {
      const A = Math.pow(10.0, 6.5 / 40.0);
      const w0 = (2.0 * Math.PI * 4200.0) / this.fs;
      const cosW = Math.cos(w0);
      const sinW = Math.sin(w0);
      const alpha = (sinW * 0.5) * Math.sqrt(2.0);
      const twoSqrtAAlpha = 2.0 * Math.sqrt(A) * alpha;
      const a0 = (A + 1.0) - (A - 1.0) * cosW + twoSqrtAAlpha;
      this.toneB0[2] = (A * ((A + 1.0) + (A - 1.0) * cosW + twoSqrtAAlpha) * 0.88) / a0;
      this.toneB1[2] = (-2.0 * A * ((A - 1.0) + (A + 1.0) * cosW) * 0.88) / a0;
      this.toneB2[2] = (A * ((A + 1.0) + (A - 1.0) * cosW - twoSqrtAAlpha) * 0.88) / a0;
      this.toneA1[2] = (2.0 * ((A - 1.0) - (A + 1.0) * cosW)) / a0;
      this.toneA2[2] = ((A + 1.0) - (A - 1.0) * cosW - twoSqrtAAlpha) / a0;
    }
    {
      const A = Math.pow(10.0, 6.5 / 40.0);
      const w0 = (2.0 * Math.PI * 2450.0) / this.fs;
      const cosW = Math.cos(w0);
      const alpha = Math.sin(w0) / (2.0 * 2.4);
      const a0 = 1.0 + alpha / A;
      this.toneB0[3] = ((1.0 + alpha * A) * 0.92) / a0;
      this.toneB1[3] = ((-2.0 * cosW) * 0.92) / a0;
      this.toneB2[3] = ((1.0 - alpha * A) * 0.92) / a0;
      this.toneA1[3] = (-2.0 * cosW) / a0;
      this.toneA2[3] = (1.0 - alpha / A) / a0;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;

    const input = inputs[0];
    const hasInput = input && input.length > 0 && input[0] && input[0].length > 0;
    const inL = hasInput ? input[0] : null;
    const inR = hasInput && input.length > 1 ? input[1] : null;

    const decayParam = Math.max(0.2, Math.min(12.0, parameters.decay[0]));
    const dampingParam = Math.max(0.0, Math.min(1.0, parameters.damping[0]));
    const sizeParam = Math.max(0.5, Math.min(2.0, parameters.plateSize[0]));

    const matParam = this.overrideMaterial >= 0
      ? this.overrideMaterial
      : Math.max(0, Math.min(3, Math.round(parameters.material[0])));

    const lowCutEnabled = this.overrideLowCut >= 0
      ? this.overrideLowCut > 0
      : parameters.lowCut[0] >= 0.5;

    const dispA = this.presetDispersionA[matParam];
    const fCutBase = this.presetCutoffHz[matParam];
    const hfMult = this.presetHfMultiplier[matParam];
    const matSizeScale = this.presetSizeScale[matParam];

    const effectiveT60 = decayParam * (0.65 + 0.35 * hfMult);
    const dampScale = Math.pow(0.16, dampingParam);
    const effectiveFCut = Math.max(350.0, Math.min(16000.0, fCutBase * 1.45 * dampScale));
    const specP = Math.max(0.05, Math.min(0.96, Math.exp((-2.0 * Math.PI * effectiveFCut) / this.fs)));
    const oneMinusP = 1.0 - specP;

    const fsInv3 = -3.0 / (this.fs * effectiveT60);
    const combinedSize = sizeParam * matSizeScale;
    for (let c = 0; c < 16; c++) {
      const targetL = Math.max(64.0, Math.min(15000.0, Math.floor(this.baseDelays[c] * combinedSize)));
      this.targetDelays[c] = targetL;
      const g = Math.pow(10.0, targetL * fsInv3);
      this.feedbackGains[c] = g < 0.9992 ? g : 0.9992;
    }

    const fdnBuffers = this.fdnBuffers;
    const bufferMask = this.bufferMask;
    const currentDelays = this.currentDelays;
    const targetDelays = this.targetDelays;
    const feedbackGains = this.feedbackGains;
    const fdnVector = this.fdnVector;
    const tapVector = this.tapVector;
    const dispStateX = this.dispStateX;
    const dispStateY = this.dispStateY;
    const dispStateX2 = this.dispStateX2;
    const dispStateY2 = this.dispStateY2;
    const dampState = this.dampState;

    const diffBuffers = this.diffBuffers;
    const diffDelays = this.diffDelays;
    const diffMask = this.diffBufferMask;
    const diffG = this.presetDiffGain[matParam];

    const tb0 = this.toneB0[matParam];
    const tb1 = this.toneB1[matParam];
    const tb2 = this.toneB2[matParam];
    const ta1 = this.toneA1[matParam];
    const ta2 = this.toneA2[matParam];

    let writePtr = this.writePtr;
    let diffWritePtr = this.diffWritePtr;
    const delaySmooth = 0.0015;

    for (let s = 0; s < blockSize; s++) {
      let monoIn = 0.0;
      if (inL !== null) {
        monoIn = inR !== null ? (inL[s] + inR[s]) * 0.5 : inL[s];
      }

      let sig = monoIn;
      for (let d = 0; d < 4; d++) {
        const dOffset = d << 10;
        const readIdx = (diffWritePtr - diffDelays[d]) & diffMask;
        const delayed = diffBuffers[dOffset + readIdx];
        const v = sig - diffG * delayed;
        sig = delayed + diffG * v;
        diffBuffers[dOffset + diffWritePtr] = v;
      }
      diffWritePtr = (diffWritePtr + 1) & diffMask;
      const diffusedInput = sig * 0.25;

      for (let j = 0; j < 16; j++) {
        const curL = currentDelays[j] + (targetDelays[j] - currentDelays[j]) * delaySmooth;
        currentDelays[j] = curL;
        const delayInt = curL | 0;
        const frac = curL - delayInt;
        const chanOffset = j << 14;
        const rIdx0 = (writePtr - delayInt) & bufferMask;
        const rIdx1 = (rIdx0 - 1) & bufferMask;
        const s0 = fdnBuffers[chanOffset + rIdx0];
        const s1 = fdnBuffers[chanOffset + rIdx1];
        const delayedSample = s0 + frac * (s1 - s0);

        const disp1 = dispA * delayedSample + dispStateX[j] - dispA * dispStateY[j];
        dispStateX[j] = delayedSample;
        dispStateY[j] = disp1;

        const dispOut = dispA * disp1 + dispStateX2[j] - dispA * dispStateY2[j];
        dispStateX2[j] = disp1;
        dispStateY2[j] = dispOut;

        const dampOut = oneMinusP * dispOut + specP * dampState[j];
        dampState[j] = dampOut + 1e-20 - 1e-20;

        tapVector[j] = dampOut;
        fdnVector[j] = dampOut;
      }

      for (let j = 0; j < 16; j += 2) {
        const u = fdnVector[j];
        const v = fdnVector[j + 1];
        fdnVector[j] = u + v;
        fdnVector[j + 1] = u - v;
      }
      for (let j = 0; j < 16; j += 4) {
        const u0 = fdnVector[j];
        const v0 = fdnVector[j + 2];
        fdnVector[j] = u0 + v0;
        fdnVector[j + 2] = u0 - v0;
        const u1 = fdnVector[j + 1];
        const v1 = fdnVector[j + 3];
        fdnVector[j + 1] = u1 + v1;
        fdnVector[j + 3] = u1 - v1;
      }
      for (let j = 0; j < 16; j += 8) {
        for (let k = 0; k < 4; k++) {
          const idx = j + k;
          const u = fdnVector[idx];
          const v = fdnVector[idx + 4];
          fdnVector[idx] = u + v;
          fdnVector[idx + 4] = u - v;
        }
      }
      for (let j = 0; j < 8; j++) {
        const u = fdnVector[j];
        const v = fdnVector[j + 8];
        fdnVector[j] = (u + v) * 0.25;
        fdnVector[j + 8] = (u - v) * 0.25;
      }

      for (let j = 0; j < 16; j++) {
        const inSign = (j & 1) === 0 ? diffusedInput : -diffusedInput;
        fdnBuffers[(j << 14) + writePtr] = inSign + fdnVector[j] * feedbackGains[j];
      }
      writePtr = (writePtr + 1) & bufferMask;

      let rawL = (tapVector[2] - tapVector[6] + tapVector[10] - tapVector[14]) * 0.72;
      let rawR = (tapVector[3] - tapVector[7] + tapVector[11] - tapVector[15]) * 0.72;

      const voicedL = tb0 * rawL + tb1 * this.toneLX1 + tb2 * this.toneLX2
        - ta1 * this.toneLY1 - ta2 * this.toneLY2;
      this.toneLX2 = this.toneLX1; this.toneLX1 = rawL; this.toneLY2 = this.toneLY1; this.toneLY1 = voicedL;
      rawL = voicedL;

      const voicedR = tb0 * rawR + tb1 * this.toneRX1 + tb2 * this.toneRX2
        - ta1 * this.toneRY1 - ta2 * this.toneRY2;
      this.toneRX2 = this.toneRX1; this.toneRX1 = rawR; this.toneRY2 = this.toneRY1; this.toneRY1 = voicedR;
      rawR = voicedR;

      if (lowCutEnabled) {
        const hpL = this.hpB0 * rawL + this.hpB1 * this.hpLX1 + this.hpB2 * this.hpLX2
          - this.hpA1 * this.hpLY1 - this.hpA2 * this.hpLY2;
        this.hpLX2 = this.hpLX1; this.hpLX1 = rawL; this.hpLY2 = this.hpLY1; this.hpLY1 = hpL;
        rawL = hpL;

        const hpR = this.hpB0 * rawR + this.hpB1 * this.hpRX1 + this.hpB2 * this.hpRX2
          - this.hpA1 * this.hpRY1 - this.hpA2 * this.hpRY2;
        this.hpRX2 = this.hpRX1; this.hpRX1 = rawR; this.hpRY2 = this.hpRY1; this.hpRY1 = hpR;
        rawR = hpR;
      }

      outL[s] = Math.tanh(rawL);
      outR[s] = Math.tanh(rawR);
    }

    this.writePtr = writePtr;
    this.diffWritePtr = diffWritePtr;
    return true;
  }
}
registerProcessor('plate-reverb-processor', PlateReverbProcessor);
`;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isPowered = false;

    // Audio Graph Nodes
    this.inputGainNode = null;
    this.inputAnalyser = null;
    this.preDelayNode = null;
    this.reverbWorkletNode = null;
    this.wetGainNode = null;
    this.dryGainNode = null;
    this.outputGainNode = null;
    this.outputAnalyser = null;

    // Active Source State
    this.sourceType = 'impulse'; // 'mic' | 'impulse' | 'stem' | 'file'
    this.impulseSubType = 'rimshot'; // 'click' | 'noise' | 'rimshot'
    this.stemSubType = 'drums'; // 'drums' | 'guitar' | 'vocal'
    this.activeBufferSource = null;
    this.micStream = null;
    this.micSourceNode = null;
    this.isLoopPlaying = false;

    // Pre-generated procedural AudioBuffers
    this.impulseBuffers = {
      click: null,
      noise: null,
      rimshot: null
    };
    this.stemBuffers = {
      drums: null,
      guitar: null,
      vocal: null
    };
    this.customFileBuffer = null;
    this.customFileName = '';

    // Current DSP Parameter State
    this.params = {
      inputGainDb: 0.0,
      preDelayMs: 18.0,
      decaySeconds: 3.2,
      damping: 0.35,
      plateSize: 1.0,
      material: 0,
      lowCut: true,
      wetDryMix: 0.50,
      outputGainDb: 0.0
    };

    // Pre-allocated typed arrays for zero-GC telemetry polling
    this.inputTimeData = new Float32Array(1024);
    this.outputTimeData = new Float32Array(1024);
    this.outputFreqData = new Uint8Array(512);
    this.modalEnergies = new Float32Array(16);

    this.telemetry = {
      inputRms: 0.0,
      inputPeak: 0.0,
      inputDb: -60.0,
      outputRms: 0.0,
      outputPeak: 0.0,
      outputDb: -60.0,
      modalEnergies: this.modalEnergies
    };
  }

  async init() {
    if (this.isInitialized) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({
      latencyHint: 'interactive',
      sampleRate: 48000
    });

    // Load AudioWorklet module with automatic inline Blob fallback
    try {
      await this.ctx.audioWorklet.addModule('plate-reverb-processor.js');
    } catch (err) {
      const blob = new Blob([WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
    }

    // -------------------------------------------------------------------------
    // Build Web Audio Signal Graph
    // -------------------------------------------------------------------------
    this.inputGainNode = this.ctx.createGain();
    this.inputAnalyser = this.ctx.createAnalyser();
    this.inputAnalyser.fftSize = 1024;
    this.inputAnalyser.smoothingTimeConstant = 0.65;

    this.preDelayNode = this.ctx.createDelay(0.5);
    this.reverbWorkletNode = new AudioWorkletNode(this.ctx, 'plate-reverb-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.wetGainNode = this.ctx.createGain();
    this.dryGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();

    this.outputAnalyser = this.ctx.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = 0.75;

    // Connect Wet Path: Input Gain -> Input Analyser -> Pre-Delay -> PlateReverbWorklet -> Wet Gain
    this.inputGainNode.connect(this.inputAnalyser);
    this.inputGainNode.connect(this.preDelayNode);
    this.preDelayNode.connect(this.reverbWorkletNode);
    this.reverbWorkletNode.connect(this.wetGainNode);

    // Connect Dry Path: Input Gain -> Dry Gain
    this.inputGainNode.connect(this.dryGainNode);

    // Sum Wet + Dry -> Output Gain -> Output Analyser -> Destination
    this.wetGainNode.connect(this.outputGainNode);
    this.dryGainNode.connect(this.outputGainNode);
    this.outputGainNode.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.ctx.destination);

    // Synthesize built-in procedural impulses and stems
    this._synthesizeImpulses();
    this._synthesizeProceduralStems();

    // Apply initial parameter values
    this.setGain(this.params.inputGainDb);
    this.setPreDelay(this.params.preDelayMs);
    this.setDecay(this.params.decaySeconds);
    this.setDamping(this.params.damping);
    this.setPlateSize(this.params.plateSize);
    this.setMaterial(this.params.material);
    this.setLowCut(this.params.lowCut);
    this.setWetDry(this.params.wetDryMix);
    this.setOutputLevel(this.params.outputGainDb);

    this.isInitialized = true;
    this.isPowered = true;
  }

  async setPower(powered) {
    if (!this.isInitialized) {
      if (powered) await this.init();
      return;
    }
    this.isPowered = powered;
    if (powered) {
      await this.ctx.resume();
      this.setOutputLevel(this.params.outputGainDb);
    } else {
      this.stopLoop();
      this._disconnectMic();
      this.outputGainNode.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.015);
    }
  }

  // ---------------------------------------------------------------------------
  // Click-Free Parameter Ramping (tau = 0.015s)
  // ---------------------------------------------------------------------------
  setGain(db) {
    this.params.inputGainDb = Math.max(-24.0, Math.min(12.0, db));
    if (!this.isInitialized) return;
    const linear = Math.pow(10.0, this.params.inputGainDb / 20.0);
    this.inputGainNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  setPreDelay(ms) {
    this.params.preDelayMs = Math.max(0.0, Math.min(250.0, ms));
    if (!this.isInitialized) return;
    const seconds = this.params.preDelayMs / 1000.0;
    this.preDelayNode.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.015);
  }

  setDecay(seconds) {
    this.params.decaySeconds = Math.max(0.2, Math.min(12.0, seconds));
    if (!this.isInitialized) return;
    const param = this.reverbWorkletNode.parameters.get('decay');
    param.setTargetAtTime(this.params.decaySeconds, this.ctx.currentTime, 0.015);
  }

  setDamping(normValue) {
    this.params.damping = Math.max(0.0, Math.min(1.0, normValue));
    if (!this.isInitialized) return;
    const param = this.reverbWorkletNode.parameters.get('damping');
    param.setTargetAtTime(this.params.damping, this.ctx.currentTime, 0.015);
  }

  setPlateSize(scale) {
    this.params.plateSize = Math.max(0.5, Math.min(2.0, scale));
    if (!this.isInitialized) return;
    const param = this.reverbWorkletNode.parameters.get('plateSize');
    param.setTargetAtTime(this.params.plateSize, this.ctx.currentTime, 0.015);
  }

  setMaterial(index) {
    const idx = Math.max(0, Math.min(3, index | 0));
    this.params.material = idx;
    if (!this.isInitialized) return;
    const param = this.reverbWorkletNode.parameters.get('material');
    param.setValueAtTime(idx, this.ctx.currentTime);
    this.reverbWorkletNode.port.postMessage({ type: 'SET_MATERIAL', value: idx });
  }

  setLowCut(enabled) {
    this.params.lowCut = Boolean(enabled);
    if (!this.isInitialized) return;
    const val = this.params.lowCut ? 1 : 0;
    const param = this.reverbWorkletNode.parameters.get('lowCut');
    param.setValueAtTime(val, this.ctx.currentTime);
    this.reverbWorkletNode.port.postMessage({ type: 'SET_LOWCUT', value: val });
  }

  setWetDry(mixNorm) {
    this.params.wetDryMix = Math.max(0.0, Math.min(1.0, mixNorm));
    if (!this.isInitialized) return;
    // Equal-Power Crossfade: Dry = cos(mix * 0.5 * pi), Wet = sin(mix * 0.5 * pi)
    const angle = this.params.wetDryMix * 0.5 * Math.PI;
    const dryGain = Math.cos(angle);
    const wetGain = Math.sin(angle);
    this.dryGainNode.gain.setTargetAtTime(dryGain, this.ctx.currentTime, 0.015);
    this.wetGainNode.gain.setTargetAtTime(wetGain, this.ctx.currentTime, 0.015);
  }

  setOutputLevel(db) {
    this.params.outputGainDb = Math.max(-24.0, Math.min(6.0, db));
    if (!this.isInitialized || !this.isPowered) return;
    const linear = Math.pow(10.0, this.params.outputGainDb / 20.0);
    this.outputGainNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  // ---------------------------------------------------------------------------
  // Built-In Input Sources & Playback Control
  // ---------------------------------------------------------------------------
  async setSourceType(type) {
    if (!this.isInitialized) await this.init();
    this.stopLoop();
    if (type !== 'mic') {
      this._disconnectMic();
    }
    this.sourceType = type;

    if (type === 'mic') {
      await this._connectMic();
    }
  }

  async _connectMic() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      this.micSourceNode = this.ctx.createMediaStreamSource(this.micStream);
      this.micSourceNode.connect(this.inputGainNode);
      return true;
    } catch (err) {
      console.warn('Microphone access denied or unavailable:', err);
      throw err;
    }
  }

  _disconnectMic() {
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (_) {}
      this.micSourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  async triggerImpulse(subType = this.impulseSubType) {
    if (!this.isInitialized) await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.impulseSubType = subType;
    const buf = this.impulseBuffers[subType] || this.impulseBuffers.rimshot;
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.inputGainNode);
    src.start();
  }

  async toggleLoopPlayback() {
    if (!this.isInitialized) await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    if (this.isLoopPlaying) {
      this.stopLoop();
      return false;
    } else {
      return this.startLoop();
    }
  }

  startLoop() {
    this.stopLoop();
    let bufferToPlay = null;

    if (this.sourceType === 'file' && this.customFileBuffer) {
      bufferToPlay = this.customFileBuffer;
    } else if (this.sourceType === 'stem') {
      bufferToPlay = this.stemBuffers[this.stemSubType] || this.stemBuffers.drums;
    } else if (this.sourceType === 'impulse') {
      this.triggerImpulse(this.impulseSubType);
      return false;
    }

    if (!bufferToPlay) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = bufferToPlay;
    src.loop = true;
    src.connect(this.inputGainNode);
    src.start(0);
    this.activeBufferSource = src;
    this.isLoopPlaying = true;
    return true;
  }

  stopLoop() {
    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch (_) {}
      this.activeBufferSource = null;
    }
    this.isLoopPlaying = false;
  }

  async loadAudioFile(file) {
    if (!this.isInitialized) await this.init();
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

    const decodedBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.customFileBuffer = decodedBuffer;
    this.customFileName = file.name;
    this.sourceType = 'file';
    this.startLoop();
    return decodedBuffer;
  }

  // ---------------------------------------------------------------------------
  // Procedural Synthesis for Impulses & Dry Studio Stems (Zero External Deps)
  // ---------------------------------------------------------------------------
  _synthesizeImpulses() {
    const fs = this.ctx.sampleRate;

    // 1. Dirac Delta Click + Short High-Frequency Spark
    const clickLen = Math.floor(fs * 0.04);
    const clickBuf = this.ctx.createBuffer(2, clickLen, fs);
    for (let ch = 0; ch < 2; ch++) {
      const data = clickBuf.getChannelData(ch);
      data[0] = 1.0;
      data[1] = -0.45;
      data[2] = 0.2;
      for (let i = 3; i < 64; i++) {
        data[i] = Math.exp(-i * 0.15) * (Math.random() * 2.0 - 1.0) * 0.35;
      }
    }
    this.impulseBuffers.click = clickBuf;

    // 2. White Noise Burst (15 ms exponentially decaying)
    const noiseLen = Math.floor(fs * 0.08);
    const noiseBuf = this.ctx.createBuffer(2, noiseLen, fs);
    const tauSamples = 0.015 * fs;
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuf.getChannelData(ch);
      for (let i = 0; i < noiseLen; i++) {
        const env = Math.exp(-i / tauSamples);
        data[i] = (Math.random() * 2.0 - 1.0) * env * 0.9;
      }
    }
    this.impulseBuffers.noise = noiseBuf;

    // 3. Acoustic Rimshot Transient (Pitched membrane 180 Hz -> 60 Hz + filtered wood snap)
    const rimLen = Math.floor(fs * 0.18);
    const rimBuf = this.ctx.createBuffer(2, rimLen, fs);
    let phase = 0.0;
    let bpZ1 = 0.0;
    let bpZ2 = 0.0;
    for (let i = 0; i < rimLen; i++) {
      const t = i / fs;
      const freq = 60.0 + 120.0 * Math.exp(-t * 65.0);
      phase += (2.0 * Math.PI * freq) / fs;
      const body = Math.sin(phase) * Math.exp(-t * 28.0);
      const overtone = Math.sin(phase * 2.75) * Math.exp(-t * 55.0) * 0.45;

      const rawNoise = (Math.random() * 2.0 - 1.0) * Math.exp(-t * 95.0);
      // Resonant woody snap around 1.8 kHz
      const snap = rawNoise - 0.7 * bpZ1 + 0.35 * bpZ2;
      bpZ2 = bpZ1;
      bpZ1 = snap;

      const sample = Math.tanh((body * 0.8 + overtone + snap * 0.75) * 1.4);
      rimBuf.getChannelData(0)[i] = sample;
      rimBuf.getChannelData(1)[i] = sample;
    }
    this.impulseBuffers.rimshot = rimBuf;
  }

  _synthesizeProceduralStems() {
    const fs = this.ctx.sampleRate;

    // 1. Dry Drum Groove (4-bar 1950s Studio Kit: Kick, Snare, Rim, Brushed Hat at 110 BPM)
    const bpm = 110;
    const beatSec = 60.0 / bpm;
    const barSec = beatSec * 4.0;
    const drumDuration = barSec * 2.0;
    const drumSamples = Math.floor(fs * drumDuration);
    const drumBuf = this.ctx.createBuffer(2, drumSamples, fs);
    const dL = drumBuf.getChannelData(0);
    const dR = drumBuf.getChannelData(1);

    const sixteenthSec = beatSec * 0.25;
    for (let step = 0; step < 32; step++) {
      const stepStart = Math.floor(step * sixteenthSec * fs);

      // Kick on 0, 6, 8, 16, 22, 24
      if (step === 0 || step === 6 || step === 8 || step === 16 || step === 22 || step === 24) {
        let p = 0;
        const len = Math.min(Math.floor(fs * 0.32), drumSamples - stepStart);
        for (let i = 0; i < len; i++) {
          const t = i / fs;
          const f = 52.0 + 95.0 * Math.exp(-t * 42.0);
          p += (2.0 * Math.PI * f) / fs;
          const s = Math.sin(p) * Math.exp(-t * 11.5) * 0.85;
          dL[stepStart + i] += s;
          dR[stepStart + i] += s;
        }
      }

      // Snare / Rim on backbeats 4, 12, 20, 28 + ghost note on 15, 30
      if (step === 4 || step === 12 || step === 20 || step === 28 || step === 15 || step === 30) {
        const vel = (step === 15 || step === 30) ? 0.32 : 0.9;
        let p = 0;
        const len = Math.min(Math.floor(fs * 0.22), drumSamples - stepStart);
        for (let i = 0; i < len; i++) {
          const t = i / fs;
          const f = 145.0 + 90.0 * Math.exp(-t * 50.0);
          p += (2.0 * Math.PI * f) / fs;
          const tone = (Math.sin(p) + 0.4 * Math.sin(p * 1.85)) * Math.exp(-t * 24.0);
          const wires = (Math.random() * 2.0 - 1.0) * Math.exp(-t * 20.0) * 0.65;
          const s = Math.tanh((tone + wires) * vel);
          dL[stepStart + i] += s;
          dR[stepStart + i] += s;
        }
      }

      // Hi-hat every eighth note (even steps)
      if ((step & 1) === 0) {
        const accent = (step % 4 === 0) ? 0.28 : 0.16;
        const len = Math.min(Math.floor(fs * 0.07), drumSamples - stepStart);
        let prev = 0;
        for (let i = 0; i < len; i++) {
          const t = i / fs;
          const n = (Math.random() * 2.0 - 1.0);
          const hp = n - prev;
          prev = n;
          const s = hp * Math.exp(-t * 48.0) * accent;
          dL[stepStart + i] += s;
          dR[stepStart + i] += s;
        }
      }
    }
    this.stemBuffers.drums = drumBuf;

    // 2. Dry Pluck / Archtop Guitar Chord Sequence (Karplus-Strong / Harmonic Pluck)
    const gtrDuration = 6.4;
    const gtrSamples = Math.floor(fs * gtrDuration);
    const gtrBuf = this.ctx.createBuffer(2, gtrSamples, fs);
    const gL = gtrBuf.getChannelData(0);
    const gR = gtrBuf.getChannelData(1);

    const chords = [
      [110.0, 164.81, 220.0, 261.63, 329.63], // Am7
      [146.83, 220.0, 293.66, 349.23, 440.0], // Dm7
      [98.0, 196.0, 246.94, 293.66, 349.23],  // G7
      [130.81, 196.0, 246.94, 329.63, 392.0]  // Cmaj7
    ];

    chords.forEach((chord, cIdx) => {
      const chordStart = cIdx * 1.6;
      chord.forEach((freq, nIdx) => {
        const noteStart = Math.floor((chordStart + nIdx * 0.065) * fs);
        const noteLen = Math.min(Math.floor(fs * 1.35), gtrSamples - noteStart);
        const pan = 0.35 + (nIdx / chord.length) * 0.3;
        for (let i = 0; i < noteLen; i++) {
          const t = i / fs;
          let val = 0.0;
          for (let h = 1; h <= 6; h++) {
            const hDecay = Math.exp(-t * (2.8 + h * 1.9));
            val += (Math.sin(2.0 * Math.PI * freq * h * t) / h) * hDecay;
          }
          const pick = (Math.random() * 2.0 - 1.0) * Math.exp(-t * 140.0) * 0.25;
          const out = (val * 0.32 + pick);
          gL[noteStart + i] += out * (1.0 - pan * 0.4);
          gR[noteStart + i] += out * (0.6 + pan * 0.4);
        }
      });
    });
    this.stemBuffers.guitar = gtrBuf;

    // 3. Dry Vocal Formant Synth Phrase (Expressive vibrato + vowel formants)
    const vocDuration = 6.0;
    const vocSamples = Math.floor(fs * vocDuration);
    const vocBuf = this.ctx.createBuffer(2, vocSamples, fs);
    const vL = vocBuf.getChannelData(0);
    const vR = vocBuf.getChannelData(1);

    const notes = [
      { start: 0.1, dur: 1.2, f0: 220.0, f1: 730, f2: 1090 }, // 'Ah' A3
      { start: 1.5, dur: 1.1, f0: 261.63, f1: 530, f2: 1840 }, // 'Eh' C4
      { start: 2.8, dur: 1.3, f0: 293.66, f1: 390, f2: 1990 }, // 'Ee' D4
      { start: 4.3, dur: 1.3, f0: 220.0, f1: 570, f2: 840 }   // 'Oh' A3
    ];

    notes.forEach((n) => {
      const startIdx = Math.floor(n.start * fs);
      const len = Math.min(Math.floor(n.dur * fs), vocSamples - startIdx);
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const t = i / fs;
        const env = Math.sin(Math.PI * Math.min(1.0, t / 0.08)) * Math.exp(-Math.max(0, t - (n.dur - 0.25)) * 10.0);
        const vib = Math.sin(2.0 * Math.PI * 5.4 * t) * 2.5 * Math.min(1.0, t / 0.3);
        const f = n.f0 + vib;
        phase += (2.0 * Math.PI * f) / fs;

        // Glottal pulse harmonics shaped around formants F1 and F2
        let sig = 0.0;
        for (let h = 1; h <= 12; h++) {
          const hf = f * h;
          const d1 = (hf - n.f1) / 140.0;
          const d2 = (hf - n.f2) / 220.0;
          const formantGain = 0.25 / h + Math.exp(-0.5 * d1 * d1) * 0.9 + Math.exp(-0.5 * d2 * d2) * 0.55;
          sig += Math.sin(phase * h) * formantGain;
        }
        const sample = sig * env * 0.16;
        vL[startIdx + i] += sample;
        vR[startIdx + i] += sample;
      }
    });
    this.stemBuffers.vocal = vocBuf;
  }

  // ---------------------------------------------------------------------------
  // Zero-GC Real-Time Audio Telemetry Polling (for VU Meters & 3D Plate Modes)
  // ---------------------------------------------------------------------------
  getTelemetry() {
    if (!this.isInitialized || !this.isPowered) {
      this.telemetry.inputRms = 0;
      this.telemetry.inputPeak = 0;
      this.telemetry.inputDb = -60;
      this.telemetry.outputRms = 0;
      this.telemetry.outputPeak = 0;
      this.telemetry.outputDb = -60;
      this.modalEnergies.fill(0);
      return this.telemetry;
    }

    this.inputAnalyser.getFloatTimeDomainData(this.inputTimeData);
    this.outputAnalyser.getFloatTimeDomainData(this.outputTimeData);
    this.outputAnalyser.getByteFrequencyData(this.outputFreqData);

    let inSum = 0.0;
    let inPeak = 0.0;
    let outSum = 0.0;
    let outPeak = 0.0;

    const len = this.inputTimeData.length;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(this.inputTimeData[i]);
      inSum += a * a;
      if (a > inPeak) inPeak = a;

      const b = Math.abs(this.outputTimeData[i]);
      outSum += b * b;
      if (b > outPeak) outPeak = b;
    }

    const inRms = Math.sqrt(inSum / len);
    const outRms = Math.sqrt(outSum / len);

    this.telemetry.inputRms = inRms;
    this.telemetry.inputPeak = inPeak;
    this.telemetry.inputDb = inRms > 0.00001 ? Math.max(-60.0, 20.0 * Math.log10(inRms * 1.414)) : -60.0;

    this.telemetry.outputRms = outRms;
    this.telemetry.outputPeak = outPeak;
    this.telemetry.outputDb = outRms > 0.00001 ? Math.max(-60.0, 20.0 * Math.log10(outRms * 1.414)) : -60.0;

    // Populate 16 modal energy bands (4x4 spatial standing wave grid)
    for (let m = 0; m < 16; m++) {
      const startBin = 2 + m * 12;
      let binSum = 0.0;
      for (let k = 0; k < 12; k++) {
        binSum += this.outputFreqData[startBin + k];
      }
      const norm = binSum / (12.0 * 255.0);
      this.modalEnergies[m] = this.modalEnergies[m] * 0.78 + norm * 0.22;
    }

    return this.telemetry;
  }
}

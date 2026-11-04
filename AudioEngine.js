/**
 * @fileoverview Stage 2: Web Audio Routing, Source Manager, Parameter Ramping Bridge & Analyser Interface
 * for Module 3: Electro-Mechanical Reverbs (EMT-140 Plate Reverb & Classic Tube-Driven Spring Reverb Tank).
 * Includes automatic inline Blob AudioWorklet fallbacks so both simulators run cleanly over HTTP or file://.
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

const SPRING_WORKLET_PROCESSOR_SOURCE = `
class SpringReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'topology', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tankEra', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'wireRadiusMm', defaultValue: 0.25, minValue: 0.12, maxValue: 0.50, automationRate: 'k-rate' },
      { name: 'helixRadiusMm', defaultValue: 3.0, minValue: 1.5, maxValue: 6.0, automationRate: 'k-rate' },
      { name: 'wireLengthM', defaultValue: 2.65, minValue: 1.0, maxValue: 5.5, automationRate: 'k-rate' },
      { name: 'dwell', defaultValue: 0.65, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 0.62, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.55, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'acousticFeedback', defaultValue: 0.28, minValue: 0.0, maxValue: 0.95, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.rho = 7800.0;
    this.E = 200.0e9;
    this.waveSpeedSteel = Math.sqrt(this.E / this.rho);
    this.springLengthRatios = new Float32Array([1.0, 0.8728]);

    this.delayBufSize = 32768;
    this.delayBufMask = 32767;
    this.springDelayBuf1 = new Float32Array(this.delayBufSize);
    this.springDelayBuf2 = new Float32Array(this.delayBufSize);
    this.delayWritePtr = 0;

    this.curDelay1 = 3300.0;
    this.curDelay2 = 2880.0;

    this.numDispStages = 32;
    this.dispX1_S1 = new Float32Array(this.numDispStages);
    this.dispY1_S1 = new Float32Array(this.numDispStages);
    this.dispX2_S1 = new Float32Array(this.numDispStages);
    this.dispY2_S1 = new Float32Array(this.numDispStages);

    this.dispX1_S2 = new Float32Array(this.numDispStages);
    this.dispY1_S2 = new Float32Array(this.numDispStages);
    this.dispX2_S2 = new Float32Array(this.numDispStages);
    this.dispY2_S2 = new Float32Array(this.numDispStages);

    this.scatBufSize = 512;
    this.scatBufMask = 511;
    this.scatBuf1 = new Float32Array(4 * this.scatBufSize);
    this.scatBuf2 = new Float32Array(4 * this.scatBufSize);
    this.scatWritePtr = 0;
    this.scatDelays1 = new Int32Array([29, 67, 113, 179]);
    this.scatDelays2 = new Int32Array([37, 79, 131, 197]);

    this.vState1 = 0.0;
    this.vState2 = 0.0;
    this.lpState1 = 0.0;
    this.lpState2 = 0.0;
    this.dcX1 = 0.0;
    this.dcY1 = 0.0;
    this.dcX2 = 0.0;
    this.dcY2 = 0.0;

    this.xfmrFlux = 0.0;
    this.xfmrHpX = 0.0;
    this.xfmrHpY = 0.0;

    this.toneLpL = 0.0;
    this.toneLpR = 0.0;

    this.acoustBufSize = 4096;
    this.acoustBufMask = 4095;
    this.acoustBuf = new Float32Array(this.acoustBufSize);
    this.acoustWritePtr = 0;
    this.acoustBpY1 = 0.0;
    this.acoustBpY2 = 0.0;

    this.kickExciteAmp = 0.0;
    this.kickPhase = 0.0;

    this.overrideTopology = -1;
    this.overrideTankEra = -1;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'SET_TOPOLOGY' && typeof data.value === 'number') {
        this.overrideTopology = data.value | 0;
      } else if (data.type === 'SET_TANK_ERA' && typeof data.value === 'number') {
        this.overrideTankEra = data.value | 0;
      } else if (data.type === 'KICK_TANK') {
        this.kickExciteAmp = 1.0;
        this.kickPhase = 0.0;
      } else if (data.type === 'RESET') {
        this.springDelayBuf1.fill(0);
        this.springDelayBuf2.fill(0);
        this.dispX1_S1.fill(0);
        this.dispY1_S1.fill(0);
        this.dispX2_S1.fill(0);
        this.dispY2_S1.fill(0);
        this.dispX1_S2.fill(0);
        this.dispY1_S2.fill(0);
        this.dispX2_S2.fill(0);
        this.dispY2_S2.fill(0);
        this.acoustBuf.fill(0);
      }
    };
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

    const topology = this.overrideTopology >= 0
      ? this.overrideTopology
      : Math.round(parameters.topology[0]);
    const tankEra = this.overrideTankEra >= 0
      ? this.overrideTankEra
      : Math.round(parameters.tankEra[0]);

    const r_m = Math.max(0.12e-3, Math.min(0.50e-3, parameters.wireRadiusMm[0] * 1e-3));
    const R_m = Math.max(1.5e-3, Math.min(6.0e-3, parameters.helixRadiusMm[0] * 1e-3));
    const L_m = Math.max(1.0, Math.min(5.5, parameters.wireLengthM[0]));

    const T_D = ((4.0 * L_m * R_m) / r_m) / this.waveSpeedSteel;
    const F_c = ((3.0 * r_m) / (16.0 * Math.sqrt(5.0) * Math.PI * R_m * R_m)) * this.waveSpeedSteel;
    const kappa = Math.min(0.45, r_m / (R_m * 1.25));

    const dispGroupDelaySamples = this.numDispStages * 2.2;
    const rawSamples1 = Math.max(128.0, Math.min(30000.0, T_D * this.fs * this.springLengthRatios[0] - dispGroupDelaySamples));
    const rawSamples2 = Math.max(128.0, Math.min(30000.0, T_D * this.fs * this.springLengthRatios[1] - dispGroupDelaySamples));

    let baseFeedback = 0.855;
    let dampCutoffHz = 3900.0;
    let dualSpringMix = 1.0;

    if (tankEra === 1) {
      baseFeedback = 0.72;
      dampCutoffHz = 1850.0;
      dualSpringMix = 0.85;
    } else if (tankEra === 2) {
      baseFeedback = 0.78;
      dampCutoffHz = 3100.0;
      dualSpringMix = 0.0;
    }

    const effectiveDwell = topology === 0 ? parameters.dwell[0] : 0.60;
    const effectiveTone = topology === 0 ? parameters.tone[0] : 0.58;
    const mixParam = parameters.mix[0];
    const acoustFbParam = topology === 1
      ? Math.max(0.18, parameters.acousticFeedback[0])
      : parameters.acousticFeedback[0] * 0.25;

    const fcClamped = Math.max(600.0, Math.min(7500.0, F_c));
    const wFc = (2.0 * Math.PI * fcClamped) / this.fs;
    const apRadius = 0.86;
    const a1Disp = -2.0 * apRadius * Math.cos(wFc * 0.68);
    const a2Disp = apRadius * apRadius;

    const lpPole = Math.exp((-2.0 * Math.PI * dampCutoffHz) / this.fs);
    const oneMinusLp = 1.0 - lpPole;

    const toneFreq = 1100.0 + effectiveTone * effectiveTone * 6800.0;
    const toneAlpha = 1.0 - Math.exp((-2.0 * Math.PI * toneFreq) / this.fs);

    const wAcoust = (2.0 * Math.PI * 125.0) / this.fs;
    const rAcoust = 0.965;
    const b1Acoust = -2.0 * rAcoust * Math.cos(wAcoust);
    const b2Acoust = rAcoust * rAcoust;

    const springDelayBuf1 = this.springDelayBuf1;
    const springDelayBuf2 = this.springDelayBuf2;
    const delayMask = this.delayBufMask;

    const dispX1_S1 = this.dispX1_S1;
    const dispY1_S1 = this.dispY1_S1;
    const dispX2_S1 = this.dispX2_S1;
    const dispY2_S1 = this.dispY2_S1;

    const dispX1_S2 = this.dispX1_S2;
    const dispY1_S2 = this.dispY1_S2;
    const dispX2_S2 = this.dispX2_S2;
    const dispY2_S2 = this.dispY2_S2;

    const scatBuf1 = this.scatBuf1;
    const scatBuf2 = this.scatBuf2;
    const scatMask = this.scatBufMask;
    const scatDelays1 = this.scatDelays1;
    const scatDelays2 = this.scatDelays2;

    let delayWritePtr = this.delayWritePtr;
    let scatWritePtr = this.scatWritePtr;
    let acoustWritePtr = this.acoustWritePtr;

    for (let s = 0; s < blockSize; s++) {
      let dryMono = 0.0;
      if (inL !== null) {
        dryMono = inR !== null ? (inL[s] + inR[s]) * 0.5 : inL[s];
      }

      const dwellGain = 0.25 + effectiveDwell * 2.65;
      const gridSignal = dryMono * dwellGain;

      let transducerDrive = 0.0;
      if (topology === 0) {
        const biased = gridSignal + 0.14 * gridSignal * gridSignal;
        const plateCurrent = Math.tanh(biased * 1.45) * 0.88;
        this.xfmrFlux = 0.992 * this.xfmrFlux + 0.008 * plateCurrent;
        const xfmrOut = plateCurrent - 0.35 * Math.tanh(this.xfmrFlux * 3.2);
        const hp = xfmrOut - this.xfmrHpX + 0.985 * this.xfmrHpY;
        this.xfmrHpX = xfmrOut;
        this.xfmrHpY = hp;
        transducerDrive = hp * 0.95;
      } else {
        const triodeOut = (gridSignal / (1.0 + 0.42 * Math.abs(gridSignal))) * 0.92;
        const hp = triodeOut - this.xfmrHpX + 0.991 * this.xfmrHpY;
        this.xfmrHpX = triodeOut;
        this.xfmrHpY = hp;
        transducerDrive = hp * 0.90;
      }

      if (this.kickExciteAmp > 0.0001) {
        this.kickPhase += (2.0 * Math.PI * (85.0 + 950.0 * this.kickExciteAmp)) / this.fs;
        const crash = (Math.sin(this.kickPhase) * 0.7 + (Math.random() * 2.0 - 1.0) * 0.6) * this.kickExciteAmp;
        transducerDrive += crash * 1.65;
        this.kickExciteAmp *= 0.9988;
      }

      const acoustDelayed = this.acoustBuf[(acoustWritePtr - 640) & this.acoustBufMask];
      const acoustRes = acoustDelayed * 0.035 - b1Acoust * this.acoustBpY1 - b2Acoust * this.acoustBpY2;
      this.acoustBpY2 = this.acoustBpY1;
      this.acoustBpY1 = Math.tanh(acoustRes * 0.95);
      transducerDrive += this.acoustBpY1 * acoustFbParam * 0.42;

      this.curDelay1 += (rawSamples1 - this.curDelay1) * 0.001;
      this.curDelay2 += (rawSamples2 - this.curDelay2) * 0.001;

      const d1Int = this.curDelay1 | 0;
      const d1Frac = this.curDelay1 - d1Int;
      const rIdx1_0 = (delayWritePtr - d1Int) & delayMask;
      const rIdx1_1 = (rIdx1_0 - 1) & delayMask;
      let wave1 = springDelayBuf1[rIdx1_0] + d1Frac * (springDelayBuf1[rIdx1_1] - springDelayBuf1[rIdx1_0]);

      const d2Int = this.curDelay2 | 0;
      const d2Frac = this.curDelay2 - d2Int;
      const rIdx2_0 = (delayWritePtr - d2Int) & delayMask;
      const rIdx2_1 = (rIdx2_0 - 1) & delayMask;
      let wave2 = springDelayBuf2[rIdx2_0] + d2Frac * (springDelayBuf2[rIdx2_1] - springDelayBuf2[rIdx2_0]);

      for (let st = 0; st < this.numDispStages; st++) {
        const y1 = a2Disp * wave1 + a1Disp * dispX1_S1[st] + dispX2_S1[st]
          - a1Disp * dispY1_S1[st] - a2Disp * dispY2_S1[st];
        dispX2_S1[st] = dispX1_S1[st];
        dispX1_S1[st] = wave1;
        dispY2_S1[st] = dispY1_S1[st];
        dispY1_S1[st] = y1;
        wave1 = y1;

        const y2 = a2Disp * wave2 + a1Disp * dispX1_S2[st] + dispX2_S2[st]
          - a1Disp * dispY1_S2[st] - a2Disp * dispY2_S2[st];
        dispX2_S2[st] = dispX1_S2[st];
        dispX1_S2[st] = wave2;
        dispY2_S2[st] = dispY1_S2[st];
        dispY1_S2[st] = y2;
        wave2 = y2;
      }

      const scatG = -0.52;
      for (let k = 0; k < 4; k++) {
        const off = k << 9;
        const idx1 = (scatWritePtr - scatDelays1[k]) & scatMask;
        const del1 = scatBuf1[off + idx1];
        const v1 = wave1 - scatG * del1;
        wave1 = del1 + scatG * v1;
        scatBuf1[off + scatWritePtr] = v1;

        const idx2 = (scatWritePtr - scatDelays2[k]) & scatMask;
        const del2 = scatBuf2[off + idx2];
        const v2 = wave2 - scatG * del2;
        wave2 = del2 + scatG * v2;
        scatBuf2[off + scatWritePtr] = v2;
      }
      scatWritePtr = (scatWritePtr + 1) & scatMask;

      const coupled1 = wave1 - kappa * (wave1 - this.vState1);
      this.vState1 = 0.85 * this.vState1 + 0.15 * wave1;

      const coupled2 = wave2 - kappa * (wave2 - this.vState2);
      this.vState2 = 0.85 * this.vState2 + 0.15 * wave2;

      this.lpState1 = oneMinusLp * coupled1 + lpPole * this.lpState1;
      this.lpState2 = oneMinusLp * coupled2 + lpPole * this.lpState2;

      const dcOut1 = this.lpState1 - this.dcX1 + 0.996 * this.dcY1;
      this.dcX1 = this.lpState1;
      this.dcY1 = dcOut1;

      const dcOut2 = this.lpState2 - this.dcX2 + 0.996 * this.dcY2;
      this.dcX2 = this.lpState2;
      this.dcY2 = dcOut2;

      const endBlockCross = 0.08 * dualSpringMix;
      const fb1 = dcOut1 + endBlockCross * dcOut2;
      const fb2 = dcOut2 - endBlockCross * dcOut1;

      springDelayBuf1[delayWritePtr] = Math.tanh(transducerDrive + fb1 * baseFeedback);
      springDelayBuf2[delayWritePtr] = Math.tanh(transducerDrive * 0.94 - fb2 * baseFeedback * 0.985);
      delayWritePtr = (delayWritePtr + 1) & delayMask;

      const rawPickupL = dcOut1 + 0.35 * dualSpringMix * dcOut2;
      const rawPickupR = dualSpringMix > 0.01 ? (dcOut2 + 0.35 * dcOut1) : dcOut1;

      const recL = Math.tanh(rawPickupL * 1.55);
      const recR = Math.tanh(rawPickupR * 1.55);

      this.toneLpL += toneAlpha * (recL - this.toneLpL);
      this.toneLpR += toneAlpha * (recR - this.toneLpR);

      const wetL = this.toneLpL;
      const wetR = this.toneLpR;

      const monoOut = (dryMono * (1.0 - mixParam * 0.45) + (wetL + wetR) * 0.5 * mixParam);
      this.acoustBuf[acoustWritePtr] = monoOut;
      acoustWritePtr = (acoustWritePtr + 1) & this.acoustBufMask;

      const dryGain = topology === 1 ? 0.85 : Math.cos(mixParam * 0.5 * Math.PI);
      const wetGain = topology === 1 ? (mixParam * 1.15) : Math.sin(mixParam * 0.5 * Math.PI) * 1.25;

      const dryL = inL !== null ? inL[s] : 0.0;
      const dryR = inR !== null ? inR[s] : dryL;

      outL[s] = Math.tanh(dryL * dryGain + wetL * wetGain);
      outR[s] = Math.tanh(dryR * dryGain + wetR * wetGain);
    }

    this.delayWritePtr = delayWritePtr;
    this.scatWritePtr = scatWritePtr;
    this.acoustWritePtr = acoustWritePtr;
    return true;
  }
}
registerProcessor('spring-reverb-processor', SpringReverbProcessor);
`;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isPowered = false;

    // Active Unit Mode: 'plate' (EMT-140 Plate) | 'spring' (Classic Tube Spring Reverb)
    this.activeUnit = 'plate';

    // Audio Graph Nodes
    this.inputGainNode = null;
    this.inputAnalyser = null;
    this.preDelayNode = null;
    this.reverbWorkletNode = null;
    this.springWorkletNode = null;
    this.platePathGain = null;
    this.springPathGain = null;
    this.wetGainNode = null;
    this.dryGainNode = null;
    this.outputGainNode = null;
    this.outputAnalyser = null;

    // Active Source State
    this.sourceType = 'impulse'; // 'mic' | 'impulse' | 'stem' | 'file'
    this.impulseSubType = 'rimshot'; // 'click' | 'noise' | 'rimshot'
    this.stemSubType = 'drums'; // 'drums' | 'guitar' | 'vocal' | 'surf'
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
      vocal: null,
      surf: null
    };
    this.customFileBuffer = null;
    this.customFileName = '';

    // Current Plate DSP Parameter State
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

    // Current Spring Reverb Physical & Electrical Topology Parameters
    this.springParams = {
      topology: 0,           // 0 = Version A (1961 Fender 6G15 Standalone 6K6), 1 = Version B (1963 AB763 Twin Reverb 12AT7)
      tankEra: 0,            // 0 = 1960 Accutronics Type 4, 1 = 1939 Hammond Oil-Damped, 2 = 1930s Bell Labs Delay Line
      wireRadiusMm: 0.25,    // r (mm)
      helixRadiusMm: 3.0,    // R (mm)
      wireLengthM: 2.65,     // L (m)
      dwell: 0.65,           // 0..1 (Driver Tube Grid Drive)
      tone: 0.62,            // 0..1 (Recovery Low-Pass Filter)
      mix: 0.55,             // 0..1 (Wet/Dry Mixer or AB763 Reverb Return)
      acousticFeedback: 0.28 // 0..0.95 (Speaker-to-Spring Sympathetic Coupling)
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

  /**
   * Computes exact Wittrick Helical Spring Dispersion Physics Telemetry:
   *  - T_D = (4 * L * R / r) * sqrt(rho / E)
   *  - F_c = (3 * r / (16 * sqrt(5) * pi * R^2)) * sqrt(E / rho)
   */
  getSpringPhysicsMetrics() {
    const rho = 7800.0;
    const E = 200.0e9;
    const cSteel = Math.sqrt(E / rho); // ~5063.7 m/s
    const r = this.springParams.wireRadiusMm * 1e-3;
    const R = this.springParams.helixRadiusMm * 1e-3;
    const L = this.springParams.wireLengthM;

    const TdSeconds = ((4.0 * L * R) / r) / cSteel;
    const FcHertz = ((3.0 * r) / (16.0 * Math.sqrt(5.0) * Math.PI * R * R)) * cSteel;
    const kappa = 1.0 / R;

    return {
      TdMs: TdSeconds * 1000.0,
      FcHz: FcHertz,
      kappaInvM: kappa,
      cSteelMs: cSteel
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

    // Load PlateReverbProcessor AudioWorklet
    try {
      await this.ctx.audioWorklet.addModule('plate-reverb-processor.js');
    } catch (_) {
      const blob = new Blob([WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
    }

    // Load SpringReverbProcessor AudioWorklet
    try {
      await this.ctx.audioWorklet.addModule('spring-reverb-processor.js');
    } catch (_) {
      const blob = new Blob([SPRING_WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
    }

    // -------------------------------------------------------------------------
    // Build Dual Electro-Mechanical Reverb Signal Graph
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

    this.springWorkletNode = new AudioWorkletNode(this.ctx, 'spring-reverb-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.platePathGain = this.ctx.createGain();
    this.springPathGain = this.ctx.createGain();

    this.wetGainNode = this.ctx.createGain();
    this.dryGainNode = this.ctx.createGain();
    this.outputGainNode = this.ctx.createGain();

    this.outputAnalyser = this.ctx.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = 0.75;

    // Input Analyser
    this.inputGainNode.connect(this.inputAnalyser);

    // Path A: EMT-140 Plate Reverb (Wet + Dry routed via platePathGain)
    this.inputGainNode.connect(this.preDelayNode);
    this.preDelayNode.connect(this.reverbWorkletNode);
    this.reverbWorkletNode.connect(this.wetGainNode);
    this.inputGainNode.connect(this.dryGainNode);
    this.wetGainNode.connect(this.platePathGain);
    this.dryGainNode.connect(this.platePathGain);
    this.platePathGain.connect(this.outputGainNode);

    // Path B: Classic Tube-Driven Spring Reverb (Independent Input Gain & Pre-Delay -> Worklet -> springPathGain)
    this.springInputGainNode = this.ctx.createGain();
    this.springPreDelayNode = this.ctx.createDelay(0.5);
    this.inputGainNode.connect(this.springInputGainNode);
    this.springInputGainNode.connect(this.springPreDelayNode);
    this.springPreDelayNode.connect(this.springWorkletNode);
    this.springWorkletNode.connect(this.springPathGain);
    this.springPathGain.connect(this.outputGainNode);

    // Master Output -> Analyser -> Destination
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

    // Apply initial Spring Reverb parameters
    this.setSpringTopology(this.springParams.topology);
    this.setSpringTankEra(this.springParams.tankEra);
    this.setSpringWireRadius(this.springParams.wireRadiusMm);
    this.setSpringHelixRadius(this.springParams.helixRadiusMm);
    this.setSpringWireLength(this.springParams.wireLengthM);
    this.setSpringDwell(this.springParams.dwell);
    this.setSpringTone(this.springParams.tone);
    this.setSpringMix(this.springParams.mix);
    this.setSpringAcousticFeedback(this.springParams.acousticFeedback);

    this.setActiveUnit(this.activeUnit);

    this.isInitialized = true;
    this.isPowered = true;
  }

  setActiveUnit(unitName) {
    this.activeUnit = unitName === 'spring' ? 'spring' : 'plate';
    if (!this.isInitialized) return;
    const now = this.ctx.currentTime;
    if (this.activeUnit === 'spring') {
      this.platePathGain.gain.setTargetAtTime(0.0, now, 0.015);
      this.springPathGain.gain.setTargetAtTime(1.0, now, 0.015);
    } else {
      this.platePathGain.gain.setTargetAtTime(1.0, now, 0.015);
      this.springPathGain.gain.setTargetAtTime(0.0, now, 0.015);
    }
  }

  // ---------------------------------------------------------------------------
  // Spring Reverb Parameter Setters
  // ---------------------------------------------------------------------------
  setSpringTopology(topologyIdx) {
    const idx = topologyIdx ? 1 : 0;
    this.springParams.topology = idx;
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters.get('topology').setValueAtTime(idx, this.ctx.currentTime);
    this.springWorkletNode.port.postMessage({ type: 'SET_TOPOLOGY', value: idx });
  }

  setSpringTankEra(eraIdx) {
    const idx = Math.max(0, Math.min(2, eraIdx | 0));
    this.springParams.tankEra = idx;
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters.get('tankEra').setValueAtTime(idx, this.ctx.currentTime);
    this.springWorkletNode.port.postMessage({ type: 'SET_TANK_ERA', value: idx });
  }

  setSpringGain(db) {
    this.springParams.inputGainDb = Math.max(-24.0, Math.min(12.0, db));
    if (!this.isInitialized) return;
    const linear = Math.pow(10.0, this.springParams.inputGainDb / 20.0);
    this.springInputGainNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  setSpringPreDelay(ms) {
    this.springParams.preDelayMs = Math.max(0.0, Math.min(250.0, ms));
    if (!this.isInitialized) return;
    const seconds = this.springParams.preDelayMs / 1000.0;
    this.springPreDelayNode.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.015);
  }

  setSpringWireRadius(rMm) {
    this.springParams.wireRadiusMm = Math.max(0.12, Math.min(0.50, rMm));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('wireRadiusMm')
      .setTargetAtTime(this.springParams.wireRadiusMm, this.ctx.currentTime, 0.015);
  }

  setSpringHelixRadius(RMm) {
    this.springParams.helixRadiusMm = Math.max(1.5, Math.min(6.0, RMm));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('helixRadiusMm')
      .setTargetAtTime(this.springParams.helixRadiusMm, this.ctx.currentTime, 0.015);
  }

  setSpringWireLength(LM) {
    this.springParams.wireLengthM = Math.max(1.0, Math.min(5.5, LM));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('wireLengthM')
      .setTargetAtTime(this.springParams.wireLengthM, this.ctx.currentTime, 0.015);
  }

  setSpringDwell(normVal) {
    this.springParams.dwell = Math.max(0.0, Math.min(1.0, normVal));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('dwell')
      .setTargetAtTime(this.springParams.dwell, this.ctx.currentTime, 0.015);
  }

  setSpringTone(normVal) {
    this.springParams.tone = Math.max(0.0, Math.min(1.0, normVal));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('tone')
      .setTargetAtTime(this.springParams.tone, this.ctx.currentTime, 0.015);
  }

  setSpringMix(normVal) {
    this.springParams.mix = Math.max(0.0, Math.min(1.0, normVal));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('mix')
      .setTargetAtTime(this.springParams.mix, this.ctx.currentTime, 0.015);
  }

  setSpringAcousticFeedback(normVal) {
    this.springParams.acousticFeedback = Math.max(0.0, Math.min(0.95, normVal));
    if (!this.isInitialized) return;
    this.springWorkletNode.parameters
      .get('acousticFeedback')
      .setTargetAtTime(this.springParams.acousticFeedback, this.ctx.currentTime, 0.015);
  }

   async kickSpringTank() {
    if (!this.isInitialized) await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.springWorkletNode.port.postMessage({ type: 'KICK_TANK' });
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

    // 1. Dry Drum Groove (4-bar 1960s Studio Kit at 110 BPM)
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

    // 2. Dry Pluck / Archtop Guitar Chord Sequence
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

    // 3. 1962 Staccato Surf Guitar Riff (Ideal for testing 6G15 Spring Reverb "Drip" & "Chirp")
    const surfDuration = 4.8;
    const surfSamples = Math.floor(fs * surfDuration);
    const surfBuf = this.ctx.createBuffer(2, surfSamples, fs);
    const sL = surfBuf.getChannelData(0);
    const sR = surfBuf.getChannelData(1);

    const surfNotes = [
      { t: 0.0, f: 164.81, d: 0.18 },
      { t: 0.22, f: 164.81, d: 0.16 },
      { t: 0.45, f: 196.00, d: 0.20 },
      { t: 0.70, f: 220.00, d: 0.22 },
      { t: 1.00, f: 246.94, d: 0.16 },
      { t: 1.20, f: 246.94, d: 0.16 },
      { t: 1.42, f: 220.00, d: 0.20 },
      { t: 1.70, f: 196.00, d: 0.25 },
      { t: 2.15, f: 329.63, d: 0.14 }, // High staccato muted pick snap (classic Dick Dale / Fender 6G15 drip test!)
      { t: 2.35, f: 329.63, d: 0.14 },
      { t: 2.55, f: 392.00, d: 0.14 },
      { t: 2.80, f: 493.88, d: 0.55 },
      { t: 3.60, f: 164.81, d: 0.90 }
    ];
    surfNotes.forEach((sn) => {
      const start = Math.floor(sn.t * fs);
      const len = Math.min(Math.floor((sn.d + 0.25) * fs), surfSamples - start);
      for (let i = 0; i < len; i++) {
        const t = i / fs;
        let v = 0.0;
        // Bright bridge single-coil harmonic profile
        for (let h = 1; h <= 9; h++) {
          const hd = Math.exp(-t * (6.5 + h * 2.2));
          v += Math.sin(2.0 * Math.PI * sn.f * h * t) * (1.0 / Math.pow(h, 0.75)) * hd;
        }
        // Heavy celluloid pick transient
        const pick = (Math.random() * 2.0 - 1.0) * Math.exp(-t * 220.0) * 0.55;
        const samp = Math.tanh((v * 0.36 + pick) * 1.3);
        sL[start + i] += samp;
        sR[start + i] += samp;
      }
    });
    this.stemBuffers.surf = surfBuf;

    // 4. Dry Vocal Formant Synth Phrase
    const vocDuration = 6.0;
    const vocSamples = Math.floor(fs * vocDuration);
    const vocBuf = this.ctx.createBuffer(2, vocSamples, fs);
    const vL = vocBuf.getChannelData(0);
    const vR = vocBuf.getChannelData(1);

    const notes = [
      { start: 0.1, dur: 1.2, f0: 220.0, f1: 730, f2: 1090 },
      { start: 1.5, dur: 1.1, f0: 261.63, f1: 530, f2: 1840 },
      { start: 2.8, dur: 1.3, f0: 293.66, f1: 390, f2: 1990 },
      { start: 4.3, dur: 1.3, f0: 220.0, f1: 570, f2: 840 }
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
  // Zero-GC Real-Time Audio Telemetry Polling
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

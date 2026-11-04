/**
 * @fileoverview Stage 1: Standalone AudioWorkletProcessor running the FDN-16 Plate Reverb DSP Core.
 * Strictly Zero-GC inside the process() loop: all typed arrays and state variables are pre-allocated
 * in the constructor.
 */

class PlateReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'decay',
        defaultValue: 3.2,
        minValue: 0.2,
        maxValue: 12.0,
        automationRate: 'k-rate'
      },
      {
        name: 'damping',
        defaultValue: 0.35,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: 'k-rate'
      },
      {
        name: 'plateSize',
        defaultValue: 1.0,
        minValue: 0.5,
        maxValue: 2.0,
        automationRate: 'k-rate'
      },
      {
        name: 'material',
        defaultValue: 0,
        minValue: 0,
        maxValue: 3,
        automationRate: 'k-rate'
      },
      {
        name: 'lowCut',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor() {
    super();

    this.fs = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
    this.fsScale = this.fs / 48000.0;

    // -------------------------------------------------------------------------
    // 1.1 Pre-Allocated FDN-16 Delay Ring Buffers (Power-of-two: 16384)
    // -------------------------------------------------------------------------
    this.numChannels = 16;
    this.bufferSize = 16384;
    this.bufferMask = 16383;
    this.fdnBuffers = new Float32Array(this.numChannels * this.bufferSize);
    this.writePtr = 0;

    // Base prime delay lengths at 48 kHz
    const rawBaseDelays = [
      1051, 1297, 1543, 1723,
      1993, 2237, 2503, 2713,
      2999, 3229, 3557, 3833,
      4153, 4409, 4691, 5011
    ];
    this.baseDelays = new Float32Array(this.numChannels);
    for (let i = 0; i < this.numChannels; i++) {
      this.baseDelays[i] = rawBaseDelays[i] * this.fsScale;
    }

    // Current smoothed delay lengths and feedback gains per channel
    this.currentDelays = new Float32Array(this.numChannels);
    this.targetDelays = new Float32Array(this.numChannels);
    this.feedbackGains = new Float32Array(this.numChannels);
    this.fdnVector = new Float32Array(this.numChannels);
    this.tapVector = new Float32Array(this.numChannels);

    for (let i = 0; i < this.numChannels; i++) {
      this.currentDelays[i] = this.baseDelays[i];
      this.targetDelays[i] = this.baseDelays[i];
      this.feedbackGains[i] = 0.85;
    }

    // -------------------------------------------------------------------------
    // 1.2 Input Diffusion Stage: 4 Cascaded All-Pass Filters (83, 149, 231, 353)
    // -------------------------------------------------------------------------
    this.numDiffusers = 4;
    this.diffBufferSize = 1024;
    this.diffBufferMask = 1023;
    this.diffBuffers = new Float32Array(this.numDiffusers * this.diffBufferSize);
    this.diffWritePtr = 0;
    this.diffGain = 0.7;

    const rawDiffDelays = [83, 149, 231, 353];
    this.diffDelays = new Int32Array(this.numDiffusers);
    for (let i = 0; i < this.numDiffusers; i++) {
      const scaled = Math.max(1, Math.min(this.diffBufferMask - 1, Math.round(rawDiffDelays[i] * this.fsScale)));
      this.diffDelays[i] = scaled;
    }

    // -------------------------------------------------------------------------
    // 1.4 Dispersion All-Pass & Damping Low-Pass Filter State Arrays
    // -------------------------------------------------------------------------
    this.dispStateX = new Float32Array(this.numChannels);
    this.dispStateY = new Float32Array(this.numChannels);
    this.dampState = new Float32Array(this.numChannels);

    // -------------------------------------------------------------------------
    // 1.6 Material Presets Map (Pre-allocated typed arrays)
    // 0: Steel (EMT 140)   -> a = -0.35, f_cut = 4500 Hz, hfMult = 1.00
    // 1: Gold (EMT 240)    -> a = -0.18, f_cut = 2800 Hz, hfMult = 0.75
    // 2: Aluminium         -> a = -0.55, f_cut = 7500 Hz, hfMult = 1.25
    // 3: Titanium          -> a = -0.45, f_cut = 6200 Hz, hfMult = 1.15
    // -------------------------------------------------------------------------
    this.presetDispersionA = new Float32Array([-0.35, -0.18, -0.55, -0.45]);
    this.presetCutoffHz = new Float32Array([4500.0, 2800.0, 7500.0, 6200.0]);
    this.presetHfMultiplier = new Float32Array([1.0, 0.75, 1.25, 1.15]);

    this.activeMaterial = 0;
    this.overrideMaterial = -1;
    this.overrideLowCut = -1;

    // -------------------------------------------------------------------------
    // 1.7 Output 2nd-Order Butterworth High-Pass Filter at 80 Hz (12 dB/oct)
    // -------------------------------------------------------------------------
    const f0 = 80.0;
    const w0 = (2.0 * Math.PI * f0) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / Math.SQRT2; // Q = 1 / sqrt(2) for Butterworth
    const a0 = 1.0 + alpha;

    this.hpB0 = ((1.0 + cosW0) * 0.5) / a0;
    this.hpB1 = -(1.0 + cosW0) / a0;
    this.hpB2 = ((1.0 + cosW0) * 0.5) / a0;
    this.hpA1 = (-2.0 * cosW0) / a0;
    this.hpA2 = (1.0 - alpha) / a0;

    // Biquad states for Left & Right channels
    this.hpLX1 = 0.0;
    this.hpLX2 = 0.0;
    this.hpLY1 = 0.0;
    this.hpLY2 = 0.0;

    this.hpRX1 = 0.0;
    this.hpRX2 = 0.0;
    this.hpRY1 = 0.0;
    this.hpRY2 = 0.0;

    // Message port handler for instant material switching or state resets
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
        this.dampState.fill(0);
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;

    const input = inputs[0];
    const hasInput = input && input.length > 0 && input[0] && input[0].length > 0;
    const inL = hasInput ? input[0] : null;
    const inR = hasInput && input.length > 1 ? input[1] : null;

    // Extract k-rate parameters
    const decayParam = Math.max(0.2, Math.min(12.0, parameters.decay[0]));
    const dampingParam = Math.max(0.0, Math.min(1.0, parameters.damping[0]));
    const sizeParam = Math.max(0.5, Math.min(2.0, parameters.plateSize[0]));

    const matParam = this.overrideMaterial >= 0
      ? this.overrideMaterial
      : Math.max(0, Math.min(3, Math.round(parameters.material[0])));

    const lowCutEnabled = this.overrideLowCut >= 0
      ? this.overrideLowCut > 0
      : parameters.lowCut[0] >= 0.5;

    // Material preset constants
    const dispA = this.presetDispersionA[matParam];
    const fCut = this.presetCutoffHz[matParam];
    const hfMult = this.presetHfMultiplier[matParam];

    // Effective T60 adjusted by material HF multiplier and physical damping pole
    const effectiveT60 = decayParam * (0.85 + 0.15 * hfMult);
    const poleCoeff = 1.0 - Math.exp((-2.0 * Math.PI * fCut) / this.fs);
    const dampP = Math.max(0.0, Math.min(0.92, (0.08 + 0.84 * dampingParam) * poleCoeff / Math.max(0.15, poleCoeff)));
    // Exact specification formula: p = D * (1.0 - exp(-2*pi * f_cut / f_s)) with small intrinsic loss floor
    const specP = Math.max(0.02, Math.min(0.95, dampingParam * poleCoeff + 0.02 * (2.0 - hfMult)));
    const oneMinusP = 1.0 - specP;

    // Update target delay lengths and per-channel T60 feedback gains
    const fsInv3 = -3.0 / (this.fs * effectiveT60);
    for (let c = 0; c < 16; c++) {
      const targetL = Math.max(64.0, Math.min(15000.0, Math.floor(this.baseDelays[c] * sizeParam)));
      this.targetDelays[c] = targetL;
      const g = Math.pow(10.0, targetL * fsInv3);
      this.feedbackGains[c] = g < 0.9992 ? g : 0.9992;
    }

    // Local references for tight loop speed
    const fdnBuffers = this.fdnBuffers;
    const bufferMask = this.bufferMask;
    const currentDelays = this.currentDelays;
    const targetDelays = this.targetDelays;
    const feedbackGains = this.feedbackGains;
    const fdnVector = this.fdnVector;
    const tapVector = this.tapVector;
    const dispStateX = this.dispStateX;
    const dispStateY = this.dispStateY;
    const dampState = this.dampState;

    const diffBuffers = this.diffBuffers;
    const diffDelays = this.diffDelays;
    const diffMask = this.diffBufferMask;
    const diffG = this.diffGain;

    let writePtr = this.writePtr;
    let diffWritePtr = this.diffWritePtr;

    // Per-sample delay smoothing coefficient to prevent zipper noise during Plate Size changes
    const delaySmooth = 0.0015;

    for (let s = 0; s < blockSize; s++) {
      // -----------------------------------------------------------------------
      // 1.2 Sum stereo/mono input to mono driver signal + 4 All-Pass Diffusers
      // -----------------------------------------------------------------------
      let monoIn = 0.0;
      if (inL !== null) {
        monoIn = inR !== null ? (inL[s] + inR[s]) * 0.5 : inL[s];
      }

      let sig = monoIn;
      for (let d = 0; d < 4; d++) {
        const dOffset = d << 10; // d * 1024
        const readIdx = (diffWritePtr - diffDelays[d]) & diffMask;
        const delayed = diffBuffers[dOffset + readIdx];
        const v = sig - diffG * delayed;
        sig = delayed + diffG * v;
        diffBuffers[dOffset + diffWritePtr] = v;
      }
      diffWritePtr = (diffWritePtr + 1) & diffMask;

      const diffusedInput = sig * 0.25;

      // -----------------------------------------------------------------------
      // 1.3 & 1.4 Read Fractional Delays, Dispersion All-Pass & Damping LPF
      // -----------------------------------------------------------------------
      for (let j = 0; j < 16; j++) {
        // Smoothly interpolate delay length L_j
        const curL = currentDelays[j] + (targetDelays[j] - currentDelays[j]) * delaySmooth;
        currentDelays[j] = curL;

        const delayInt = curL | 0;
        const frac = curL - delayInt;

        const chanOffset = j << 14; // j * 16384
        const rIdx0 = (writePtr - delayInt) & bufferMask;
        const rIdx1 = (rIdx0 - 1) & bufferMask;

        const s0 = fdnBuffers[chanOffset + rIdx0];
        const s1 = fdnBuffers[chanOffset + rIdx1];
        const delayedSample = s0 + frac * (s1 - s0);

        // Store raw/dispersed tap for output pickup before feedback attenuation
        // Dispersion All-Pass Filter: dispOut = a * x[n] + x[n-1] - a * y[n-1]
        const dispOut = dispA * delayedSample + dispStateX[j] - dispA * dispStateY[j];
        dispStateX[j] = delayedSample;
        dispStateY[j] = dispOut;

        tapVector[j] = dispOut;

        // Physical Damping Low-Pass Filter: y[n] = (1 - p) * x[n] + p * y[n-1]
        const dampOut = oneMinusP * dispOut + specP * dampState[j];
        dampState[j] = dampOut + 1e-20 - 1e-20; // Denormal guard

        fdnVector[j] = dampOut;
      }

      // -----------------------------------------------------------------------
      // 1.5 Unrolled 16-Point Fast Walsh-Hadamard Transform (FWHT)
      // -----------------------------------------------------------------------
      // Stage 1: stride 1 (j += 2)
      for (let j = 0; j < 16; j += 2) {
        const u = fdnVector[j];
        const v = fdnVector[j + 1];
        fdnVector[j] = u + v;
        fdnVector[j + 1] = u - v;
      }

      // Stage 2: stride 2 (j += 4)
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

      // Stage 3: stride 4 (j += 8)
      for (let j = 0; j < 16; j += 8) {
        for (let k = 0; k < 4; k++) {
          const idx = j + k;
          const u = fdnVector[idx];
          const v = fdnVector[idx + 4];
          fdnVector[idx] = u + v;
          fdnVector[idx + 4] = u - v;
        }
      }

      // Stage 4: stride 8 (j < 8), multiply outputs by 0.25 (1 / sqrt(16))
      for (let j = 0; j < 8; j++) {
        const u = fdnVector[j];
        const v = fdnVector[j + 8];
        fdnVector[j] = (u + v) * 0.25;
        fdnVector[j + 8] = (u - v) * 0.25;
      }

      // Inject diffused input (with alternating polarity for rich modal excitation) + feedback
      for (let j = 0; j < 16; j++) {
        const inSign = (j & 1) === 0 ? diffusedInput : -diffusedInput;
        fdnBuffers[(j << 14) + writePtr] = inSign + fdnVector[j] * feedbackGains[j];
      }

      writePtr = (writePtr + 1) & bufferMask;

      // -----------------------------------------------------------------------
      // 1.7 Output Pickup Taps & 80 Hz 2nd-Order Butterworth High-Pass Filter
      // Left  = +d3 - d7 + d11 - d15 (0-based indices: 2, 6, 10, 14)
      // Right = +d4 - d8 + d12 - d16 (0-based indices: 3, 7, 11, 15)
      // -----------------------------------------------------------------------
      let rawL = (tapVector[2] - tapVector[6] + tapVector[10] - tapVector[14]) * 0.65;
      let rawR = (tapVector[3] - tapVector[7] + tapVector[11] - tapVector[15]) * 0.65;

      if (lowCutEnabled) {
        const hpL = this.hpB0 * rawL + this.hpB1 * this.hpLX1 + this.hpB2 * this.hpLX2
          - this.hpA1 * this.hpLY1 - this.hpA2 * this.hpLY2;
        this.hpLX2 = this.hpLX1;
        this.hpLX1 = rawL;
        this.hpLY2 = this.hpLY1;
        this.hpLY1 = hpL;
        rawL = hpL;

        const hpR = this.hpB0 * rawR + this.hpB1 * this.hpRX1 + this.hpB2 * this.hpRX2
          - this.hpA1 * this.hpRY1 - this.hpA2 * this.hpRY2;
        this.hpRX2 = this.hpRX1;
        this.hpRX1 = rawR;
        this.hpRY2 = this.hpRY1;
        this.hpRY1 = hpR;
        rawR = hpR;
      }

      // Soft-clipping output transformer saturation
      outL[s] = Math.tanh(rawL);
      outR[s] = Math.tanh(rawR);
    }

    this.writePtr = writePtr;
    this.diffWritePtr = diffWritePtr;

    return true;
  }
}

registerProcessor('plate-reverb-processor', PlateReverbProcessor);

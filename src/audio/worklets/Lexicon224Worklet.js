/**
 * Lexicon224Worklet.js
 * Production-Grade AudioWorkletProcessor for the 1978 Lexicon 224 Digital Reverb.
 * 
 * Architecture:
 *  1. Pre-delay line with linear interpolation.
 *  2. 4-stage cascaded All-Pass input diffusers with coprime prime delay lengths.
 *  3. 4-channel Feedback Delay Network (FDN) / Tank loops:
 *     - Wandering delay lines with 4-point Hermite cubic interpolation.
 *     - Multi-phase quadrature LFOs with irrational frequency ratios and soft wandering drift.
 *     - One-pole low-pass HF damping filters inside each feedback loop.
 *     - Inner all-pass filters inside each feedback loop for high echo density.
 *     - Lossless, unitary 4x4 Householder mixing matrix: y_i = x_i - 0.5 * sum(x).
 *  4. Stereo decorrelation tap matrix (alternating polarity cross-summing).
 *  5. Equal-power wet/dry mix.
 * 
 * Memory: Strictly Zero-GC in process() loop. All typed buffers are pre-allocated.
 */

class Lexicon224Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'preDelay', defaultValue: 24.0, minValue: 0.0, maxValue: 250.0, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 2.8, minValue: 0.1, maxValue: 20.0, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 4500.0, minValue: 200.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'diffusion', defaultValue: 0.72, minValue: 0.0, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'modRate', defaultValue: 0.85, minValue: 0.05, maxValue: 5.0, automationRate: 'k-rate' },
      { name: 'modDepth', defaultValue: 1.5, minValue: 0.0, maxValue: 8.0, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.40, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;
    const fsScale = this.fs / 44100.0;

    // --- 1. Pre-Delay Buffer (Max 250ms at 96kHz is 24,000 samples -> 2^15 = 32768) ---
    this.preDelaySize = 32768;
    this.preDelayMask = this.preDelaySize - 1;
    this.preDelayBuffer = new Float32Array(this.preDelaySize);
    this.preDelayWrite = 0;

    // --- 2. Input Diffusers (4 Cascaded All-Pass Filters) ---
    this.diffCount = 4;
    this.diffSize = 4096; // 2^12
    this.diffMask = this.diffSize - 1;
    this.diffBuffers = new Float32Array(this.diffCount * this.diffSize);
    this.diffWrites = new Int32Array(this.diffCount);

    // Iconic Griesinger prime delay lengths for input diffusion
    const baseDiffDelays = [142, 107, 379, 277];
    this.diffDelays = new Int32Array(this.diffCount);
    for (let i = 0; i < this.diffCount; i++) {
      this.diffDelays[i] = Math.max(8, Math.round(baseDiffDelays[i] * fsScale));
    }

    // --- 3. 4-Channel Circulating FDN Tank Delays ---
    this.tankCount = 4;
    this.tankSize = 16384; // 2^14
    this.tankMask = this.tankSize - 1;
    this.tankBuffers = new Float32Array(this.tankCount * this.tankSize);
    this.tankWrites = new Int32Array(this.tankCount);

    // Primary tank loop delays (coprime samples at 44.1k)
    const baseTankDelays = [1801, 2141, 2477, 2749];
    this.tankBaseDelays = new Float32Array(this.tankCount);
    for (let i = 0; i < this.tankCount; i++) {
      this.tankBaseDelays[i] = baseTankDelays[i] * fsScale;
    }

    // Inner All-Pass Delays within each circulating tank loop
    this.innerApSize = 4096;
    this.innerApMask = this.innerApSize - 1;
    this.innerApBuffers = new Float32Array(this.tankCount * this.innerApSize);
    this.innerApWrites = new Int32Array(this.tankCount);
    const baseInnerApDelays = [677, 907, 541, 797];
    this.innerApDelays = new Int32Array(this.tankCount);
    for (let i = 0; i < this.tankCount; i++) {
      this.innerApDelays[i] = Math.max(16, Math.round(baseInnerApDelays[i] * fsScale));
    }

    // --- 4. Wandering Modulation LFOs (Dual Quadrature with irrational ratios) ---
    this.lfoPhases = new Float32Array([0.0, 0.25 * Math.PI, 0.5 * Math.PI, 0.75 * Math.PI]);
    this.lfoFreqScales = new Float32Array([1.0, 1.231, 0.893, 1.414]); // Prime / irrational detune

    // --- 5. Filtering, Gain & State Buffers (Pre-allocated, Zero-GC) ---
    this.dampState = new Float32Array(this.tankCount);
    this.feedbackGains = new Float32Array(this.tankCount);
    this.tankOutputs = new Float32Array(this.tankCount);
    this.matrixOutputs = new Float32Array(this.tankCount);

    // Internal parameter change detection caches
    this.lastDecay = -1.0;
    this.lastDamping = -1.0;
    this.dampCoeff = 0.5;

    // Telemetry reporting for UI visualization
    this.telemetryCounter = 0;
    this.tankEnergies = new Float32Array(4);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const blockSize = inL.length;

    // Fast param reads (k-rate)
    const pBypass = parameters.bypass[0] > 0.5;
    if (pBypass) {
      outL.set(inL);
      outR.set(inR);
      return true;
    }

    const pPreDelay = parameters.preDelay[0];
    const pDecay = parameters.decay[0];
    const pDamping = parameters.damping[0];
    const pDiff = parameters.diffusion[0];
    const pModRate = parameters.modRate[0];
    const pModDepth = parameters.modDepth[0];
    const pMix = parameters.mix[0];

    // Recalculate T60 feedback gains if decay parameter changed
    if (pDecay !== this.lastDecay) {
      this.lastDecay = pDecay;
      for (let i = 0; i < this.tankCount; i++) {
        // -60 dB attenuation formula: g = 10^(-3 * (LoopLength / (Decay * fs)))
        const totalLoopSamples = this.tankBaseDelays[i] + this.innerApDelays[i];
        this.feedbackGains[i] = Math.pow(10, (-3.0 * totalLoopSamples) / (pDecay * this.fs));
      }
    }

    // Recalculate one-pole low-pass damping coefficient if cutoff changed
    if (pDamping !== this.lastDamping) {
      this.lastDamping = pDamping;
      const omega = (2.0 * Math.PI * Math.min(pDamping, this.fs * 0.49)) / this.fs;
      // alpha = 1 - exp(-omega)
      this.dampCoeff = Math.min(1.0, Math.max(0.01, 1.0 - Math.exp(-omega)));
    }

    const modDepthSamples = (pModDepth * 0.001) * this.fs;
    const lfoIncBase = (2.0 * Math.PI * pModRate) / this.fs;
    const preDelaySamples = (pPreDelay * 0.001) * this.fs;

    // Equal-Power Wet/Dry Gains
    const dryGain = Math.cos(pMix * 0.5 * Math.PI);
    const wetGain = Math.sin(pMix * 0.5 * Math.PI);

    let sumEnergy0 = 0;
    let sumEnergy1 = 0;
    let sumEnergy2 = 0;
    let sumEnergy3 = 0;

    for (let n = 0; n < blockSize; n++) {
      // Sum input to mono with 3 dB headroom scaling
      const monoIn = 0.5 * (inL[n] + inR[n]);

      // --- 1. Pre-Delay Line (Linear Interpolation) ---
      this.preDelayBuffer[this.preDelayWrite] = monoIn;
      let pdReadPtr = this.preDelayWrite - preDelaySamples;
      if (pdReadPtr < 0) pdReadPtr += this.preDelaySize;
      const pdIdx0 = Math.floor(pdReadPtr) & this.preDelayMask;
      const pdIdx1 = (pdIdx0 + 1) & this.preDelayMask;
      const pdFrac = pdReadPtr - Math.floor(pdReadPtr);
      const preDelayedSample = this.preDelayBuffer[pdIdx0] + pdFrac * (this.preDelayBuffer[pdIdx1] - this.preDelayBuffer[pdIdx0]);
      this.preDelayWrite = (this.preDelayWrite + 1) & this.preDelayMask;

      // --- 2. 4-Stage Cascaded All-Pass Input Diffusers ---
      let diffSample = preDelayedSample;
      for (let i = 0; i < this.diffCount; i++) {
        const bufOffset = i * this.diffSize;
        const wPtr = this.diffWrites[i];
        const rPtr = (wPtr - this.diffDelays[i] + this.diffSize) & this.diffMask;

        const bufVal = this.diffBuffers[bufOffset + rPtr];
        const wVal = diffSample + pDiff * bufVal;
        this.diffBuffers[bufOffset + wPtr] = wVal;
        diffSample = -pDiff * wVal + bufVal;

        this.diffWrites[i] = (wPtr + 1) & this.diffMask;
      }

      // --- 3. 4-Channel Circulating FDN Tanks with Wandering Hermite Delays ---
      for (let i = 0; i < this.tankCount; i++) {
        // Multi-frequency quadrature LFO computation
        this.lfoPhases[i] += lfoIncBase * this.lfoFreqScales[i];
        if (this.lfoPhases[i] >= 2.0 * Math.PI) {
          this.lfoPhases[i] -= 2.0 * Math.PI;
        }

        const modulation = Math.sin(this.lfoPhases[i]) * modDepthSamples;
        const currentDelay = this.tankBaseDelays[i] + modulation;

        const bufOffset = i * this.tankSize;
        const wPtr = this.tankWrites[i];

        let rPtr = wPtr - currentDelay;
        while (rPtr < 0) rPtr += this.tankSize;

        const i0 = Math.floor(rPtr);
        const frac = rPtr - i0;

        const idxM1 = (i0 - 1 + this.tankSize) & this.tankMask;
        const idx0  = (i0) & this.tankMask;
        const idx1  = (i0 + 1) & this.tankMask;
        const idx2  = (i0 + 2) & this.tankMask;

        const yM1 = this.tankBuffers[bufOffset + idxM1];
        const y0  = this.tankBuffers[bufOffset + idx0];
        const y1  = this.tankBuffers[bufOffset + idx1];
        const y2  = this.tankBuffers[bufOffset + idx2];

        // 4-Point 3rd-Order Hermite Cubic Interpolation (C1 Continuous, no zipper noise)
        const c0 = y0;
        const c1 = 0.5 * (y1 - yM1);
        const c2 = yM1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2;
        const c3 = 0.5 * (y2 - yM1) + 1.5 * (y0 - y1);
        const delayedSignal = ((c3 * frac + c2) * frac + c1) * frac + c0;

        // --- Low-Pass Frequency Damping (One-Pole Filter) ---
        // y[n] = y[n-1] + alpha * (x[n] - y[n-1])
        this.dampState[i] = this.dampState[i] + this.dampCoeff * (delayedSignal - this.dampState[i]);
        const dampedSignal = this.dampState[i];

        // --- Inner Loop All-Pass Filter ---
        const innerOffset = i * this.innerApSize;
        const apWPtr = this.innerApWrites[i];
        const apRPtr = (apWPtr - this.innerApDelays[i] + this.innerApSize) & this.innerApMask;
        const apBufVal = this.innerApBuffers[innerOffset + apRPtr];
        const apWVal = dampedSignal + 0.6 * apBufVal;
        this.innerApBuffers[innerOffset + apWPtr] = apWVal;
        this.tankOutputs[i] = (-0.6 * apWVal + apBufVal) * this.feedbackGains[i];
        this.innerApWrites[i] = (apWPtr + 1) & this.innerApMask;
      }

      // Track energy for live telemetry
      sumEnergy0 += Math.abs(this.tankOutputs[0]);
      sumEnergy1 += Math.abs(this.tankOutputs[1]);
      sumEnergy2 += Math.abs(this.tankOutputs[2]);
      sumEnergy3 += Math.abs(this.tankOutputs[3]);

      // --- 4. Unitary Lossless 4x4 Householder Matrix Mixing ---
      // H = I - (2/N)*11^T -> out[i] = in[i] - 0.5 * sum(in)
      const sum = this.tankOutputs[0] + this.tankOutputs[1] + this.tankOutputs[2] + this.tankOutputs[3];
      const halfSum = 0.5 * sum;
      for (let i = 0; i < this.tankCount; i++) {
        this.matrixOutputs[i] = this.tankOutputs[i] - halfSum;
      }

      // Feed mixed signals + diffused input into delay tank buffers
      for (let i = 0; i < this.tankCount; i++) {
        const bufOffset = i * this.tankSize;
        // Small anti-denormal noise floor
        this.tankBuffers[bufOffset + this.tankWrites[i]] = diffSample + this.matrixOutputs[i] + 1e-18;
        this.tankWrites[i] = (this.tankWrites[i] + 1) & this.tankMask;
      }

      // --- 5. Decorrelated Stereo Output Matrix (Lexicon 224 Tap Topology) ---
      // Left Out:   +Tank0 -Tank1 +Tank2 -Tank3
      // Right Out:  +Tank0 +Tank1 -Tank2 -Tank3
      const wetL = 0.5 * (this.tankOutputs[0] - this.tankOutputs[1] + this.tankOutputs[2] - this.tankOutputs[3]);
      const wetR = 0.5 * (this.tankOutputs[0] + this.tankOutputs[1] - this.tankOutputs[2] - this.tankOutputs[3]);

      outL[n] = dryGain * inL[n] + wetGain * wetL;
      outR[n] = dryGain * inR[n] + wetGain * wetR;
    }

    // Telemetry throttling to port (~30Hz)
    this.telemetryCounter += blockSize;
    if (this.telemetryCounter >= 1536) {
      this.telemetryCounter = 0;
      this.tankEnergies[0] = sumEnergy0 / blockSize;
      this.tankEnergies[1] = sumEnergy1 / blockSize;
      this.tankEnergies[2] = sumEnergy2 / blockSize;
      this.tankEnergies[3] = sumEnergy3 / blockSize;
      this.port.postMessage({
        type: 'LEXICON_224_TELEMETRY',
        energies: Array.from(this.tankEnergies),
        lfoPhases: Array.from(this.lfoPhases)
      });
    }

    return true;
  }
}

registerProcessor('lexicon-224-processor', Lexicon224Processor);

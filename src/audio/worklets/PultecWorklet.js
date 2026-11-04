/**
 * PultecWorklet.js
 * Stage 2: Pultec EQP-1A3 Passive Program Equalizer with Push-Pull 12AX7/12AU7 Tube Makeup Stage.
 * Implements the interactive LF Boost + LF Atten "Pultec Low-End Trick" (offset corner frequencies
 * + RLC interaction notch), HF Inductor Bell Boost with variable Bandwidth (Q), and HF Passive Shelf Cut.
 */

class PultecProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Low Frequency Selector: 20, 30, 60, or 100 Hz
      { name: 'lowFreq', defaultValue: 60, minValue: 20, maxValue: 100, automationRate: 'k-rate' },
      // LF Boost (0.0 to 10.0 -> up to +13.5 dB)
      { name: 'lowBoost', defaultValue: 3.5, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' },
      // LF Atten (0.0 to 10.0 -> up to -17.5 dB at 1.48 * lowFreq)
      { name: 'lowAtten', defaultValue: 2.5, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' },
      // High Frequency Bell Boost Selector: 3000, 4000, 5000, 8000, 10000, 12000, 16000 Hz
      { name: 'highFreq', defaultValue: 8000, minValue: 3000, maxValue: 16000, automationRate: 'k-rate' },
      // HF Boost (0.0 to 10.0 -> up to +16.0 dB)
      { name: 'highBoost', defaultValue: 4.0, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' },
      // HF Bandwidth (0.0 = Sharp / High Q, 10.0 = Broad / Low Q)
      { name: 'bandwidth', defaultValue: 5.0, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' },
      // High Frequency Atten Selector: 5000, 10000, 20000 Hz
      { name: 'attenFreq', defaultValue: 10000, minValue: 5000, maxValue: 20000, automationRate: 'k-rate' },
      // HF Atten (0.0 to 10.0 -> up to -16.0 dB)
      { name: 'highAtten', defaultValue: 1.5, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' },
      // EQ In/Out Bypass (0 = Active, 1 = Bypass)
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;
    // Stereo filter state cascades (5 biquad sections per channel)
    this.states = [this._createChannelStates(), this._createChannelStates()];
  }

  _createChannelStates() {
    return {
      lfBoost: { x1: 0, x2: 0, y1: 0, y2: 0 },
      lfAtten: { x1: 0, x2: 0, y1: 0, y2: 0 },
      lfNotch: { x1: 0, x2: 0, y1: 0, y2: 0 },
      hfBoost: { x1: 0, x2: 0, y1: 0, y2: 0 },
      hfAtten: { x1: 0, x2: 0, y1: 0, y2: 0 }
    };
  }

  _calcLowShelf(f0, gainDb, S = 0.72) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * f0) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

    const b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);
    const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
    const b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);
    const a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;
    const a1 = -2 * ((A - 1) + (A + 1) * cosW0);
    const a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;

    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  _calcHighShelf(f0, gainDb, S = 0.75) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * Math.min(f0, this.fs * 0.46)) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

    const b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
    const b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
    const a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
    const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
    const a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;

    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  _calcPeaking(f0, Q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * Math.min(f0, this.fs * 0.46)) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    const b0 = 1 + alpha * A;
    const b1 = -2 * cosW0;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha / A;

    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  _runBiquad(x, coeffs, state) {
    const y =
      coeffs.b0 * x +
      coeffs.b1 * state.x1 +
      coeffs.b2 * state.x2 -
      coeffs.a1 * state.y1 -
      coeffs.a2 * state.y2;
    state.x2 = state.x1;
    state.x1 = x;
    state.y2 = state.y1;
    state.y1 = y;
    return y;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const bypass = parameters.bypass[0] > 0.5;
    const lowFreq = parameters.lowFreq[0];
    const lowBoostDial = parameters.lowBoost[0];
    const lowAttenDial = parameters.lowAtten[0];
    const highFreq = parameters.highFreq[0];
    const highBoostDial = parameters.highBoost[0];
    const bandwidthDial = parameters.bandwidth[0];
    const attenFreq = parameters.attenFreq[0];
    const highAttenDial = parameters.highAtten[0];

    // 1. Pultec Passive Network Gain Mapping
    const lfBoostDb = (lowBoostDial / 10.0) * 13.5;
    const lfAttenDb = -(lowAttenDial / 10.0) * 17.5;
    // In the Pultec passive RC network, the LF Attenuation capacitor taps a higher corner frequency
    // than the LF Boost path, and simultaneous Boost+Atten creates an interactive dip at 1.75 * lowFreq.
    const lfBoostCoeffs = this._calcLowShelf(lowFreq * 0.92, lfBoostDb, 0.65);
    const lfAttenCoeffs = this._calcLowShelf(lowFreq * 1.52, lfAttenDb, 0.60);

    // Interactive Pultec Notch when both LF Boost and LF Atten are engaged
    const interactionDepthDb = -Math.min(lfBoostDb, Math.abs(lfAttenDb)) * 0.28;
    const lfNotchCoeffs = this._calcPeaking(lowFreq * 1.85, 0.85, interactionDepthDb);

    // 2. High-Frequency Inductor RLC Tank Boost
    // Bandwidth 0 (Sharp) -> Q = 2.8, Bandwidth 10 (Broad) -> Q = 0.48
    const hfQ = 2.8 * Math.pow(0.48 / 2.8, bandwidthDial / 10.0);
    const hfBoostDb = (highBoostDial / 10.0) * 16.0;
    const hfBoostCoeffs = this._calcPeaking(highFreq, hfQ, hfBoostDb);

    // 3. High-Frequency Passive RC Attenuation Shelf
    const hfAttenDb = -(highAttenDial / 10.0) * 16.0;
    const hfAttenCoeffs = this._calcHighShelf(attenFreq, hfAttenDb, 0.68);

    const numChannels = Math.min(input.length, output.length, this.states.length);

    for (let ch = 0; ch < numChannels; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      const st = this.states[ch];

      for (let i = 0; i < inCh.length; i++) {
        let x = inCh[i];

        if (bypass) {
          outCh[i] = x;
          continue;
        }

        // Cascade through passive RC & LC sections
        let y = this._runBiquad(x, lfBoostCoeffs, st.lfBoost);
        y = this._runBiquad(y, lfAttenCoeffs, st.lfAtten);
        y = this._runBiquad(y, lfNotchCoeffs, st.lfNotch);
        y = this._runBiquad(y, hfBoostCoeffs, st.hfBoost);
        y = this._runBiquad(y, hfAttenCoeffs, st.hfAtten);

        // 12AX7 / 12AU7 Push-Pull Makeup Amplifier & Peerless S-217-D Output Transformer
        // Restores the 16 dB passive network insertion loss with subtle 2nd & 3rd harmonic coloration
        const tubeIn = y * 1.05;
        const tubeOut = Math.tanh(tubeIn) + 0.032 * tubeIn * tubeIn * (1.0 - 0.25 * Math.abs(tubeIn));
        outCh[i] = tubeOut * 0.96;
      }
    }

    if (input.length === 1 && output.length > 1) {
      output[1].set(output[0]);
    }

    return true;
  }
}

registerProcessor('pultec-eq-processor', PultecProcessor);

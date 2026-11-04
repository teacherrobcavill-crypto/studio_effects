/**
 * MicWorklet.js
 * Stage 1 & 2 Microphone Transducer, Proximity Effect, Input/Output Transformer Core Saturation,
 * and Telefunken VF14M / RCA 6SJ7 Single-Ended Triode Asymmetric Polynomial Waveshaper.
 */

class MicPreampProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // 0 = Neumann U47 (VF14M Tube Condenser)
      // 1 = RCA 44-BX (Bi-directional Velocity Ribbon)
      // 2 = Shure 55SH (Unidyne Moving-Coil Dynamic)
      { name: 'micModel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      // Distance in feet (0.25 ft to 25 ft) for Proximity Effect calculation
      { name: 'distanceFeet', defaultValue: 2.5, minValue: 0.25, maxValue: 30.0, automationRate: 'k-rate' },
      // Preamp stepped input drive in dB (-10 to +36 dB)
      { name: 'driveDb', defaultValue: 6.0, minValue: -12.0, maxValue: 36.0, automationRate: 'k-rate' },
      // Transformer iron saturation factor (0.0 to 1.0)
      { name: 'transformerSat', defaultValue: 0.45, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Pad (-20 dB) switch (0 or 1)
      { name: 'padEnabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Phase invert (0 = normal, 1 = 180 deg inverted)
      { name: 'phaseInvert', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;

    // Per-channel filter states (supports stereo or mono)
    this.channels = [this._createChannelState(), this._createChannelState()];
    this.meterCounter = 0;
  }

  _createChannelState() {
    return {
      // Proximity 1st-order low-shelf state
      proxZ1: 0.0,
      // Transformer magnetic flux integrator state (Phi = integral of voltage)
      fluxState: 0.0,
      // High-frequency transducer diaphragm damping biquad state
      hfX1: 0.0,
      hfX2: 0.0,
      hfY1: 0.0,
      hfY2: 0.0,
      // Presence peak biquad state (U47 K47 capsule 4.5kHz rise or Shure 55 3kHz peak)
      presX1: 0.0,
      presX2: 0.0,
      presY1: 0.0,
      presY2: 0.0,
      // DC blocker state (12 Hz high-pass)
      dcX1: 0.0,
      dcY1: 0.0
    };
  }

  /**
   * Computes biquad coefficients for transducer presence peak (peaking EQ)
   */
  _calcPeakingCoeffs(f0, Q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * f0) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    const b0 = 1 + alpha * A;
    const b1 = -2 * cosW0;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha / A;

    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    };
  }

  /**
   * Computes biquad coefficients for 2nd-order low-pass transducer roll-off
   */
  _calcLowPassCoeffs(fc, Q) {
    const w0 = (2 * Math.PI * fc) / this.fs;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    const b0 = (1 - cosW0) / 2;
    const b1 = 1 - cosW0;
    const b2 = (1 - cosW0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha;

    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const micModel = Math.round(parameters.micModel[0]);
    const distFeet = Math.max(0.25, parameters.distanceFeet[0]);
    const driveDb = parameters.driveDb[0];
    const transSat = parameters.transformerSat[0];
    const padEnabled = parameters.padEnabled[0] > 0.5;
    const phaseInvert = parameters.phaseInvert[0] > 0.5 ? -1.0 : 1.0;

    // 1. Microphone Model Acoustic Parameters
    // Model 0: Neumann U47 (Cardioid Condenser, moderate proximity, +2.8dB @ 4.8kHz, 15.5kHz rolloff, VF14M tube)
    // Model 1: RCA 44-BX (Figure-8 Ribbon, strong proximity beta=1.0, smooth -1.5dB @ 3.5kHz, 11.5kHz ribbon mass rolloff)
    // Model 2: Shure 55SH (Cardioid Dynamic, moderate proximity, +4.5dB @ 3.2kHz presence, 9.8kHz rolloff)
    let betaProx = 0.55;
    let presFreq = 4800;
    let presQ = 1.1;
    let presGainDb = 2.8;
    let lpFreq = 15500;
    let lpQ = 0.707;
    let gridBias = 0.16; // VF14M asymmetric bias operating point
    let k2 = 0.085;      // 2nd harmonic (even-order warmth)
    let k3 = 0.022;      // 3rd harmonic

    if (micModel === 1) {
      // RCA 44-BX Velocity Ribbon
      betaProx = 1.0;
      presFreq = 3200;
      presQ = 0.8;
      presGainDb = -1.2;
      lpFreq = 11200;
      lpQ = 0.62;
      gridBias = 0.08;
      k2 = 0.045;
      k3 = 0.038; // Push-pull ribbon step-up transformer odd harmonics
    } else if (micModel === 2) {
      // Shure 55SH Dynamic
      betaProx = 0.65;
      presFreq = 3100;
      presQ = 1.65;
      presGainDb = 4.6;
      lpFreq = 9600;
      lpQ = 0.8;
      gridBias = 0.12;
      k2 = 0.06;
      k3 = 0.05;
    }

    // 2. Proximity Effect 1st-Order Shelf Calculation
    // Physical equation: Boost proportional to beta * c / (w0 * d)
    const distMeters = distFeet * 0.3048;
    const proxBoostLinear = 1.0 + betaProx * (0.38 / Math.max(0.08, distMeters));
    const proxShelfFreq = 160.0;
    const proxAlpha = Math.exp((-2.0 * Math.PI * proxShelfFreq) / this.fs);

    // 3. Capsule Biquad Coefficients
    const presCoeffs = this._calcPeakingCoeffs(presFreq, presQ, presGainDb);
    const lpCoeffs = this._calcLowPassCoeffs(lpFreq, lpQ);

    // 4. Preamp Gain & Pad
    const padGain = padEnabled ? 0.1 : 1.0; // -20 dB pad
    const driveLinear = Math.pow(10, driveDb / 20) * padGain;
    // Automatic output makeup trim so extreme preamp drive saturates without deafening volume spikes
    const makeupGain = 1.0 / Math.pow(Math.max(1.0, driveLinear), 0.55);

    // Transformer flux integrator leak factor (models 35 Hz core saturation threshold)
    const fluxLeak = Math.exp((-2.0 * Math.PI * 35.0) / this.fs);
    const dcCoeff = Math.exp((-2.0 * Math.PI * 12.0) / this.fs);

    const biasOffset = Math.tanh(driveLinear * gridBias);
    let peakOut = 0.0;
    let peakHarmonic = 0.0;

    const numChannels = Math.min(input.length, output.length, this.channels.length);

    for (let ch = 0; ch < numChannels; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      const state = this.channels[ch];

      for (let i = 0; i < inCh.length; i++) {
        let x = inCh[i];

        // A. Proximity Effect (1st-order low-pass shelf blended with dry signal)
        state.proxZ1 = (1.0 - proxAlpha) * x + proxAlpha * state.proxZ1;
        x = x + (proxBoostLinear - 1.0) * state.proxZ1;

        // B. Capsule Presence Biquad
        const pOut =
          presCoeffs.b0 * x +
          presCoeffs.b1 * state.presX1 +
          presCoeffs.b2 * state.presX2 -
          presCoeffs.a1 * state.presY1 -
          presCoeffs.a2 * state.presY2;
        state.presX2 = state.presX1;
        state.presX1 = x;
        state.presY2 = state.presY1;
        state.presY1 = pOut;
        x = pOut;

        // C. Input Transformer Core Hysteresis & Low-Frequency Flux Saturation
        // Magnetic flux Phi is the time-integral of input voltage; saturates hardest at low frequencies
        state.fluxState = fluxLeak * state.fluxState + (1.0 - fluxLeak) * x * driveLinear;
        const fluxSat = state.fluxState / (1.0 + transSat * 1.8 * Math.abs(state.fluxState));
        const transformerSignal = x * driveLinear + transSat * 0.35 * (fluxSat - state.fluxState);

        // D. VF14M / 6SJ7 Single-Ended Triode Asymmetric Polynomial Waveshaper
        // y_tube(v) = (tanh(v - b_grid) + tanh(b_grid)) / (1 + alpha_2 * v^2) + k2 * v^2 + k3 * v^3
        const v = transformerSignal;
        const vSq = v * v;
        const gridConductionCompression = 1.0 / (1.0 + 0.08 * vSq);
        const tubeCore = (Math.tanh(v - driveLinear * gridBias) + biasOffset) * gridConductionCompression;
        const polyHarmonics = k2 * vSq * Math.sign(v + 0.15) + k3 * (vSq * v);
        let y = (tubeCore + polyHarmonics * 0.25) * makeupGain;

        // Track harmonic distortion amount for UI telemetry
        const harmDiff = Math.abs(y - x);
        if (harmDiff > peakHarmonic) peakHarmonic = harmDiff;

        // E. High-Frequency Diaphragm & Output Transformer Inductance Roll-off
        const lpOut =
          lpCoeffs.b0 * y +
          lpCoeffs.b1 * state.hfX1 +
          lpCoeffs.b2 * state.hfX2 -
          lpCoeffs.a1 * state.hfY1 -
          lpCoeffs.a2 * state.hfY2;
        state.hfX2 = state.hfX1;
        state.hfX1 = y;
        state.hfY2 = state.hfY1;
        state.hfY1 = lpOut;
        y = lpOut;

        // F. Coupling Capacitor DC Blocker (12 Hz 1st-order HPF)
        const dcOut = y - state.dcX1 + dcCoeff * state.dcY1;
        state.dcX1 = y;
        state.dcY1 = dcOut;

        const finalSample = dcOut * phaseInvert;
        outCh[i] = finalSample;

        const absOut = Math.abs(finalSample);
        if (absOut > peakOut) peakOut = absOut;
      }
    }

    // Copy channel 0 to channel 1 if mono input into stereo output
    if (input.length === 1 && output.length > 1) {
      output[1].set(output[0]);
    }

    this.meterCounter += input[0].length;
    if (this.meterCounter >= 2048) {
      this.meterCounter = 0;
      this.port.postMessage({
        peak: peakOut,
        harmonic: Math.min(1.0, peakHarmonic)
      });
    }

    return true;
  }
}

registerProcessor('mic-preamp-processor', MicPreampProcessor);

/**
 * VariMuWorklet.js
 * Stage 2: Fairchild 660 / Gates STA-Level Variable-Mu Tube Compressor.
 * Implements Feedback Sidechain Rectification, Program-Dependent Dual-RC Time Constants (Positions 1-6),
 * Remote-Cutoff 6386 Triode Exponential Transconductance Gain Law, and Push-Pull Output Stage Saturation.
 */

class VariMuProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Input Gain / Drive into the Vari-Mu stage (-12 to +24 dB)
      { name: 'inputGainDb', defaultValue: 4.0, minValue: -12.0, maxValue: 24.0, automationRate: 'k-rate' },
      // AC Threshold (0.0 to 1.0, controls sidechain amplifier drive)
      { name: 'threshold', defaultValue: 0.45, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Fairchild 660 Time Constant Switch (1 to 6)
      { name: 'timeConstant', defaultValue: 3, minValue: 1, maxValue: 6, automationRate: 'k-rate' },
      // DC Threshold / Knee bias (0.0 = soft Vari-Mu knee, 1.0 = harder limiting knee)
      { name: 'dcBias', defaultValue: 0.35, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Makeup / Output Level in dB (-12 to +18 dB)
      { name: 'outputGainDb', defaultValue: 3.0, minValue: -12.0, maxValue: 18.0, automationRate: 'k-rate' },
      // Bypass switch (0 = active, 1 = bypass)
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;

    // Feedback sidechain dual-capacitor envelope states (V_fast and V_slow)
    this.vFast = 0.0;
    this.vSlow = 0.0;
    this.prevOutL = 0.0;
    this.prevOutR = 0.0;
    this.meterCounter = 0;
  }

  /**
   * Returns attack/release time constants (in seconds) for Fairchild 660 positions 1-6.
   * Positions 5 & 6 use dual program-dependent RC networks (fast transient + slow program memory).
   */
  _getTimeConstantProfile(pos) {
    switch (Math.round(pos)) {
      case 1:
        return { tAtt: 0.0002, tRelFast: 0.3, tRelSlow: 0.3, dualWeight: 0.0 };
      case 2:
        return { tAtt: 0.0002, tRelFast: 0.8, tRelSlow: 0.8, dualWeight: 0.0 };
      case 3:
        return { tAtt: 0.0004, tRelFast: 2.0, tRelSlow: 2.0, dualWeight: 0.0 };
      case 4:
        return { tAtt: 0.0008, tRelFast: 5.0, tRelSlow: 5.0, dualWeight: 0.0 };
      case 5:
        // Program dependent: 200ms fast release + 2.0s program-density release
        return { tAtt: 0.0004, tRelFast: 0.2, tRelSlow: 2.0, dualWeight: 0.55 };
      case 6:
      default:
        // Program dependent: 300ms fast release + 10.0s sustained program release
        return { tAtt: 0.0004, tRelFast: 0.3, tRelSlow: 10.0, dualWeight: 0.72 };
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const bypass = parameters.bypass[0] > 0.5;
    const inGainLinear = Math.pow(10, parameters.inputGainDb[0] / 20);
    const outGainLinear = Math.pow(10, parameters.outputGainDb[0] / 20);
    const acThreshold = parameters.threshold[0];
    const dcBias = parameters.dcBias[0];
    const tcProfile = this._getTimeConstantProfile(parameters.timeConstant[0]);

    const alphaAtt = Math.exp(-1.0 / (tcProfile.tAtt * this.fs));
    const alphaRelFast = Math.exp(-1.0 / (tcProfile.tRelFast * this.fs));
    const alphaRelSlow = Math.exp(-1.0 / (tcProfile.tRelSlow * this.fs));
    // Slow capacitor charges slightly slower than fast peak capacitor (program density detector)
    const alphaSlowCharge = Math.exp(-1.0 / (0.035 * this.fs));

    // Sidechain amplification factor based on AC Threshold knob
    const sidechainDrive = Math.pow(acThreshold * 3.2, 1.6) * 4.5;
    // DC bias sets cathode-grid knee threshold (0.08V to 0.55V)
    const kneeThreshold = 0.08 + (1.0 - dcBias) * 0.42;
    // Remote-cutoff transconductance curvature constant kappa
    const kappa = 0.65 + dcBias * 0.55;

    // Subtle tube mismatch in push-pull stage (adds authentic 2nd harmonic warmth alongside odd harmonics)
    const balanceMismatch = 0.045;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    let maxGrDb = 0.0;
    let peakIn = 0.0;
    let peakOut = 0.0;

    for (let i = 0; i < inL.length; i++) {
      const rawL = inL[i];
      const rawR = inR[i];

      const absIn = Math.max(Math.abs(rawL), Math.abs(rawR));
      if (absIn > peakIn) peakIn = absIn;

      if (bypass) {
        outL[i] = rawL;
        if (output.length > 1) outR[i] = rawR;
        if (absIn > peakOut) peakOut = absIn;
        continue;
      }

      const xL = rawL * inGainLinear;
      const xR = rawR * inGainLinear;

      // 1. Feedback Sidechain Detection (Rectifies previous output sample, true to Fairchild 660 topology)
      const fbPeak = Math.max(Math.abs(this.prevOutL), Math.abs(this.prevOutR));
      const scRectified = Math.max(0.0, fbPeak * sidechainDrive - kneeThreshold);

      // 2. Dual Program-Dependent RC Network
      if (scRectified > this.vFast) {
        this.vFast = alphaAtt * this.vFast + (1.0 - alphaAtt) * scRectified;
      } else {
        this.vFast = alphaRelFast * this.vFast + (1.0 - alphaRelFast) * scRectified;
      }

      if (scRectified > this.vSlow) {
        this.vSlow = alphaSlowCharge * this.vSlow + (1.0 - alphaSlowCharge) * scRectified;
      } else {
        this.vSlow = alphaRelSlow * this.vSlow + (1.0 - alphaRelSlow) * scRectified;
      }

      // Control voltage V_c combines fast peak cathode charge and slow program memory capacitor
      const vControl = (1.0 - tcProfile.dualWeight) * this.vFast + tcProfile.dualWeight * Math.max(this.vFast, this.vSlow);

      // 3. Remote-Cutoff 6386 Variable-Mu Exponential Transconductance Law:
      // G_mu(V_c) = exp(-kappa * V_c / (1 + 0.18 * V_c))
      const gMu = Math.exp((-kappa * vControl) / (1.0 + 0.18 * vControl));

      const grDb = -20.0 * Math.log10(Math.max(1e-4, gMu));
      if (grDb > maxGrDb) maxGrDb = grDb;

      // Apply Vari-Mu gain to stereo signal
      const compL = xL * gMu;
      const compR = xR * gMu;

      // 4. Push-Pull Parallel Tube Output Stage (Balanced tanh with slight plate asymmetry)
      const ppL = 0.5 * (Math.tanh(compL + balanceMismatch) - Math.tanh(-compL + balanceMismatch));
      const ppR = 0.5 * (Math.tanh(compR + balanceMismatch) - Math.tanh(-compR + balanceMismatch));

      this.prevOutL = ppL;
      this.prevOutR = ppR;

      const finalL = ppL * outGainLinear;
      const finalR = ppR * outGainLinear;

      outL[i] = finalL;
      if (output.length > 1) {
        outR[i] = finalR;
      }

      const absOut = Math.max(Math.abs(finalL), Math.abs(finalR));
      if (absOut > peakOut) peakOut = absOut;
    }

    this.meterCounter += inL.length;
    if (this.meterCounter >= 1024) {
      this.meterCounter = 0;
      this.port.postMessage({
        grDb: maxGrDb,
        peakIn,
        peakOut
      });
    }

    return true;
  }
}

registerProcessor('vari-mu-processor', VariMuProcessor);

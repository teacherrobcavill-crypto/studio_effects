/**
 * LatheWorklet.js
 * Stage 4: Scully 601 / Neumann AM-32B Master Disc Cutting Lathe & Western Electric Cutterhead.
 * Implements:
 *  1. Elliptical Filter (< 150 Hz vertical-to-lateral mono bass summing to prevent groove lift)
 *  2. Exact RIAA Record Pre-Emphasis (T1=3180us, T2=318us, T3=75us) -> Cutterhead -> RIAA Playback De-Emphasis
 *  3. Stylus Acceleration Limiter (2nd-derivative d^2x/dt^2 curvature detector & dynamic HF damper)
 *  4. Tangential Groove Velocity v(r) = (2*pi*RPM/60)*r Inner-Groove HF Scanning Loss & Pinch Distortion
 *  5. Physical Shellac (78 RPM) / Vinyl (45 & 33.3 RPM) Poisson Impulse Crackle, Dust Pops & Platter Rumble
 */

class CuttingLatheProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Platter Speed: 33.3, 45, or 78 RPM
      { name: 'rpm', defaultValue: 45, minValue: 33.3, maxValue: 78, automationRate: 'k-rate' },
      // Stylus Groove Position (0.0 = Outer Rim r=5.75", 1.0 = Inner Label Groove r=2.15")
      { name: 'groovePosition', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Cutterhead Drive / Hot Cut Level in dB (-12 to +15 dB)
      { name: 'cutterDriveDb', defaultValue: 2.0, minValue: -12.0, maxValue: 15.0, automationRate: 'k-rate' },
      // Stylus HF Acceleration Limiter Threshold (0.1 = aggressive limiting, 1.0 = relaxed)
      { name: 'accelLimit', defaultValue: 0.55, minValue: 0.1, maxValue: 1.0, automationRate: 'k-rate' },
      // Surface Wear / Shellac Crackle & Platter Rumble (0.0 to 1.0)
      { name: 'surfaceWear', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Mono / Stereo Cutterhead Mode (1 = 1950s True Lateral Mono, 0 = Stereo Westrex 45/45)
      { name: 'monoCut', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Bypass (0 = Active, 1 = Bypass)
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;
    this.prngState = 0x9e3779b9;
    this.rumblePhase1 = 0.0;
    this.rumblePhase2 = 1.7;
    this.crackleResX1 = 0.0;
    this.crackleResX2 = 0.0;
    this.crackleResY1 = 0.0;
    this.crackleResY2 = 0.0;
    this.ellipticalSideZ1 = 0.0;
    this.accelEnv = 0.0;
    this.meterCounter = 0;

    // Precompute RIAA biquad coefficients for current sampleRate
    this.riaaCoeffs = this._computeRIAACoeffs();
    this.channels = [this._createChannelState(), this._createChannelState()];
  }

  _createChannelState() {
    return {
      // RIAA Pre-emphasis biquad state
      preX1: 0.0,
      preX2: 0.0,
      preY1: 0.0,
      preY2: 0.0,
      // Stylus 2nd-derivative history states x[n-1], x[n-2]
      stylX1: 0.0,
      stylX2: 0.0,
      // Acceleration HF damper filter state
      dampZ1: 0.0,
      // Inner-groove scanning loss low-pass state
      scanZ1: 0.0,
      scanZ2: 0.0,
      // RIAA De-emphasis biquad state
      deX1: 0.0,
      deX2: 0.0,
      deY1: 0.0,
      deY2: 0.0
    };
  }

  /**
   * Computes matched digital biquad coefficients for RIAA Playback De-Emphasis
   * (T1 = 3180 us, T2 = 318 us, T3 = 75 us) and its exact inverse for RIAA Record Pre-Emphasis.
   */
  _computeRIAACoeffs() {
    // Analog transfer function of RIAA playback de-emphasis with Neumann ultrasonic pole T4:
    // H_de(s) = ((1 + s * T2) * (1 + s * T4)) / ((1 + s * T1) * (1 + s * T3))
    const T1 = 0.003180; // 50.05 Hz bass pole
    const T2 = 0.000318; // 500.5 Hz midrange zero
    const T3 = 0.000075; // 2122.1 Hz treble pole
    const T4 = 0.000015; // 15 us Neumann cutterhead ultrasonic pole (prevents z = -1 Nyquist pole in H_pre)

    const c = 2.0 * this.fs; // Bilinear transform constant 2/T

    // Denominator (1 + s*T1)(1 + s*T3) = 1 + s*(T1+T3) + s^2*(T1*T3)
    const A0 = 1.0;
    const A1 = T1 + T3;
    const A2 = T1 * T3;

    // Numerator (1 + s*T2)(1 + s*T4) = 1 + s*(T2+T4) + s^2*(T2*T4)
    const B0 = 1.0;
    const B1 = T2 + T4;
    const B2 = T2 * T4;

    const a0 = A0 + A1 * c + A2 * c * c;
    const a1 = 2.0 * A0 - 2.0 * A2 * c * c;
    const a2 = A0 - A1 * c + A2 * c * c;

    const b0 = B0 + B1 * c + B2 * c * c;
    const b1 = 2.0 * B0 - 2.0 * B2 * c * c;
    const b2 = B0 - B1 * c + B2 * c * c;

    // Normalize for 0 dB gain at 1000 Hz
    const w1k = (2.0 * Math.PI * 1000.0) / this.fs;
    const cos1 = Math.cos(w1k);
    const cos2 = Math.cos(2.0 * w1k);
    const sin1 = Math.sin(w1k);
    const sin2 = Math.sin(2.0 * w1k);

    const numRe = b0 + b1 * cos1 + b2 * cos2;
    const numIm = -b1 * sin1 - b2 * sin2;
    const denRe = a0 + a1 * cos1 + a2 * cos2;
    const denIm = -a1 * sin1 - a2 * sin2;

    const mag1k = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
    const normB0 = b0 / (a0 * mag1k);
    const normB1 = b1 / (a0 * mag1k);
    const normB2 = b2 / (a0 * mag1k);
    const normA1 = a1 / a0;
    const normA2 = a2 / a0;

    return {
      // Playback De-Emphasis
      de: { b0: normB0, b1: normB1, b2: normB2, a1: normA1, a2: normA2 },
      // Record Pre-Emphasis (Exact inverse transfer function H_pre(z) = 1 / H_de(z))
      pre: {
        b0: 1.0 / normB0,
        b1: normA1 / normB0,
        b2: normA2 / normB0,
        a1: normB1 / normB0,
        a2: normB2 / normB0
      }
    };
  }

  _nextNoise() {
    let x = this.prngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.prngState = x;
    return (x | 0) / 2147483648.0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const bypass = parameters.bypass[0] > 0.5;
    const rpm = parameters.rpm[0];
    const groovePos = parameters.groovePosition[0];
    const cutterDriveDb = parameters.cutterDriveDb[0];
    const accelLimit = parameters.accelLimit[0];
    const surfaceWear = parameters.surfaceWear[0];
    const monoCut = parameters.monoCut[0] > 0.5;

    const driveLinear = Math.pow(10, cutterDriveDb / 20);
    const driveMakeup = 1.0 / Math.pow(Math.max(1.0, driveLinear), 0.5);

    // 1. Physical Groove Geometry & Tangential Velocity Calculation
    // Outer radius r_out = 5.75 in (12" LP/78) or 3.3" (7" 45), inner radius r_in = 2.15 in
    const rInches = 5.75 - groovePos * (5.75 - 2.15);
    const omegaRadSec = (2.0 * Math.PI * rpm) / 60.0;
    const vGrooveInchesPerSec = omegaRadSec * rInches;

    // Stylus tip scanning cutoff frequency f_scan proportional to tangential velocity v(r)
    // 78 RPM shellac uses a wider 2.7 mil stylus, but spins fast; inner grooves on 33.3 RPM suffer sharpest HF loss
    const baseMediaBandwidth = rpm >= 70 ? 11500.0 : rpm >= 40 ? 15500.0 : 14200.0;
    const velocityRatio = Math.min(1.25, vGrooveInchesPerSec / 18.0);
    const scanCutoffHz = Math.max(2800.0, Math.min(this.fs * 0.44, baseMediaBandwidth * (0.48 + 0.52 * velocityRatio)));
    const scanAlpha = Math.exp((-2.0 * Math.PI * scanCutoffHz) / this.fs);

    // Inner-groove pinch effect (2nd harmonic geometric tracing distortion increases as 1 / v_groove)
    const pinchFactor = 0.035 * (1.0 + groovePos * 1.8) * (rpm < 40 ? 1.3 : 0.9);

    // Elliptical filter high-pass on Side (L-R) channel at 150 Hz so bass is strictly lateral
    const ellipAlpha = Math.exp((-2.0 * Math.PI * 150.0) / this.fs);

    // Turntable platter motor & bearing rumble (29.5 Hz + 59 Hz)
    const dRumble1 = (2.0 * Math.PI * 29.5) / this.fs;
    const dRumble2 = (2.0 * Math.PI * 59.0) / this.fs;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    const pre = this.riaaCoeffs.pre;
    const de = this.riaaCoeffs.de;

    let maxAccelLimiting = 0.0;

    for (let i = 0; i < inL.length; i++) {
      let xL = inL[i];
      let xR = inR[i];

      if (bypass) {
        outL[i] = xL;
        if (output.length > 1) outR[i] = xR;
        continue;
      }

      // A. Elliptical Filter / Lateral Mono Summing
      const mid = 0.5 * (xL + xR);
      const side = 0.5 * (xL - xR);
      this.ellipticalSideZ1 = (1.0 - ellipAlpha) * side + ellipAlpha * this.ellipticalSideZ1;
      const highPassedSide = monoCut ? 0.0 : side - this.ellipticalSideZ1;

      const latIn = [mid + highPassedSide, mid - highPassedSide];

      // B. Generate Physical Surface Noise (Poisson Dust Pops + Shellac Grain + Platter Rumble)
      this.rumblePhase1 = (this.rumblePhase1 + dRumble1) % (2 * Math.PI);
      this.rumblePhase2 = (this.rumblePhase2 + dRumble2) % (2 * Math.PI);
      const rumble = (0.7 * Math.sin(this.rumblePhase1) + 0.3 * Math.sin(this.rumblePhase2)) * surfaceWear * 0.0022;

      const rand = this._nextNoise();
      // Shellac 78 RPM has higher continuous abrasive grain + more frequent crackle impulses
      const is78 = rpm >= 70;
      const popThreshold = 1.0 - surfaceWear * (is78 ? 0.0045 : 0.0018);
      const popImpulse = Math.abs(rand) > popThreshold ? Math.sign(rand) * surfaceWear * (is78 ? 0.16 : 0.09) : 0.0;
      const grainNoise = rand * surfaceWear * (is78 ? 0.0065 : 0.0018);

      // Resonant tonearm/cartridge impulse shaping (~2.8 kHz damped needle ping)
      const cIn = popImpulse + grainNoise;
      const cOut = 0.35 * cIn - 0.55 * this.crackleResX1 + 0.85 * this.crackleResY1 - 0.38 * this.crackleResY2;
      this.crackleResX1 = cIn;
      this.crackleResY2 = this.crackleResY1;
      this.crackleResY1 = cOut;

      for (let ch = 0; ch < 2; ch++) {
        const st = this.channels[ch];
        const sigIn = latIn[ch] * driveLinear;

        // 1. RIAA Record Pre-Emphasis (Boosts HF +20dB, cuts LF -20dB before cutterhead coil)
        let preOut =
          pre.b0 * sigIn +
          pre.b1 * st.preX1 +
          pre.b2 * st.preX2 -
          pre.a1 * st.preY1 -
          pre.a2 * st.preY2;
        st.preX2 = st.preX1;
        st.preX1 = sigIn;
        st.preY2 = st.preY1;
        st.preY1 = preOut;

        // Clamp extreme ultrasonic spikes in RIAA pre-emphasis
        preOut = Math.max(-6.0, Math.min(6.0, preOut));

        // 2. Stylus 2nd-Derivative Acceleration Detector: a[n] = x[n] - 2*x[n-1] + x[n-2]
        const accel = Math.abs(preOut - 2.0 * st.stylX1 + st.stylX2);
        st.stylX2 = st.stylX1;
        st.stylX1 = preOut;

        const thresh = accelLimit * 1.8;
        const overAccel = Math.max(0.0, accel - thresh);
        this.accelEnv = 0.96 * this.accelEnv + 0.04 * overAccel;

        // Dynamic HF acceleration damper (shunts HF current when stylus curvature exceeds safe limit)
        const dampFactor = Math.min(0.88, this.accelEnv * 0.65);
        if (dampFactor > maxAccelLimiting) maxAccelLimiting = dampFactor;

        st.dampZ1 = (1.0 - dampFactor) * preOut + dampFactor * st.dampZ1;

        // 3. Western Electric Cutterhead Magnetic Coil Saturation + Inner-Groove Pinch Harmonics
        const coilDrive = st.dampZ1 * 0.45;
        const cutterWave = Math.tanh(coilDrive) * 2.22 + pinchFactor * coilDrive * coilDrive;

        // 4. Inner-Groove Finite Stylus Tip Scanning Loss (2-pole cascade low-pass filter)
        st.scanZ1 = (1.0 - scanAlpha) * cutterWave + scanAlpha * st.scanZ1;
        st.scanZ2 = (1.0 - scanAlpha) * st.scanZ1 + scanAlpha * st.scanZ2;

        // 5. RIAA Playback Cartridge De-Emphasis (Restores flat frequency response & attenuates HF hiss)
        const deIn = st.scanZ2;
        const deOut =
          de.b0 * deIn +
          de.b1 * st.deX1 +
          de.b2 * st.deX2 -
          de.a1 * st.deY1 -
          de.a2 * st.deY2;
        st.deX2 = st.deX1;
        st.deX1 = deIn;
        st.deY2 = st.deY1;
        st.deY1 = deOut;

        const finalSample = deOut * driveMakeup + cOut + rumble;
        if (ch === 0) {
          outL[i] = finalSample;
        } else if (output.length > 1) {
          outR[i] = finalSample;
        }
      }
    }

    this.meterCounter += inL.length;
    if (this.meterCounter >= 2048) {
      this.meterCounter = 0;
      this.port.postMessage({
        accelLimiting: maxAccelLimiting,
        scanCutoffHz: Math.round(scanCutoffHz),
        tangentialIps: Number(vGrooveInchesPerSec.toFixed(1))
      });
    }

    return true;
  }
}

registerProcessor('cutting-lathe-processor', CuttingLatheProcessor);

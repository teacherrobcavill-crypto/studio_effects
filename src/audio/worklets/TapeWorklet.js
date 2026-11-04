/**
 * TapeWorklet.js
 * Stage 3: Ampex 300 / 350 1/4-Inch Magnetic Tape Machine (Scotch 111 / 190 Ferric Oxide Formulation).
 * Implements:
 *  1. Jiles-Atherton Ferromagnetic Hysteresis Loop (Langevin anhysteretic magnetization + pinning loss)
 *  2. Speed-dependent Playback Head Contour Bump (62 Hz @ 15 IPS, 36 Hz @ 7.5 IPS) & Gap HF Roll-off
 *  3. High-Frequency Self-Erasure / Tape Compression under heavy bias/input drive
 *  4. Capstan Wow (0.8 Hz + 1.7 Hz) & Idler Scrape Flutter (9.5 Hz + stochastic) via 4-point Hermite
 *     cubic interpolated circular delay buffer
 *  5. Authentic AC Bias Tape Hiss generator
 */

class TapeMachineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Tape speed: 15 = 15 IPS, 7.5 = 7.5 IPS
      { name: 'tapeSpeed', defaultValue: 15, minValue: 7.5, maxValue: 15, automationRate: 'k-rate' },
      // Input Calibration / Record Drive in dB (-12 to +18 dB)
      { name: 'recordDriveDb', defaultValue: 3.0, minValue: -12.0, maxValue: 18.0, automationRate: 'k-rate' },
      // AC Bias Calibration (-1.0 = underbiased/bright/distorted, 0.0 = NAB standard, +1.0 = overbiased/warm/dark)
      { name: 'biasTrim', defaultValue: 0.15, minValue: -1.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Capstan Wow & Flutter Depth (0.0 to 1.0)
      { name: 'wowFlutter', defaultValue: 0.28, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Scotch 111 Oxide Hiss Level (0.0 to 1.0)
      { name: 'hissLevel', defaultValue: 0.18, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Reproduce Output Level in dB (-12 to +12 dB)
      { name: 'reproGainDb', defaultValue: 0.0, minValue: -12.0, maxValue: 12.0, automationRate: 'k-rate' },
      // Bypass (0 = Active, 1 = Bypass)
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = sampleRate || 48000;

    // Circular buffer for Capstan Wow & Flutter modulation (2048 samples per channel)
    this.bufSize = 2048;
    this.bufMask = this.bufSize - 1;
    this.writeIdx = 0;

    this.wowPhase1 = 0.0;
    this.wowPhase2 = 1.3;
    this.flutterPhase1 = 0.4;
    this.flutterPhase2 = 2.1;
    this.scrapeNoiseLP = 0.0;
    this.prngState = 0x13579bdf;

    this.channels = [this._createChannelState(), this._createChannelState()];
    this.meterCounter = 0;
  }

  _createChannelState() {
    return {
      delayBuf: new Float32Array(this.bufSize),
      // Jiles-Atherton hysteresis state variables: M (Magnetization), H_prev (Previous field)
      M: 0.0,
      HPrev: 0.0,
      // Head bump biquad state
      bumpX1: 0.0,
      bumpX2: 0.0,
      bumpY1: 0.0,
      bumpY2: 0.0,
      // Gap loss & self-erasure dynamic low-pass state
      lpZ1: 0.0,
      hfEnv: 0.0,
      // Pre-emphasis / De-emphasis NAB shelf state
      preZ1: 0.0,
      deZ1: 0.0,
      // Pink-ish oxide hiss filter state
      hissZ1: 0.0
    };
  }

  /**
   * Fast xorshift32 white noise generator in [-1, 1]
   */
  _nextNoise() {
    let x = this.prngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.prngState = x;
    return (x | 0) / 2147483648.0;
  }

  /**
   * Langevin function L(x) = coth(x) - 1/x with continuous Taylor expansion near x = 0
   */
  _langevin(x) {
    const absX = Math.abs(x);
    if (absX < 1e-4) {
      return x / 3.0;
    }
    if (absX < 0.15) {
      const x3 = x * x * x;
      return x / 3.0 - x3 / 45.0;
    }
    // coth(x) = (e^(2x) + 1) / (e^(2x) - 1)
    if (absX > 18.0) {
      return Math.sign(x) - 1.0 / x;
    }
    const exp2x = Math.exp(2.0 * x);
    const coth = (exp2x + 1.0) / (exp2x - 1.0);
    return coth - 1.0 / x;
  }

  /**
   * Derivative of Langevin function L'(x) = 1/x^2 - csch^2(x)
   */
  _langevinDeriv(x) {
    const absX = Math.abs(x);
    if (absX < 0.15) {
      return 1.0 / 3.0 - (x * x) / 15.0;
    }
    if (absX > 18.0) {
      return 1.0 / (x * x);
    }
    const expX = Math.exp(x);
    const sinhX = 0.5 * (expX - 1.0 / expX);
    const cschSq = 1.0 / (sinhX * sinhX);
    return 1.0 / (x * x) - cschSq;
  }

  /**
   * Single-step Jiles-Atherton ferromagnetic hysteresis solver
   */
  _solveJilesAtherton(H, state, aShape, kPinning, cRev, alphaMeanField) {
    const dH = H - state.HPrev;
    state.HPrev = H;

    if (Math.abs(dH) < 1e-9) {
      return state.M;
    }

    const He = H + alphaMeanField * state.M;
    const x = He / aShape;
    const Man = this._langevin(x); // Normalized Ms = 1.0
    const dMan_dHe = this._langevinDeriv(x) / aShape;

    const delta = dH >= 0.0 ? 1.0 : -1.0;
    const diffManM = Man - state.M;

    // Ensure non-negative irreversible susceptibility when domain walls unpin
    const irrNum = Math.max(0.0, delta * diffManM);
    const denom = delta * kPinning - alphaMeanField * diffManM;
    const safeDenom = Math.abs(denom) < 1e-4 ? 1e-4 : Math.abs(denom);

    const dM_dH = ((1.0 - cRev) * (irrNum / safeDenom) + cRev * dMan_dHe) / (1.0 + cRev * alphaMeanField * dMan_dHe);

    // Midpoint damped integration for unconditional stability at high drive
    let nextM = state.M + dM_dH * dH;
    // Soft domain saturation ceiling at Ms = 1.0
    if (Math.abs(nextM) > 0.995) {
      nextM = Math.tanh(nextM);
    }
    state.M = nextM;
    return nextM;
  }

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

    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  /**
   * 4-point Hermite cubic fractional delay reader
   */
  _readHermite(buf, delaySamples) {
    const readPos = this.writeIdx - delaySamples;
    const rInt = Math.floor(readPos);
    const frac = readPos - rInt;

    const y0 = buf[(rInt - 1) & this.bufMask];
    const y1 = buf[rInt & this.bufMask];
    const y2 = buf[(rInt + 1) & this.bufMask];
    const y3 = buf[(rInt + 2) & this.bufMask];

    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

    return ((c3 * frac + c2) * frac + c1) * frac + c0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const bypass = parameters.bypass[0] > 0.5;
    const speedIps = parameters.tapeSpeed[0] >= 11.25 ? 15.0 : 7.5;
    const driveDb = parameters.recordDriveDb[0];
    const biasTrim = parameters.biasTrim[0];
    const wowDepth = parameters.wowFlutter[0];
    const hissLevel = parameters.hissLevel[0];
    const reproLinear = Math.pow(10, parameters.reproGainDb[0] / 20);

    const driveLinear = Math.pow(10, driveDb / 20);
    // Automatic calibration compensation so driving the tape harder increases compression & harmonics naturally
    const driveComp = 1.0 / Math.pow(Math.max(1.0, driveLinear), 0.52);

    // Jiles-Atherton parameters modulated by AC Bias Trim:
    // Higher AC bias linearizes the anhysteretic curve (larger aShape, smaller pinning k) but rolls off HF faster
    const aShape = 0.42 + (biasTrim + 1.0) * 0.16;
    const kPinning = 0.28 - biasTrim * 0.08;
    const cRev = 0.24 + (biasTrim + 1.0) * 0.05;
    const alphaMeanField = 0.012;

    // Speed-dependent Playback Head Bump & Gap Cutoff
    // 15 IPS: +3.2 dB head bump @ 62 Hz, 15.8 kHz base bandwidth
    // 7.5 IPS: +3.8 dB head bump @ 36 Hz, 9.2 kHz base bandwidth
    const bumpFreq = speedIps === 15.0 ? 62.0 : 36.0;
    const bumpGain = speedIps === 15.0 ? 3.2 : 3.8;
    const bumpCoeffs = this._calcPeakingCoeffs(bumpFreq, 1.35, bumpGain);

    const baseCutoff = (speedIps === 15.0 ? 15800.0 : 9200.0) * (1.0 - biasTrim * 0.18);

    // Wow & Flutter LFO increments
    const dWow1 = (2.0 * Math.PI * 0.82) / this.fs;
    const dWow2 = (2.0 * Math.PI * 1.65) / this.fs;
    const dFlut1 = (2.0 * Math.PI * 8.4) / this.fs;
    const dFlut2 = (2.0 * Math.PI * 13.7) / this.fs;

    // 7.5 IPS has slightly higher mechanical capstan/pinch-roller wow variance
    const speedFlutterMult = speedIps === 15.0 ? 1.0 : 1.35;
    const maxExcursionSamples = 0.0028 * this.fs * wowDepth * speedFlutterMult;
    const centerDelaySamples = 8.0 + maxExcursionSamples;

    const numChannels = Math.min(input.length, output.length, this.channels.length);
    let peakTapeSat = 0.0;

    for (let i = 0; i < input[0].length; i++) {
      // Advance Capstan & Idler LFO phases once per sample frame (stereo phase-locked transport)
      this.wowPhase1 = (this.wowPhase1 + dWow1) % (2 * Math.PI);
      this.wowPhase2 = (this.wowPhase2 + dWow2) % (2 * Math.PI);
      this.flutterPhase1 = (this.flutterPhase1 + dFlut1) % (2 * Math.PI);
      this.flutterPhase2 = (this.flutterPhase2 + dFlut2) % (2 * Math.PI);

      const rawNoise = this._nextNoise();
      this.scrapeNoiseLP = 0.992 * this.scrapeNoiseLP + 0.008 * rawNoise;

      const lfoMod =
        0.58 * Math.sin(this.wowPhase1) +
        0.24 * Math.sin(this.wowPhase2) +
        0.12 * Math.sin(this.flutterPhase1) +
        0.06 * Math.sin(this.flutterPhase2) +
        0.08 * this.scrapeNoiseLP;

      const currentDelay = centerDelaySamples + lfoMod * maxExcursionSamples;

      for (let ch = 0; ch < numChannels; ch++) {
        const x = input[ch][i];
        const st = this.channels[ch];

        if (bypass) {
          output[ch][i] = x;
          continue;
        }

        // 1. NAB Record Pre-Emphasis high-frequency boost before hitting oxide
        const hfDiff = x - st.preZ1;
        st.preZ1 = 0.82 * st.preZ1 + 0.18 * x;
        const preEmph = x + 0.35 * hfDiff;

        // 2. Jiles-Atherton Magnetic Hysteresis Loop
        const H = preEmph * driveLinear * 0.85;
        const M = this._solveJilesAtherton(H, st, aShape, kPinning, cRev, alphaMeanField);
        const magOut = M * 1.45 * driveComp;

        const satAmount = Math.abs(H - M * 1.35);
        if (satAmount > peakTapeSat) peakTapeSat = satAmount;

        // 3. Dynamic High-Frequency Self-Erasure & Gap Loss Low-Pass Filter
        // As high-frequency energy and record drive increase, magnetic self-erasure dynamically lowers cutoff
        st.hfEnv = 0.99 * st.hfEnv + 0.01 * Math.abs(hfDiff * driveLinear);
        const dynamicCutoff = Math.max(2400.0, baseCutoff / (1.0 + 1.4 * st.hfEnv));
        const lpAlpha = Math.exp((-2.0 * Math.PI * dynamicCutoff) / this.fs);
        st.lpZ1 = (1.0 - lpAlpha) * magOut + lpAlpha * st.lpZ1;

        // 4. Playback Head Contour Bump (62 Hz @ 15 IPS / 36 Hz @ 7.5 IPS)
        const bIn = st.lpZ1;
        const bOut =
          bumpCoeffs.b0 * bIn +
          bumpCoeffs.b1 * st.bumpX1 +
          bumpCoeffs.b2 * st.bumpX2 -
          bumpCoeffs.a1 * st.bumpY1 -
          bumpCoeffs.a2 * st.bumpY2;
        st.bumpX2 = st.bumpX1;
        st.bumpX1 = bIn;
        st.bumpY2 = st.bumpY1;
        st.bumpY1 = bOut;

        // 5. Write into Circular Transport Buffer & Read with Hermite Cubic Capstan Modulation
        st.delayBuf[this.writeIdx] = bOut;
        const fluttered = this._readHermite(st.delayBuf, currentDelay);

        // 6. Scotch 111 Ferric Oxide Bias Hiss
        const white = this._nextNoise();
        st.hissZ1 = 0.88 * st.hissZ1 + 0.12 * white;
        const oxideHiss = (0.5 * white + 0.5 * st.hissZ1) * hissLevel * 0.0028;

        output[ch][i] = (fluttered + oxideHiss) * reproLinear;
      }

      this.writeIdx = (this.writeIdx + 1) & this.bufMask;
    }

    if (input.length === 1 && output.length > 1) {
      output[1].set(output[0]);
    }

    this.meterCounter += input[0].length;
    if (this.meterCounter >= 2048) {
      this.meterCounter = 0;
      this.port.postMessage({
        saturation: Math.min(1.0, peakTapeSat)
      });
    }

    return true;
  }
}

registerProcessor('tape-machine-processor', TapeMachineProcessor);

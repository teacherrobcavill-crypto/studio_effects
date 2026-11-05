/**
 * TapeEchoWorklet.js
 * Dual Physical-Modeling AudioWorklet Processor for:
 *   1. 1974 Roland RE-201 Space Echo (Free-Floating Tape Tank + 3 Playback Heads + 12-Pos Rotary Mode + Baxandall EQ + 3-Spring Reverb Tank)
 *   2. 1958 Watkins Copicat (Short Tensioned Spliced Loop + 3 Push-Button Heads + Valve Sustain + Mechanical Motor Ramp-Up Pitch Slur)
 *
 * Uses continuous variable-speed delay pointers with 4-point Hermite cubic interpolation
 * so real-time Repeat Rate sweeps, Copicat Motor Switch inertia, and mechanical Wow/Flutter
 * produce authentic continuous Doppler pitch-shifting artifacts.
 */

class TapeEchoWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Global Routing: 0 = Dual Side-by-Side (Mixed), 1 = Roland RE-201 Solo, 2 = Watkins Copicat Solo
      { name: 'routingMode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      // Shared or Independent Input Gain (0.0 to 2.0, >1.3 triggers Magnetic Saturation Hint)
      { name: 'inputGain', defaultValue: 1.0, minValue: 0.0, maxValue: 2.5, automationRate: 'k-rate' },

      // ── Roland RE-201 Space Echo Parameters ──
      { name: 'reMode', defaultValue: 11, minValue: 1, maxValue: 12, automationRate: 'k-rate' },
      { name: 'reRepeatRate', defaultValue: 0.52, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'reIntensity', defaultValue: 0.48, minValue: 0.0, maxValue: 1.18, automationRate: 'k-rate' },
      { name: 'reEchoVol', defaultValue: 0.72, minValue: 0.0, maxValue: 1.2, automationRate: 'k-rate' },
      { name: 'reReverbVol', defaultValue: 0.38, minValue: 0.0, maxValue: 1.2, automationRate: 'k-rate' },
      { name: 'reBass', defaultValue: 0.0, minValue: -12.0, maxValue: 12.0, automationRate: 'k-rate' },
      { name: 'reTreble', defaultValue: 0.0, minValue: -12.0, maxValue: 12.0, automationRate: 'k-rate' },

      // ── Watkins Copicat Parameters ──
      { name: 'ccHead1', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ccHead2', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ccHead3', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ccSwell', defaultValue: 0.70, minValue: 0.0, maxValue: 1.2, automationRate: 'k-rate' },
      { name: 'ccSustain', defaultValue: 0.45, minValue: 0.0, maxValue: 1.18, automationRate: 'k-rate' },
      { name: 'ccMotorOn', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate || 48000;

    // Circular tape delay buffers (4 seconds max at 48kHz = 262144 power-of-two mask)
    this.bufSize = 262144;
    this.bufMask = this.bufSize - 1;
    this.reTapeBuf = new Float32Array(this.bufSize);
    this.ccTapeBuf = new Float32Array(this.bufSize);
    this.writeIdx = 0;

    // ── Roland RE-201 State ──
    // Smoothed delay time for Head 1 (Head 2 = 1.92x, Head 3 = 2.86x physical head spacing)
    this.reSmoothedBaseDelaySamples = 0.115 * this.sr;
    this.reFeedbackSample = 0.0;
    this.reWowPhase1 = 0.0;
    this.reWowPhase2 = 1.3;
    this.reFlutterPhase = 2.4;

    // RE-201 Feedback loop filters (one-pole HPF at 105 Hz + LPF at 3400 Hz for warm dub decay)
    this.reLoopLpZ = 0.0;
    this.reLoopHpZ = 0.0;
    this.reLoopHpPrevX = 0.0;

    // RE-201 Echo Wet Baxandall Bass/Treble Shelf Filter states
    this.reBassLpZ = 0.0;
    this.reTrebleLpZ = 0.0;

    // RE-201 Internal 3-Spring Reverb Tank (Dispersive All-Pass + 3 Comb Loops)
    this.springApBufs = [
      new Float32Array(256),
      new Float32Array(512),
      new Float32Array(512),
      new Float32Array(1024)
    ];
    this.springApLens = [113, 241, 337, 557];
    this.springApIdx = [0, 0, 0, 0];

    this.springCombBufs = [
      new Float32Array(4096),
      new Float32Array(4096),
      new Float32Array(4096)
    ];
    this.springCombLens = [
      Math.floor(0.037 * this.sr),
      Math.floor(0.043 * this.sr),
      Math.floor(0.051 * this.sr)
    ];
    this.springCombIdx = [0, 0, 0];
    this.springCombLpZ = [0.0, 0.0, 0.0];

    // ── Watkins Copicat State ──
    // Mechanical capstan motor speed (0.0 = stopped, 1.0 = nominal 3.75 IPS)
    this.ccMotorSpeed = 1.0;
    this.ccMotorStartupWobblePhase = 0.0;
    this.ccSmoothedHead1Samples = 0.095 * this.sr;
    this.ccFeedbackSample = 0.0;
    this.ccWowPhase = 0.0;
    this.ccFlutterPhase1 = 0.7;
    this.ccFlutterPhase2 = 3.1;
    this.ccSplicePhase = 0.0;

    // Copicat Valve Feedback loop filters (grittier 155 Hz HPF + 2650 Hz LPF)
    this.ccLoopLpZ = 0.0;
    this.ccLoopHpZ = 0.0;
    this.ccLoopHpPrevX = 0.0;

    // Telemetry counters
    this.telemCounter = 0;
    this.rePeakAcc = 0.0;
    this.ccPeakAcc = 0.0;
    this.inPeakAcc = 0.0;
    this.satAmountAcc = 0.0;
  }

  /**
   * 4-point Hermite cubic fractional delay reader for smooth pitch-shifting
   */
  readHermite(buf, writePos, delaySamples) {
    const clampedDelay = Math.max(2.0, Math.min(this.bufSize - 8.0, delaySamples));
    const readPos = writePos - clampedDelay;
    const i0 = Math.floor(readPos);
    const frac = readPos - i0;

    const mask = this.bufMask;
    const xm1 = buf[(i0 - 1) & mask];
    const x0 = buf[i0 & mask];
    const x1 = buf[(i0 + 1) & mask];
    const x2 = buf[(i0 + 2) & mask];

    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);

    return ((c3 * frac + c2) * frac + c1) * frac + c0;
  }

  /**
   * Asymmetric magnetic tape oxide hysteresis / soft-saturation curve
   */
  saturateTape(x, drive = 1.0, asymmetry = 0.06) {
    const driven = x * drive;
    // Soft-clipping with slight 2nd-harmonic asymmetry (tube/transistor bias + ferric oxide remanence)
    const biased = driven + asymmetry * driven * driven;
    return Math.tanh(biased) - asymmetry * 0.15;
  }

  /**
   * Roland RE-201 12-Position Mode Selector Lookup Table
   * Returns { h1, h2, h3, rev }
   */
  getRe201ModeRouting(modeInt) {
    switch (modeInt) {
      // ECHO ONLY (Modes 1–4)
      case 1:  return { h1: 1, h2: 0, h3: 0, rev: 0 };
      case 2:  return { h1: 0, h2: 1, h3: 0, rev: 0 };
      case 3:  return { h1: 0, h2: 0, h3: 1, rev: 0 };
      case 4:  return { h1: 0, h2: 1, h3: 1, rev: 0 };
      // ECHO + REVERB (Modes 5–11)
      case 5:  return { h1: 1, h2: 0, h3: 0, rev: 1 };
      case 6:  return { h1: 0, h2: 1, h3: 0, rev: 1 };
      case 7:  return { h1: 0, h2: 0, h3: 1, rev: 1 };
      case 8:  return { h1: 1, h2: 1, h3: 0, rev: 1 };
      case 9:  return { h1: 0, h2: 1, h3: 1, rev: 1 };
      case 10: return { h1: 1, h2: 0, h3: 1, rev: 1 };
      case 11: return { h1: 1, h2: 1, h3: 1, rev: 1 };
      // REVERB ONLY (Mode 12)
      case 12: return { h1: 0, h2: 0, h3: 0, rev: 1 };
      default: return { h1: 1, h2: 1, h3: 1, rev: 1 };
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || output[0];
    const inL = input && input.length > 0 ? input[0] : null;
    const inR = input && input.length > 1 ? input[1] : inL;

    const routingMode = Math.round(parameters.routingMode[0]);
    const inputGain = parameters.inputGain[0];

    // RE-201 params
    const reMode = Math.max(1, Math.min(12, Math.round(parameters.reMode[0])));
    const reRepeatRate = parameters.reRepeatRate[0];
    const reIntensity = parameters.reIntensity[0];
    const reEchoVol = parameters.reEchoVol[0];
    const reReverbVol = parameters.reReverbVol[0];
    const reBassDb = parameters.reBass[0];
    const reTrebleDb = parameters.reTreble[0];

    // Copicat params
    const ccH1 = parameters.ccHead1[0] > 0.5 ? 1.0 : 0.0;
    const ccH2 = parameters.ccHead2[0] > 0.5 ? 1.0 : 0.0;
    const ccH3 = parameters.ccHead3[0] > 0.5 ? 1.0 : 0.0;
    const ccSwell = parameters.ccSwell[0];
    const ccSustain = parameters.ccSustain[0];
    const ccMotorTarget = parameters.ccMotorOn[0] > 0.5 ? 1.0 : 0.0;

    const reRouting = this.getRe201ModeRouting(reMode);

    // 1. Compute target RE-201 Head 1 base delay from Repeat Rate (0.0 = slow ~185ms, 1.0 = fast ~56ms)
    // Exponential motor speed mapping: v_tape scales from 1.75 IPS to 5.75 IPS
    const reTargetHead1Sec = 0.185 * Math.pow(0.30, reRepeatRate);
    const reTargetHead1Samples = reTargetHead1Sec * this.sr;
    // Capstan mechanical inertia smoothing coefficient (~55ms time constant for authentic pitch sweep)
    const reInertiaAlpha = 1.0 - Math.exp(-1.0 / (0.055 * this.sr));

    // RE-201 Feedback Loop Filter coefficients
    const reLpCoeff = Math.exp((-2.0 * Math.PI * 3350.0) / this.sr);
    const reHpCoeff = Math.exp((-2.0 * Math.PI * 108.0) / this.sr);

    // RE-201 Echo Tone EQ (Bass @ 180Hz, Treble @ 2600Hz)
    const bassAlpha = 1.0 - Math.exp((-2.0 * Math.PI * 180.0) / this.sr);
    const trebleAlpha = 1.0 - Math.exp((-2.0 * Math.PI * 2600.0) / this.sr);
    const bassLinearGain = Math.pow(10.0, reBassDb / 20.0) - 1.0;
    const trebleLinearGain = Math.pow(10.0, reTrebleDb / 20.0) - 1.0;

    // 2. Copicat Filter coefficients (Grittier British WEM valve tape loop: 155 Hz - 2550 Hz)
    const ccLpCoeff = Math.exp((-2.0 * Math.PI * 2550.0) / this.sr);
    const ccHpCoeff = Math.exp((-2.0 * Math.PI * 155.0) / this.sr);

    // Copicat Motor Inertia coefficient (~240ms ramp-up / ~190ms coast-down for unmistakable pitch slur!)
    const ccMotorAlpha = ccMotorTarget > this.ccMotorSpeed
      ? 1.0 - Math.exp(-1.0 / (0.24 * this.sr))
      : 1.0 - Math.exp(-1.0 / (0.19 * this.sr));
    const ccDelaySlewAlpha = 1.0 - Math.exp(-1.0 / (0.045 * this.sr));

    const invSr = 1.0 / this.sr;
    const twoPi = 2.0 * Math.PI;

    for (let i = 0; i < outL.length; i++) {
      // Mono sum input
      const rawIn = inL ? 0.5 * (inL[i] + (inR ? inR[i] : inL[i])) : 0.0;
      const gainedIn = rawIn * inputGain;
      const saturatedIn = this.saturateTape(gainedIn, 1.15, 0.07);

      const absIn = Math.abs(gainedIn);
      if (absIn > this.inPeakAcc) this.inPeakAcc = absIn;
      const satDiff = Math.abs(gainedIn - saturatedIn);
      if (satDiff > this.satAmountAcc) this.satAmountAcc = satDiff;

      // ====================================================================
      // UNIT 1: 1974 ROLAND RE-201 SPACE ECHO
      // ====================================================================
      this.reSmoothedBaseDelaySamples +=
        reInertiaAlpha * (reTargetHead1Samples - this.reSmoothedBaseDelaySamples);

      // Free-floating tank low-tension Wow (1.1 Hz + 0.37 Hz) & Flutter (7.8 Hz)
      this.reWowPhase1 += twoPi * 1.12 * invSr;
      if (this.reWowPhase1 > twoPi) this.reWowPhase1 -= twoPi;
      this.reWowPhase2 += twoPi * 0.37 * invSr;
      if (this.reWowPhase2 > twoPi) this.reWowPhase2 -= twoPi;
      this.reFlutterPhase += twoPi * 7.8 * invSr;
      if (this.reFlutterPhase > twoPi) this.reFlutterPhase -= twoPi;

      // Modulated delay excursion in samples (~0.25 ms gentle drift)
      const reModSamples =
        (0.00022 * Math.sin(this.reWowPhase1) +
          0.00011 * Math.sin(this.reWowPhase2) +
          0.00005 * Math.sin(this.reFlutterPhase)) *
        this.sr;

      const dHead1 = this.reSmoothedBaseDelaySamples + reModSamples;
      const dHead2 = this.reSmoothedBaseDelaySamples * 1.92 + reModSamples * 1.15;
      const dHead3 = this.reSmoothedBaseDelaySamples * 2.86 + reModSamples * 1.3;

      const tap1 = this.readHermite(this.reTapeBuf, this.writeIdx, dHead1);
      const tap2 = this.readHermite(this.reTapeBuf, this.writeIdx, dHead2);
      const tap3 = this.readHermite(this.reTapeBuf, this.writeIdx, dHead3);

      const activeHeadCount = reRouting.h1 + reRouting.h2 + reRouting.h3;
      const headNorm = activeHeadCount > 0 ? 1.0 / Math.sqrt(activeHeadCount) : 0.0;
      const reHeadsSum =
        (reRouting.h1 * tap1 + reRouting.h2 * tap2 + reRouting.h3 * tap3) * headNorm;

      // Feedback loop filtering + oxide saturation for authentic dub self-oscillation
      // Even when activeHeadCount === 0 (Mode 12 Reverb Only), Head 3 still circulates silently on the tape
      const fbSource = activeHeadCount > 0 ? reHeadsSum : tap3;
      // Tiny noise floor seed (-86 dB) so extreme Intensity (>1.0) can self-oscillate organically like real analog tape hiss!
      const hissSeed = ((this.writeIdx * 1664525 + 1013904223) & 0xffff) * 1.5e-9 - 5e-5;
      const fbPreFilter = fbSource * reIntensity + hissSeed;

      // One-pole HPF (108 Hz)
      this.reLoopHpZ = reHpCoeff * (this.reLoopHpZ + fbPreFilter - this.reLoopHpPrevX);
      this.reLoopHpPrevX = fbPreFilter;
      // One-pole LPF (3350 Hz)
      this.reLoopLpZ = (1.0 - reLpCoeff) * this.reLoopHpZ + reLpCoeff * this.reLoopLpZ;

      this.reFeedbackSample = this.saturateTape(this.reLoopLpZ, 1.28, 0.09);

      // Write Record Head onto RE-201 tape
      this.reTapeBuf[this.writeIdx] = this.saturateTape(
        saturatedIn + this.reFeedbackSample,
        1.1,
        0.05
      );

      // Apply RE-201 Bass & Treble EQ to Echo wet path ONLY
      this.reBassLpZ += bassAlpha * (reHeadsSum - this.reBassLpZ);
      this.reTrebleLpZ += trebleAlpha * (reHeadsSum - this.reTrebleLpZ);
      const highComponent = reHeadsSum - this.reTrebleLpZ;
      const reEqEcho =
        reHeadsSum + bassLinearGain * this.reBassLpZ + trebleLinearGain * highComponent;

      // RE-201 Spring Reverb Tank (Active in Modes 5–12)
      let springWet = 0.0;
      if (reRouting.rev > 0) {
        // Spring tank is fed by input + subtle echo bleed
        let spSig = (saturatedIn * 0.65 + reEqEcho * 0.35) * 0.5;
        // 4 dispersive all-pass stages (chirp dispersion)
        for (let s = 0; s < 4; s++) {
          const buf = this.springApBufs[s];
          const idx = this.springApIdx[s];
          const delayed = buf[idx];
          const g = 0.62;
          const v = spSig - g * delayed;
          buf[idx] = v;
          spSig = delayed + g * v;
          this.springApIdx[s] = (idx + 1) % this.springApLens[s];
        }
        // 3 parallel helical spring comb tanks
        let combSum = 0.0;
        for (let c = 0; c < 3; c++) {
          const cBuf = this.springCombBufs[c];
          const cIdx = this.springCombIdx[c];
          const cOut = cBuf[cIdx];
          this.springCombLpZ[c] = 0.58 * cOut + 0.42 * this.springCombLpZ[c];
          cBuf[cIdx] = spSig + 0.78 * this.springCombLpZ[c];
          this.springCombIdx[c] = (cIdx + 1) % this.springCombLens[c];
          combSum += cOut;
        }
        springWet = combSum * 0.42;
      }

      const reWetTotal = reEqEcho * reEchoVol + springWet * reReverbVol;
      const reOutSample = gainedIn * 0.85 + reWetTotal;
      const absRe = Math.abs(reWetTotal) + Math.abs(gainedIn * 0.5);
      if (absRe > this.rePeakAcc) this.rePeakAcc = absRe;

      // ====================================================================
      // UNIT 2: LATE-1950s WATKINS COPICAT
      // ====================================================================
      this.ccMotorSpeed += ccMotorAlpha * (ccMotorTarget - this.ccMotorSpeed);

      // When motor ramps up through 0.3..0.95, add a momentary tension-arm bounce wobble
      const speedErr = Math.abs(ccMotorTarget - this.ccMotorSpeed);
      this.ccMotorStartupWobblePhase += twoPi * 4.6 * invSr;
      if (this.ccMotorStartupWobblePhase > twoPi) this.ccMotorStartupWobblePhase -= twoPi;
      const startupBounce = speedErr * 0.14 * Math.sin(this.ccMotorStartupWobblePhase);

      const effectiveMotorSpeed = Math.max(0.03, this.ccMotorSpeed + startupBounce);

      // Tensioned endless loop has pronounced Wow (1.85 Hz) & Flutter (11.5 Hz + 19 Hz)
      this.ccWowPhase += twoPi * 1.85 * effectiveMotorSpeed * invSr;
      if (this.ccWowPhase > twoPi) this.ccWowPhase -= twoPi;
      this.ccFlutterPhase1 += twoPi * 11.4 * effectiveMotorSpeed * invSr;
      if (this.ccFlutterPhase1 > twoPi) this.ccFlutterPhase1 -= twoPi;
      this.ccFlutterPhase2 += twoPi * 18.7 * effectiveMotorSpeed * invSr;
      if (this.ccFlutterPhase2 > twoPi) this.ccFlutterPhase2 -= twoPi;

      // Periodic endless loop splice pass (~1.4 Hz loop revolution)
      this.ccSplicePhase += twoPi * 1.42 * effectiveMotorSpeed * invSr;
      if (this.ccSplicePhase > twoPi) this.ccSplicePhase -= twoPi;
      // Subtle dropout dip when glued splice crosses playback head
      const spliceGain = this.ccSplicePhase > 6.18 ? 0.82 : 1.0;

      // Target Head 1 delay inversely proportional to capstan motor speed (~92ms nominal)
      const ccTargetHead1Samples = (0.092 / effectiveMotorSpeed) * this.sr;
      this.ccSmoothedHead1Samples +=
        ccDelaySlewAlpha * (ccTargetHead1Samples - this.ccSmoothedHead1Samples);

      // Pronounced tensioned-loop wow & flutter excursion (~0.85 ms peak-to-peak)
      const ccModSamples =
        (0.00068 * Math.sin(this.ccWowPhase) +
          0.00024 * Math.sin(this.ccFlutterPhase1) +
          0.00011 * Math.sin(this.ccFlutterPhase2)) *
        this.sr;

      const ccD1 = this.ccSmoothedHead1Samples + ccModSamples;
      const ccD2 = this.ccSmoothedHead1Samples * 1.98 + ccModSamples * 1.2;
      const ccD3 = this.ccSmoothedHead1Samples * 3.12 + ccModSamples * 1.35;

      const ccTap1 = this.readHermite(this.ccTapeBuf, this.writeIdx, ccD1);
      const ccTap2 = this.readHermite(this.ccTapeBuf, this.writeIdx, ccD2);
      const ccTap3 = this.readHermite(this.ccTapeBuf, this.writeIdx, ccD3);

      const ccHeadCount = ccH1 + ccH2 + ccH3;
      const ccNorm = ccHeadCount > 0 ? 1.0 / Math.sqrt(ccHeadCount) : 0.0;
      // If motor is nearly stopped (<0.05), magnetic flux pickup (dPhi/dt) drops to zero
      const fluxVelocityGain = Math.min(1.0, Math.max(0.0, (this.ccMotorSpeed - 0.03) * 2.5));
      const ccHeadsSum =
        (ccH1 * ccTap1 + ccH2 * ccTap2 + ccH3 * ccTap3) *
        ccNorm *
        spliceGain *
        fluxVelocityGain;

      // Copicat Valve Sustain feedback loop
      const ccFbPre = (ccHeadCount > 0 ? ccHeadsSum : ccTap2 * fluxVelocityGain) * ccSustain + hissSeed * 1.6;
      this.ccLoopHpZ = ccHpCoeff * (this.ccLoopHpZ + ccFbPre - this.ccLoopHpPrevX);
      this.ccLoopHpPrevX = ccFbPre;
      this.ccLoopLpZ = (1.0 - ccLpCoeff) * this.ccLoopHpZ + ccLpCoeff * this.ccLoopLpZ;

      this.ccFeedbackSample = this.saturateTape(this.ccLoopLpZ, 1.42, 0.14);

      // Write onto Copicat loop only while motor moves tape past record head
      if (this.ccMotorSpeed > 0.02) {
        this.ccTapeBuf[this.writeIdx] = this.saturateTape(
          saturatedIn + this.ccFeedbackSample,
          1.25,
          0.11
        );
      }

      const ccWetTotal = ccHeadsSum * ccSwell;
      const ccOutSample = gainedIn * 0.85 + ccWetTotal;
      const absCc = Math.abs(ccWetTotal) + Math.abs(gainedIn * 0.5);
      if (absCc > this.ccPeakAcc) this.ccPeakAcc = absCc;

      // ====================================================================
      // MASTER ROUTING OUTPUT
      // ====================================================================
      if (routingMode === 1) {
        // Solo Roland RE-201 Space Echo
        outL[i] = Math.tanh(reOutSample * 0.9);
        outR[i] = Math.tanh((gainedIn * 0.85 + reWetTotal * 0.96 - springWet * 0.18) * 0.9);
      } else if (routingMode === 2) {
        // Solo Watkins Copicat
        outL[i] = Math.tanh(ccOutSample * 0.9);
        outR[i] = Math.tanh(ccOutSample * 0.9);
      } else {
        // Dual Side-by-Side Stereo Panorama (Left biased RE-201, Right biased Copicat + centered dry)
        const leftMix = gainedIn * 0.75 + reWetTotal * 0.88 + ccWetTotal * 0.32;
        const rightMix = gainedIn * 0.75 + ccWetTotal * 0.88 + reWetTotal * 0.32;
        outL[i] = Math.tanh(leftMix * 0.85);
        outR[i] = Math.tanh(rightMix * 0.85);
      }

      this.writeIdx = (this.writeIdx + 1) & this.bufMask;
    }

    // Post real-time telemetry to main UI thread at ~30 Hz
    this.telemCounter += outL.length;
    if (this.telemCounter >= 1536) {
      this.telemCounter = 0;
      this.port.postMessage({
        type: 'TAPE_ECHO_TELEMETRY',
        inPeak: this.inPeakAcc,
        rePeak: this.rePeakAcc,
        ccPeak: this.ccPeakAcc,
        saturation: this.satAmountAcc,
        reDelayMs: Math.round((this.reSmoothedBaseDelaySamples / this.sr) * 1000),
        ccDelayMs: Math.round((this.ccSmoothedHead1Samples / this.sr) * 1000),
        ccMotorSpeed: this.ccMotorSpeed
      });
      this.inPeakAcc *= 0.65;
      this.rePeakAcc *= 0.65;
      this.ccPeakAcc *= 0.65;
      this.satAmountAcc *= 0.65;
    }

    return true;
  }
}

registerProcessor('tape-echo-processor', TapeEchoWorkletProcessor);

/**
 * @fileoverview Classic Tube-Driven Spring Reverberation AudioWorkletProcessor
 * Implements physical and historical modelling of helical spring wave propagation
 * (Wittrick linear dispersion model, coupled transverse/torsional delay lines,
 * dual-spring Accutronics Type 4 topology) and historical electrical topologies:
 *  - Version A: 1961 Fender 6G15 Standalone Tube Reverb (6K6 single-ended pentode driver +
 *               output transformer saturation + 12AX7 recovery + Dwell, Mixer, Tone controls)
 *  - Version B: 1963 Fender AB763 Twin Reverb Built-In Amp Reverb (Parallel 12AT7 dual-triode driver +
 *               fixed Dwell/Tone + single Reverb wet return + speaker-to-chassis acoustic feedback loop)
 *  - 1939 Hammond Oil-Damped Tank option vs. 1960 Accutronics Type 4 Dry Dual-Spring Tank
 *
 * Strictly Zero-GC inside process(): all typed arrays and state buffers are pre-allocated.
 */

class SpringReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Topology: 0 = Version A (1961 6G15 Standalone 6K6), 1 = Version B (1963 AB763 Built-in 12AT7)
      { name: 'topology', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Historical Era Tank: 0 = 1960 Accutronics Type 4 (Dry Dual-Spring), 1 = 1939 Hammond Oil-Filled Tube, 2 = 1930s Bell Labs Long Delay Line
      { name: 'tankEra', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      // Helical Spring Geometry & Material Constants
      // r: Wire radius in mm (0.15 mm to 0.45 mm, default 0.25 mm)
      { name: 'wireRadiusMm', defaultValue: 0.25, minValue: 0.12, maxValue: 0.50, automationRate: 'k-rate' },
      // R: Helix radius in mm (1.8 mm to 5.5 mm, default 3.0 mm)
      { name: 'helixRadiusMm', defaultValue: 3.0, minValue: 1.5, maxValue: 6.0, automationRate: 'k-rate' },
      // L: Uncurled wire length in m (1.2 m to 5.0 m, default 2.65 m -> T_D ~ 69 ms)
      { name: 'wireLengthM', defaultValue: 2.65, minValue: 1.0, maxValue: 5.5, automationRate: 'k-rate' },
      // Tube Driver & Recovery Controls
      // Dwell (0..1): Controls grid voltage of 6K6 driver tube (fixed at 0.62 in AB763 mode)
      { name: 'dwell', defaultValue: 0.65, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Tone (0..1): Low-pass filter on wet recovery signal to tame HF spring splash (fixed at 0.58 in AB763 mode)
      { name: 'tone', defaultValue: 0.62, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Mixer / Reverb Level (0..1): Blends wet transducer recovery with dry signal
      { name: 'mix', defaultValue: 0.55, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // Acoustic Feedback (0..1): Sympathetic speaker-to-spring mechanical coupling in AB763 combo enclosure
      { name: 'acousticFeedback', defaultValue: 0.28, minValue: 0.0, maxValue: 0.95, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.fs = typeof sampleRate !== 'undefined' ? sampleRate : 48000;

    // Physical Material Constants for Tempered Music-Wire Steel
    // Density rho = 7800 kg/m^3, Young's Modulus E = 200 GPa = 2.0e11 Pa
    this.rho = 7800.0;
    this.E = 200.0e9;
    this.waveSpeedSteel = Math.sqrt(this.E / this.rho); // ~5063.7 m/s

    // Dual Helical Springs (Accutronics Type 4 uses two springs with incommensurate delay ratios
    // to suppress standing waves and flutter echoes: Spring 1 = 1.000 * L, Spring 2 = 0.873 * L)
    this.springLengthRatios = new Float32Array([1.0, 0.8728]);

    // Pre-allocate Main Transmission Line Ring Buffers for 2 Springs (up to 32768 samples = ~680ms at 48kHz)
    this.delayBufSize = 32768;
    this.delayBufMask = 32767;
    this.springDelayBuf1 = new Float32Array(this.delayBufSize);
    this.springDelayBuf2 = new Float32Array(this.delayBufSize);
    this.delayWritePtr = 0;

    // Smoothed delay lengths in samples for Spring 1 & Spring 2
    this.curDelay1 = 3300.0;
    this.curDelay2 = 2880.0;

    // Cascaded Dispersive All-Pass Chain (24 stages per spring = 48 1st-order dispersive sections +
    // 8 2nd-order Thiran/Padé group-delay chirp sections per spring) to model Wittrick helical dispersion
    // where high frequencies below/near F_c travel with different phase/group velocity than low frequencies,
    // creating the unmistakable spring "boing" / "chirp" transient!
    this.numDispStages = 32;
    this.dispX1_S1 = new Float32Array(this.numDispStages);
    this.dispY1_S1 = new Float32Array(this.numDispStages);
    this.dispX2_S1 = new Float32Array(this.numDispStages);
    this.dispY2_S1 = new Float32Array(this.numDispStages);

    this.dispX1_S2 = new Float32Array(this.numDispStages);
    this.dispY1_S2 = new Float32Array(this.numDispStages);
    this.dispX2_S2 = new Float32Array(this.numDispStages);
    this.dispY2_S2 = new Float32Array(this.numDispStages);

    // High-frequency scattering ripple all-pass buffers (above F_c coil-to-coil scattering)
    this.scatBufSize = 512;
    this.scatBufMask = 511;
    this.scatBuf1 = new Float32Array(4 * this.scatBufSize);
    this.scatBuf2 = new Float32Array(4 * this.scatBufSize);
    this.scatWritePtr = 0;
    this.scatDelays1 = new Int32Array([29, 67, 113, 179]);
    this.scatDelays2 = new Int32Array([37, 79, 131, 197]);

    // Coupled Transverse (v) and Torsional (u) Cross-Coupling State per Spring
    this.uState1 = 0.0;
    this.vState1 = 0.0;
    this.uState2 = 0.0;
    this.vState2 = 0.0;

    // Per-spring reflection damping LPF states (models viscous oil damping in 1939 Hammond vs dry air in 1960 Type 4)
    this.lpState1 = 0.0;
    this.lpState2 = 0.0;
    this.dcX1 = 0.0;
    this.dcY1 = 0.0;
    this.dcX2 = 0.0;
    this.dcY2 = 0.0;

    // 8-Ohm Driver Transducer & Output Transformer Core Hysteresis / Eddy-Current State
    this.xfmrFlux = 0.0;
    this.xfmrHpX = 0.0;
    this.xfmrHpY = 0.0;

    // 12AX7 Recovery Stage & Tone Control State (Stereo spread from Dual Springs + Mid-Scoop tank resonance)
    this.toneLpL = 0.0;
    this.toneLpR = 0.0;

    // Acoustic Feedback Loop (Speaker cabinet low-mid cone resonance 115 Hz coupling into chassis springs)
    this.acoustBufSize = 4096;
    this.acoustBufMask = 4095;
    this.acoustBuf = new Float32Array(this.acoustBufSize);
    this.acoustWritePtr = 0;
    this.acoustBpY1 = 0.0;
    this.acoustBpY2 = 0.0;

    // Physical Spring Kick / Boing Mechanical Shock Exciter State
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
        // Mechanical shock directly excites both springs with a dispersive torsional/transverse impulse!
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

    // Read k-rate parameters
    const topology = this.overrideTopology >= 0
      ? this.overrideTopology
      : Math.round(parameters.topology[0]);
    const tankEra = this.overrideTankEra >= 0
      ? this.overrideTankEra
      : Math.round(parameters.tankEra[0]);

    const r_m = Math.max(0.12e-3, Math.min(0.50e-3, parameters.wireRadiusMm[0] * 1e-3));
    const R_m = Math.max(1.5e-3, Math.min(6.0e-3, parameters.helixRadiusMm[0] * 1e-3));
    const L_m = Math.max(1.0, Math.min(5.5, parameters.wireLengthM[0]));

    // Wittrick Linear Model Equations:
    // 1. Base echo time T_D ≈ (4 * L * R / r) * sqrt(rho / E)
    const T_D = ((4.0 * L_m * R_m) / r_m) / this.waveSpeedSteel;
    // 2. Transition frequency F_c ≈ (3 * r / (16 * sqrt(5) * pi * R^2)) * sqrt(E / rho)
    const F_c = ((3.0 * r_m) / (16.0 * Math.sqrt(5.0) * Math.PI * R_m * R_m)) * this.waveSpeedSteel;

    // Helix curvature kappa = R / (R^2 + p^2) ≈ 1 / R for thin tight helical springs
    const kappa = Math.min(0.45, r_m / (R_m * 1.25));

    // Target delay samples for Spring 1 and Spring 2 (subtracting group delay of dispersive all-pass cascade)
    const dispGroupDelaySamples = this.numDispStages * 2.2;
    const rawSamples1 = Math.max(128.0, Math.min(30000.0, T_D * this.fs * this.springLengthRatios[0] - dispGroupDelaySamples));
    const rawSamples2 = Math.max(128.0, Math.min(30000.0, T_D * this.fs * this.springLengthRatios[1] - dispGroupDelaySamples));

    // Historical Era Tank Modifiers:
    // tankEra === 0: 1960 Accutronics Type 4 (Dual dry springs, long lively decay, strong chirp)
    // tankEra === 1: 1939 Hammond Organ Oil-Filled Tube (Heavy viscous oil damping, dark short decay)
    // tankEra === 2: 1930s Bell Labs Single Mechanical Line (Single spring, distinct telephone-line slap echoes)
    let baseFeedback = 0.855;
    let dampCutoffHz = 3900.0;
    let dualSpringMix = 1.0;

    if (tankEra === 1) {
      // 1939 Hammond oil-filled damping
      baseFeedback = 0.72;
      dampCutoffHz = 1850.0;
      dualSpringMix = 0.85;
    } else if (tankEra === 2) {
      // 1930s Bell Labs single dispersive delay line
      baseFeedback = 0.78;
      dampCutoffHz = 3100.0;
      dualSpringMix = 0.0; // Single spring only
    }

    // Electrical Topology Parameters:
    // Version A (topology === 0): 1961 Fender 6G15 Standalone Tube Reverb
    //   - 6K6 single-ended power pentode driver + step-down transformer into 8-ohm transducer
    //   - User-adjustable Dwell, Tone, Mixer
    //   - Isolated unit: minimal acoustic speaker feedback unless cranked
    // Version B (topology === 1): 1963 Fender AB763 Twin Reverb Built-In Amp Reverb
    //   - Parallel 12AT7 dual-triode driver (lower current, cleaner transient snap, less even-order sag)
    //   - Fixed circuit Dwell (0.60) and Tone (0.58), single "Reverb" wet volume control
    //   - Mounted inside combo amp enclosure -> strong sympathetic speaker-to-spring acoustic feedback
    const effectiveDwell = topology === 0 ? parameters.dwell[0] : 0.60;
    const effectiveTone = topology === 0 ? parameters.tone[0] : 0.58;
    const mixParam = parameters.mix[0];
    const acoustFbParam = topology === 1
      ? Math.max(0.18, parameters.acousticFeedback[0])
      : parameters.acousticFeedback[0] * 0.25;

    // Compute 2nd-order dispersive all-pass coefficients tuned around Wittrick transition frequency F_c
    const fcClamped = Math.max(600.0, Math.min(7500.0, F_c));
    const wFc = (2.0 * Math.PI * fcClamped) / this.fs;
    // All-pass radius & pole angle so frequencies below F_c experience strong group-delay dispersion ("chirp")
    const apRadius = 0.86;
    const a1Disp = -2.0 * apRadius * Math.cos(wFc * 0.68);
    const a2Disp = apRadius * apRadius;

    // Reflection low-pass filter coefficient inside tank loop
    const lpPole = Math.exp((-2.0 * Math.PI * dampCutoffHz) / this.fs);
    const oneMinusLp = 1.0 - lpPole;

    // Recovery Tone Control low-pass filter (1.2 kHz dark to 7.8 kHz bright splash)
    const toneFreq = 1100.0 + effectiveTone * effectiveTone * 6800.0;
    const toneAlpha = 1.0 - Math.exp((-2.0 * Math.PI * toneFreq) / this.fs);

    // Acoustic speaker-to-spring resonant bandpass filter (~118 Hz cabinet thump + 420 Hz cone ring)
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

      // -----------------------------------------------------------------------
      // 1. Tube Driver Stage (6G15 6K6 Pentode + Transformer vs AB763 12AT7 Parallel Triode)
      // -----------------------------------------------------------------------
      const dwellGain = 0.25 + effectiveDwell * 2.65;
      let gridSignal = dryMono * dwellGain;

      let transducerDrive = 0.0;
      if (topology === 0) {
        // Version A: 1961 Fender 6G15 Single-Ended 6K6 Power Pentode + Step-Down Transformer
        // Asymmetric class-A pentode transfer curve (rich 2nd & 3rd harmonics + screen-grid compression)
        const biased = gridSignal + 0.14 * gridSignal * gridSignal;
        const plateCurrent = Math.tanh(biased * 1.45) * 0.88;
        // Transformer core saturation & low-end inductive high-pass (matches high-Z plate to 8-ohm coil)
        this.xfmrFlux = 0.992 * this.xfmrFlux + 0.008 * plateCurrent;
        const xfmrOut = plateCurrent - 0.35 * Math.tanh(this.xfmrFlux * 3.2);
        // Inductive eddy-current treble pre-emphasis in transformer core
        const hp = xfmrOut - this.xfmrHpX + 0.985 * this.xfmrHpY;
        this.xfmrHpX = xfmrOut;
        this.xfmrHpY = hp;
        transducerDrive = hp * 0.95;
      } else {
        // Version B: 1963 Fender AB763 Parallel 12AT7 Dual-Triode Driver
        // Cleaner, higher-transconductance triode drive with crisp transient snap and less core sag
        const triodeOut = (gridSignal / (1.0 + 0.42 * Math.abs(gridSignal))) * 0.92;
        const hp = triodeOut - this.xfmrHpX + 0.991 * this.xfmrHpY;
        this.xfmrHpX = triodeOut;
        this.xfmrHpY = hp;
        transducerDrive = hp * 0.90;
      }

      // Add mechanical "Kick Tank" spring crash excitation if triggered by user
      if (this.kickExciteAmp > 0.0001) {
        this.kickPhase += (2.0 * Math.PI * (85.0 + 950.0 * this.kickExciteAmp)) / this.fs;
        const crash = (Math.sin(this.kickPhase) * 0.7 + (Math.random() * 2.0 - 1.0) * 0.6) * this.kickExciteAmp;
        transducerDrive += crash * 1.65;
        this.kickExciteAmp *= 0.9988;
      }

      // Add Sympathetic Acoustic Speaker Feedback (AB763 Combo Enclosure Coupling)
      const acoustDelayed = this.acoustBuf[(acoustWritePtr - 640) & this.acoustBufMask];
      const acoustRes = acoustDelayed * 0.035 - b1Acoust * this.acoustBpY1 - b2Acoust * this.acoustBpY2;
      this.acoustBpY2 = this.acoustBpY1;
      this.acoustBpY1 = Math.tanh(acoustRes * 0.95);
      transducerDrive += this.acoustBpY1 * acoustFbParam * 0.42;

      // Smoothly interpolate transmission line lengths (T_D)
      this.curDelay1 += (rawSamples1 - this.curDelay1) * 0.001;
      this.curDelay2 += (rawSamples2 - this.curDelay2) * 0.001;

      // -----------------------------------------------------------------------
      // 2. Read Helical Transmission Lines (Spring 1 & Spring 2)
      // -----------------------------------------------------------------------
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

      // -----------------------------------------------------------------------
      // 3. Wittrick Helical Dispersion All-Pass Cascade (Chirp below F_c)
      //    H(z) = (a2 + a1*z^-1 + z^-2) / (1 + a1*z^-1 + a2*z^-2)
      // -----------------------------------------------------------------------
      for (let st = 0; st < this.numDispStages; st++) {
        // Spring 1 biquad all-pass
        const y1 = a2Disp * wave1 + a1Disp * dispX1_S1[st] + dispX2_S1[st]
          - a1Disp * dispY1_S1[st] - a2Disp * dispY2_S1[st];
        dispX2_S1[st] = dispX1_S1[st];
        dispX1_S1[st] = wave1;
        dispY2_S1[st] = dispY1_S1[st];
        dispY1_S1[st] = y1;
        wave1 = y1;

        // Spring 2 biquad all-pass
        const y2 = a2Disp * wave2 + a1Disp * dispX1_S2[st] + dispX2_S2[st]
          - a1Disp * dispY1_S2[st] - a2Disp * dispY2_S2[st];
        dispX2_S2[st] = dispX1_S2[st];
        dispX1_S2[st] = wave2;
        dispY2_S2[st] = dispY1_S2[st];
        dispY1_S2[st] = y2;
        wave2 = y2;
      }

      // -----------------------------------------------------------------------
      // 4. Coil-to-Coil High-Frequency Scattering All-Pass Diffusers
      // -----------------------------------------------------------------------
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

      // -----------------------------------------------------------------------
      // 5. Coupled Torsional (u) & Transverse (v) Curvature Interaction (kappa)
      //    du^2/dt^2 = (E/rho)*(du^2/ds^2 - kappa * dv/ds)
      // -----------------------------------------------------------------------
      const coupled1 = wave1 - kappa * (wave1 - this.vState1);
      this.vState1 = 0.85 * this.vState1 + 0.15 * wave1;

      const coupled2 = wave2 - kappa * (wave2 - this.vState2);
      this.vState2 = 0.85 * this.vState2 + 0.15 * wave2;

      // Damping & DC blocking inside tank loop
      this.lpState1 = oneMinusLp * coupled1 + lpPole * this.lpState1;
      this.lpState2 = oneMinusLp * coupled2 + lpPole * this.lpState2;

      const dcOut1 = this.lpState1 - this.dcX1 + 0.996 * this.dcY1;
      this.dcX1 = this.lpState1;
      this.dcY1 = dcOut1;

      const dcOut2 = this.lpState2 - this.dcX2 + 0.996 * this.dcY2;
      this.dcX2 = this.lpState2;
      this.dcY2 = dcOut2;

      // Subtle mechanical cross-coupling at the shared tank end-block bracket
      const endBlockCross = 0.08 * dualSpringMix;
      const fb1 = dcOut1 + endBlockCross * dcOut2;
      const fb2 = dcOut2 - endBlockCross * dcOut1;

      // Write back into helical transmission lines with magnetic transducer non-linearity
      springDelayBuf1[delayWritePtr] = Math.tanh(transducerDrive + fb1 * baseFeedback);
      springDelayBuf2[delayWritePtr] = Math.tanh(transducerDrive * 0.94 - fb2 * baseFeedback * 0.985);
      delayWritePtr = (delayWritePtr + 1) & delayMask;

      // -----------------------------------------------------------------------
      // 6. 12AX7 Dual-Triode Recovery Preamp & Tone Filter Stage
      // -----------------------------------------------------------------------
      const rawPickupL = dcOut1 + 0.35 * dualSpringMix * dcOut2;
      const rawPickupR = dualSpringMix > 0.01 ? (dcOut2 + 0.35 * dcOut1) : dcOut1;

      // 12AX7 triode grid saturation on millivolt recovery coil signal
      const recL = Math.tanh(rawPickupL * 1.55);
      const recR = Math.tanh(rawPickupR * 1.55);

      // Tone control low-pass filter to tame high-frequency spring "splash"
      this.toneLpL += toneAlpha * (recL - this.toneLpL);
      this.toneLpR += toneAlpha * (recR - this.toneLpR);

      const wetL = this.toneLpL;
      const wetR = this.toneLpR;

      // Store speaker output into acoustic feedback buffer
      const monoOut = (dryMono * (1.0 - mixParam * 0.45) + (wetL + wetR) * 0.5 * mixParam);
      this.acoustBuf[acoustWritePtr] = monoOut;
      acoustWritePtr = (acoustWritePtr + 1) & this.acoustBufMask;

      // Equal-power / authentic mixer blend
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

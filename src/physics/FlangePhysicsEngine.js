/**
 * FlangePhysicsEngine.js
 * Mechanical Physics & Rotational Inertia Engine for 1960s Dual-Tape Flanging.
 * 
 * Accurately models:
 *  1. "The Thumb on the Flange": Rotational braking friction, moment arm (radial distance),
 *     capstan motor recovery torque, tape tension dancer overshoot, and acoustic Doppler shift.
 *  2. The B.P.O. (British Post Office) Varispeed Frequency Generator (45 Hz - 55 Hz).
 *  3. Periodic LFO Sweeps (Sine, Triangle, Mechanical Eccentric Cam).
 *  4. Physical Tape Displacement (15 IPS = 381 mm/s) passing over repro heads.
 */

export class FlangePhysicsEngine {
  constructor() {
    // Nominal reference speed: 15 Inches Per Second = 381 mm/s
    this.NOMINAL_IPS = 15.0;
    this.MM_PER_SEC = 381.0;
    this.NOMINAL_BPO_HZ = 50.0; // 50 Hz UK Mains frequency for Studer capstan motor

    // Base delay for Through-Zero topology
    this.BASE_DELAY_SEC = 0.010; // Deck A is fixed at 10 ms (0.010 s)
    this.MIN_DELAY_B_SEC = 0.000; // Deck B can lead Deck A by up to 10 ms
    this.MAX_DELAY_B_SEC = 0.025; // Deck B can lag Deck A by up to 15 ms

    // Dynamic state
    this.deckASpeedRatio = 1.0; // Deck A reference runs locked at 1.0 (15 IPS)
    this.deckBSpeedRatio = 1.0; // Deck B instantaneous speed ratio (1.0 = 15 IPS)
    this.deckBVelocityTarget = 1.0;
    this.delayBSec = this.BASE_DELAY_SEC; // Start locked at The Zero Point (10 ms)
    this.deltaT_ms = 0.0; // (delayBSec - 0.010) * 1000

    // Reel physics parameters (10.5" aluminum NAB reel)
    this.reelRadiusMm = 133.0; // ~5.25 inches radius
    this.hubRadiusMm = 45.0;
    this.reelInertia = 0.045; // kg*m^2 rotational inertia
    this.motorRestoringTorque = 6.2; // Spring-like capstan motor torque recovery
    this.tensionDamping = 4.8; // Viscous damping from tape guide rollers
    this.angularVelocityB = 1.0; // Normalized rad/s
    this.overshootVelocity = 0.0;

    // Interactive Thumb Flange Friction
    this.isBraking = false;
    this.dragForce = 0.0; // 0.0 to 1.0
    this.dragRadiusMm = this.reelRadiusMm; // radial distance from center
    this.frictionIntensity = 0.0; // smoothed 0 to 1 for tape azimuth filter

    // BPO Varispeed Oscillator
    this.bpoFrequencyHz = 50.0; // 45.0 Hz to 55.0 Hz
    this.isLFOActive = false;
    this.lfoWaveform = 'sine'; // 'sine' | 'triangle' | 'cam'
    this.lfoRateHz = 0.25; // 0.02 Hz to 2.5 Hz (typical vintage flange sweep)
    this.lfoDepth = 0.50; // 0.0 to 1.0
    this.lfoPhase = 0.0;

    // Visual reel rotation angles (radians)
    this.reelAngleA = 0.0;
    this.reelAngleB = 0.0;

    // Cumulative physical displacement of Deck B relative to Deck A (in mm)
    this.tapeDisplacementMm = 0.0;

    // History log for sweep detection (used by Lab Challenges)
    this.recentDeltaTHistory = [];
    this.historyMaxLen = 120;
  }

  /**
   * Apply user thumb touch to the flange rim of Deck B
   * @param {number} normalizedRadius 0.0 (hub) to 1.0 (outer rim)
   * @param {number} force 0.0 to 1.0 pressure
   */
  applyThumbBrake(normalizedRadius, force = 0.8) {
    this.isBraking = true;
    const clampedR = Math.max(0.0, Math.min(1.0, normalizedRadius));
    this.dragRadiusMm = this.hubRadiusMm + clampedR * (this.reelRadiusMm - this.hubRadiusMm);
    this.dragForce = Math.max(0.1, Math.min(1.0, force));
  }

  /**
   * Release thumb brake with motor spring-back
   */
  releaseThumbBrake() {
    this.isBraking = false;
    this.dragForce = 0.0;
  }

  /**
   * Set BPO Varispeed Oscillator frequency directly (vernier dial)
   * @param {number} freqHz 45.0 to 55.0
   */
  setBPOFrequency(freqHz) {
    this.bpoFrequencyHz = Math.max(45.0, Math.min(55.0, freqHz));
  }

  /**
   * Toggle automated LFO modulation vs manual dial
   * @param {boolean} active
   * @param {string} waveform 'sine' | 'triangle' | 'cam'
   * @param {number} rateHz
   * @param {number} depth
   */
  setLFO(active, waveform = 'sine', rateHz = 0.25, depth = 0.5) {
    this.isLFOActive = Boolean(active);
    this.lfoWaveform = waveform;
    this.lfoRateHz = Math.max(0.02, Math.min(2.5, rateHz));
    this.lfoDepth = Math.max(0.0, Math.min(1.0, depth));
  }

  /**
   * Reset the simulator back to locked Through-Zero sync
   */
  resetToZeroPoint() {
    this.delayBSec = this.BASE_DELAY_SEC;
    this.deltaT_ms = 0.0;
    this.bpoFrequencyHz = 50.0;
    this.deckBSpeedRatio = 1.0;
    this.overshootVelocity = 0.0;
    this.isBraking = false;
    this.dragForce = 0.0;
    this.frictionIntensity = 0.0;
  }

  /**
   * Physics Integration Step
   * Called once per animation frame (typically ~60 FPS, dt ~ 0.016s)
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    const clampedDt = Math.min(0.05, Math.max(0.001, dt));

    // 1. Calculate Target Speed Ratio from BPO Oscillator
    let effectiveBPOHz = this.bpoFrequencyHz;

    if (this.isLFOActive) {
      this.lfoPhase += (2 * Math.PI * this.lfoRateHz) * clampedDt;
      if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;

      let lfoVal = 0;
      if (this.lfoWaveform === 'triangle') {
        // Triangle wave [-1, 1]
        lfoVal = 2 * Math.abs(2 * (this.lfoPhase / (2 * Math.PI) - Math.floor(this.lfoPhase / (2 * Math.PI) + 0.5))) - 1;
      } else if (this.lfoWaveform === 'cam') {
        // Mechanical Cam: Slow build (quadratic) + steep drop
        const norm = this.lfoPhase / (2 * Math.PI);
        lfoVal = norm < 0.75
          ? (Math.pow(norm / 0.75, 1.8) * 2 - 1)
          : (1 - ((norm - 0.75) / 0.25) * 2);
      } else {
        // Pure Sine wave [-1, 1]
        lfoVal = Math.sin(this.lfoPhase);
      }

      // Max BPO sweep deviation: ±4.5 Hz at 100% depth
      effectiveBPOHz = this.NOMINAL_BPO_HZ + lfoVal * (4.5 * this.lfoDepth);
    }

    // Nominal speed ratio governed by BPO AC frequency (50 Hz = 1.00)
    const bpoSpeedRatio = effectiveBPOHz / this.NOMINAL_BPO_HZ;

    // 2. Calculate Thumb Braking Friction Torque
    let brakeTorque = 0.0;
    if (this.isBraking) {
      // Torque = r * F (moment arm effect: dragging rim exerts higher braking torque than dragging hub)
      const momentArmFactor = (this.dragRadiusMm / this.reelRadiusMm);
      brakeTorque = 1.8 * this.dragForce * momentArmFactor;
      this.frictionIntensity += (1.0 - this.frictionIntensity) * (clampedDt * 12.0);
    } else {
      this.frictionIntensity += (0.0 - this.frictionIntensity) * (clampedDt * 8.0);
    }

    // 3. Rotational Dynamics & Inertia ODE
    // Deck B capstan motor tries to lock to bpoSpeedRatio with spring-damper compliance
    const speedError = bpoSpeedRatio - this.deckBSpeedRatio;
    const motorTorque = this.motorRestoringTorque * speedError;

    // Net acceleration including rotational inertia and friction braking
    const netTorque = motorTorque - brakeTorque - (this.tensionDamping * (this.deckBSpeedRatio - 1.0));
    const angularAcc = netTorque / (1.0 + this.reelInertia);

    // Update velocity with slight mechanical compliance (tension dancer bounce)
    this.deckBSpeedRatio += angularAcc * clampedDt;
    this.deckBSpeedRatio = Math.max(0.4, Math.min(1.4, this.deckBSpeedRatio));

    // 4. Delay Differential Integration
    // When Deck B runs slower than Deck A (deckBSpeedRatio < 1.0), Deck B falls behind Deck A,
    // so delay offset (t_B - t_A) increases.
    // If Deck B runs faster (deckBSpeedRatio > 1.0), Deck B pulls ahead, so delay offset decreases.
    if (this.isBraking) {
      // Direct physical finger drag smoothly accumulates delay lag
      const speedDeficit = (1.0 - this.deckBSpeedRatio);
      this.delayBSec += speedDeficit * clampedDt * 0.045;
    } else if (this.isLFOActive) {
      // In LFO mode, delay smoothly tracks the oscillator sweep around 10 ms center
      const targetDelaySec = this.BASE_DELAY_SEC - (effectiveBPOHz - this.NOMINAL_BPO_HZ) * 0.0022 * this.lfoDepth;
      this.delayBSec += (targetDelaySec - this.delayBSec) * (clampedDt * 10.0);
    } else {
      // In manual vernier mode, manual dial sets direct delay offset or motor restores sync
      const manualTargetDelay = this.BASE_DELAY_SEC - (this.bpoFrequencyHz - this.NOMINAL_BPO_HZ) * 0.0022;
      this.delayBSec += (manualTargetDelay - this.delayBSec) * (clampedDt * (this.motorRestoringTorque * 0.6));
    }

    // Clamp delay within hardware delay line limits [0 ms, 25 ms]
    this.delayBSec = Math.max(this.MIN_DELAY_B_SEC, Math.min(this.MAX_DELAY_B_SEC, this.delayBSec));

    // Calculate Delta T relative to fixed Deck A base delay (0.010 s)
    // Positive deltaT = Deck B lags Deck A (Thumb drag)
    // Zero deltaT = The Zero Point (Total null when phase inverted)
    // Negative deltaT = Deck B leads Deck A (Varispeed speed-up)
    this.deltaT_ms = (this.delayBSec - this.BASE_DELAY_SEC) * 1000.0;

    // Physical millimeter displacement of tape on head face (381 mm/s * seconds offset)
    this.tapeDisplacementMm = (this.delayBSec - this.BASE_DELAY_SEC) * this.MM_PER_SEC;

    // 5. Visual Reel Rotation Animation (15 IPS corresponds to ~2.86 rad/s at 10.5" outer pack)
    const nominalAngularRate = 2.86;
    this.reelAngleA += nominalAngularRate * 1.0 * clampedDt;
    this.reelAngleB += nominalAngularRate * this.deckBSpeedRatio * clampedDt;
    if (this.reelAngleA > 2 * Math.PI) this.reelAngleA -= 2 * Math.PI;
    if (this.reelAngleB > 2 * Math.PI) this.reelAngleB -= 2 * Math.PI;

    // Keep history for challenge verification
    this.recentDeltaTHistory.push({
      time: performance.now(),
      deltaT: this.deltaT_ms,
      isBraking: this.isBraking
    });
    if (this.recentDeltaTHistory.length > this.historyMaxLen) {
      this.recentDeltaTHistory.shift();
    }
  }

  /**
   * Telemetry snapshot for UI and Audio Engine
   */
  getState() {
    const absDeltaT_ms = Math.abs(this.deltaT_ms);

    return {
      // Delay parameters
      delayASec: this.BASE_DELAY_SEC,
      delayBSec: this.delayBSec,
      deltaT_ms: this.deltaT_ms,
      absDeltaT_ms: absDeltaT_ms,
      deltaT_microsec: Math.round(this.deltaT_ms * 1000),
      tapeDisplacementMm: this.tapeDisplacementMm,

      // Mechanical telemetry
      deckASpeedIps: this.NOMINAL_IPS,
      deckBSpeedIps: this.NOMINAL_IPS * this.deckBSpeedRatio,
      deckBSpeedRatio: this.deckBSpeedRatio,
      bpoFrequencyHz: this.bpoFrequencyHz,
      frictionIntensity: this.frictionIntensity,
      isBraking: this.isBraking,
      dragRadiusMm: this.dragRadiusMm,

      // LFO telemetry
      isLFOActive: this.isLFOActive,
      lfoWaveform: this.lfoWaveform,
      lfoRateHz: this.lfoRateHz,
      lfoDepth: this.lfoDepth,

      // Visual angles
      reelAngleA: this.reelAngleA,
      reelAngleB: this.reelAngleB
    };
  }
}

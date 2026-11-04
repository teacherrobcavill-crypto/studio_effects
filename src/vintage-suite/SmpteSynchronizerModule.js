/**
 * MODULE 3: SMPTE Timecode Dual 24-Track Synchronizer
 * Models 2x Studer A800 MKIII 2-Inch 24-Track Tape Transports (Master A + Slave B)
 * locked via an Adams Smith Zeta-Three SMPTE LTC Synchronizer (80-bit Bi-Phase Mark).
 */
export class SmpteSynchronizerModule {
  /**
   * @param {HTMLElement} parentEl
   * @param {Object} contextBag
   */
  constructor(parentEl, contextBag) {
    this.parentEl = parentEl;
    this.contextBag = contextBag;
    this.abortController = new AbortController();
    this.rafId = null;
    this.audioNodes = [];
    this.scheduledSources = [];
    this.isAudioGraphBuilt = false;

    this.params = {
      frameRate: 30, // 24 | 25 | 29.97 | 30
      tapeSpeedIps: 30, // 15 | 30 IPS
      guardBandTrack23: true, // When false, Track 24 SMPTE LTC bleeds into audio!
      ltcPrintLevelDb: -6, // -18 dB to +3 dB
      ltcMonitorSolo: false, // Listen directly to Track 24 80-bit Bi-Phase Mark audio
      subFramePhaseMs: 0.0, // 0.0 ms to 15.0 ms manual phase offset between Machine A & B
      jamSyncEnabled: true
    };

    // Transport & PLL Capstan Servo State
    this.syncState = {
      transportRunning: true,
      masterTimeSec: 3600.0, // Starts at 01:00:00:00 (Standard studio 1-hour pre-roll start)
      slaveTimeSec: 3600.0,
      slaveVarispeedRatio: 1.0, // 1.000 = nominal speed
      lockStatus: 'HARD LOCK', // 'HARD LOCK' | 'PHASE LOCK' | 'CHASE SLEW' | 'FREEWHEEL (DROPOUT)' | 'UNLOCKED'
      dropoutRemainingMs: 0,
      masterReelAngle: 0,
      slaveReelAngle: 0,
      lastFrameMs: performance.now(),
      current80Bits: new Uint8Array(80)
    };

    this.encodeSmpte80BitFrame(1, 0, 0, 0);
    this.renderUI();
    this.startVisualLoop();
  }

  ensureAudioGraph() {
    const ctx = this.contextBag.ensureAudioContext();
    if (!ctx || this.isAudioGraphBuilt) return;

    const sourceNode = this.contextBag.getInputNode();
    const masterOut = this.contextBag.getOutputNode();

    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    sourceNode.connect(this.inputGain);
    this.outputGain.connect(masterOut);

    // =========================================================================
    // 1. MASTER MACHINE A (Tracks 1–22 Direct Reference Path)
    // =========================================================================
    this.masterDeckGain = ctx.createGain();
    this.masterDeckGain.gain.value = 0.75;
    this.inputGain.connect(this.masterDeckGain);
    this.masterDeckGain.connect(this.outputGain);

    // =========================================================================
    // 2. SLAVE MACHINE B (Tracks 25–46 Variable-Delay Capstan Servo Path)
    // Audibly demonstrates varispeed pitch slewing during CHASE and comb-filtering
    // when Slave Machine B has a sub-frame phase offset!
    // =========================================================================
    this.slaveServoDelay = ctx.createDelay(1.0);
    this.slaveServoDelay.delayTime.value = 0.0;

    this.slaveDeckGain = ctx.createGain();
    this.slaveDeckGain.gain.value = 0.75;

    this.inputGain.connect(this.slaveServoDelay);
    this.slaveServoDelay.connect(this.slaveDeckGain);
    this.slaveDeckGain.connect(this.outputGain);

    // =========================================================================
    // 3. TRACK 24 SMPTE LTC MANCHESTER BI-PHASE MARK GENERATOR (1200 / 2400 Hz)
    // =========================================================================
    this.ltcCarrierOsc = ctx.createOscillator();
    this.ltcCarrierOsc.type = 'square';
    this.ltcCarrierOsc.frequency.value = 2400;

    // Bandpass filter simulating magnetic tape edge-track head response (800 Hz - 4.5 kHz)
    this.ltcHeadFilter = ctx.createBiquadFilter();
    this.ltcHeadFilter.type = 'bandpass';
    this.ltcHeadFilter.frequency.value = 1850;
    this.ltcHeadFilter.Q.value = 0.9;

    this.ltcCrosstalkGain = ctx.createGain();
    this.ltcCrosstalkGain.gain.value = 0.0;

    this.ltcCarrierOsc.connect(this.ltcHeadFilter);
    this.ltcHeadFilter.connect(this.ltcCrosstalkGain);
    this.ltcCrosstalkGain.connect(this.outputGain);
    this.ltcCarrierOsc.start();
    this.scheduledSources.push(this.ltcCarrierOsc);

    this.audioNodes.push(
      this.inputGain,
      this.outputGain,
      this.masterDeckGain,
      this.slaveServoDelay,
      this.slaveDeckGain,
      this.ltcCarrierOsc,
      this.ltcHeadFilter,
      this.ltcCrosstalkGain
    );

    this.isAudioGraphBuilt = true;
    this.syncAudioParams();
  }

  /**
   * Encodes an authentic 80-bit SMPTE Longitudinal Timecode (LTC) frame:
   * - BCD units/tens for Frames, Seconds, Minutes, Hours
   * - Bits 64..79: Fixed 16-bit Sync Word (0011 1111 1111 1101)
   */
  encodeSmpte80BitFrame(hh, mm, ss, ff) {
    const bits = this.syncState.current80Bits;
    bits.fill(0);

    const writeBcd = (val, unitOffset, tensOffset, tensBits) => {
      const u = val % 10;
      const t = Math.floor(val / 10);
      for (let b = 0; b < 4; b++) bits[unitOffset + b] = (u >> b) & 1;
      for (let b = 0; b < tensBits; b++) bits[tensOffset + b] = (t >> b) & 1;
    };

    writeBcd(ff, 0, 8, 2);
    if (this.params.frameRate === 29.97) bits[10] = 1; // Drop-Frame flag at bit 10
    writeBcd(ss, 16, 24, 3);
    writeBcd(mm, 32, 40, 3);
    writeBcd(hh, 48, 56, 2);

    // Standard 16-bit SMPTE LTC Sync Word (0x3FFD in LSB-first order: 0011 1111 1111 1101)
    const syncWord = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
    for (let i = 0; i < 16; i++) {
      bits[64 + i] = syncWord[i];
    }
  }

  formatSmpte(totalSeconds) {
    const fps = this.params.frameRate === 29.97 ? 30 : this.params.frameRate;
    const absSec = Math.max(0, totalSeconds);
    const hh = Math.floor(absSec / 3600) % 24;
    const mm = Math.floor((absSec % 3600) / 60);
    const ss = Math.floor(absSec % 60);
    const ff = Math.floor((absSec - Math.floor(absSec)) * fps);
    const sep = this.params.frameRate === 29.97 ? ';' : ':';
    const pad = (n) => String(n).padStart(2, '0');
    return {
      hh,
      mm,
      ss,
      ff,
      text: `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`
    };
  }

  syncAudioParams() {
    if (!this.isAudioGraphBuilt) return;
    const ctx = this.contextBag.ensureAudioContext();
    const now = ctx.currentTime;

    // Calculate Track 24 SMPTE LTC audible bleed or solo level
    let ltcAudibleGain = 0.0;
    const printLin = Math.pow(10, this.params.ltcPrintLevelDb / 20);

    if (this.params.ltcMonitorSolo) {
      // Engineer is soloing Track 24 SMPTE LTC output
      ltcAudibleGain = 0.22 * printLin;
      this.masterDeckGain.gain.setTargetAtTime(0.15, now, 0.02);
      this.slaveDeckGain.gain.setTargetAtTime(0.15, now, 0.02);
    } else {
      this.masterDeckGain.gain.setTargetAtTime(0.75, now, 0.02);
      this.slaveDeckGain.gain.setTargetAtTime(0.75, now, 0.02);
      // If Track 23 Guard Band is bypassed, Track 24 crosstalks into Track 23 audio!
      if (!this.params.guardBandTrack23) {
        ltcAudibleGain = 0.045 * printLin;
      } else if (this.params.ltcPrintLevelDb > -2) {
        // Even with guard band, printing LTC above 0 VU causes faint magnetic flux bleed
        ltcAudibleGain = 0.008 * printLin;
      }
    }

    if (this.syncState.dropoutRemainingMs > 0) {
      ltcAudibleGain = 0.0;
    }

    this.ltcCrosstalkGain.gain.setTargetAtTime(ltcAudibleGain, now, 0.015);
  }

  /**
   * Simulates the Adams Smith Zeta-Three Capstan Phase-Locked Loop (PLL) Servo
   */
  stepSynchronizerServo(nowMs) {
    const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - this.syncState.lastFrameMs) / 1000));
    this.syncState.lastFrameMs = nowMs;

    if (this.syncState.dropoutRemainingMs > 0) {
      this.syncState.dropoutRemainingMs = Math.max(
        0,
        this.syncState.dropoutRemainingMs - dtSec * 1000
      );
      this.syncAudioParams();
    }

    if (this.syncState.transportRunning) {
      this.syncState.masterTimeSec += dtSec;

      // Error between Master TC and Slave TC (in seconds)
      const targetSlaveSec =
        this.syncState.masterTimeSec - this.params.subFramePhaseMs / 1000;
      const errorSec = targetSlaveSec - this.syncState.slaveTimeSec;
      const absErrFrames = Math.abs(errorSec) * this.params.frameRate;

      if (this.syncState.dropoutRemainingMs > 0) {
        if (this.params.jamSyncEnabled) {
          // Jam Sync Freewheel keeps Slave capstan running at nominal 1.000x crystal reference
          this.syncState.lockStatus = 'FREEWHEEL (JAM SYNC)';
          this.syncState.slaveVarispeedRatio = 1.0;
        } else {
          // Without Jam Sync, slave transport loses tach/LTC lock and decelerates!
          this.syncState.lockStatus = 'DROPOUT UNLOCK!';
          this.syncState.slaveVarispeedRatio = 0.86;
        }
        this.syncState.slaveTimeSec += dtSec * this.syncState.slaveVarispeedRatio;
      } else if (absErrFrames > 1.5) {
        // CHASE MODE: Fast capstan varispeed slewing
        this.syncState.lockStatus = 'CHASE SLEW';
        const slew = Math.max(-0.42, Math.min(0.42, errorSec * 3.0));
        this.syncState.slaveVarispeedRatio = 1.0 + slew;
        this.syncState.slaveTimeSec += dtSec * this.syncState.slaveVarispeedRatio;
      } else if (absErrFrames > 0.008) {
        // PHASE LOCK MODE: Brisk proportional-derivative capstan servo pull-in through the flam zone
        this.syncState.lockStatus = 'PHASE LOCKING';
        const fine = Math.max(-0.18, Math.min(0.18, errorSec * 9.5));
        this.syncState.slaveVarispeedRatio = 1.0 + fine;
        this.syncState.slaveTimeSec += dtSec * this.syncState.slaveVarispeedRatio;
      } else {
        // HARD LOCK (< 0.25 ms error): Snap slave capstan to exact phase lock (zero flam!)
        this.syncState.lockStatus =
          this.params.subFramePhaseMs > 0.1 ? 'PHASE OFFSET LOCK' : 'HARD SYNC LOCK';
        this.syncState.slaveVarispeedRatio = 1.0;
        this.syncState.slaveTimeSec = targetSlaveSec;
      }

      // Rotate 14-inch NAB reels proportional to IPS & varispeed
      const baseOmega = this.params.tapeSpeedIps === 30 ? 3.2 : 1.6;
      this.syncState.masterReelAngle =
        (this.syncState.masterReelAngle + baseOmega * dtSec) % (Math.PI * 2);
      this.syncState.slaveReelAngle =
        (this.syncState.slaveReelAngle +
          baseOmega * this.syncState.slaveVarispeedRatio * dtSec) %
        (Math.PI * 2);
    }

    // Update 80-bit SMPTE LTC frame bits & modulate Bi-Phase Mark oscillator between 1200 Hz ('0') and 2400 Hz ('1')
    const tc = this.formatSmpte(this.syncState.masterTimeSec);
    this.encodeSmpte80BitFrame(tc.hh, tc.mm, tc.ss, tc.ff);

    if (this.isAudioGraphBuilt) {
      const ctx = this.contextBag.ensureAudioContext();
      const now = ctx.currentTime;

      // Pick current bit inside the 80-bit frame based on fractional frame time
      const bitIndex = Math.floor(((nowMs / 2) % 80));
      const bitVal = this.syncState.current80Bits[bitIndex];
      const baseFreq = this.params.frameRate * 80; // ~2400 Hz for '1', ~1200 Hz for '0'
      this.ltcCarrierOsc.frequency.setTargetAtTime(
        bitVal ? baseFreq : baseFreq * 0.5,
        now,
        0.002
      );

      // Update Slave Machine B variable delay line:
      // In HARD SYNC LOCK with 0.0 ms Sub-Frame Offset, delay is strictly 0.0s (zero flamming / comb filtering).
      const timeDiffSec = Math.abs(
        this.syncState.masterTimeSec - this.syncState.slaveTimeSec
      );
      const isHardZeroLock =
        this.syncState.lockStatus === 'HARD SYNC LOCK' && this.params.subFramePhaseMs <= 0.05;
      if (isHardZeroLock) {
        this.slaveServoDelay.delayTime.cancelScheduledValues(now);
        this.slaveServoDelay.delayTime.setValueAtTime(0.0, now);
      } else {
        const clampedDelay = Math.min(0.08, timeDiffSec);
        this.slaveServoDelay.delayTime.setTargetAtTime(clampedDelay, now, 0.018);
      }
    }
  }

  renderUI() {
    const unit = document.createElement('section');
    unit.className = 'vst-suite-rack-unit vst-suite-unit-studer';
    unit.innerHTML = `
      <div class="vst-suite-rack-ear-left">
        <span class="vst-suite-rack-screw"></span>
        <span class="vst-suite-rack-screw"></span>
        <span class="vst-suite-rack-screw"></span>
      </div>
      <div class="vst-suite-rack-ear-right">
        <span class="vst-suite-rack-screw"></span>
        <span class="vst-suite-rack-screw"></span>
        <span class="vst-suite-rack-screw"></span>
      </div>

      <div class="vst-suite-unit-header">
        <div class="vst-suite-unit-title-group">
          <span class="vst-suite-unit-tag">RACK UNIT 03 · 46-TRACK SMPTE LINK</span>
          <div>
            <div class="vst-suite-unit-name">
              DUAL 24-TRACK TAPE SYNCHRONIZER // 2× STUDER A800 + TIMELINE LYNX SYNCHRONIZER
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="What Is a Dual 24-Track Lynx Synchronizer?" data-edu-tip="In the late 1970s and 1980s, a single 2-inch tape machine (like the Studer A800) only held 24 tracks. When huge albums (like Michael Jackson's 'Thriller' or Queen) needed 40+ tracks, engineers linked TWO 24-track tape machines together using a TimeLine Lynx or Adams Smith synchronizer box. Because two mechanical motors naturally drift apart, Track 24 on both tapes carries an audio stopwatch signal (SMPTE Timecode). The Lynx reads both clocks and continuously adjusts Machine B's motor speed so both reels play in tight lockstep!" data-edu-try="Click '⏪ KNOCK SLAVE OUT OF SYNC' while audio is playing to hear Machine B fall behind, speed up its motor (pitching up), and lock back in!">?</button>
            </div>
            <div class="vst-suite-unit-model">Locks Two 24-Track Tape Machines Together via a Track 24 Audio Clock Signal · Yields 46 Usable Tracks</div>
          </div>
        </div>
        <div class="vst-suite-preset-bar" style="align-items:center;">
          <button type="button" class="vst-suite-btn vst-suite-btn-trigger" data-action="slew-offset">⏪ KNOCK SLAVE OUT OF SYNC (-12 FRAMES)</button>
          <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Knock Slave Machine Out of Sync (Chase Mode)" data-edu-tip="Pushes Tape Machine B (Slave) 12 frames (~0.4 seconds) behind Tape Machine A (Master). Watch the Lynx Synchronizer detect the timing gap, speed up Machine B's motor above 100% (which bends the pitch up and causes temporary double-hits/flamming), and settle back into Hard Sync Lock!" data-edu-try="Press Start Test Signal at the top, then click this button and listen to Machine B catch up.">?</button>
          <button type="button" class="vst-suite-btn" data-action="dropout">⚠️ SIMULATE TAPE DROPOUT (1.5s)</button>
          <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Simulate Damaged Timecode Tape (1.5s Dropout)" data-edu-tip="Simulates a 1.5-second worn spot on Track 24 where the timecode clock signal disappears. If 'Jam Sync Protection' is ON, the Lynx synthesizer freewheels smoothly at 100% speed. If Jam Sync is OFF, Machine B loses its clock reference and slows down!" data-edu-try="Turn OFF 'Jam Sync Protection' below, then click 'Simulate Tape Dropout' to hear Machine B lose sync!">?</button>
          <button type="button" class="vst-suite-btn" data-action="locate-zero">⏮ REWIND TO 01:00:00:00</button>
          <button type="button" class="vst-suite-chip vst-suite-chip-expand" data-action="toggle-expand" title="Toggle between single expanded view and all rack units">
            ${this.contextBag && this.contextBag.isSingleMode && this.contextBag.isSingleMode() ? '🗗 ALL RACK UNITS' : '⛶ EXPAND VIEW'}
          </button>
        </div>
      </div>

      <!-- PLAIN-ENGLISH BEGINNER GUIDE DRAWER -->
      <details class="edu-foldable" open style="margin-bottom:12px;">
        <summary>
          <span class="edu-foldable-title">
            <span class="edu-foldable-tag">Plain-English Guide</span>
            <span>How Two Studer A800 Tape Machines &amp; a Lynx Synchronizer Work Together (Click to Fold)</span>
          </span>
          <span class="edu-foldable-chevron">▼</span>
        </summary>
        <div class="edu-foldable-body">
          <strong>1. Why two tape machines?</strong> One 2-inch magnetic tape reel holds at most <strong>24 tracks</strong>. When 1980s producers needed more tracks for stacked vocals, synths, and orchestra, they rolled in a <strong>second Studer A800 24-track machine</strong>.<br/>
          <strong>2. Why can't you just press Play on both?</strong> Heavy mechanical tape motors never spin at the exact same microscopic speed—within seconds, Machine B will drift ahead or behind Machine A, causing drum hits to double ("flam") and drift out of time.<br/>
          <strong>3. How the Lynx Synchronizer fixes it:</strong> Engineers record a digital stopwatch tone (<strong>SMPTE Timecode</strong>) onto <strong>Track 24</strong> of both tapes. The <strong>Lynx Synchronizer</strong> compares the two stopwatch signals 30 times every second and continuously nudges <strong>Machine B's motor speed (Capstan %)</strong> faster or slower until both machines are locked to the exact same millisecond (<strong>HARD SYNC LOCK</strong>).
        </div>
      </details>

      <!-- TIMELINE LYNX / ADAMS SMITH 7-SEGMENT LED TIMECODE DISPLAY BAR -->
      <div class="vst-suite-smpte-display-bar" style="margin-bottom:12px;">
        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>
              TAPE MACHINE A · MASTER (TRACKS 1–22)
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Master Tape Machine A (The Leader)" data-edu-tip="Machine A runs at a fixed, steady speed and acts as the master clock for the studio session. Its Track 24 timecode stopwatch tells Machine B where the song is at every instant.">?</button>
            </span>
            <span>STEADY 100% MOTOR</span>
          </div>
          <div class="vst-suite-tc-digits" data-tc="master">01:00:00:00</div>
        </div>

        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>
              TAPE MACHINE B · SLAVE (TRACKS 25–46)
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Slave Tape Machine B (The Chaser)" data-edu-tip="Machine B's motor speed (CAPSTAN %) is controlled by the Lynx Synchronizer. If Machine B is behind Machine A, the Lynx speeds its motor above 100% until both timecode counters match.">?</button>
            </span>
            <span data-tc="varispeed">CAPSTAN: 100.00%</span>
          </div>
          <div class="vst-suite-tc-digits vst-suite-tc-slave" data-tc="slave">01:00:00:00</div>
        </div>

        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>
              LYNX SYNCHRONIZER STATUS
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Lynx Synchronizer Lock Status & Frame Error (Δ FR)" data-edu-tip="Shows what the Lynx box is doing right now: 'CHASE SLEW' means Machine B is far behind and speeding up fast; 'PHASE LOCKING' means it is fine-tuning the alignment; 'HARD SYNC LOCK' (Δ 0.00 FR) means both tape machines are locked together with zero timing error!">?</button>
            </span>
            <span data-tc="err-frames">Δ 0.00 FR</span>
          </div>
          <div class="vst-suite-tc-digits vst-suite-tc-locked" data-tc="status" style="font-size:16px; padding-top:4px;">HARD SYNC LOCK</div>
        </div>
      </div>

      <div class="vst-suite-module-grid-2">
        <!-- COLUMN 1: SYNCHRONIZER & GUARD-BAND CONTROLS -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              1. Lynx Synchronizer Controls &amp; Track 24 Clock Settings
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Timecode Bleed, Guard Band & Manual Drift" data-edu-tip="Because the Track 24 timecode clock is a loud, buzzing tone recorded right on the edge of the tape, it can accidentally leak ('crosstalk') into the music on Track 23. Engineers leave Track 23 blank as a safety buffer ('Guard Band') to block that buzz." data-edu-try="Click 'TRK 23 SAFETY BUFFER' to turn it red (OFF) and hear the high-pitched timecode buzz leak into the music!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">46 Usable Audio Tracks</span>
          </div>

          <div class="vst-suite-param-grid">
            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">
                Clock Frame Rate
                <button type="button" class="edu-tip-badge edu-amber" data-edu-title="SMPTE Clock Frame Rate (Frames Per Second)" data-edu-tip="How many times per second the Track 24 stopwatch updates. Music studios usually used 30 frames per second (fps), European TV used 25 fps, and Hollywood film used 24 fps.">?</button>
              </span>
              <select class="vst-suite-select" data-param="frameRate" style="grid-column: span 2;">
                <option value="30">30 fps (US Music Studio Standard)</option>
                <option value="29.97">29.97 fps (US Color TV Broadcast)</option>
                <option value="25">25 fps (European PAL TV &amp; Video)</option>
                <option value="24">24 fps (Cinema 35mm Film Standard)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">
                Reel Tape Speed
                <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Tape Speed: 30 IPS vs 15 IPS" data-edu-tip="Inches Per Second (IPS) is how fast the magnetic tape travels across the heads. 30 IPS gives cleaner highs and less tape hiss, while 15 IPS gives twice the recording time and a punchier low-bass 'head bump'.">?</button>
              </span>
              <select class="vst-suite-select" data-param="tapeSpeedIps" style="grid-column: span 2;">
                <option value="30">30 IPS (Fast · Lowest Tape Hiss)</option>
                <option value="15">15 IPS (Warm Bass · 2× Recording Time)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">
                Manual Timing Drift
                <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Manual Timing Drift (Sub-Frame Offset)" data-edu-tip="Deliberately delays Slave Machine B by 0 to 12 milliseconds relative to Master Machine A. At 0.0 ms, both machines are perfectly aligned. Turn this up to hear hollow 'comb-filtering' (1–5 ms) or audible drum double-hits/'flamming' (6–12 ms)!" data-edu-try="Slide this from 0.0 ms up to 10.0 ms while drums are playing to hear why sub-millisecond sync matters.">?</button>
              </span>
              <input type="range" class="vst-suite-slider" data-param="subFramePhaseMs" min="0" max="12" step="0.2" value="0" />
              <span class="vst-suite-param-val" data-readout="subFramePhaseMs">0.0 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">
                Trk 24 Clock Volume
                <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Track 24 Timecode Recording Level" data-edu-tip="Controls how loud the SMPTE timecode tone is printed onto Track 24. Engineers usually printed it around -6 VU. If you print it too loud (above 0 VU), the buzzing tone bleeds into neighboring music tracks even with a guard band!">?</button>
              </span>
              <input type="range" class="vst-suite-slider" data-param="ltcPrintLevelDb" min="-18" max="3" step="1" value="-6" />
              <span class="vst-suite-param-val" data-readout="ltcPrintLevelDb">-6 VU</span>
            </div>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">
            <button type="button" class="vst-suite-btn" data-toggle="guardBandTrack23" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot vst-suite-on-green" data-led="guardBandTrack23"></span>
              TRK 23 SAFETY BUFFER (BLOCK TIMECODE BLEED)
            </button>
            <button type="button" class="vst-suite-btn" data-toggle="ltcMonitorSolo" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot" data-led="ltcMonitorSolo"></span>
              LISTEN TO TRACK 24 CLOCK TONE (SOLO)
            </button>
          </div>

          <div style="display:flex; gap:8px;">
            <button type="button" class="vst-suite-btn" data-toggle="jamSyncEnabled" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot vst-suite-on-amber" data-led="jamSyncEnabled"></span>
              JAM SYNC DROPOUT PROTECTION (KEEP LOCK IF TAPE WEARS)
            </button>
          </div>

          <details class="edu-foldable" style="margin-top:4px;">
            <summary>
              <span class="edu-foldable-title">
                <span class="edu-foldable-tag">Studio Math</span>
                <span>Why Two 24-Track Machines Give You 44–46 Tracks (Not 48)</span>
              </span>
              <span class="edu-foldable-chevron">▼</span>
            </summary>
            <div class="edu-foldable-body">
              Each Studer A800 has 24 tracks across a 2-inch tape. However, <strong>Track 24</strong> on both machines must be used to record the high-pitched SMPTE timecode clock signal (leaving 23 tracks per machine). Because that clock signal is an aggressive buzzing tone that easily leaks into the track next door, engineers also leave <strong>Track 23 blank as a safety buffer ("Guard Band")</strong>—leaving $22 + 22 = 44$ (or up to 46) clean music tracks!
            </div>
          </details>
        </div>

        <!-- COLUMN 2: DUAL STUDER A800 TRANSPORTS + 80-BIT MANCHESTER BI-PHASE SCOPE -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              2. Visual Diagram: Machine A + Lynx Synchronizer + Machine B
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Reading the Visual Transport & Timecode Display" data-edu-tip="Top Left: Master Deck A and Slave Deck B reels spinning in real time, linked by the Lynx Synchronizer. Top Right: All 24 tracks on the tape head (Tracks 1–22 in green carry music, Track 23 is the safety buffer, and Track 24 in amber carries the clock tone). Bottom: The actual digital pulse wave inside Track 24's clock tone!" data-edu-try="Turn OFF 'TRK 23 SAFETY BUFFER' to watch Track 23 turn red with timecode bleed in the 24-track meter!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Live Transport &amp; Track 24 Scope</span>
          </div>

          <div class="vst-suite-canvas-wrap">
            <canvas class="vst-suite-canvas vst-suite-canvas-tall" data-canvas="smpte-scope"></canvas>
          </div>
        </div>
      </div>
    `;

    this.unitEl = unit;
    this.parentEl.appendChild(unit);
    this.canvasEl = unit.querySelector('[data-canvas="smpte-scope"]');
    this.bindEvents();
    this.syncUIFromParams();
  }

  bindEvents() {
    const sig = { signal: this.abortController.signal };

    const slewBtn = this.unitEl.querySelector('[data-action="slew-offset"]');
    if (slewBtn) {
      slewBtn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          // Knock Slave Machine B behind Master Machine A by 12 frames (~0.40s) to trigger audible CHASE slew!
          this.syncState.slaveTimeSec = this.syncState.masterTimeSec - 12 / this.params.frameRate;
        },
        sig
      );
    }

    const dropBtn = this.unitEl.querySelector('[data-action="dropout"]');
    if (dropBtn) {
      dropBtn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.syncState.dropoutRemainingMs = 1500;
          this.syncAudioParams();
        },
        sig
      );
    }

    const locBtn = this.unitEl.querySelector('[data-action="locate-zero"]');
    if (locBtn) {
      locBtn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.syncState.masterTimeSec = 3600.0;
          this.syncState.slaveTimeSec = 3599.65; // Slight chase on locate
        },
        sig
      );
    }

    // Expand / Collapse Single Unit View
    const expandBtn = this.unitEl.querySelector('[data-action="toggle-expand"]');
    if (expandBtn) {
      expandBtn.addEventListener(
        'click',
        () => {
          if (this.contextBag && this.contextBag.isSingleMode && this.contextBag.isSingleMode()) {
            if (this.contextBag.onShowAllUnits) this.contextBag.onShowAllUnits();
          } else {
            if (this.contextBag.onExpandUnit) this.contextBag.onExpandUnit();
          }
        },
        sig
      );
    }

    this.unitEl.querySelectorAll('[data-param]').forEach((el) => {
      const param = el.getAttribute('data-param');
      const handler = () => {
        this.ensureAudioGraph();
        this.params[param] = parseFloat(el.value);
        this.syncAudioParams();
        this.syncUIFromParams();
      };
      el.addEventListener('input', handler, sig);
      el.addEventListener('change', handler, sig);
    });

    this.unitEl.querySelectorAll('[data-toggle]').forEach((btn) => {
      const param = btn.getAttribute('data-toggle');
      btn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.params[param] = !this.params[param];
          this.syncAudioParams();
          this.syncUIFromParams();
        },
        sig
      );
    });
  }

  syncUIFromParams() {
    if (!this.unitEl) return;

    const setReadout = (k, text) => {
      const el = this.unitEl.querySelector(`[data-readout="${k}"]`);
      if (el) el.textContent = text;
    };

    setReadout('subFramePhaseMs', `${this.params.subFramePhaseMs.toFixed(1)} ms`);
    setReadout(
      'ltcPrintLevelDb',
      `${this.params.ltcPrintLevelDb >= 0 ? '+' : ''}${this.params.ltcPrintLevelDb} VU`
    );

    const guardLed = this.unitEl.querySelector('[data-led="guardBandTrack23"]');
    if (guardLed) {
      guardLed.className = `vst-suite-led-dot ${
        this.params.guardBandTrack23 ? 'vst-suite-on-green' : 'vst-suite-on-red'
      }`;
    }

    const soloLed = this.unitEl.querySelector('[data-led="ltcMonitorSolo"]');
    if (soloLed) {
      soloLed.className = `vst-suite-led-dot ${
        this.params.ltcMonitorSolo ? 'vst-suite-on-amber' : ''
      }`;
    }

    const jamLed = this.unitEl.querySelector('[data-led="jamSyncEnabled"]');
    if (jamLed) {
      jamLed.className = `vst-suite-led-dot ${
        this.params.jamSyncEnabled ? 'vst-suite-on-amber' : ''
      }`;
    }
  }

  startVisualLoop() {
    const loop = (now) => {
      this.stepSynchronizerServo(now);
      this.renderTelemetryAndScope(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  drawNabReel(ctx, cx, cy, radius, angle, label, accentColor) {
    ctx.save();
    ctx.translate(cx, cy);

    // Outer magnetic tape pack
    ctx.fillStyle = '#181310';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.88, 0, Math.PI * 2);
    ctx.fill();

    // Aluminum flange ring
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 3 Rotating NAB cutouts
    ctx.rotate(angle);
    ctx.fillStyle = '#2d3744';
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.roundRect(-5, radius * 0.28, 10, radius * 0.56, 3);
      ctx.fill();
      ctx.restore();
    }

    // Center NAB hub
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(label, cx - radius, cy + radius + 13);
  }

  renderTelemetryAndScope(nowMs) {
    if (!this.unitEl) return;

    const masterFmt = this.formatSmpte(this.syncState.masterTimeSec);
    const slaveFmt = this.formatSmpte(this.syncState.slaveTimeSec);
    const errFrames =
      (this.syncState.masterTimeSec - this.syncState.slaveTimeSec) * this.params.frameRate;

    const mEl = this.unitEl.querySelector('[data-tc="master"]');
    const sEl = this.unitEl.querySelector('[data-tc="slave"]');
    const vEl = this.unitEl.querySelector('[data-tc="varispeed"]');
    const eEl = this.unitEl.querySelector('[data-tc="err-frames"]');
    const stEl = this.unitEl.querySelector('[data-tc="status"]');

    if (mEl) mEl.textContent = masterFmt.text;
    if (sEl) sEl.textContent = slaveFmt.text;
    if (vEl)
      vEl.textContent = `CAPSTAN: ${(this.syncState.slaveVarispeedRatio * 100).toFixed(2)}%`;
    if (eEl) eEl.textContent = `Δ ${errFrames >= 0 ? '+' : ''}${errFrames.toFixed(2)} FR`;
    if (stEl) {
      stEl.textContent = this.syncState.lockStatus;
      stEl.className = `vst-suite-tc-digits ${
        this.syncState.lockStatus === 'HARD SYNC LOCK'
          ? 'vst-suite-tc-locked'
          : 'vst-suite-tc-slave'
      }`;
    }

    if (!this.canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvasEl.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (this.canvasEl.width !== w || this.canvasEl.height !== h) {
      this.canvasEl.width = w;
      this.canvasEl.height = h;
    }

    const ctx = this.canvasEl.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    const cw = rect.width;
    const ch = rect.height;

    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, cw, ch);

    // Top Half: Dual Studer A800 NAB Reel Transports + Lynx Sync Bridge + 24-Track Head Strip
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fca5a5';
    ctx.fillText('DECK A · MASTER (100%)', 16, 12);

    ctx.fillStyle = '#fcd34d';
    ctx.fillText(
      `DECK B · SLAVE (${(this.syncState.slaveVarispeedRatio * 100).toFixed(1)}%)`,
      184,
      12
    );

    const rRadius = 26;
    this.drawNabReel(ctx, 44, 43, rRadius, this.syncState.masterReelAngle, 'SUPPLY', '#ff3b30');
    this.drawNabReel(ctx, 112, 43, rRadius, this.syncState.masterReelAngle, 'TAKEUP', '#ff3b30');

    // Lynx Sync connection line between Deck A and Deck B
    const isLocked = this.syncState.lockStatus === 'HARD SYNC LOCK';
    ctx.strokeStyle = isLocked ? '#30d158' : '#ffb74d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(142, 43);
    ctx.lineTo(180, 43);
    ctx.stroke();

    ctx.fillStyle = '#111827';
    ctx.fillRect(144, 32, 34, 20);
    ctx.strokeRect(144, 32, 34, 20);
    ctx.fillStyle = isLocked ? '#30d158' : '#ffb74d';
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.fillText('LYNX', 150, 41);
    ctx.fillText(isLocked ? 'LOCK' : 'SYNC', 150, 49);

    this.drawNabReel(ctx, 210, 43, rRadius, this.syncState.slaveReelAngle, 'SUPPLY', '#ffb74d');
    this.drawNabReel(ctx, 278, 43, rRadius, this.syncState.slaveReelAngle, 'TAKEUP', '#ffb74d');

    // Right side of Top Half: 24-Track Head Stack Visualizer (Tracks 1–22 Music, 23 Safety Buffer, 24 Clock)
    const trkStartX = 328;
    const trkW = Math.max(4, (cw - trkStartX - 14) / 24);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('24-TRACK TAPE HEAD (1–22 MUSIC · 23 BUFFER · 24 CLOCK)', trkStartX, 12);

    for (let t = 0; t < 24; t++) {
      const tx = trkStartX + t * trkW;
      const barMaxH = 54;
      let level = 0;
      let color = '#30d158';

      if (t < 22) {
        // Audio tracks 1-22
        level = 0.35 + 0.45 * Math.abs(Math.sin(nowMs * 0.004 + t * 0.7));
      } else if (t === 22) {
        // Track 23: Guard Band!
        if (this.params.guardBandTrack23) {
          level = 0.04;
          color = '#475569';
        } else {
          // Crosstalk bleed from Track 24!
          level = 0.55;
          color = '#ff3b30';
        }
      } else {
        // Track 24: SMPTE LTC Bi-Phase Mark Carrier
        level = this.syncState.dropoutRemainingMs > 0 ? 0.02 : 0.88;
        color = '#ffb74d';
      }

      ctx.fillStyle = '#141921';
      ctx.fillRect(tx, 20, Math.max(2, trkW - 2), barMaxH);

      const fillH = level * barMaxH;
      ctx.fillStyle = color;
      ctx.fillRect(tx, 20 + barMaxH - fillH, Math.max(2, trkW - 2), fillH);
    }

    // Bottom Half: Real-Time 80-Bit SMPTE Manchester Bi-Phase Mark Waveform Scope
    const waveTop = 104;
    const waveH = ch - waveTop - 18;
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(8, waveTop - 12, cw - 16, waveH + 22);

    ctx.fillStyle = '#00e5ff';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(
      'TRACK 24 AUDIO CLOCK TONE (SMPTE TIMECODE PULSE WAVE · SOUNDS LIKE A DIAL-UP MODEM)',
      14,
      waveTop
    );

    const bits = this.syncState.current80Bits;
    const numVisibleBits = 32; // Show 32 bits cleanly including Sync Word
    const cellW = (cw - 28) / numVisibleBits;
    const highY = waveTop + 12;
    const lowY = waveTop + waveH - 2;

    ctx.strokeStyle = this.syncState.dropoutRemainingMs > 0 ? '#ff3b30' : '#00e5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let polarity = 1;
    const startBit = 48; // Shows Hours BCD + 16-bit Sync Word (bits 48..79)
    for (let i = 0; i < numVisibleBits; i++) {
      const bitVal = this.syncState.dropoutRemainingMs > 0 ? 0 : bits[startBit + i];
      const x0 = 14 + i * cellW;
      const xMid = x0 + cellW * 0.5;
      const x1 = x0 + cellW;

      // Bi-Phase Mark Rule: ALWAYS transition at start of bit cell
      polarity = -polarity;
      const yStart = polarity > 0 ? highY : lowY;

      if (i === 0) ctx.moveTo(x0, yStart);
      else ctx.lineTo(x0, yStart);

      if (bitVal === 1 && this.syncState.dropoutRemainingMs === 0) {
        // Binary '1': mid-bit transition!
        ctx.lineTo(xMid, yStart);
        polarity = -polarity;
        const yMid = polarity > 0 ? highY : lowY;
        ctx.lineTo(xMid, yMid);
        ctx.lineTo(x1, yMid);
      } else {
        // Binary '0': no mid-bit transition
        const yFlat = this.syncState.dropoutRemainingMs > 0 ? (highY + lowY) / 2 : yStart;
        ctx.lineTo(x1, yFlat);
      }
    }
    ctx.stroke();

    ctx.restore();
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.abortController.abort();
    this.scheduledSources.forEach((s) => {
      try {
        s.stop();
      } catch (_) {}
    });
    this.scheduledSources = [];
    this.audioNodes.forEach((n) => {
      try {
        n.disconnect();
      } catch (_) {}
    });
    this.audioNodes = [];
    if (this.unitEl && this.unitEl.parentNode) {
      this.unitEl.parentNode.removeChild(this.unitEl);
    }
  }
}

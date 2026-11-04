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
    this.slaveServoDelay.delayTime.value = 0.0005;

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
      } else if (absErrFrames > 1.5) {
        // CHASE MODE: Fast capstan varispeed slewing
        this.syncState.lockStatus = 'CHASE SLEW';
        const slew = Math.max(-0.35, Math.min(0.35, errorSec * 2.4));
        this.syncState.slaveVarispeedRatio = 1.0 + slew;
      } else if (absErrFrames > 0.06) {
        // PHASE LOCK MODE: Fine proportional-derivative capstan servo
        this.syncState.lockStatus = 'PHASE LOCKING';
        const fine = Math.max(-0.06, Math.min(0.06, errorSec * 3.8));
        this.syncState.slaveVarispeedRatio = 1.0 + fine;
      } else {
        // HARD LOCK (< 0.05 frame error)
        this.syncState.lockStatus = 'HARD SYNC LOCK';
        this.syncState.slaveVarispeedRatio = 1.0 + errorSec * 1.5;
      }

      this.syncState.slaveTimeSec += dtSec * this.syncState.slaveVarispeedRatio;

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

      // Update Slave Machine B variable delay line to produce real audible pitch slewing & comb-filtering!
      const timeDiffSec = Math.abs(
        this.syncState.masterTimeSec - this.syncState.slaveTimeSec
      );
      const clampedDelay = Math.max(0.0001, Math.min(0.08, timeDiffSec));
      this.slaveServoDelay.delayTime.setTargetAtTime(clampedDelay, now, 0.025);
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
              DUAL 24-TRACK SMPTE SYNCHRONIZER // 2x STUDER A800 MKIII + ADAMS SMITH ZETA-THREE
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Dual 24-Track SMPTE Tape Synchronization (46 Tracks)" data-edu-tip="When 24 tracks on a 2-inch Studer A800 weren't enough for late-1970s/1980s productions (Queen, Toto, Michael Jackson's 'Thriller'), engineers locked two 24-track machines together using an Adams Smith Zeta-Three or Lynx synchronizer. It compares 80-bit SMPTE Longitudinal Timecode (LTC) on Track 24 of both reels and continuously adjusts the Slave machine's DC capstan motor speed via a Phase-Locked Loop (PLL)." data-edu-try="Click '⏪ TRIGGER SLAVE CHASE (-12 FRAMES)' while audio is playing to hear the Slave machine pitch-slew and lock back in!">?</button>
            </div>
            <div class="vst-suite-unit-model">80-Bit Longitudinal Timecode (LTC) on Track 24 · Track 23 Guard-Band · PLL Capstan Varispeed Servo</div>
          </div>
        </div>
        <div class="vst-suite-preset-bar">
          <button type="button" class="vst-suite-btn vst-suite-btn-trigger" data-action="slew-offset">⏪ TRIGGER SLAVE CHASE (-12 FRAMES)</button>
          <button type="button" class="vst-suite-btn" data-action="dropout">⚠️ SIMULATE TC DROPOUT (1.5s)</button>
          <button type="button" class="vst-suite-btn" data-action="locate-zero">LOCATE 01:00:00:00</button>
        </div>
      </div>

      <!-- ADAMS SMITH ZETA-THREE 7-SEGMENT LED TIMECODE DISPLAY BAR -->
      <div class="vst-suite-smpte-display-bar" style="margin-bottom:12px;">
        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>STUDER A800 MASTER (MACHINE A · TRK 1–22)</span>
            <span>TRK 24 LTC OUT</span>
          </div>
          <div class="vst-suite-tc-digits" data-tc="master">01:00:00:00</div>
        </div>

        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>STUDER A800 SLAVE (MACHINE B · TRK 25–46)</span>
            <span data-tc="varispeed">CAPSTAN: 100.00%</span>
          </div>
          <div class="vst-suite-tc-digits vst-suite-tc-slave" data-tc="slave">01:00:00:00</div>
        </div>

        <div class="vst-suite-tc-box">
          <div class="vst-suite-tc-label">
            <span>ADAMS SMITH ZETA-3 SERVO STATUS</span>
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
              1. SMPTE LTC Standard, Guard Band &amp; Capstan Phase
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Track 23 Guard Band, Sub-Frame Phase & Jam Sync" data-edu-tip="SMPTE LTC is an aggressive 1200/2400 Hz square-wave audio signal printed on Track 24. Without leaving Track 23 empty as a Guard Band, capacitive head crosstalk bleeds timecode whine into Track 23 audio! Meanwhile, JAM SYNC regenerates fresh timecode during tape oxide dropouts so the slave machine doesn't lose lock." data-edu-try="Disengage 'TRK 23 GUARD BAND' to hear 2.4 kHz LTC crosstalk bleed into the mix, or click 'SOLO TRK 24 SMPTE BI-PHASE AUDIO' to hear raw timecode!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">46 Usable Audio Tracks</span>
          </div>

          <div class="vst-suite-param-grid">
            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">SMPTE Frame Rate</span>
              <select class="vst-suite-select" data-param="frameRate" style="grid-column: span 2;">
                <option value="30">30 fps (NTSC Non-Drop Music Standard)</option>
                <option value="29.97">29.97 fps (NTSC Drop-Frame Broadcast)</option>
                <option value="25">25 fps (EBU PAL European Video)</option>
                <option value="24">24 fps (35mm Cinema Film Standard)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Tape Speed (IPS)</span>
              <select class="vst-suite-select" data-param="tapeSpeedIps" style="grid-column: span 2;">
                <option value="30">30 IPS (Low Noise · Tight Bass Head Bump)</option>
                <option value="15">15 IPS (Warm 60 Hz Head Bump · 2x Reel Time)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Sub-Frame Offset</span>
              <input type="range" class="vst-suite-slider" data-param="subFramePhaseMs" min="0" max="12" step="0.2" value="0" />
              <span class="vst-suite-param-val" data-readout="subFramePhaseMs">0.0 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Trk 24 LTC Level</span>
              <input type="range" class="vst-suite-slider" data-param="ltcPrintLevelDb" min="-18" max="3" step="1" value="-6" />
              <span class="vst-suite-param-val" data-readout="ltcPrintLevelDb">-6 VU</span>
            </div>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">
            <button type="button" class="vst-suite-btn" data-toggle="guardBandTrack23" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot vst-suite-on-green" data-led="guardBandTrack23"></span>
              TRK 23 GUARD BAND (ISOLATE CROSSTALK)
            </button>
            <button type="button" class="vst-suite-btn" data-toggle="ltcMonitorSolo" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot" data-led="ltcMonitorSolo"></span>
              SOLO TRK 24 SMPTE BI-PHASE AUDIO
            </button>
          </div>

          <div style="display:flex; gap:8px;">
            <button type="button" class="vst-suite-btn" data-toggle="jamSyncEnabled" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot vst-suite-on-amber" data-led="jamSyncEnabled"></span>
              JAM SYNC FREEWHEEL PROTECTION (ON)
            </button>
          </div>

          <details class="edu-foldable" style="margin-top:4px;">
            <summary>
              <span class="edu-foldable-title">
                <span class="edu-foldable-tag">Studio Math</span>
                <span>Why 2× 24-Track Machines Equal 46 Usable Audio Tracks</span>
              </span>
              <span class="edu-foldable-chevron">▼</span>
            </summary>
            <div class="edu-foldable-body">
              Track 24 on both machines is dedicated to 2400 Hz Manchester Bi-Phase SMPTE timecode (leaving 23 tracks per machine). Because the edge-track timecode signal is a steep square wave, Track 23 is left blank as a <strong>Guard Band</strong> so timecode whine cannot bleed into adjacent vocal or acoustic guitar tracks—yielding $22 + 22 = 44$ (or up to 46) clean audio tracks!
            </div>
          </details>
        </div>

        <!-- COLUMN 2: DUAL STUDER A800 TRANSPORTS + 80-BIT MANCHESTER BI-PHASE SCOPE -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              2. Studer A800 Dual Transports &amp; 80-Bit Bi-Phase Mark Scope
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="80-Bit Manchester Bi-Phase Mark Encoding" data-edu-tip="Each video/audio frame contains 80 bits encoding Hours:Minutes:Seconds:Frames in Binary-Coded Decimal (BCD) plus a 16-bit Sync Word (0011 1111 1111 1101) at bits 64–79 so the reader knows tape direction and frame boundaries even during fast wind!" data-edu-try="Watch the spinning Studer A800 reels and live 80-bit Manchester square wave below.">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Sync Word: 0011 1111 1111 1101</span>
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

    // Top Half: Dual Studer A800 NAB Reel Transports + 24-Track Head Allocation Strip
    const rRadius = 29;
    this.drawNabReel(ctx, 46, 40, rRadius, this.syncState.masterReelAngle, 'MASTER', '#ff3b30');
    this.drawNabReel(ctx, 118, 40, rRadius, this.syncState.masterReelAngle, 'A800-A', '#ff3b30');

    this.drawNabReel(ctx, 212, 40, rRadius, this.syncState.slaveReelAngle, 'SLAVE', '#ffb74d');
    this.drawNabReel(ctx, 284, 40, rRadius, this.syncState.slaveReelAngle, 'A800-B', '#ffb74d');

    // Right side of Top Half: 24-Track Head Stack Visualizer (Tracks 1–22 Audio, 23 Guard, 24 LTC)
    const trkStartX = 335;
    const trkW = Math.max(4, (cw - trkStartX - 14) / 24);
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('24-TRACK 2" HEAD STACK (TRK 1–22 AUDIO · 23 GUARD · 24 LTC)', trkStartX, 14);

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
      '80-BIT SMPTE LTC MANCHESTER BI-PHASE MARK WAVEFORM (0 = 1x TRANSITION · 1 = 2x TRANSITION)',
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

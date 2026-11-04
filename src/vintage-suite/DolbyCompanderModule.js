/**
 * MODULE 2: Dolby Noise Compander System (Dolby A-Type Cat. 22, Dolby B & "Air Trick" Exciter)
 * Implements the 4-band differential additive/subtractive bilinear compander network,
 * an intermediate Analog Tape Oxide Hiss channel, Calibration Trim, and 850 Hz Dolby Tone.
 */
export class DolbyCompanderModule {
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
      mode: 'encode-decode', // 'encode-decode' | 'air-trick' | 'raw-tape' | 'mistracked'
      topology: 'dolby-a', // 'dolby-a' (4-Band Cat.22) | 'dolby-b' (Single Sliding HF Band)
      tapeHissDb: -46, // -72 dB to -30 dB
      calibrationTrimDb: 0.0, // -10 dB to +10 dB (0 dB = matched Dolby Level)
      airTrickDrive: 100, // 0 - 150% differential intensity
      dolbyToneActive: false,
      bandEnabled: [true, true, true, true] // Band 1 (80LP), Band 2 (80-3k), Band 3 (3kHP), Band 4 (9kHP)
    };

    this.bandSpecs = [
      { id: 0, name: 'BAND 1 (HUM)', freqLabel: '< 80 Hz LP', maxBoostDb: 10.0 },
      { id: 1, name: 'BAND 2 (MID)', freqLabel: '80 Hz – 3 kHz', maxBoostDb: 10.0 },
      { id: 2, name: 'BAND 3 (HISS)', freqLabel: '> 3.0 kHz HP', maxBoostDb: 10.0 },
      { id: 3, name: 'BAND 4 (AIR)', freqLabel: '> 9.0 kHz HP', maxBoostDb: 5.5 } // Stacks on Band 3 = +15.5dB
    ];

    this.telemetry = {
      bandInputDb: [-60, -60, -60, -60],
      bandEncodeBoostDb: [0, 0, 0, 0],
      bandDecodeCutDb: [0, 0, 0, 0],
      netHissReductionDb: 0,
      vuLevelDb: -40,
      warblePhase: 0
    };

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

    // 850 Hz Dolby Reference Calibration Tone Oscillator (FM Warble)
    this.dolbyToneOsc = ctx.createOscillator();
    this.dolbyToneOsc.type = 'sine';
    this.dolbyToneOsc.frequency.value = 850;
    this.dolbyToneGain = ctx.createGain();
    this.dolbyToneGain.gain.value = 0;
    this.dolbyToneOsc.connect(this.dolbyToneGain);
    this.dolbyToneOsc.start();
    this.scheduledSources.push(this.dolbyToneOsc);

    // Pre-Encoder Sum (Audio Input + Optional Dolby Reference Tone)
    this.preEncodeSum = ctx.createGain();
    this.inputGain.connect(this.preEncodeSum);
    this.dolbyToneGain.connect(this.preEncodeSum);

    // =========================================================================
    // STAGE 1: DOLBY CAT. 22 4-BAND DIFFERENTIAL ENCODER
    // Main Linear Path + 4 Parallel Low-Level Differential Boost Filters
    // =========================================================================
    this.encodeSum = ctx.createGain();
    this.preEncodeSum.connect(this.encodeSum); // Linear 1:1 main path

    this.encodeBands = this.bandSpecs.map((spec, idx) => {
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();
      if (idx === 0) {
        f1.type = 'lowpass';
        f1.frequency.value = 80;
        f2.type = 'allpass';
        f2.frequency.value = 80;
      } else if (idx === 1) {
        f1.type = 'highpass';
        f1.frequency.value = 80;
        f2.type = 'lowpass';
        f2.frequency.value = 3000;
      } else if (idx === 2) {
        f1.type = 'highpass';
        f1.frequency.value = 3000;
        f2.type = 'allpass';
        f2.frequency.value = 3000;
      } else {
        f1.type = 'highpass';
        f1.frequency.value = 9000;
        f2.type = 'allpass';
        f2.frequency.value = 9000;
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const buf = new Float32Array(128);

      const diffGain = ctx.createGain();
      diffGain.gain.value = 0;

      this.preEncodeSum.connect(f1);
      f1.connect(f2);
      f2.connect(analyser);
      f2.connect(diffGain);
      diffGain.connect(this.encodeSum);

      this.audioNodes.push(f1, f2, analyser, diffGain);
      return { f1, f2, analyser, buf, diffGain, spec };
    });

    // =========================================================================
    // STAGE 2: ANALOG TAPE OXIDE CHANNEL (Hiss Floor + Calibration Level Trim)
    // =========================================================================
    this.tapeCalGain = ctx.createGain();
    this.tapeCalGain.gain.value = 1.0;

    // Continuous Tape Hiss Buffer Loop
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(2, noiseLen, ctx.sampleRate);
    let seed = 19660501;
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuffer.getChannelData(ch);
      let b0 = 0;
      for (let i = 0; i < noiseLen; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const w = (seed / 0xffffffff) * 2 - 1;
        // Tape oxide spectral tilt (slight HF emphasis + warm bias floor)
        b0 = 0.55 * b0 + 0.45 * w;
        data[i] = (w * 0.7 + b0 * 0.3) * 0.5;
      }
    }
    this.tapeNoiseSource = ctx.createBufferSource();
    this.tapeNoiseSource.buffer = noiseBuffer;
    this.tapeNoiseSource.loop = true;

    this.tapeNoiseFilter = ctx.createBiquadFilter();
    this.tapeNoiseFilter.type = 'highpass';
    this.tapeNoiseFilter.frequency.value = 950;

    this.tapeNoiseGain = ctx.createGain();
    this.tapeNoiseGain.gain.value = Math.pow(10, this.params.tapeHissDb / 20);

    this.tapeNoiseSource.connect(this.tapeNoiseFilter);
    this.tapeNoiseFilter.connect(this.tapeNoiseGain);
    this.tapeNoiseSource.start();
    this.scheduledSources.push(this.tapeNoiseSource);

    this.tapeChannelSum = ctx.createGain();
    this.encodeSum.connect(this.tapeCalGain);
    this.tapeCalGain.connect(this.tapeChannelSum);
    this.tapeNoiseGain.connect(this.tapeChannelSum);

    // On-Tape VU Analyser (Measures signal + calibration level on tape)
    this.onTapeAnalyser = ctx.createAnalyser();
    this.onTapeAnalyser.fftSize = 512;
    this.onTapeBuf = new Float32Array(256);
    this.tapeChannelSum.connect(this.onTapeAnalyser);

    // =========================================================================
    // STAGE 3: DOLBY CAT. 22 4-BAND COMPLEMENTARY DECODER
    // =========================================================================
    this.decodeBands = this.bandSpecs.map((spec, idx) => {
      const eq = ctx.createBiquadFilter();
      if (idx === 0) {
        eq.type = 'lowshelf';
        eq.frequency.value = 90;
      } else if (idx === 1) {
        eq.type = 'peaking';
        eq.frequency.value = 750;
        eq.Q.value = 0.55;
      } else if (idx === 2) {
        eq.type = 'highshelf';
        eq.frequency.value = 3000;
      } else {
        eq.type = 'highshelf';
        eq.frequency.value = 9000;
      }
      eq.gain.value = 0;
      this.audioNodes.push(eq);
      return { eq, spec };
    });

    // Chain the 4 complementary decoder bands in series after the tape sum
    this.tapeChannelSum.connect(this.decodeBands[0].eq);
    this.decodeBands[0].eq.connect(this.decodeBands[1].eq);
    this.decodeBands[1].eq.connect(this.decodeBands[2].eq);
    this.decodeBands[2].eq.connect(this.decodeBands[3].eq);

    this.outputAnalyser = ctx.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputFreqData = new Uint8Array(this.outputAnalyser.frequencyBinCount);

    this.decodeBands[3].eq.connect(this.outputAnalyser);
    this.decodeBands[3].eq.connect(this.outputGain);

    this.audioNodes.push(
      this.inputGain,
      this.outputGain,
      this.dolbyToneOsc,
      this.dolbyToneGain,
      this.preEncodeSum,
      this.encodeSum,
      this.tapeCalGain,
      this.tapeNoiseSource,
      this.tapeNoiseFilter,
      this.tapeNoiseGain,
      this.tapeChannelSum,
      this.onTapeAnalyser,
      this.outputAnalyser
    );

    this.isAudioGraphBuilt = true;
    this.syncAudioParams();
  }

  /**
   * Dolby Bilinear Differential Compander Law:
   * Below -36 dB: full differential boost (+10 dB for Bands 1-3, +5.5 dB stacked for Band 4).
   * Between -36 dB and -14 dB: smooth transition knee down to 0 dB boost.
   * Above -14 dB: 0 dB differential boost (uncompressed 1:1 high-level transparency).
   */
  computeDolbyBilinearDb(levelDb, maxBoostDb) {
    const lowKnee = -38;
    const highKnee = -12;
    if (levelDb <= lowKnee) return maxBoostDb;
    if (levelDb >= highKnee) return 0.0;
    const t = (highKnee - levelDb) / (highKnee - lowKnee);
    // Smooth cosine interpolation across the bilinear knee
    return maxBoostDb * (0.5 - 0.5 * Math.cos(Math.PI * t));
  }

  computeRmsDb(analyser, buf) {
    if (!analyser) return -66;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
    }
    const rms = Math.sqrt(sum / buf.length);
    return Math.max(-68, 20 * Math.log10(rms + 1e-6));
  }

  syncAudioParams() {
    if (!this.isAudioGraphBuilt) return;
    const ctx = this.contextBag.ensureAudioContext();
    const now = ctx.currentTime;

    // Tape Hiss Level (muted during Air Trick studio insert mode unless desired, or kept subtle)
    const effectiveHissDb =
      this.params.mode === 'air-trick'
        ? Math.min(-62, this.params.tapeHissDb)
        : this.params.tapeHissDb;
    this.tapeNoiseGain.gain.setTargetAtTime(Math.pow(10, effectiveHissDb / 20), now, 0.02);

    // Calibration Trim (Record/Reproduce Head Flux Alignment)
    const calGain = Math.pow(10, this.params.calibrationTrimDb / 20);
    this.tapeCalGain.gain.setTargetAtTime(calGain, now, 0.02);

    // Dolby 850 Hz Warble Calibration Tone
    this.dolbyToneGain.gain.setTargetAtTime(
      this.params.dolbyToneActive ? 0.35 : 0.0,
      now,
      0.015
    );
  }

  stepCompanderDynamics(nowMs) {
    if (!this.isAudioGraphBuilt) return;
    const ctx = this.contextBag.ensureAudioContext();
    const now = ctx.currentTime;

    // Periodic FM warble on the 850 Hz Dolby Calibration Tone every 0.85s
    if (this.params.dolbyToneActive) {
      const cycle = (nowMs % 850) / 850;
      const freq = cycle < 0.14 ? 850 + Math.sin(cycle * Math.PI * 14) * 95 : 850;
      this.dolbyToneOsc.frequency.setTargetAtTime(freq, now, 0.008);
    }

    // On-Tape VU Meter Level
    this.telemetry.vuLevelDb = this.computeRmsDb(this.onTapeAnalyser, this.onTapeBuf);

    const driveScale = this.params.airTrickDrive / 100;
    const isDolbyB = this.params.topology === 'dolby-b';

    for (let i = 0; i < 4; i++) {
      const band = this.encodeBands[i];
      const inDb = this.computeRmsDb(band.analyser, band.buf);
      this.telemetry.bandInputDb[i] = inDb;

      // In Dolby B mode, only Band 3 (>3kHz) & Band 4 (>9kHz) operate
      const enabled = isDolbyB ? i >= 2 : this.params.bandEnabled[i];

      let boostDb = 0;
      let cutDb = 0;

      if (enabled && this.params.mode !== 'raw-tape') {
        boostDb = this.computeDolbyBilinearDb(inDb, band.spec.maxBoostDb * driveScale);
      }

      if (this.params.mode === 'encode-decode' || this.params.mode === 'mistracked') {
        // Decoder sees the level shifted by calibrationTrimDb!
        // If calibrationTrimDb != 0, the decoder mistracks the bilinear knee!
        const decoderSeenDb = inDb + boostDb + this.params.calibrationTrimDb;
        if (enabled) {
          cutDb = -this.computeDolbyBilinearDb(
            decoderSeenDb - boostDb * 0.85,
            band.spec.maxBoostDb
          );
        }
      } else if (this.params.mode === 'air-trick') {
        // "Dolby A Air Trick": Encode ONLY, Decode is completely bypassed (0 dB cut)!
        cutDb = 0;
      }

      this.telemetry.bandEncodeBoostDb[i] = boostDb;
      this.telemetry.bandDecodeCutDb[i] = cutDb;

      // Convert Encode Boost dB to parallel differential linear gain: (10^(boostDb/20) - 1)
      const diffLin = Math.max(0, Math.pow(10, boostDb / 20) - 1.0);
      band.diffGain.gain.setTargetAtTime(diffLin, now, 0.015);

      // Apply Complementary Decode Cut dB
      this.decodeBands[i].eq.gain.setTargetAtTime(cutDb, now, 0.015);
    }

    // Total HF Noise Reduction (Band 3 + Band 4 decode attenuation)
    this.telemetry.netHissReductionDb =
      this.telemetry.bandDecodeCutDb[2] + this.telemetry.bandDecodeCutDb[3];
  }

  applyModePreset(modeId) {
    this.params.mode = modeId;
    if (modeId === 'encode-decode') {
      this.params.topology = 'dolby-a';
      this.params.calibrationTrimDb = 0.0;
      this.params.airTrickDrive = 100;
      this.params.bandEnabled = [true, true, true, true];
    } else if (modeId === 'air-trick') {
      // Famous Vocal Exciter Trick: Bypass LF/Mid Bands 1 & 2, drive HF Bands 3 & 4 in Encode-Only!
      this.params.topology = 'dolby-a';
      this.params.calibrationTrimDb = 0.0;
      this.params.airTrickDrive = 125;
      this.params.bandEnabled = [false, false, true, true];
    } else if (modeId === 'raw-tape') {
      this.params.calibrationTrimDb = 0.0;
    } else if (modeId === 'mistracked') {
      this.params.topology = 'dolby-a';
      this.params.calibrationTrimDb = -6.5;
      this.params.bandEnabled = [true, true, true, true];
    }
    this.syncAudioParams();
    this.syncUIFromParams();
  }

  renderUI() {
    const unit = document.createElement('section');
    unit.className = 'vst-suite-rack-unit vst-suite-unit-dolby';
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
          <span class="vst-suite-unit-tag">RACK UNIT 02 · DOLBY CAT. 22 / 361 FRAME</span>
          <div>
            <div class="vst-suite-unit-name">
              DOLBY A-TYPE &amp; B-TYPE COMPANDER // + "AIR TRICK" VOCAL EXCITER
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="1965 Ray Dolby A-Type Bilateral Compander" data-edu-tip="Analog magnetic tape generates continuous high-frequency oxide hiss around -50 dB. Ray Dolby's Cat. 22 card solved this without pumping artifacts by splitting only quiet signals (below -20 dB) into 4 independent frequency bands, boosting them +10 to +15 dB before hitting tape (Encode), and applying an exact mirror-image cut on playback (Decode)." data-edu-try="Switch the top stem selector to 'Stem 2: Breathy Vocal & Synth Pad', then click between 'Raw Analog Tape (No NR)', 'Full Compander', and '✨ Dolby A Air Trick'!">?</button>
            </div>
            <div class="vst-suite-unit-model">4-Band Low-Level Differential Network (80Hz · 80–3kHz · 3kHz · 9kHz) · 850Hz FM Calibration Tone</div>
          </div>
        </div>
        <div class="vst-suite-preset-bar">
          <button type="button" class="vst-suite-chip vst-suite-active" data-mode="encode-decode">Full Compander (NR Active)</button>
          <button type="button" class="vst-suite-chip" data-mode="air-trick">✨ "Dolby A Air Trick" (Encode-Only Exciter)</button>
          <button type="button" class="vst-suite-chip" data-mode="raw-tape">Raw Analog Tape (No NR)</button>
          <button type="button" class="vst-suite-chip" data-mode="mistracked">Miscalibrated Tape (-6.5 dB Error)</button>
        </div>
      </div>

      <div class="vst-suite-module-grid-3">
        <!-- COLUMN 1: COMPANDER TOPOLOGY, TAPE HISS & CALIBRATION -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              1. Compander Mode &amp; Tape Alignment
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Dolby Level (185 nWb/m) & Calibration Mistracking" data-edu-tip="Because Dolby A expanders are level-sensitive (-20 dB threshold), playback tape flux must match the recording level within ±0.5 dB using the built-in 850 Hz frequency-modulated 'Dolby Tone'. If tape level drops on playback, the decoder over-expands and dulls quiet high frequencies!" data-edu-try="Click 'Miscalibrated Tape (-6.5 dB Error)' or drag 'Tape Flux Cal Trim' away from 0.0 dB to hear mistracking dullness.">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Dolby Level 0 VU</span>
          </div>

          <div class="vst-suite-param-grid">
            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Filter Topology</span>
              <select class="vst-suite-select" data-param="topology" style="grid-column: span 2;">
                <option value="dolby-a">Dolby A-Type Cat. 22 (4-Band Pro Studio)</option>
                <option value="dolby-b">Dolby B-Type (Single-Band Consumer HF)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Tape Oxide Hiss</span>
              <input type="range" class="vst-suite-slider" data-param="tapeHissDb" min="-70" max="-30" step="1" value="-46" />
              <span class="vst-suite-param-val" data-readout="tapeHissDb">-46 dB</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Tape Flux Cal Trim</span>
              <input type="range" class="vst-suite-slider" data-param="calibrationTrimDb" min="-10" max="10" step="0.5" value="0" />
              <span class="vst-suite-param-val" data-readout="calibrationTrimDb">0.0 dB</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Differential Drive</span>
              <input type="range" class="vst-suite-slider" data-param="airTrickDrive" min="25" max="150" step="5" value="100" />
              <span class="vst-suite-param-val" data-readout="airTrickDrive">100%</span>
            </div>
          </div>

          <div style="display:flex; gap:8px; margin-top:4px;">
            <button type="button" class="vst-suite-btn" data-toggle="dolbyToneActive" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot" data-led="dolbyToneActive"></span>
              850 Hz DOLBY WARBLE TONE
            </button>
          </div>

          <details class="edu-foldable" style="margin-top:4px;">
            <summary>
              <span class="edu-foldable-title">
                <span class="edu-foldable-tag">Studio Secret</span>
                <span>How the "Dolby A Air Trick" Exciter Works on Vocals</span>
              </span>
              <span class="edu-foldable-chevron">▼</span>
            </summary>
            <div class="edu-foldable-body">
              Producers (like Mutt Lange and Johnlier) discovered that routing a lead vocal through a Dolby 361 in <strong>Encode-Only</strong> mode—while Physically unclipping or bypassing Bands 1 &amp; 2—dynamically boosts quiet high-frequency breathiness (3 kHz &amp; 9 kHz+) by up to +15 dB while leaving loud sibilant peaks untouched!
            </div>
          </details>
        </div>

        <!-- COLUMN 2: CAT. 22 4-BAND DIFFERENTIAL FILTER MATRIX -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              2. Cat. 22 4-Band Differential Matrix
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="4-Band Low-Level Differential Filter Bank" data-edu-tip="Band 1 (<80Hz LP) removes hum/rumble; Band 2 (80Hz–3kHz BP) reduces broadband tape modulation noise; Band 3 (>3kHz HP) and Band 4 (>9kHz HP) stack together above 9kHz to yield 15 dB of high-frequency hiss reduction." data-edu-try="Click the 'IN' button on B1–B4 cards to bypass individual bands and hear how B3 + B4 create the Air Trick!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Click Band to Toggle</span>
          </div>

          <div class="vst-suite-dolby-bands">
            ${this.bandSpecs
              .map(
                (b) => `
              <div class="vst-suite-band-card" data-band-card="${b.id}">
                <div class="vst-suite-band-title">
                  <span>B${b.id + 1}</span>
                  <button type="button" class="vst-suite-chip vst-suite-active" data-band-toggle="${b.id}" style="padding:1px 5px;">IN</button>
                </div>
                <div class="vst-suite-band-freq">${b.freqLabel}</div>
                <div style="font-size:10px; color:var(--vst-text-muted); margin-top:2px;">Encode Boost</div>
                <div class="vst-suite-meter-track">
                  <div class="vst-suite-meter-fill" data-band-enc-bar="${b.id}"></div>
                </div>
                <div class="vst-suite-param-val" data-band-enc-val="${b.id}" style="text-align:left; color:#30d158;">+0.0 dB</div>

                <div style="font-size:10px; color:var(--vst-text-muted); margin-top:2px;">Decode Cut</div>
                <div class="vst-suite-meter-track">
                  <div class="vst-suite-meter-fill" data-band-dec-bar="${b.id}" style="background:linear-gradient(90deg,#00e5ff,#3b82f6);"></div>
                </div>
                <div class="vst-suite-param-val" data-band-dec-val="${b.id}" style="text-align:left; color:#00e5ff;">-0.0 dB</div>
              </div>
            `
              )
              .join('')}
          </div>

          <div class="vst-suite-kpi-strip" style="margin-top:4px;">
            <span class="vst-suite-kpi-pill">HF HISS REDUCTION (&gt;9kHz): <strong data-kpi="nrDb">0.0 dB</strong></span>
            <span class="vst-suite-kpi-pill">TAPE FLUX LEVEL: <strong data-kpi="vuDb">-40.0 dB</strong></span>
          </div>
        </div>

        <!-- COLUMN 3: BILINEAR COMPANDER TRANSFER CURVE & SPECTRUM -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              3. Bilinear Transfer Characteristic &amp; Noise Floor
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Bilinear Encode/Decode Transfer Curve" data-edu-tip="Shows Input dB (horizontal) vs. Output dB (vertical). Below -40 dB, the green Encode curve lifts quiet details +10 dB above the tape hiss floor; above -20 dB it merges smoothly back to 1:1 unity gain so loud peaks never saturate the tape." data-edu-try="Watch the live signal dot ride along the green Encode curve when 'Dolby A Air Trick' is selected!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Encode / Decode Law</span>
          </div>

          <div class="vst-suite-canvas-wrap">
            <canvas class="vst-suite-canvas vst-suite-canvas-tall" data-canvas="dolby-scope"></canvas>
          </div>
        </div>
      </div>
    `;

    this.unitEl = unit;
    this.parentEl.appendChild(unit);
    this.canvasEl = unit.querySelector('[data-canvas="dolby-scope"]');
    this.bindEvents();
    this.syncUIFromParams();
  }

  bindEvents() {
    const sig = { signal: this.abortController.signal };

    this.unitEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.applyModePreset(btn.getAttribute('data-mode'));
        },
        sig
      );
    });

    this.unitEl.querySelectorAll('[data-param]').forEach((el) => {
      const param = el.getAttribute('data-param');
      const handler = () => {
        this.ensureAudioGraph();
        this.params[param] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
        this.syncAudioParams();
        this.syncUIFromParams();
      };
      el.addEventListener('input', handler, sig);
      el.addEventListener('change', handler, sig);
    });

    this.unitEl.querySelectorAll('[data-band-toggle]').forEach((btn) => {
      const idx = parseInt(btn.getAttribute('data-band-toggle'), 10);
      btn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.params.bandEnabled[idx] = !this.params.bandEnabled[idx];
          this.syncUIFromParams();
        },
        sig
      );
    });

    const toneBtn = this.unitEl.querySelector('[data-toggle="dolbyToneActive"]');
    if (toneBtn) {
      toneBtn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.params.dolbyToneActive = !this.params.dolbyToneActive;
          this.syncAudioParams();
          this.syncUIFromParams();
        },
        sig
      );
    }
  }

  syncUIFromParams() {
    if (!this.unitEl) return;

    this.unitEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle(
        'vst-suite-active',
        btn.getAttribute('data-mode') === this.params.mode
      );
    });

    ['topology', 'tapeHissDb', 'calibrationTrimDb', 'airTrickDrive'].forEach((k) => {
      const input = this.unitEl.querySelector(`[data-param="${k}"]`);
      if (input && document.activeElement !== input) input.value = String(this.params[k]);
    });

    const setReadout = (k, text) => {
      const el = this.unitEl.querySelector(`[data-readout="${k}"]`);
      if (el) el.textContent = text;
    };

    setReadout('tapeHissDb', `${Math.round(this.params.tapeHissDb)} dB`);
    setReadout(
      'calibrationTrimDb',
      `${this.params.calibrationTrimDb >= 0 ? '+' : ''}${this.params.calibrationTrimDb.toFixed(1)} dB`
    );
    setReadout('airTrickDrive', `${Math.round(this.params.airTrickDrive)}%`);

    const toneLed = this.unitEl.querySelector('[data-led="dolbyToneActive"]');
    if (toneLed) {
      toneLed.className = `vst-suite-led-dot ${
        this.params.dolbyToneActive ? 'vst-suite-on-amber' : ''
      }`;
    }

    const isDolbyB = this.params.topology === 'dolby-b';
    for (let i = 0; i < 4; i++) {
      const active = isDolbyB ? i >= 2 : this.params.bandEnabled[i];
      const card = this.unitEl.querySelector(`[data-band-card="${i}"]`);
      const btn = this.unitEl.querySelector(`[data-band-toggle="${i}"]`);
      if (card) card.classList.toggle('vst-suite-band-disabled', !active);
      if (btn) {
        btn.classList.toggle('vst-suite-active', active);
        btn.textContent = active ? 'IN' : 'BYP';
      }
    }
  }

  startVisualLoop() {
    const loop = (now) => {
      this.stepCompanderDynamics(now);
      this.renderTelemetryAndScope();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  renderTelemetryAndScope() {
    if (!this.unitEl) return;

    for (let i = 0; i < 4; i++) {
      const boost = this.telemetry.bandEncodeBoostDb[i];
      const cut = Math.abs(this.telemetry.bandDecodeCutDb[i]);
      const maxB = this.bandSpecs[i].maxBoostDb * 1.3;

      const encBar = this.unitEl.querySelector(`[data-band-enc-bar="${i}"]`);
      const encVal = this.unitEl.querySelector(`[data-band-enc-val="${i}"]`);
      const decBar = this.unitEl.querySelector(`[data-band-dec-bar="${i}"]`);
      const decVal = this.unitEl.querySelector(`[data-band-dec-val="${i}"]`);

      if (encBar) encBar.style.width = `${Math.min(100, (boost / maxB) * 100)}%`;
      if (encVal) encVal.textContent = `+${boost.toFixed(1)} dB`;
      if (decBar) decBar.style.width = `${Math.min(100, (cut / maxB) * 100)}%`;
      if (decVal) decVal.textContent = `-${cut.toFixed(1)} dB`;
    }

    const nrEl = this.unitEl.querySelector('[data-kpi="nrDb"]');
    const vuEl = this.unitEl.querySelector('[data-kpi="vuDb"]');
    if (nrEl) nrEl.textContent = `${this.telemetry.netHissReductionDb.toFixed(1)} dB`;
    if (vuEl) {
      const calErr =
        Math.abs(this.params.calibrationTrimDb) > 0.2
          ? ` (CAL ${this.params.calibrationTrimDb > 0 ? '+' : ''}${this.params.calibrationTrimDb.toFixed(1)}dB)`
          : ' (ALIGNED ▼)';
      vuEl.textContent = `${this.telemetry.vuLevelDb.toFixed(1)} dBFS${calErr}`;
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

    // Coordinate mapping for Bilinear Compander Input (-60..0 dB) vs Output (-60..0 dB)
    const padL = 38;
    const padR = 14;
    const padT = 22;
    const padB = 22;
    const pw = cw - padL - padR;
    const ph = ch - padT - padB;

    const dbToX = (db) => padL + ((db + 60) / 60) * pw;
    const dbToY = (db) => padT + ph - ((db + 60) / 60) * ph;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(147,161,176,0.55)';
    [-60, -45, -30, -15, 0].forEach((db) => {
      const x = dbToX(db);
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ph);
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + pw, y);
      ctx.stroke();
      ctx.fillText(`${db}`, x - 10, ch - 6);
      ctx.fillText(`${db}`, 6, y + 3);
    });

    // 1. Unity 1:1 Reference Line (Dashed White)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dbToX(-60), dbToY(-60));
    ctx.lineTo(dbToX(0), dbToY(0));
    ctx.stroke();
    ctx.setLineDash([]);

    const drive = this.params.airTrickDrive / 100;

    // 2. Encode Bilinear Curve (+15 dB low-level lift in Band 3+4)
    ctx.strokeStyle = '#30d158';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let db = -60; db <= 0; db += 1) {
      const boost =
        this.params.mode === 'raw-tape' ? 0 : this.computeDolbyBilinearDb(db, 15.0 * drive);
      const x = dbToX(db);
      const y = dbToY(Math.min(0, db + boost));
      if (db === -60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 3. Decode Complementary Curve (-15 dB low-level expansion)
    if (this.params.mode === 'encode-decode' || this.params.mode === 'mistracked') {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let db = -60; db <= 0; db += 1) {
        const cut = -this.computeDolbyBilinearDb(db + this.params.calibrationTrimDb, 15.0);
        const x = dbToX(db);
        const y = dbToY(Math.max(-60, db + cut));
        if (db === -60) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 4. Net Output Curve (Amber: Linear 1:1 when calibrated, or High-Shelf Exciter Lift in "Air Trick" mode!)
    ctx.strokeStyle = '#ffb74d';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let db = -60; db <= 0; db += 1) {
      const boost =
        this.params.mode === 'raw-tape' ? 0 : this.computeDolbyBilinearDb(db, 15.0 * drive);
      const cut =
        this.params.mode === 'encode-decode' || this.params.mode === 'mistracked'
          ? -this.computeDolbyBilinearDb(db + this.params.calibrationTrimDb, 15.0)
          : 0;
      const net = Math.max(-60, Math.min(0, db + boost + cut));
      const x = dbToX(db);
      const y = dbToY(net);
      if (db === -60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 5. Live Operating Point Dot on Curve (Band 3 HF Level)
    const liveInDb = Math.max(-60, Math.min(0, this.telemetry.bandInputDb[2]));
    const liveBoost = this.telemetry.bandEncodeBoostDb[2] + this.telemetry.bandEncodeBoostDb[3];
    const liveCut = this.telemetry.bandDecodeCutDb[2] + this.telemetry.bandDecodeCutDb[3];
    const dotX = dbToX(liveInDb);
    const dotY = dbToY(Math.max(-60, Math.min(0, liveInDb + liveBoost + liveCut)));

    ctx.fillStyle = '#ffb74d';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Legend
    ctx.fillStyle = '#30d158';
    ctx.fillText('■ ENCODE (+15dB)', padL + 4, 14);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('■ DECODE (-15dB)', padL + 118, 14);
    ctx.fillStyle = '#ffb74d';
    ctx.fillText(
      this.params.mode === 'air-trick' ? '■ NET: AIR EXCITER LIFT' : '■ NET SYSTEM TRANSFER',
      padL + 234,
      14
    );

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

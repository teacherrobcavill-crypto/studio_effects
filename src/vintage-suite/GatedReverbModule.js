import { ProceduralStemGenerator } from './ProceduralStemGenerator.js';

/**
 * MODULE 1: 1980s Gated Reverb Simulator
 * Models the Townhouse Studio 2 (Stone Room) + SSL 4000 E Listen Mic Compressor (LMC)
 * + AMS RMX16 / Acoustic Room + Drawmer DS201 Sidechain Noise Gate.
 */
export class GatedReverbModule {
  /**
   * @param {HTMLElement} parentEl
   * @param {Object} contextBag
   * @param {Function} contextBag.ensureAudioContext - Lazy getter returning AudioContext
   * @param {Function} contextBag.getInputNode - Returns shared source GainNode
   * @param {Function} contextBag.getOutputNode - Returns master destination GainNode
   * @param {Function} contextBag.onTriggerSingleHit - Triggers an immediate snare transient
   */
  constructor(parentEl, contextBag) {
    this.parentEl = parentEl;
    this.contextBag = contextBag;
    this.abortController = new AbortController();
    this.rafId = null;
    this.audioNodes = [];
    this.isAudioGraphBuilt = false;

    // Historical & DSP Parameters
    this.params = {
      preset: 'townhouse-1981',
      algorithm: 'stone-room', // 'stone-room' | 'ams-nonlin' | 'plate-224'
      preDelayMs: 18,
      roomDecaySec: 1.85,
      lmcEnabled: true,
      lmcSmash: 10, // 0 - 100%
      keySource: 'dry-key', // 'dry-key' (External Sidechain) | 'reverb-tail' (Internal)
      keyListen: false,
      keyLowCutHz: 110,
      keyHighCutHz: 4200,
      thresholdDb: -24,
      attackMs: 1.5,
      holdMs: 240,
      releaseMs: 65,
      rangeDb: -60,
      dryMix: 0.85,
      wetMix: 0.95
    };

    // Gate State Machine Telemetry
    this.gateState = {
      status: 'CLOSED', // 'OPEN' | 'HOLDING' | 'CLOSED'
      currentGainLin: 0.001,
      gainReductionDb: -60,
      keyLevelDb: -72,
      unGatedLevelDb: -72,
      gatedLevelDb: -72,
      holdRemainingMs: 0,
      lastFrameTime: performance.now(),
      history: [] // Rolling ring buffer for envelope canvas
    };

    this.renderUI();
    this.startVisualLoop();
  }

  /**
   * Lazily constructs and connects the Web Audio graph when AudioContext is active.
   */
  ensureAudioGraph() {
    const ctx = this.contextBag.ensureAudioContext();
    if (!ctx || this.isAudioGraphBuilt) return;

    const sourceNode = this.contextBag.getInputNode();
    const masterOut = this.contextBag.getOutputNode();

    // Module input & output sum
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    sourceNode.connect(this.inputGain);
    this.outputGain.connect(masterOut);

    // 1. Dry Close-Mic Path
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = this.params.dryMix;
    this.inputGain.connect(this.dryGain);
    this.dryGain.connect(this.outputGain);

    // 2. Wet Reverb + SSL LMC Path
    this.preDelayNode = ctx.createDelay(0.5);
    this.preDelayNode.delayTime.value = this.params.preDelayMs / 1000;

    this.convolverNode = ctx.createConvolver();
    this.rebuildImpulseResponse(ctx);

    // SSL 4000 E Talkback / Listen Mic Compressor (LMC) Band-Limiting & Brickwall Smash
    this.lmcHighPass = ctx.createBiquadFilter();
    this.lmcHighPass.type = 'highpass';
    this.lmcHighPass.frequency.value = 150;

    this.lmcLowPass = ctx.createBiquadFilter();
    this.lmcLowPass.type = 'lowpass';
    this.lmcLowPass.frequency.value = this.params.lmcEnabled ? 6800 : 18500;

    this.lmcCompressor = ctx.createDynamicsCompressor();
    this.lmcCompressor.attack.value = 0.001;
    this.lmcCompressor.release.value = 0.048;
    this.lmcCompressor.knee.value = 4;

    this.lmcShaper = ctx.createWaveShaper();
    this.lmcMakeUp = ctx.createGain();

    // Un-gated Reverb Analyser (for ghost decay comparison on scope)
    this.unGatedAnalyser = ctx.createAnalyser();
    this.unGatedAnalyser.fftSize = 512;
    this.unGatedBuf = new Float32Array(256);

    // Drawmer DS201 Gate VCA Node
    this.gateVca = ctx.createGain();
    this.gateVca.gain.value = Math.pow(10, this.params.rangeDb / 20);

    // Gated Output Analyser
    this.gatedAnalyser = ctx.createAnalyser();
    this.gatedAnalyser.fftSize = 512;
    this.gatedBuf = new Float32Array(256);

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = this.params.wetMix;

    // Connect Wet Chain: Input -> PreDelay -> Convolver -> LMC HPF -> LMC LPF -> LMC Comp -> Shaper -> Makeup -> Gate VCA -> WetGain -> Output
    this.inputGain.connect(this.preDelayNode);
    this.preDelayNode.connect(this.convolverNode);
    this.convolverNode.connect(this.lmcHighPass);
    this.lmcHighPass.connect(this.lmcLowPass);
    this.lmcLowPass.connect(this.lmcCompressor);
    this.lmcCompressor.connect(this.lmcShaper);
    this.lmcShaper.connect(this.lmcMakeUp);
    this.lmcMakeUp.connect(this.unGatedAnalyser);
    this.lmcMakeUp.connect(this.gateVca);
    this.gateVca.connect(this.gatedAnalyser);
    this.gateVca.connect(this.wetGain);
    this.wetGain.connect(this.outputGain);

    // 3. Drawmer DS201 Sidechain Key Path (Selectable Dry Drum Key vs Reverb Tail)
    this.keySelectorDryGain = ctx.createGain();
    this.keySelectorWetGain = ctx.createGain();
    this.keyHighPass = ctx.createBiquadFilter();
    this.keyHighPass.type = 'highpass';
    this.keyLowPass = ctx.createBiquadFilter();
    this.keyLowPass.type = 'lowpass';
    this.keyAnalyser = ctx.createAnalyser();
    this.keyAnalyser.fftSize = 512;
    this.keyBuf = new Float32Array(256);

    // Key Listen Solo Path
    this.keyListenGain = ctx.createGain();
    this.keyListenGain.gain.value = 0;

    this.inputGain.connect(this.keySelectorDryGain);
    this.lmcMakeUp.connect(this.keySelectorWetGain);
    this.keySelectorDryGain.connect(this.keyHighPass);
    this.keySelectorWetGain.connect(this.keyHighPass);
    this.keyHighPass.connect(this.keyLowPass);
    this.keyLowPass.connect(this.keyAnalyser);
    this.keyLowPass.connect(this.keyListenGain);
    this.keyListenGain.connect(this.outputGain);

    this.audioNodes.push(
      this.inputGain,
      this.outputGain,
      this.dryGain,
      this.preDelayNode,
      this.convolverNode,
      this.lmcHighPass,
      this.lmcLowPass,
      this.lmcCompressor,
      this.lmcShaper,
      this.lmcMakeUp,
      this.unGatedAnalyser,
      this.gateVca,
      this.gatedAnalyser,
      this.wetGain,
      this.keySelectorDryGain,
      this.keySelectorWetGain,
      this.keyHighPass,
      this.keyLowPass,
      this.keyAnalyser,
      this.keyListenGain
    );

    this.isAudioGraphBuilt = true;
    this.syncAudioParams();
  }

  rebuildImpulseResponse(ctx) {
    if (!this.convolverNode) return;
    this.convolverNode.buffer = ProceduralStemGenerator.createReverbImpulse(ctx, {
      algorithm: this.params.algorithm,
      decaySeconds: this.params.roomDecaySec
    });
  }

  makeSaturationCurve(drivePercent) {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = 1 + (drivePercent / 100) * 6.5;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  syncAudioParams() {
    if (!this.isAudioGraphBuilt) return;
    const ctx = this.contextBag.ensureAudioContext();
    const now = ctx.currentTime;

    this.preDelayNode.delayTime.setTargetAtTime(this.params.preDelayMs / 1000, now, 0.015);

    // SSL LMC Compressor & Saturation
    const smashNorm = this.params.lmcEnabled ? this.params.lmcSmash / 100 : 0;
    this.lmcLowPass.frequency.setTargetAtTime(
      this.params.lmcEnabled ? 6800 : 18500,
      now,
      0.02
    );
    this.lmcCompressor.threshold.setTargetAtTime(-8 - smashNorm * 34, now, 0.02);
    this.lmcCompressor.ratio.setTargetAtTime(1 + smashNorm * 19, now, 0.02);
    this.lmcShaper.curve = this.makeSaturationCurve(smashNorm * 100);
    // Makeup gain brings quiet room reflections screaming to the front
    const makeupLin = 1.0 + smashNorm * 4.2;
    this.lmcMakeUp.gain.setTargetAtTime(makeupLin, now, 0.02);

    // Key Sidechain Routing & Filter
    const isDryKey = this.params.keySource === 'dry-key';
    this.keySelectorDryGain.gain.setTargetAtTime(isDryKey ? 1.0 : 0.0, now, 0.01);
    this.keySelectorWetGain.gain.setTargetAtTime(isDryKey ? 0.0 : 1.0, now, 0.01);
    this.keyHighPass.frequency.setTargetAtTime(this.params.keyLowCutHz, now, 0.015);
    this.keyLowPass.frequency.setTargetAtTime(this.params.keyHighCutHz, now, 0.015);

    // Key Listen Mode (Mutes normal dry/wet and solos the filtered key trigger)
    if (this.params.keyListen) {
      this.dryGain.gain.setTargetAtTime(0, now, 0.015);
      this.wetGain.gain.setTargetAtTime(0, now, 0.015);
      this.keyListenGain.gain.setTargetAtTime(1.0, now, 0.015);
    } else {
      this.dryGain.gain.setTargetAtTime(this.params.dryMix, now, 0.015);
      this.wetGain.gain.setTargetAtTime(this.params.wetMix, now, 0.015);
      this.keyListenGain.gain.setTargetAtTime(0, now, 0.015);
    }
  }

  computeRmsDb(analyser, buf) {
    if (!analyser) return -72;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = Math.abs(buf[i]);
      sum += s * s;
      if (s > peak) peak = s;
    }
    const level = Math.max(Math.sqrt(sum / buf.length), peak * 0.75);
    return Math.max(-72, 20 * Math.log10(level + 1e-6));
  }

  /**
   * Executes the Drawmer DS201 Attack / Hold / Release Envelope State Machine on every frame.
   */
  stepGateEnvelope(nowMs) {
    const dtMs = Math.min(50, Math.max(1, nowMs - this.gateState.lastFrameTime));
    this.gateState.lastFrameTime = nowMs;

    if (!this.isAudioGraphBuilt) {
      return;
    }

    const ctx = this.contextBag.ensureAudioContext();
    const keyDb = this.computeRmsDb(this.keyAnalyser, this.keyBuf);
    const unGatedDb = this.computeRmsDb(this.unGatedAnalyser, this.unGatedBuf);
    const gatedDb = this.computeRmsDb(this.gatedAnalyser, this.gatedBuf);

    this.gateState.keyLevelDb = keyDb;
    this.gateState.unGatedLevelDb = unGatedDb;
    this.gateState.gatedLevelDb = gatedDb;

    const thresh = this.params.thresholdDb;
    const minGainLin = Math.pow(10, this.params.rangeDb / 20);

    // Hysteresis: open at threshold, close at threshold - 2.5 dB
    const isAbove =
      this.gateState.status === 'CLOSED' ? keyDb >= thresh : keyDb >= thresh - 2.5;

    if (isAbove) {
      this.gateState.status = 'OPEN';
      this.gateState.holdRemainingMs = this.params.holdMs;
      // Attack slew toward 1.0
      const attackAlpha = 1 - Math.exp(-dtMs / Math.max(0.5, this.params.attackMs));
      this.gateState.currentGainLin += (1.0 - this.gateState.currentGainLin) * attackAlpha;
    } else if (this.gateState.holdRemainingMs > 0) {
      this.gateState.status = 'HOLDING';
      this.gateState.holdRemainingMs = Math.max(0, this.gateState.holdRemainingMs - dtMs);
      this.gateState.currentGainLin = 1.0;
    } else {
      this.gateState.status = 'CLOSED';
      const releaseAlpha = 1 - Math.exp(-dtMs / Math.max(5, this.params.releaseMs));
      this.gateState.currentGainLin +=
        (minGainLin - this.gateState.currentGainLin) * releaseAlpha;
    }

    // Apply gate VCA gain smoothly
    this.gateVca.gain.setTargetAtTime(
      Math.max(minGainLin, Math.min(1.0, this.gateState.currentGainLin)),
      ctx.currentTime,
      0.004
    );

    this.gateState.gainReductionDb = 20 * Math.log10(Math.max(1e-4, this.gateState.currentGainLin));

    // Push telemetry frame to scope history
    this.gateState.history.push({
      keyDb,
      unGatedDb,
      gatedDb,
      gainLin: this.gateState.currentGainLin,
      status: this.gateState.status
    });
    if (this.gateState.history.length > 220) {
      this.gateState.history.shift();
    }
  }

  applyPreset(presetId) {
    this.params.preset = presetId;
    if (presetId === 'townhouse-1981') {
      Object.assign(this.params, {
        algorithm: 'stone-room',
        preDelayMs: 18,
        roomDecaySec: 1.9,
        lmcEnabled: true,
        lmcSmash: 10,
        keySource: 'dry-key',
        thresholdDb: -24,
        attackMs: 1.2,
        holdMs: 240,
        releaseMs: 60,
        rangeDb: -60,
        dryMix: 0.85,
        wetMix: 0.98
      });
    } else if (presetId === 'ams-nonlin2') {
      Object.assign(this.params, {
        algorithm: 'ams-nonlin',
        preDelayMs: 28,
        roomDecaySec: 1.4,
        lmcEnabled: true,
        lmcSmash: 10,
        keySource: 'dry-key',
        thresholdDb: -26,
        attackMs: 0.8,
        holdMs: 310,
        releaseMs: 35,
        rangeDb: -70,
        dryMix: 0.85,
        wetMix: 0.92
      });
    } else if (presetId === 'power-station') {
      Object.assign(this.params, {
        algorithm: 'stone-room',
        preDelayMs: 35,
        roomDecaySec: 2.5,
        lmcEnabled: true,
        lmcSmash: 10,
        keySource: 'dry-key',
        thresholdDb: -22,
        attackMs: 2.0,
        holdMs: 360,
        releaseMs: 140,
        rangeDb: -52,
        dryMix: 0.8,
        wetMix: 1.0
      });
    } else if (presetId === 'natural-ungated') {
      Object.assign(this.params, {
        algorithm: 'plate-224',
        preDelayMs: 15,
        roomDecaySec: 2.2,
        lmcEnabled: false,
        lmcSmash: 10,
        keySource: 'reverb-tail',
        thresholdDb: -58,
        attackMs: 5.0,
        holdMs: 450,
        releaseMs: 850,
        rangeDb: 0,
        dryMix: 0.85,
        wetMix: 0.65
      });
    }

    if (this.isAudioGraphBuilt) {
      this.rebuildImpulseResponse(this.contextBag.ensureAudioContext());
      this.syncAudioParams();
    }
    this.syncUIFromParams();
  }

  renderUI() {
    const unit = document.createElement('section');
    unit.className = 'vst-suite-rack-unit vst-suite-unit-ssl';
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
          <span class="vst-suite-unit-tag">RACK UNIT 01 · 1981 TOWNHOUSE CHAIN</span>
          <div>
            <div class="vst-suite-unit-name">
              GATED REVERB SIMULATOR // SSL 4000E LMC + AMS RMX16 + DRAWMER DS201
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="1981 Townhouse Studio 2 Gated Reverb" data-edu-tip="Accidentally discovered by Hugh Padgham and Phil Collins during Peter Gabriel's 'Intruder' sessions: the SSL 4000B/E console had a built-in Listen Mic Compressor (LMC) with a brickwall 20:1 ratio designed so engineers could hear musicians talking across the live room. Routing the room mic through the LMC and chopping its tail with a Drawmer DS201 noise gate keyed from the dry snare close-mic created the explosive 1980s drum sound!" data-edu-try="Click '⚡ HIT SNARE TRANSIENT' or 'START TEST SIGNAL' above, then compare '1981 Townhouse Snare' vs. 'Un-Gated Natural Plate'.">?</button>
            </div>
            <div class="vst-suite-unit-model">Close-Mic Key Sidechain Trigger · Non-Linear Truncated Room Decay · Brickwall Listen-Mic Smash</div>
          </div>
        </div>
        <div class="vst-suite-preset-bar">
          <button type="button" class="vst-suite-chip vst-suite-active" data-preset="townhouse-1981">1981 Townhouse Snare</button>
          <button type="button" class="vst-suite-chip" data-preset="ams-nonlin2">AMS RMX16 NonLin 2</button>
          <button type="button" class="vst-suite-chip" data-preset="power-station">Power Station Big Room</button>
          <button type="button" class="vst-suite-chip" data-preset="natural-ungated">Un-Gated Natural Plate</button>
          <button type="button" class="vst-suite-btn vst-suite-btn-trigger" data-action="hit-snare">⚡ HIT SNARE TRANSIENT</button>
        </div>
      </div>

      <div class="vst-suite-module-grid-3">
        <!-- COLUMN 1: ROOM ACOUSTICS & SSL 4000 E LISTEN MIC COMPRESSOR -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              1. Room Chamber &amp; SSL 4000E LMC
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="SSL 4000E Listen Mic Compressor (LMC)" data-edu-tip="Natural room reverb decays exponentially (-60 dB over RT60). By crushing the room mics through the SSL LMC before the gate, quiet reverb reflections are pulled up to full volume so the room sounds like a sustained plateau of energy right until the gate closes." data-edu-try="Crank 'SSL LMC Smash' from 10% up to 90% and watch the amber envelope plateau flatten in the oscilloscope!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Pre-Gate Smash</span>
          </div>

          <div class="vst-suite-param-grid">
            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Reverb Chamber</span>
              <select class="vst-suite-select" data-param="algorithm" style="grid-column: span 2;">
                <option value="stone-room">Townhouse Studio 2 (Stone Room)</option>
                <option value="ams-nonlin">AMS RMX16 (NonLin 2 Digital Cluster)</option>
                <option value="plate-224">Lexicon 224XL (Concert Plate)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Pre-Delay (ITDG)</span>
              <input type="range" class="vst-suite-slider" data-param="preDelayMs" min="0" max="120" step="1" value="18" />
              <span class="vst-suite-param-val" data-readout="preDelayMs">18 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Room RT60 Size</span>
              <input type="range" class="vst-suite-slider" data-param="roomDecaySec" min="0.4" max="3.2" step="0.05" value="1.85" />
              <span class="vst-suite-param-val" data-readout="roomDecaySec">1.85 s</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">SSL LMC Smash</span>
              <input type="range" class="vst-suite-slider" data-param="lmcSmash" min="0" max="100" step="1" value="10" />
              <span class="vst-suite-param-val" data-readout="lmcSmash">10%</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Dry Drum Direct</span>
              <input type="range" class="vst-suite-slider" data-param="dryMix" min="0" max="1.2" step="0.02" value="0.85" />
              <span class="vst-suite-param-val" data-readout="dryMix">85%</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Gated Room Return</span>
              <input type="range" class="vst-suite-slider" data-param="wetMix" min="0" max="1.3" step="0.02" value="0.95" />
              <span class="vst-suite-param-val" data-readout="wetMix">95%</span>
            </div>
          </div>

          <div style="display:flex; gap:8px; margin-top:4px;">
            <button type="button" class="vst-suite-btn" data-toggle="lmcEnabled" style="flex:1; justify-content:center;">
              <span class="vst-suite-led-dot vst-suite-on-amber" data-led="lmcEnabled"></span>
              SSL TALKBACK LMC (IN)
            </button>
          </div>

          <details class="edu-foldable" style="margin-top:4px;">
            <summary>
              <span class="edu-foldable-title">
                <span class="edu-foldable-tag">Studio Secret</span>
                <span>Why External Key Triggering + SSL Smash Is Essential</span>
              </span>
              <span class="edu-foldable-chevron">▼</span>
            </summary>
            <div class="edu-foldable-body">
              Crushing the Stone Room mic at 20:1 raises the diffuse reverb tail to 0 VU so the room stays explosively loud right until the Drawmer DS201 gate chops it off. Triggering the gate's <strong>Key Input</strong> from the dry snare close-mic prevents the loud reverb tail from holding its own gate open!
            </div>
          </details>
        </div>

        <!-- COLUMN 2: DRAWMER DS201 DUAL NOISE GATE & EXTERNAL KEY SIDECHAIN -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              2. Drawmer DS201 Sidechain Gate
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Drawmer DS201 Attack / Hold / Release Envelope" data-edu-tip="The Drawmer DS201 made gated reverb repeatable thanks to independent HOLD (how long the reverb stays wide open at 0 dB) and RELEASE (how abruptly it slams shut), plus built-in High-Pass/Low-Pass Key Filters to reject kick drum and hi-hat bleed." data-edu-try="Switch 'Key Trigger Source' to 'INT SELF: Smashed Reverb Tail' to hear why gating without an external dry snare key chatters and fails!">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">Key Trigger + Envelope</span>
          </div>

          <!-- Traffic Light Gate Status -->
          <div class="vst-suite-traffic-box">
            <div class="vst-suite-traffic-lights">
              <div class="vst-suite-lamp-item">
                <span class="vst-suite-lamp vst-suite-lit-red" data-gate-lamp="CLOSED"></span>
                <span>CLOSED</span>
              </div>
              <div class="vst-suite-lamp-item">
                <span class="vst-suite-lamp" data-gate-lamp="HOLDING"></span>
                <span>HOLD</span>
              </div>
              <div class="vst-suite-lamp-item">
                <span class="vst-suite-lamp" data-gate-lamp="OPEN"></span>
                <span>OPEN</span>
              </div>
            </div>
            <span class="vst-suite-param-val" data-readout="gateReduction" style="color:var(--vst-amber-vu);">GR: -60.0 dB</span>
          </div>

          <div class="vst-suite-param-grid">
            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Key Trigger Source</span>
              <select class="vst-suite-select" data-param="keySource" style="grid-column: span 2;">
                <option value="dry-key">EXT KEY: Dry Snare/Drum Close-Mic (Tight)</option>
                <option value="reverb-tail">INT SELF: Smashed Reverb Tail (Chattering)</option>
              </select>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Gate Threshold</span>
              <input type="range" class="vst-suite-slider" data-param="thresholdDb" min="-56" max="-4" step="0.5" value="-24" />
              <span class="vst-suite-param-val" data-readout="thresholdDb">-24.0 dB</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Attack Time</span>
              <input type="range" class="vst-suite-slider" data-param="attackMs" min="0.2" max="40" step="0.2" value="1.5" />
              <span class="vst-suite-param-val" data-readout="attackMs">1.5 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Hold Time (Plateau)</span>
              <input type="range" class="vst-suite-slider" data-param="holdMs" min="15" max="750" step="5" value="240" />
              <span class="vst-suite-param-val" data-readout="holdMs">240 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Release (Chop Cutoff)</span>
              <input type="range" class="vst-suite-slider" data-param="releaseMs" min="10" max="1000" step="5" value="65" />
              <span class="vst-suite-param-val" data-readout="releaseMs">65 ms</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Gate Range (Depth)</span>
              <input type="range" class="vst-suite-slider" data-param="rangeDb" min="-72" max="0" step="1" value="-60" />
              <span class="vst-suite-param-val" data-readout="rangeDb">-60 dB</span>
            </div>

            <div class="vst-suite-param-row">
              <span class="vst-suite-param-label">Key Filter (HP / LP)</span>
              <div style="display:flex; gap:4px;">
                <input type="range" class="vst-suite-slider" data-param="keyLowCutHz" min="20" max="600" step="10" value="110" title="Sidechain LF Cut" />
                <input type="range" class="vst-suite-slider" data-param="keyHighCutHz" min="1000" max="12000" step="100" value="4200" title="Sidechain HF Cut" />
              </div>
              <span class="vst-suite-param-val" data-readout="keyBand">110–4.2k</span>
            </div>
          </div>

          <button type="button" class="vst-suite-btn" data-toggle="keyListen" style="justify-content:center;">
            <span class="vst-suite-led-dot" data-led="keyListen"></span>
            KEY LISTEN (SOLO SIDECHAIN FILTER)
          </button>
        </div>

        <!-- COLUMN 3: REAL-TIME NON-LINEAR ENVELOPE & SIDECHAIN OSCILLOSCOPE -->
        <div class="vst-suite-subpanel">
          <div class="vst-suite-subpanel-head">
            <span>
              3. Non-Linear Gate Envelope vs. Exponential Decay
              <button type="button" class="edu-tip-badge edu-amber" data-edu-title="Reading the Gate Envelope Scope" data-edu-tip="The dashed curve shows how an un-gated room decays naturally. The solid amber curve shows the non-linear gated envelope (Attack → Hold Plateau → Abrupt Release Cutoff) alongside live audio waveform peaks." data-edu-try="Adjust 'Hold Time' (15–750 ms) and 'Release' (10–1000 ms) to reshape the amber gate trapezoid in real time.">?</button>
            </span>
            <span class="vst-suite-subpanel-tag">60 FPS Telemetry</span>
          </div>

          <div class="vst-suite-canvas-wrap">
            <canvas class="vst-suite-canvas vst-suite-canvas-tall" data-canvas="gate-scope"></canvas>
          </div>

          <div class="vst-suite-kpi-strip">
            <span class="vst-suite-kpi-pill">KEY DETECTOR: <strong data-kpi="keyDb">-72.0 dB</strong></span>
            <span class="vst-suite-kpi-pill">HOLD REMAIN: <strong data-kpi="holdMs">0 ms</strong></span>
            <span class="vst-suite-kpi-pill">GATE STATE: <strong data-kpi="gateState">CLOSED</strong></span>
          </div>
        </div>
      </div>
    `;

    this.unitEl = unit;
    this.parentEl.appendChild(unit);
    this.canvasEl = unit.querySelector('[data-canvas="gate-scope"]');
    this.bindEvents();
    this.syncUIFromParams();
  }

  bindEvents() {
    const sig = { signal: this.abortController.signal };

    // Presets
    this.unitEl.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          this.applyPreset(btn.getAttribute('data-preset'));
        },
        sig
      );
    });

    // Hit Snare Immediate Trigger
    const hitBtn = this.unitEl.querySelector('[data-action="hit-snare"]');
    if (hitBtn) {
      hitBtn.addEventListener(
        'click',
        () => {
          this.ensureAudioGraph();
          if (this.contextBag.onTriggerSingleHit) {
            this.contextBag.onTriggerSingleHit();
          }
        },
        sig
      );
    }

    // Sliders & Selects
    this.unitEl.querySelectorAll('[data-param]').forEach((el) => {
      const param = el.getAttribute('data-param');
      const handler = () => {
        this.ensureAudioGraph();
        if (el.tagName === 'SELECT') {
          this.params[param] = el.value;
          if (param === 'algorithm' && this.isAudioGraphBuilt) {
            this.rebuildImpulseResponse(this.contextBag.ensureAudioContext());
          }
        } else {
          this.params[param] = parseFloat(el.value);
          if (param === 'roomDecaySec' && this.isAudioGraphBuilt) {
            this.rebuildImpulseResponse(this.contextBag.ensureAudioContext());
          }
        }
        this.syncAudioParams();
        this.syncUIFromParams();
      };
      el.addEventListener('input', handler, sig);
      el.addEventListener('change', handler, sig);
    });

    // Toggles
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

    this.unitEl.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.classList.toggle(
        'vst-suite-active',
        btn.getAttribute('data-preset') === this.params.preset
      );
    });

    const setVal = (param, val) => {
      const input = this.unitEl.querySelector(`[data-param="${param}"]`);
      if (input && document.activeElement !== input) input.value = String(val);
    };

    Object.keys(this.params).forEach((k) => setVal(k, this.params[k]));

    const setReadout = (key, text) => {
      const el = this.unitEl.querySelector(`[data-readout="${key}"]`);
      if (el) el.textContent = text;
    };

    setReadout('preDelayMs', `${Math.round(this.params.preDelayMs)} ms`);
    setReadout('roomDecaySec', `${this.params.roomDecaySec.toFixed(2)} s`);
    setReadout('lmcSmash', `${Math.round(this.params.lmcSmash)}%`);
    setReadout('dryMix', `${Math.round(this.params.dryMix * 100)}%`);
    setReadout('wetMix', `${Math.round(this.params.wetMix * 100)}%`);
    setReadout('thresholdDb', `${this.params.thresholdDb.toFixed(1)} dB`);
    setReadout('attackMs', `${this.params.attackMs.toFixed(1)} ms`);
    setReadout('holdMs', `${Math.round(this.params.holdMs)} ms`);
    setReadout('releaseMs', `${Math.round(this.params.releaseMs)} ms`);
    setReadout('rangeDb', `${Math.round(this.params.rangeDb)} dB`);
    setReadout(
      'keyBand',
      `${Math.round(this.params.keyLowCutHz)}–${(this.params.keyHighCutHz / 1000).toFixed(1)}k`
    );

    const lmcLed = this.unitEl.querySelector('[data-led="lmcEnabled"]');
    if (lmcLed) {
      lmcLed.className = `vst-suite-led-dot ${
        this.params.lmcEnabled ? 'vst-suite-on-amber' : ''
      }`;
    }

    const keyLed = this.unitEl.querySelector('[data-led="keyListen"]');
    if (keyLed) {
      keyLed.className = `vst-suite-led-dot ${
        this.params.keyListen ? 'vst-suite-on-red' : ''
      }`;
    }
  }

  startVisualLoop() {
    const loop = (now) => {
      this.stepGateEnvelope(now);
      this.renderTelemetryAndScope();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  renderTelemetryAndScope() {
    if (!this.unitEl) return;

    // Update Drawmer Traffic-Light Lamps
    const closedLamp = this.unitEl.querySelector('[data-gate-lamp="CLOSED"]');
    const holdLamp = this.unitEl.querySelector('[data-gate-lamp="HOLDING"]');
    const openLamp = this.unitEl.querySelector('[data-gate-lamp="OPEN"]');

    if (closedLamp && holdLamp && openLamp) {
      closedLamp.classList.toggle('vst-suite-lit-red', this.gateState.status === 'CLOSED');
      holdLamp.classList.toggle('vst-suite-lit-amber', this.gateState.status === 'HOLDING');
      openLamp.classList.toggle('vst-suite-lit-green', this.gateState.status === 'OPEN');
    }

    const grReadout = this.unitEl.querySelector('[data-readout="gateReduction"]');
    if (grReadout) {
      grReadout.textContent = `GR: ${this.gateState.gainReductionDb.toFixed(1)} dB`;
    }

    const kpiKey = this.unitEl.querySelector('[data-kpi="keyDb"]');
    const kpiHold = this.unitEl.querySelector('[data-kpi="holdMs"]');
    const kpiState = this.unitEl.querySelector('[data-kpi="gateState"]');
    if (kpiKey) kpiKey.textContent = `${this.gateState.keyLevelDb.toFixed(1)} dB`;
    if (kpiHold) kpiHold.textContent = `${Math.round(this.gateState.holdRemainingMs)} ms`;
    if (kpiState) kpiState.textContent = this.gateState.status;

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

    // Draw dB Grid Lines (-60 to 0 dB)
    const dbToY = (db) => {
      const clamped = Math.max(-66, Math.min(0, db));
      return ch - 18 - ((clamped + 66) / 66) * (ch - 34);
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(147,161,176,0.55)';
    [-60, -48, -36, -24, -12, 0].forEach((db) => {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
      ctx.fillText(`${db}dB`, 6, y - 3);
    });

    // Draw Idealized Static Attack-Hold-Release Envelope Preview on Left/Background + Live History
    const hist = this.gateState.history;
    if (hist.length > 2) {
      // 1. Un-gated Reverb Tail Ghost (Dashed Grey/Blue)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((pt, idx) => {
        const x = (idx / 220) * cw;
        const y = dbToY(pt.unGatedDb);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Gated Reverb Output Envelope (Filled Amber)
      ctx.fillStyle = 'rgba(255, 183, 77, 0.24)';
      ctx.strokeStyle = '#ffb74d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ch - 18);
      hist.forEach((pt, idx) => {
        const x = (idx / 220) * cw;
        const y = dbToY(pt.gatedDb);
        ctx.lineTo(x, y);
      });
      ctx.lineTo(((hist.length - 1) / 220) * cw, ch - 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 3. Dry Key Trigger Transient Trace (Cyan)
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((pt, idx) => {
        const x = (idx / 220) * cw;
        const y = dbToY(pt.keyDb);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 4. Draw Threshold Horizontal Line
    const threshY = dbToY(this.params.thresholdDb);
    ctx.strokeStyle = '#ff3b30';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(cw, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ff3b30';
    ctx.fillText(`KEY THRESHOLD (${this.params.thresholdDb.toFixed(1)} dB)`, cw - 175, threshY - 5);

    // Legend Header
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('■ DRY KEY TRIGGER', 46, 13);
    ctx.fillStyle = '#ffb74d';
    ctx.fillText('■ GATED NON-LINEAR TAIL', 165, 13);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('▫ UN-GATED ROOM DECAY', 325, 13);

    ctx.restore();
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.abortController.abort();
    this.audioNodes.forEach((node) => {
      try {
        node.disconnect();
      } catch (_) {}
    });
    this.audioNodes = [];
    if (this.unitEl && this.unitEl.parentNode) {
      this.unitEl.parentNode.removeChild(this.unitEl);
    }
  }
}

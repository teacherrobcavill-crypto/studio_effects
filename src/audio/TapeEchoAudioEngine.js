/**
 * TapeEchoAudioEngine.js
 * Signal Routing Engine, Era-Authentic Procedural Stems (1958 British Twang Guitar,
 * 1974 Kingston Dub Skank & Rimshot, Berlin Synth Arpeggio), One-Shot Transients,
 * and Telemetry Bridge for the Roland RE-201 Space Echo & Watkins Copicat Module.
 */

import tapeEchoWorkletSource from './worklets/TapeEchoWorklet.js?raw';

export class TapeEchoAudioEngine {
  constructor(options = {}) {
    this.ctx = null;
    this.isInitialized = false;
    this.initPromise = null;

    this.workletNode = null;
    this.inputGainNode = null;
    this.masterGainNode = null;
    this.analyserOut = null;

    this.stemBuffers = {};
    this.customBuffer = null;
    this.activeSource = null;
    this.isPlaying = false;
    this.currentStemId = 'dub-skank';

    this.queuedParams = {
      routingMode: 0, // 0 = Dual Side-by-Side, 1 = RE-201 Solo, 2 = Copicat Solo
      inputGain: 1.0,
      // Unit Bypass / Mute Controls: 1 = Bypassed (Muted), 0 = Active (Engaged)
      reBypass: 1,
      ccBypass: 1,
      // Roland RE-201 Space Echo
      reMode: 11,
      reRepeatRate: 0.52,
      reIntensity: 0.48,
      reEchoVol: 0.72,
      reReverbVol: 0.38,
      reBass: 0.0,
      reTreble: 0.0,
      // Watkins Copicat
      ccHead1: 1,
      ccHead2: 1,
      ccHead3: 0,
      ccSwell: 0.70,
      ccSustain: 0.45,
      ccMotorOn: 1
    };

    this.telemetry = {
      inPeak: 0,
      rePeak: 0,
      ccPeak: 0,
      saturation: 0,
      reDelayMs: 115,
      ccDelayMs: 92,
      ccMotorSpeed: 1.0
    };

    this.onTelemetryUpdate = options.onTelemetryUpdate || null;
    this.onPlayStateChange = options.onPlayStateChange || null;
  }

  prepareSyncRouting() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
    }

    if (!this.inputGainNode) {
      this.inputGainNode = this.ctx.createGain();
      this.inputGainNode.gain.value = 1.0;

      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.value = 0.92;

      this.analyserOut = this.ctx.createAnalyser();
      this.analyserOut.fftSize = 1024;
      this.analyserOut.smoothingTimeConstant = 0.78;

      this.analyserOut.connect(this.masterGainNode);
      this.masterGainNode.connect(this.ctx.destination);

      // Pre-synthesize era-authentic procedural audio stems
      this.stemBuffers['dub-skank'] = this._createDubSkankStem(this.ctx);
      this.stemBuffers['shadows-guitar'] = this._createShadowsTwangStem(this.ctx);
      this.stemBuffers['rimshot-loop'] = this._createRimshotTransientStem(this.ctx);
      this.stemBuffers['cosmic-synth'] = this._createCosmicSynthStem(this.ctx);
    }

    return this.ctx;
  }

  async ensureAudioContext() {
    this.prepareSyncRouting();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (this.isInitialized && this.workletNode) {
      return this.ctx;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.ctx;
    }

    this.initPromise = (async () => {
      try {
        const blob = new Blob([tapeEchoWorkletSource], {
          type: 'application/javascript; charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('Blob worklet fallback, loading module path:', err);
        await this.ctx.audioWorklet.addModule('/src/audio/worklets/TapeEchoWorklet.js');
      }

      this.workletNode = new AudioWorkletNode(this.ctx, 'tape-echo-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit'
      });

      const now = this.ctx.currentTime;
      for (const [key, val] of Object.entries(this.queuedParams)) {
        const p = this.workletNode.parameters.get(key);
        if (p) p.setValueAtTime(val, now);
      }

      this.workletNode.port.onmessage = (event) => {
        if (event.data && event.data.type === 'TAPE_ECHO_TELEMETRY') {
          Object.assign(this.telemetry, event.data);
          if (this.onTelemetryUpdate) {
            this.onTelemetryUpdate(this.telemetry);
          }
        }
      };

      this.inputGainNode.connect(this.workletNode);
      this.workletNode.connect(this.analyserOut);
      this.isInitialized = true;
    })();

    await this.initPromise;
    return this.ctx;
  }

  setParam(name, value, rampTime = 0.025) {
    this.queuedParams[name] = value;
    if (!this.workletNode || !this.ctx) return;
    const param = this.workletNode.parameters.get(name);
    if (!param) return;
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, Math.max(0.004, rampTime));
  }

  getParam(name) {
    return this.queuedParams[name];
  }

  setReBypass(bypassed) {
    this.setParam('reBypass', bypassed ? 1 : 0, 0.02);
  }

  setCcBypass(bypassed) {
    this.setParam('ccBypass', bypassed ? 1 : 0, 0.02);
  }

  isReBypassed() {
    return (this.queuedParams.reBypass ?? 1) > 0.5;
  }

  isCcBypassed() {
    return (this.queuedParams.ccBypass ?? 1) > 0.5;
  }

  async playStem(stemId = this.currentStemId) {
    await this.ensureAudioContext();
    this.stopStem();

    const buffer =
      stemId === 'custom' && this.customBuffer
        ? this.customBuffer
        : this.stemBuffers[stemId] || this.stemBuffers['dub-skank'];

    if (!buffer) return;

    this.activeSource = this.ctx.createBufferSource();
    this.activeSource.buffer = buffer;
    this.activeSource.loop = true;
    this.activeSource.connect(this.inputGainNode);
    this.activeSource.start(0);

    this.isPlaying = true;
    this.currentStemId = stemId;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  stopStem() {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch (_) {}
      this.activeSource = null;
    }
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  /**
   * Triggers a crisp one-shot 1958 British Twang Guitar Chord Stab
   */
  async triggerGuitarChord() {
    await this.ensureAudioContext();
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.85);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    // A minor 9th / spy-surf twang chord (A2, E3, A3, C4, E4, B4)
    const freqs = [110.0, 164.81, 220.0, 261.63, 329.63, 493.88];
    for (let s = 0; s < freqs.length; s++) {
      const f = freqs[s];
      const strumOffset = Math.floor(s * 0.014 * sr);
      let phase = 0;
      for (let i = strumOffset; i < len; i++) {
        const t = (i - strumOffset) / sr;
        const env = Math.exp(-t * 5.8) * (1 - Math.exp(-t * 450));
        phase += (2 * Math.PI * f) / sr;
        const sig =
          0.55 * Math.sin(phase) +
          0.32 * Math.sin(2 * phase) * Math.exp(-t * 9) +
          0.18 * Math.sin(3 * phase) * Math.exp(-t * 15) +
          0.09 * Math.sin(4 * phase) * Math.exp(-t * 24);
        data[i] += sig * env * 0.28;
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.inputGainNode);
    src.start(0);
  }

  /**
   * Triggers a sharp one-shot King Tubby Dub Rimshot / Sidestick Crack
   */
  async triggerDubRimshot() {
    await this.ensureAudioContext();
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.35);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // Woody rim resonance (480 Hz + 1180 Hz + 2450 Hz click) + snare wire burst
      const rimTone =
        0.55 * Math.sin(2 * Math.PI * 485 * t) * Math.exp(-t * 48) +
        0.45 * Math.sin(2 * Math.PI * 1240 * t) * Math.exp(-t * 85) +
        0.35 * Math.sin(2 * Math.PI * 2680 * t) * Math.exp(-t * 170);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 62) * 0.45;
      data[i] = Math.tanh((rimTone + noise) * 1.4) * 0.85;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.inputGainNode);
    src.start(0);
  }

  async loadCustomAudioFile(file) {
    await this.ensureAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    this.customBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.currentStemId = 'custom';
    await this.playStem('custom');
    return file.name;
  }

  suspend() {
    this.stopStem();
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  // ==========================================================================
  // PROCEDURAL TEST STEMS
  // ==========================================================================

  /**
   * 1. 1974 Kingston Dub Skank & Rimshot Drops (8 seconds @ 75 BPM)
   * Sparse off-beat guitar/organ skank chords and dub rimshot hits with wide echo space
   */
  _createDubSkankStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 6.4; // 2 bars at 75 BPM (beat = 0.8s)
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const beat = 0.8;

    // Off-beat skank chords on "&" of each beat (0.4s, 1.2s, 2.0s, 2.8s, 3.6s, 4.4s, 5.2s, 6.0s)
    const chords = [
      [220.0, 261.63, 329.63, 440.0], // Am
      [220.0, 261.63, 329.63, 440.0],
      [196.0, 246.94, 293.66, 392.0], // G
      [220.0, 261.63, 329.63, 440.0],
      [146.83, 220.0, 293.66, 349.23], // Dm
      [220.0, 261.63, 329.63, 440.0],
      [164.81, 246.94, 329.63, 392.0], // Em
      [220.0, 261.63, 329.63, 440.0]
    ];

    for (let b = 0; b < 8; b++) {
      const startIdx = Math.floor((b * beat + 0.4) * sr);
      const chord = chords[b];
      const chopLen = Math.floor(0.14 * sr);
      for (let n = 0; n < chopLen && startIdx + n < len; n++) {
        const t = n / sr;
        const env = Math.sin((Math.PI * n) / chopLen) * Math.exp(-t * 18);
        let sig = 0;
        for (let k = 0; k < chord.length; k++) {
          const f = chord[k];
          sig +=
            0.3 * Math.sin(2 * Math.PI * f * t + k * 0.2) +
            0.2 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 25) +
            0.12 * Math.sin(6 * Math.PI * f * t);
        }
        data[startIdx + n] += sig * env * 0.55;
      }
    }

    // One-drop Dub Rimshot + Sub Bass pulse on Beat 3 of each bar (t = 1.6s and t = 4.8s)
    const rimTimes = [1.6, 4.8];
    for (const rt of rimTimes) {
      const startIdx = Math.floor(rt * sr);
      const hitLen = Math.floor(0.28 * sr);
      for (let n = 0; n < hitLen && startIdx + n < len; n++) {
        const t = n / sr;
        const rim =
          0.5 * Math.sin(2 * Math.PI * 510 * t) * Math.exp(-t * 50) +
          0.4 * Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 90) +
          (Math.random() * 2 - 1) * Math.exp(-t * 70) * 0.4;
        data[startIdx + n] += rim * 0.72;
      }
    }

    // Warm Dub Sub Bass notes
    const bassEvents = [
      { time: 0.0, freq: 55.0, dur: 0.55 },
      { time: 1.6, freq: 55.0, dur: 0.65 },
      { time: 2.4, freq: 49.0, dur: 0.55 },
      { time: 3.2, freq: 73.42, dur: 0.6 },
      { time: 4.8, freq: 55.0, dur: 0.65 }
    ];
    for (const ev of bassEvents) {
      const startIdx = Math.floor(ev.time * sr);
      const bLen = Math.floor(ev.dur * sr);
      for (let n = 0; n < bLen && startIdx + n < len; n++) {
        const t = n / sr;
        const env = (1 - Math.exp(-t * 80)) * Math.exp(-t * 4.5);
        data[startIdx + n] += Math.sin(2 * Math.PI * ev.freq * t) * env * 0.42;
      }
    }

    return buf;
  }

  /**
   * 2. 1958 British Instrumental Twang Guitar ("Apache" / Hank Marvin Style)
   * Iconic plucked Stratocaster lead phrases with space for multi-head Copicat galloping echoes
   */
  _createShadowsTwangStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 6.0;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    const melody = [
      { t: 0.1, f: 220.0, d: 0.35 },   // A3
      { t: 0.5, f: 261.63, d: 0.35 },  // C4
      { t: 0.9, f: 293.66, d: 0.35 },  // D4
      { t: 1.3, f: 329.63, d: 0.95 },  // E4 (held with vibrato so echoes cascade!)
      { t: 2.8, f: 293.66, d: 0.32 },  // D4
      { t: 3.2, f: 261.63, d: 0.32 },  // C4
      { t: 3.6, f: 220.0, d: 1.15 }    // A3 (long sustain + silence gap)
    ];

    for (const note of melody) {
      const startIdx = Math.floor(note.t * sr);
      const nLen = Math.floor(note.d * sr);
      let phase = 0;
      for (let n = 0; n < nLen && startIdx + n < len; n++) {
        const t = n / sr;
        // Subtle whammy bar shimmer vibrato (5.2 Hz)
        const vib = 1.0 + 0.0045 * Math.sin(2 * Math.PI * 5.2 * t);
        phase += (2 * Math.PI * note.f * vib) / sr;
        const env = (1 - Math.exp(-t * 380)) * Math.exp(-t * 3.8);
        const pickClick = (Math.random() * 2 - 1) * Math.exp(-t * 260) * 0.22;
        const sig =
          0.52 * Math.sin(phase) +
          0.29 * Math.sin(2 * phase + 0.3) * Math.exp(-t * 4.5) +
          0.16 * Math.sin(3 * phase) * Math.exp(-t * 9.0) +
          0.08 * Math.sin(4 * phase) * Math.exp(-t * 14.0) +
          pickClick;
        data[startIdx + n] += sig * env * 0.65;
      }
    }

    return buf;
  }

  /**
   * 3. Precision Rimshot & Transient Echo Tap Analyzer Loop
   * Wide 2.0-second spacing between hits so every playback head repeat is crystal clear
   */
  _createRimshotTransientStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.0;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    const hits = [0.15, 2.15];
    for (let h = 0; h < hits.length; h++) {
      const startIdx = Math.floor(hits[h] * sr);
      const hitLen = Math.floor(0.22 * sr);
      const pitch = h === 0 ? 520 : 640;
      for (let n = 0; n < hitLen && startIdx + n < len; n++) {
        const t = n / sr;
        const tone =
          0.55 * Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t * 55) +
          0.4 * Math.sin(2 * Math.PI * (pitch * 2.4) * t) * Math.exp(-t * 95);
        const snap = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.45;
        data[startIdx + n] += (tone + snap) * 0.78;
      }
    }
    return buf;
  }

  /**
   * 4. 1974 Berlin School Cosmic Analog Synth Pulse
   */
  _createCosmicSynthStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.8;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    const notes = [110.0, 164.81, 220.0, 246.94, 329.63, 246.94, 220.0, 164.81];
    const step = 0.6;
    for (let s = 0; s < notes.length; s++) {
      const startIdx = Math.floor(s * step * sr);
      const nLen = Math.floor(0.24 * sr);
      const f = notes[s];
      let phase = 0;
      for (let n = 0; n < nLen && startIdx + n < len; n++) {
        const t = n / sr;
        phase += (2 * Math.PI * f) / sr;
        const env = (1 - Math.exp(-t * 250)) * Math.exp(-t * 14);
        // Sawtooth-like harmonic stack with resonant filter decay
        const harm =
          0.5 * Math.sin(phase) +
          0.3 * Math.sin(2 * phase) * Math.exp(-t * 12) +
          0.2 * Math.sin(3 * phase) * Math.exp(-t * 20) +
          0.12 * Math.sin(4 * phase) * Math.exp(-t * 30);
        data[startIdx + n] += harm * env * 0.62;
      }
    }
    return buf;
  }
}

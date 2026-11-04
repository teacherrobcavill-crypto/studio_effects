/**
 * Procedural Studio Instrument Synthesizer
 * 100% Web Audio API synthesis (zero external audio files).
 * Generates Guitar, Bass, Drums, and Acoustic Impulse/Pink-Noise test signals.
 */

export class SoundSynthesizer {
  constructor(audioContext, outputNode, onTransientCallback = null) {
    this.ctx = audioContext;
    this.output = outputNode;
    this.onTransient = onTransientCallback;

    this.isPlaying = false;
    this.instrument = 'guitar'; // 'guitar' | 'bass' | 'drums' | 'test_pulse'
    this.stepIndex = 0;
    this.timerId = null;

    // Shared noise buffer (2 seconds of pink-ish & white noise for drums and test bursts)
    this.whiteNoiseBuffer = this._createWhiteNoiseBuffer();
    this.pinkNoiseBuffer = this._createPinkNoiseBuffer();
  }

  _createWhiteNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _createPinkNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
    }
    return buf;
  }

  setInstrument(instrumentId) {
    this.instrument = instrumentId;
    this.stepIndex = 0;
  }

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.stepIndex = 0;
    this._scheduleLoop();
  }

  stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Triggers an immediate one-shot acoustic impulse clap (useful even when loop is paused)
   */
  triggerSinglePulse() {
    const now = this.ctx.currentTime + 0.01;
    this._playAcousticClap(now, 0.95);
    if (this.onTransient) this.onTransient(1.0);
  }

  _scheduleLoop() {
    if (!this.isPlaying) return;

    const now = this.ctx.currentTime + 0.02;
    let stepDurationMs = 240;

    if (this.instrument === 'guitar') {
      stepDurationMs = this._stepGuitar(now, this.stepIndex);
    } else if (this.instrument === 'bass') {
      stepDurationMs = this._stepBass(now, this.stepIndex);
    } else if (this.instrument === 'drums') {
      stepDurationMs = this._stepDrums(now, this.stepIndex);
    } else if (this.instrument === 'test_pulse') {
      stepDurationMs = this._stepTestPulse(now, this.stepIndex);
    }

    this.stepIndex = (this.stepIndex + 1) % 16;
    this.timerId = setTimeout(() => this._scheduleLoop(), stepDurationMs);
  }

  // =========================================================================
  // 1. ARCHTOP STUDIO GUITAR (Chords + Melodic Lick)
  // =========================================================================
  _stepGuitar(time, step) {
    // 1950s Jazz-Blues progression in A9 / D9 / E9
    const pattern = [
      { notes: [110.0, 220.0, 277.18, 329.63, 415.3], vel: 0.85, dur: 0.55 }, // A major 7/9 chord strum
      { notes: [329.63], vel: 0.55, dur: 0.22 },
      { notes: [392.00], vel: 0.65, dur: 0.25 },
      { notes: [440.00], vel: 0.75, dur: 0.32 },
      { notes: [146.83, 220.0, 293.66, 369.99, 440.0], vel: 0.85, dur: 0.55 }, // D9 chord
      { notes: [369.99], vel: 0.5, dur: 0.22 },
      { notes: [329.63], vel: 0.65, dur: 0.25 },
      { notes: [293.66], vel: 0.6, dur: 0.28 },
      { notes: [110.0, 220.0, 277.18, 329.63], vel: 0.8, dur: 0.5 },          // A chord
      { notes: [493.88], vel: 0.7, dur: 0.22 },
      { notes: [440.00], vel: 0.65, dur: 0.25 },
      { notes: [329.63], vel: 0.6, dur: 0.25 },
      { notes: [164.81, 246.94, 311.13, 392.0, 493.88], vel: 0.9, dur: 0.55 }, // E7#9 turnaround
      { notes: [440.00], vel: 0.65, dur: 0.22 },
      { notes: [392.00], vel: 0.65, dur: 0.22 },
      { notes: [329.63], vel: 0.7, dur: 0.30 }
    ];

    const evt = pattern[step % pattern.length];
    evt.notes.forEach((freq, idx) => {
      // Strum offset for chords
      this._playGuitarString(time + idx * 0.018, freq, evt.vel * (1 - idx * 0.06), evt.dur);
    });

    if (this.onTransient && (step % 2 === 0)) {
      this.onTransient(evt.vel);
    }
    return step % 2 === 0 ? 275 : 225; // Subtle swing feel
  }

  _playGuitarString(time, freq, velocity, duration) {
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2.0, time); // 2nd harmonic pluck brightness

    // Hollow-body archtop wood resonance filter
    const bodyFilter = this.ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(freq * 7.5 + 900, time);
    bodyFilter.frequency.exponentialRampToValueAtTime(freq * 2.2 + 280, time + duration);
    bodyFilter.Q.value = 2.4;

    // Pick transient click
    const pickGain = this.ctx.createGain();
    pickGain.gain.setValueAtTime(0.0001, time);
    pickGain.gain.linearRampToValueAtTime(velocity * 0.22, time + 0.004);
    pickGain.gain.exponentialRampToValueAtTime(0.0008, time + duration + 0.12);

    osc1.connect(bodyFilter);
    osc2.connect(bodyFilter);
    bodyFilter.connect(pickGain);
    pickGain.connect(this.output);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.14);
    osc2.stop(time + duration + 0.14);
  }

  // =========================================================================
  // 2. UPRIGHT / STUDIO BASS (Deep Low-End for Boundary Loading & Modes)
  // =========================================================================
  _stepBass(time, step) {
    // Walking Jazz/Blues Bassline (41 Hz E1 up to 146 Hz D3)
    const bassLine = [
      { freq: 55.00, vel: 0.95, dur: 0.36 }, // A1
      { freq: 65.41, vel: 0.80, dur: 0.32 }, // C2
      { freq: 69.30, vel: 0.85, dur: 0.32 }, // C#2
      { freq: 82.41, vel: 0.90, dur: 0.34 }, // E2
      { freq: 73.42, vel: 0.95, dur: 0.36 }, // D2
      { freq: 87.31, vel: 0.80, dur: 0.32 }, // F2
      { freq: 92.50, vel: 0.85, dur: 0.32 }, // F#2
      { freq: 110.00, vel: 0.90, dur: 0.34 }, // A2
      { freq: 55.00, vel: 0.95, dur: 0.36 }, // A1
      { freq: 82.41, vel: 0.85, dur: 0.32 }, // E2
      { freq: 73.42, vel: 0.85, dur: 0.32 }, // D2
      { freq: 69.30, vel: 0.85, dur: 0.32 }, // C#2
      { freq: 41.20, vel: 1.00, dur: 0.38 }, // E1 (deep corner test!)
      { freq: 61.74, vel: 0.85, dur: 0.32 }, // B1
      { freq: 73.42, vel: 0.85, dur: 0.32 }, // D2
      { freq: 82.41, vel: 0.90, dur: 0.34 }  // E2
    ];

    const note = bassLine[step % bassLine.length];
    this._playUprightBass(time, note.freq, note.vel, note.dur);
    if (this.onTransient) this.onTransient(note.vel);
    return 330;
  }

  _playUprightBass(time, freq, velocity, duration) {
    const subOsc = this.ctx.createOscillator();
    const harmOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    harmOsc.type = 'sawtooth';

    // Subtle pitch envelope from finger pluck
    subOsc.frequency.setValueAtTime(freq * 1.03, time);
    subOsc.frequency.exponentialRampToValueAtTime(freq, time + 0.035);
    harmOsc.frequency.setValueAtTime(freq, time);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 6.5, time);
    lp.frequency.exponentialRampToValueAtTime(freq * 2.1, time + duration);
    lp.Q.value = 3.2;

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.52, time + 0.009);
    vca.gain.exponentialRampToValueAtTime(0.001, time + duration + 0.12);

    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.45;

    subOsc.connect(vca);
    harmOsc.connect(lp);
    lp.connect(harmGain);
    harmGain.connect(vca);
    vca.connect(this.output);

    subOsc.start(time);
    harmOsc.start(time);
    subOsc.stop(time + duration + 0.14);
    harmOsc.stop(time + duration + 0.14);
  }

  // =========================================================================
  // 3. VINTAGE STUDIO DRUM KIT (Kick, Snare, Hi-Hat/Ride)
  // =========================================================================
  _stepDrums(time, step) {
    // 16-step studio groove with crisp snare Rim/Snare hits for slapback & RT60 testing
    const kickSteps = [0, 3, 6, 8, 10];
    const snareSteps = [4, 12, 15];
    const hatSteps = [0, 2, 4, 6, 7, 8, 10, 12, 14, 15];

    let maxVel = 0.3;
    if (kickSteps.includes(step)) {
      this._playKick(time, step === 0 ? 1.0 : 0.82);
      maxVel = 0.95;
    }
    if (snareSteps.includes(step)) {
      this._playSnare(time, step === 15 ? 0.55 : 0.95);
      maxVel = 1.0;
    }
    if (hatSteps.includes(step)) {
      const open = step === 6 || step === 14;
      this._playHiHat(time, open ? 0.55 : 0.38, open ? 0.24 : 0.055);
    }

    if (this.onTransient && maxVel > 0.5) {
      this.onTransient(maxVel);
    }
    return step % 2 === 0 ? 185 : 155;
  }

  _playKick(time, velocity) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.09);
    osc.frequency.exponentialRampToValueAtTime(36, time + 0.28);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.30);

    osc.connect(gain);
    gain.connect(this.output);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  _playSnare(time, velocity) {
    // Shell fundamental
    const toneOsc = this.ctx.createOscillator();
    const toneGain = this.ctx.createGain();
    toneOsc.type = 'triangle';
    toneOsc.frequency.setValueAtTime(215, time);
    toneOsc.frequency.exponentialRampToValueAtTime(145, time + 0.08);

    toneGain.gain.setValueAtTime(velocity * 0.45, time);
    toneGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

    toneOsc.connect(toneGain);
    toneGain.connect(this.output);
    toneOsc.start(time);
    toneOsc.stop(time + 0.15);

    // Snare wire noise burst
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, time);
    filter.Q.value = 0.85;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, time);
    noiseGain.gain.linearRampToValueAtTime(velocity * 0.55, time + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0008, time + 0.22);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.output);
    noise.start(time);
    noise.stop(time + 0.24);
  }

  _playHiHat(time, velocity, duration) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(5800, time);

    const vca = this.ctx.createGain();
    vca.gain.setValueAtTime(0.0001, time);
    vca.gain.linearRampToValueAtTime(velocity * 0.32, time + 0.002);
    vca.gain.exponentialRampToValueAtTime(0.0008, time + duration);

    noise.connect(hp);
    hp.connect(vca);
    vca.connect(this.output);
    noise.start(time);
    noise.stop(time + duration + 0.02);
  }

  // =========================================================================
  // 4. ACOUSTIC IMPULSE CLAP & PINK NOISE BURST (Clinical Measurement Signal)
  // =========================================================================
  _stepTestPulse(time, step) {
    if (step % 4 === 0) {
      // Sharp broadband impulse clap for early-reflection & RT60 observation
      this._playAcousticClap(time, 0.95);
      if (this.onTransient) this.onTransient(1.0);
    } else if (step % 4 === 2) {
      // 180ms gated Pink Noise burst to reveal comb filtering notches on FFT
      this._playPinkNoiseBurst(time, 0.20, 0.65);
      if (this.onTransient) this.onTransient(0.75);
    }
    return 420;
  }

  _playAcousticClap(time, velocity) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.whiteNoiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, time);
    bp.Q.value = 0.45;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.85, time + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + 0.028);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.output);
    noise.start(time);
    noise.stop(time + 0.035);
  }

  _playPinkNoiseBurst(time, duration, velocity) {
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.pinkNoiseBuffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.75, time + 0.008);
    gain.gain.setValueAtTime(velocity * 0.75, time + duration - 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + duration);

    noise.connect(gain);
    gain.connect(this.output);
    noise.start(time);
    noise.stop(time + duration + 0.02);
  }
}

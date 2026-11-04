/**
 * Procedural Test Signal & Drum Stem Generator
 * Synthesizes 1980s acoustic snare/tom transients, vocal/pad sustain phrases,
 * and tape calibration signals purely via Web Audio API AudioBuffers.
 * Zero external audio asset dependencies.
 */

export class ProceduralStemGenerator {
  /**
   * Generates a 6-second 1980s Townhouse-style Acoustic Drum Pattern ("In The Air" style)
   * with spacious silence gaps between hits so the gated reverb tail & gate cutoff shine.
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static create80sDrumStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 6.0;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    // Deterministic PRNG for consistent crisp snare wire & room air
    let seed = 19810315;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    const addKick = (timeSec, gain = 0.85) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(0.32 * sr);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const freq = 48 + 115 * Math.exp(-t * 42);
        phase += (2 * Math.PI * freq) / sr;
        const body = Math.sin(phase) * Math.exp(-t * 11.5);
        const click = Math.exp(-t * 180) * Math.sin(2 * Math.PI * 1900 * t) * 0.35;
        const sample = (body + click) * gain;
        left[start + i] += sample;
        right[start + i] += sample;
      }
    };

    const addSnare = (timeSec, gain = 0.95) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(0.28 * sr);
      let phase1 = 0;
      let phase2 = 0;
      let bpState1 = 0;
      let bpState2 = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const f1 = 182 + 90 * Math.exp(-t * 55);
        const f2 = 330 + 110 * Math.exp(-t * 65);
        phase1 += (2 * Math.PI * f1) / sr;
        phase2 += (2 * Math.PI * f2) / sr;

        const shell = (Math.sin(phase1) * 0.65 + Math.sin(phase2) * 0.35) * Math.exp(-t * 19);
        const rawNoise = rand();
        // High-frequency snare wire emphasis
        bpState1 = 0.72 * bpState1 + 0.28 * rawNoise;
        const highWires = rawNoise - bpState1;
        bpState2 = 0.85 * bpState2 + 0.15 * rand();
        const wiresR = rand() - bpState2;

        const wireEnv = Math.exp(-t * 14.5) * (1 - 0.3 * Math.exp(-t * 120));
        const rimCrack = Math.exp(-t * 240) * Math.sin(2 * Math.PI * 2450 * t) * 0.55;

        left[start + i] += (shell + highWires * wireEnv * 0.85 + rimCrack) * gain;
        right[start + i] += (shell + wiresR * wireEnv * 0.85 + rimCrack) * gain;
      }
    };

    const addConcertTom = (timeSec, fundamentalHz, pan = 0, gain = 0.9) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(0.38 * sr);
      let phase = 0;
      const panL = Math.cos(((pan + 1) * Math.PI) / 4);
      const panR = Math.sin(((pan + 1) * Math.PI) / 4);
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const freq = fundamentalHz * (1 + 0.65 * Math.exp(-t * 36));
        phase += (2 * Math.PI * freq) / sr;
        const head = Math.sin(phase) * Math.exp(-t * 8.5);
        const overtone = Math.sin(phase * 1.58) * Math.exp(-t * 16) * 0.28;
        const attack = (rand() * 0.4 + Math.sin(2 * Math.PI * 1400 * t) * 0.5) * Math.exp(-t * 140);
        const s = (head + overtone + attack) * gain;
        left[start + i] += s * panL;
        right[start + i] += s * panR;
      }
    };

    // Spacious groove with long breathing gaps for Gated Reverb showcase:
    // 0.15s: Kick
    addKick(0.15, 0.85);
    // 0.90s: Huge Gated Snare 1
    addSnare(0.90, 0.98);
    // 2.05s: Kick + Ghost Kick
    addKick(2.05, 0.80);
    addKick(2.38, 0.72);
    // 2.85s: Huge Gated Snare 2
    addSnare(2.85, 1.0);
    // 4.00s - 5.15s: Iconic 1981 Descending Concert Tom Fill!
    addConcertTom(4.00, 175, -0.55, 0.88);
    addConcertTom(4.24, 152, -0.25, 0.90);
    addConcertTom(4.48, 126, 0.15, 0.92);
    addConcertTom(4.74, 98, 0.45, 0.95);
    addSnare(5.02, 1.0);

    // Soft clip safety
    for (let i = 0; i < length; i++) {
      left[i] = Math.tanh(left[i]);
      right[i] = Math.tanh(right[i]);
    }
    return buffer;
  }

  /**
   * Generates a Vocal Formant + Lush 1980s Synth Pad Phrase with quiet dynamic tails
   * and delicate breathy harmonics to showcase Dolby A/B Noise Companding and the "Air Trick".
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createVocalPadStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 6.0;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    let seed = 19740922;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // Chord notes (A minor 9th lush vocal/pad)
    const notes = [220.0, 261.63, 329.63, 392.0, 493.88];
    const phases = notes.map(() => 0);
    const detunePhases = notes.map(() => 0.25);

    for (let i = 0; i < length; i++) {
      const t = i / sr;

      // Phrase envelope: swells up, drops to an intimate whisper (-34 dB) from 2.6s-4.3s,
      // then swells into a breathy vocal harmonic cadence
      let env = 0.08;
      if (t < 2.4) {
        env = Math.min(1.0, t / 0.35) * Math.exp(-Math.max(0, t - 1.1) * 1.35);
      } else if (t >= 2.4 && t < 3.7) {
        // Quiet whisper passage where tape hiss and Dolby low-level companding are maximally audible
        env = 0.045 + 0.025 * Math.sin(2 * Math.PI * 1.2 * t);
      } else {
        const t2 = t - 3.7;
        env = Math.min(0.85, t2 / 0.25) * Math.exp(-Math.max(0, t2 - 0.9) * 1.6);
      }

      // Vibrato
      const vib = 1 + 0.0035 * Math.sin(2 * Math.PI * 5.4 * t);

      let sumL = 0;
      let sumR = 0;
      for (let n = 0; n < notes.length; n++) {
        const f = notes[n] * vib;
        phases[n] += (2 * Math.PI * f) / sr;
        detunePhases[n] += (2 * Math.PI * (f * 1.004)) / sr;

        // Rich harmonic series up to 12 kHz for vocal/pad air
        const h1 = Math.sin(phases[n]);
        const h2 = Math.sin(phases[n] * 2) * 0.45;
        const h3 = Math.sin(phases[n] * 3) * 0.25;
        const h5 = Math.sin(phases[n] * 5) * 0.12;
        const h8 = Math.sin(phases[n] * 8) * 0.06;
        const h12 = Math.sin(phases[n] * 12) * 0.035;

        const d1 = Math.sin(detunePhases[n]);
        const d3 = Math.sin(detunePhases[n] * 3) * 0.25;
        const d9 = Math.sin(detunePhases[n] * 9) * 0.05;

        sumL += (h1 + h2 + h3 + h5 + h8 + h12) * 0.16;
        sumR += (d1 + h2 + d3 + h5 + d9 + h12) * 0.16;
      }

      // Add subtle vocal breath / consonant aspiration (4 kHz - 11 kHz) so Dolby A Band 3 & Band 4 "Air Trick" glistens
      const breathMod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * t);
      const airL = Math.sin(2 * Math.PI * 6400 * t + rand() * 0.8) * 0.035 * breathMod;
      const airR = Math.sin(2 * Math.PI * 7800 * t + rand() * 0.8) * 0.035 * breathMod;

      left[i] = (sumL + airL) * env;
      right[i] = (sumR + airR) * env;
    }

    return buffer;
  }

  /**
   * Generates a Studio Alignment & Dynamic Staircase Calibration Signal:
   * - 0.0–1.5s: 1 kHz @ 0 VU (-12 dBFS) Reference Alignment Tone
   * - 1.5–3.0s: 8.5 kHz @ -28 dB Low-Level High-Frequency Probe (Tests Dolby Band 3/4 boost)
   * - 3.0–4.5s: Quiet Dynamic Floor Probe (-42 dB 400 Hz + 6 kHz dual tone)
   * - 4.5–6.0s: Transient Snare/Burst Impulse Check
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createCalibrationStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 6.0;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      let s = 0;
      if (t < 1.45) {
        // 1 kHz Reference Level
        s = Math.sin(2 * Math.PI * 1000 * t) * 0.45;
      } else if (t >= 1.5 && t < 2.95) {
        // Low-level 8.5 kHz HF tone (inside Dolby Band 3 & Band 4)
        s = Math.sin(2 * Math.PI * 8500 * t) * 0.045;
      } else if (t >= 3.0 && t < 4.45) {
        // Ultra-low-level dual tone (-38 dB)
        s =
          Math.sin(2 * Math.PI * 440 * t) * 0.02 +
          Math.sin(2 * Math.PI * 6200 * t) * 0.02;
      } else if (t >= 4.6 && t < 4.85) {
        // Sharp transient burst
        const dt = t - 4.6;
        s =
          (Math.sin(2 * Math.PI * 210 * dt) +
            Math.sin(2 * Math.PI * 3400 * dt) * 0.6) *
          Math.exp(-dt * 24) *
          0.85;
      }
      left[i] = s;
      right[i] = s;
    }
    return buffer;
  }

  /**
   * Generates a single immediate 1980s Snare + Tom transient hit buffer for manual "HIT SNARE" button
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createSingleSnareHit(ctx) {
    const sr = ctx.sampleRate;
    const duration = 0.35;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    let p1 = 0;
    let p2 = 0;
    let lpL = 0;
    let lpR = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const f1 = 185 + 95 * Math.exp(-t * 58);
      const f2 = 335 + 120 * Math.exp(-t * 68);
      p1 += (2 * Math.PI * f1) / sr;
      p2 += (2 * Math.PI * f2) / sr;

      const body = (Math.sin(p1) * 0.65 + Math.sin(p2) * 0.35) * Math.exp(-t * 18);
      const nL = rand();
      const nR = rand();
      lpL = 0.7 * lpL + 0.3 * nL;
      lpR = 0.7 * lpR + 0.3 * nR;
      const wiresL = (nL - lpL) * Math.exp(-t * 14);
      const wiresR = (nR - lpR) * Math.exp(-t * 14);
      const crack = Math.exp(-t * 220) * Math.sin(2 * Math.PI * 2500 * t) * 0.6;

      left[i] = Math.tanh((body + wiresL * 0.9 + crack) * 0.98);
      right[i] = Math.tanh((body + wiresR * 0.9 + crack) * 0.98);
    }
    return buffer;
  }

  /**
   * Generates a synthesized Acoustic Stone Room / AMS RMX16 NonLin2 Reverb Impulse Response
   * @param {BaseAudioContext} ctx
   * @param {Object} params
   * @param {'stone-room'|'ams-nonlin'|'plate-224'} params.algorithm
   * @param {number} params.decaySeconds
   * @returns {AudioBuffer}
   */
  static createReverbImpulse(ctx, { algorithm = 'stone-room', decaySeconds = 1.8 } = {}) {
    const sr = ctx.sampleRate;
    const dur = Math.max(0.3, Math.min(4.0, decaySeconds));
    const length = Math.floor(sr * dur);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    let seed = algorithm === 'ams-nonlin' ? 4040404 : algorithm === 'plate-224' ? 224224 : 8080808;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    let lpL = 0;
    let lpR = 0;

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const normT = t / dur;

      let env = 1.0;
      if (algorithm === 'ams-nonlin') {
        // AMS RMX16 NonLin 2: Dense build-up plateau that stays constant then truncates sharply
        const buildup = Math.min(1.0, t / 0.035);
        const holdPlateau = normT < 0.78 ? 1.0 - normT * 0.15 : Math.exp(-(normT - 0.78) * 18);
        env = buildup * holdPlateau;
      } else if (algorithm === 'stone-room') {
        // Townhouse Studio 2 Stone Room: Slapback masonry early reflections + booming diffuse room tail
        const earlyCluster = t < 0.065 && i % Math.floor(sr * 0.0045) < 12 ? 1.65 : 1.0;
        env = earlyCluster * Math.exp((-3.2 * t) / dur);
      } else {
        // Lexicon 224 Rich Plate
        env = Math.exp((-4.8 * t) / dur);
      }

      const rawL = rand();
      const rawR = rand();
      // Stone Room has brighter masonry bounce; Plate has smooth HF damping
      const damp = algorithm === 'plate-224' ? 0.55 : 0.32;
      lpL = damp * lpL + (1 - damp) * rawL;
      lpR = damp * lpR + (1 - damp) * rawR;

      left[i] = lpL * env * 0.55;
      right[i] = lpR * env * 0.55;
    }

    return buffer;
  }
}

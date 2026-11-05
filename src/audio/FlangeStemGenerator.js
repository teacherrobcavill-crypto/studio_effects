/**
 * FlangeStemGenerator.js
 * Procedural 1960s Multi-Stem Test Stimulus Generator & Zero-Persistence Local File Loader.
 * 
 * Synthesizes 5 authentic 1966-1968 studio recording stems into volatile AudioBuffers:
 *  1. Lead Vocals (Double-tracked psychedelic vocal phrase with rich formant harmonics)
 *  2. Drums (Glyn Johns mono overhead / room breakbeat with crisp cymbal wash)
 *  3. Bass (Flatwound P-Bass picked with damped bridge, classic Abbey Road tone)
 *  4. Guitars (Chiming 12-string Rickenbacker / Vox AC30 top-boost arpeggios)
 *  5. Keys (Hammond B3 organ with Leslie harmonic drawbars)
 *  6. Pink/White Noise (Textbook engineering calibration stimulus for comb filter observation)
 * 
 * Zero-Persistence Privacy Protocol:
 * User files are loaded strictly via FileReader into volatile RAM (AudioBuffer) and
 * immediately dereferenced on file swap or session teardown. Zero server or disk persistence.
 */

export class FlangeStemGenerator {
  /**
   * Synthesizes a 1967 psychedelic dry lead vocal phrase with rich vowel formants
   * ("Tomorrow Never Knows" / "Lucy" style vowel modulation and natural vibrato).
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createVocalStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 5.0; // 5-second musical loop
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    // Vocal melody notes (Hz): A3 (220), C4 (261.63), D4 (293.66), E4 (329.63), G4 (392)
    const notes = [
      { start: 0.0, dur: 1.1, f0: 220.0, vowel: 'ah' },
      { start: 1.15, dur: 0.9, f0: 261.63, vowel: 'ee' },
      { start: 2.1, dur: 1.2, f0: 293.66, vowel: 'oh' },
      { start: 3.35, dur: 1.5, f0: 220.0, vowel: 'oo' }
    ];

    // Formant frequencies (Hz) for vowel shapes
    const formants = {
      ah: [730, 1090, 2440, 3500],
      ee: [270, 2290, 3010, 3600],
      oh: [500, 700, 2410, 3400],
      oo: [300, 870, 2240, 3300]
    };

    notes.forEach((note) => {
      const startSample = Math.floor(note.start * sr);
      const noteSamples = Math.floor(note.dur * sr);
      const fmt = formants[note.vowel] || formants.ah;

      let phase1 = 0;
      let phase2 = Math.PI * 0.25; // Subtle ADT micro-split for natural voice double-tracking

      for (let i = 0; i < noteSamples && (startSample + i) < length; i++) {
        const t = i / sr;
        // Attack/Release envelope
        const env = Math.sin(Math.min(1, t / 0.08) * (Math.PI / 2)) *
                    Math.sin(Math.min(1, (note.dur - t) / 0.12) * (Math.PI / 2));
        
        // Vocal vibrato: 5.6 Hz vibrato with 1.8% pitch depth
        const vib = 1.0 + 0.018 * Math.sin(2 * Math.PI * 5.6 * t);
        const fInst = note.f0 * vib;

        phase1 += (2 * Math.PI * fInst) / sr;
        phase2 += (2 * Math.PI * (fInst * 1.002)) / sr; // slight pitch drift on second voice

        // Vocal tract pulse generator (glottal pulse wave with rich harmonics)
        let glottal1 = 0;
        let glottal2 = 0;
        for (let h = 1; h <= 18; h++) {
          const harmonicGain = 1.0 / Math.pow(h, 1.15);
          glottal1 += Math.sin(phase1 * h) * harmonicGain;
          glottal2 += Math.sin(phase2 * h) * harmonicGain;
        }

        // Apply vowel formant resonances
        let sampleL = 0;
        let sampleR = 0;
        fmt.forEach((fRes, idx) => {
          const resWeight = 1.0 / (idx + 1);
          sampleL += Math.sin(phase1 * (fRes / note.f0)) * resWeight * 0.4;
          sampleR += Math.sin(phase2 * (fRes / note.f0)) * resWeight * 0.4;
        });

        // Mix vocal pulse and formants
        const vocalSampleL = (glottal1 * 0.45 + sampleL * 0.55) * env * 0.75;
        const vocalSampleR = (glottal2 * 0.45 + sampleR * 0.55) * env * 0.75;

        chL[startSample + i] += vocalSampleL;
        chR[startSample + i] += vocalSampleR;
      }
    });

    return buffer;
  }

  /**
   * Synthesizes a mono overhead/room breakbeat (Glyn Johns 1968 style)
   * with punchy bass drum, snappy dry snare, and crisp cymbal wash.
   * Cymbals provide high-frequency broadband energy ideal for flanging.
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createDrumStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.8; // 4 bars at 100 BPM (60 / 100 * 8 = 4.8s)
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    let seed = 19670601;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    const addKick = (timeSec) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(0.28 * sr);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const freq = 52 + 105 * Math.exp(-t * 38);
        phase += (2 * Math.PI * freq) / sr;
        const body = Math.sin(phase) * Math.exp(-t * 12);
        const beater = Math.exp(-t * 160) * Math.sin(2 * Math.PI * 1800 * t) * 0.3;
        const sample = (body + beater) * 0.85;
        chL[start + i] += sample;
        chR[start + i] += sample;
      }
    };

    const addSnare = (timeSec) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(0.24 * sr);
      let p1 = 0;
      let p2 = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const f1 = 175 + 80 * Math.exp(-t * 50);
        const f2 = 295 + 110 * Math.exp(-t * 60);
        p1 += (2 * Math.PI * f1) / sr;
        p2 += (2 * Math.PI * f2) / sr;
        const tone = (Math.sin(p1) * 0.6 + Math.sin(p2) * 0.4) * Math.exp(-t * 22);
        const noise = rand() * Math.exp(-t * 18);
        const rim = Math.exp(-t * 220) * Math.sin(2 * Math.PI * 2200 * t) * 0.4;
        const s = (tone * 0.5 + noise * 0.8 + rim) * 0.8;
        chL[start + i] += s;
        chR[start + i] += s;
      }
    };

    const addHiHat = (timeSec, open = false) => {
      const start = Math.floor(timeSec * sr);
      const durSec = open ? 0.35 : 0.08;
      const dur = Math.floor(durSec * sr);
      let hpZ1 = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const raw = rand();
        // High-pass filter above 7 kHz
        const hp = raw - 0.88 * hpZ1;
        hpZ1 = raw;
        const env = Math.exp(-t * (open ? 14 : 65));
        const metallic = (Math.sin(2 * Math.PI * 8400 * t) + Math.sin(2 * Math.PI * 11200 * t)) * 0.25;
        const s = (hp * 0.75 + metallic) * env * (open ? 0.4 : 0.3);
        chL[start + i] += s;
        chR[start + i] += s;
      }
    };

    const addCrash = (timeSec) => {
      const start = Math.floor(timeSec * sr);
      const dur = Math.floor(1.8 * sr);
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        const n = rand() * 0.6 + (Math.sin(2 * Math.PI * 5200 * t) + Math.sin(2 * Math.PI * 7600 * t) + Math.sin(2 * Math.PI * 9800 * t)) * 0.15;
        const env = Math.exp(-t * 2.8);
        const s = n * env * 0.42;
        chL[start + i] += s;
        chR[start + i] += s;
      }
    };

    // 8-beat 1960s breakbeat pattern (repeated for 2 bars)
    const beatSec = 0.6; // 100 BPM
    addCrash(0.0);
    for (let bar = 0; bar < 2; bar++) {
      const b0 = bar * 4 * beatSec;
      addKick(b0 + 0.0 * beatSec);
      addSnare(b0 + 1.0 * beatSec);
      addKick(b0 + 2.0 * beatSec);
      addKick(b0 + 2.75 * beatSec);
      addSnare(b0 + 3.0 * beatSec);

      // 8th-note hi-hats
      for (let eighth = 0; eighth < 8; eighth++) {
        const isOpen = (eighth === 7);
        addHiHat(b0 + eighth * (beatSec * 0.5), isOpen);
      }
    }

    return buffer;
  }

  /**
   * Synthesizes a 1960s flatwound Tic-Tac P-Bass (Abbey Road / Carol Kaye style).
   * Picked with plectrum and dampened foam mute near the bridge.
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createBassStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.8;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    // Damped walking bass riff in D (D2 = 73.42 Hz, F#2 = 92.50 Hz, A2 = 110.0 Hz, B2 = 123.47 Hz, C3 = 130.81 Hz)
    const notes = [
      { beat: 0.0, f0: 73.42 },
      { beat: 0.75, f0: 73.42 },
      { beat: 1.0, f0: 92.50 },
      { beat: 2.0, f0: 110.0 },
      { beat: 3.0, f0: 123.47 },
      { beat: 4.0, f0: 130.81 },
      { beat: 5.0, f0: 110.0 },
      { beat: 6.0, f0: 92.50 },
      { beat: 7.0, f0: 82.41 }
    ];

    const beatSec = 0.6;
    notes.forEach((n) => {
      const start = Math.floor(n.beat * beatSec * sr);
      const dur = Math.floor(0.48 * beatSec * sr);
      let phase = 0;
      for (let i = 0; i < dur && start + i < length; i++) {
        const t = i / sr;
        // Dampened flatwound envelope
        const env = Math.exp(-t * 6.8) * (1.0 - Math.exp(-t * 120.0));
        // Pick transient click
        const pickClick = Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 90.0) * 0.35;
        phase += (2 * Math.PI * n.f0) / sr;

        // Warm, round fundamental + 2nd harmonic
        const fundamental = Math.sin(phase);
        const harm2 = Math.sin(2 * phase) * 0.45 * Math.exp(-t * 8.0);
        const harm3 = Math.sin(3 * phase) * 0.18 * Math.exp(-t * 14.0);

        const sample = (fundamental + harm2 + harm3 + pickClick) * env * 0.85;
        chL[start + i] += sample;
        chR[start + i] += sample;
      }
    });

    return buffer;
  }

  /**
   * Synthesizes a bright 12-string Rickenbacker through a chiming Vox AC30.
   * Rich high-frequency harmonics that showcase comb-filter notches dramatically.
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createGuitarStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.8;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    // Arpeggiated Dsus2 / Dadd9 chords (classic Roger McGuinn / George Harrison jangle)
    // D3(146.83), A3(220), D4(293.66), E4(329.63), F#4(369.99), A4(440)
    // 12-string pairs include octave-up courses on lower strings!
    const chordPattern = [
      { time: 0.0, freqs: [146.83, 293.66, 220.0, 440.0, 329.63] },
      { time: 0.3, freqs: [220.0, 440.0, 293.66, 587.33] },
      { time: 0.6, freqs: [293.66, 369.99, 440.0, 659.25] },
      { time: 0.9, freqs: [329.63, 659.25, 440.0, 880.0] },
      { time: 1.2, freqs: [146.83, 293.66, 220.0, 440.0, 369.99] },
      { time: 1.5, freqs: [220.0, 293.66, 329.63, 587.33] },
      { time: 1.8, freqs: [293.66, 369.99, 440.0, 739.99] },
      { time: 2.1, freqs: [329.63, 440.0, 659.25, 880.0] },
      { time: 2.4, freqs: [146.83, 293.66, 220.0, 440.0, 329.63] },
      { time: 2.7, freqs: [220.0, 440.0, 293.66, 587.33] },
      { time: 3.0, freqs: [293.66, 369.99, 440.0, 659.25] },
      { time: 3.3, freqs: [329.63, 659.25, 440.0, 880.0] },
      { time: 3.6, freqs: [146.83, 293.66, 220.0, 440.0, 369.99] },
      { time: 4.0, freqs: [146.83, 220.0, 293.66, 369.99, 440.0, 587.33] }
    ];

    chordPattern.forEach((strum) => {
      const start = Math.floor(strum.time * sr);
      const dur = Math.floor(0.9 * sr);

      strum.freqs.forEach((f0, fIdx) => {
        let phase = 0;
        let phaseOct = 0.4;
        const fOct = f0 * 2.0; // 12-string chime octave course

        for (let i = 0; i < dur && start + i < length; i++) {
          const t = i / sr;
          const env = Math.exp(-t * 3.4) * (1.0 - Math.exp(-t * 180.0));
          phase += (2 * Math.PI * f0) / sr;
          phaseOct += (2 * Math.PI * (fOct * 1.001)) / sr; // chorus shimmer

          // Bright triangular chime waveform
          const fundamental = Math.sin(phase) + 0.35 * Math.sin(phase * 2) + 0.25 * Math.sin(phase * 3);
          const octaveChime = 0.5 * Math.sin(phaseOct) + 0.25 * Math.sin(phaseOct * 2);

          // Plectrum pluck spike
          const pick = Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 220.0) * 0.15;

          const voice = (fundamental + octaveChime + pick) * env * (0.28 / (1 + fIdx * 0.15));
          chL[start + i] += voice * 0.85;
          chR[start + i] += voice * 0.95;
        }
      });
    });

    return buffer;
  }

  /**
   * Synthesizes a Hammond B3 organ with Leslie harmonic drawbars and percussion click.
   * Drawbar settings: 88 8000 000 (warm foundation) + 88 8800 000 (bright partials).
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createKeysStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.8;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    // Hammond chords (A minor to D9 groove, classic 1967 mod organ style)
    const chords = [
      { start: 0.0, dur: 1.15, notes: [220.0, 261.63, 329.63, 440.0] },
      { start: 1.2, dur: 1.15, notes: [146.83, 220.0, 277.18, 329.63] },
      { start: 2.4, dur: 1.15, notes: [220.0, 261.63, 329.63, 523.25] },
      { start: 3.6, dur: 1.15, notes: [146.83, 220.0, 293.66, 369.99] }
    ];

    // Standard tonewheel drawbar harmonic multiples
    const drawbars = [
      { mult: 0.5, gain: 0.8 },  // 16'
      { mult: 1.0, gain: 0.9 },  // 8'
      { mult: 1.5, gain: 0.6 },  // 5 1/3'
      { mult: 2.0, gain: 0.75 }, // 4'
      { mult: 3.0, gain: 0.4 },  // 2 2/3'
      { mult: 4.0, gain: 0.3 }   // 2'
    ];

    chords.forEach((chord) => {
      const start = Math.floor(chord.start * sr);
      const dur = Math.floor(chord.dur * sr);

      chord.notes.forEach((f0) => {
        const phases = drawbars.map(() => 0);

        for (let i = 0; i < dur && start + i < length; i++) {
          const t = i / sr;
          // Key click on start
          const keyClick = (Math.random() * 2 - 1) * Math.exp(-t * 250) * 0.18;
          // Organ envelope (instant attack, sustained body, fast decay)
          const env = Math.min(1.0, t / 0.01) * Math.min(1.0, (chord.dur - t) / 0.02);

          // Leslie chorusing (slow horn rotor modulation ~0.8 Hz)
          const leslieMod = 1.0 + 0.003 * Math.sin(2 * Math.PI * 0.8 * t);

          let organSample = 0;
          drawbars.forEach((db, dIdx) => {
            phases[dIdx] += (2 * Math.PI * (f0 * db.mult * leslieMod)) / sr;
            organSample += Math.sin(phases[dIdx]) * db.gain * 0.14;
          });

          const total = (organSample + keyClick) * env;
          chL[start + i] += total;
          chR[start + i] += total;
        }
      });
    });

    return buffer;
  }

  /**
   * Synthesizes a broadband Pink / White Noise test stimulus.
   * Perfect for analyzing comb filter teeth and theoretical notch alignment!
   * @param {BaseAudioContext} ctx
   * @returns {AudioBuffer}
   */
  static createNoiseStem(ctx) {
    const sr = ctx.sampleRate;
    const duration = 4.0;
    const length = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(2, length, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    // Paul Kellet's refined pink noise filter algorithm
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;

      chL[i] = pink;
      chR[i] = pink;
    }

    return buffer;
  }

  /**
   * Zero-Persistence Browser File Ingestion:
   * Uses HTML5 FileReader API to decode user audio directly into volatile RAM.
   * Never transmits audio to any server or saves to client storage.
   * @param {File} file
   * @param {BaseAudioContext} ctx
   * @returns {Promise<{ buffer: AudioBuffer, fileName: string, duration: number }>}
   */
  static async loadLocalAudioFile(file, ctx) {
    return new Promise((resolve, reject) => {
      if (!file) {
        return reject(new Error('No file provided'));
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          // Decode directly in Web Audio context
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          resolve({
            buffer: audioBuffer,
            fileName: file.name,
            duration: audioBuffer.duration
          });
        } catch (decodeErr) {
          reject(new Error(`Failed to decode audio file: ${decodeErr.message}`));
        }
      };

      reader.onerror = () => {
        reject(new Error('Error reading local file via FileReader'));
      };

      reader.readAsArrayBuffer(file);
    });
  }
}

/**
 * StemGenerator.js
 * Procedural 1950s Multi-Stem Test Stimulus Generator & Custom Audio File Loader.
 * Pre-renders rich, musical 8-bar 120 BPM 1950s Rockabilly / Jump-Blues AudioBuffers
 * for the 4 studio sources (Upright Bass, Archtop Guitar, Calfskin Drums, Lead Vocal)
 * so the simulator plays immediately out-of-the-box with zero external dependencies,
 * while also supporting custom <input type="file"> / Drag-and-Drop audio stems.
 */

export class StemGenerator {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.tempo = 124; // 1950s Sun Studio / Chess Records upbeat groove
    this.loopDurationSec = (60 / this.tempo) * 16; // 4 bars of 4/4 (16 beats)

    this.sources = [
      { id: 'bass', name: 'Upright Bass', color: '#f59e0b', muted: false, solo: false, customFileName: null },
      { id: 'guitar', name: 'Archtop Guitar', color: '#38bdf8', muted: false, solo: false, customFileName: null },
      { id: 'drums', name: 'Calfskin Kit', color: '#10b981', muted: false, solo: false, customFileName: null },
      { id: 'vocal', name: 'Lead Vocal', color: '#f43f5e', muted: false, solo: false, customFileName: null }
    ];

    this.syntheticBuffers = new Array(4).fill(null);
    this.customBuffers = new Array(4).fill(null);

    // Output gain nodes that feed Stage 1 (LiveRoomEngine)
    this.outputNodes = this.sources.map(() => {
      const g = this.ctx.createGain();
      g.gain.value = 1.0;
      return g;
    });

    this.activeBufferNodes = [];
    this.isPlaying = false;
    this._generateAllSyntheticStems();
  }

  /**
   * Generates all 4 synthetic 1950s instrumental & vocal stems into AudioBuffers
   */
  _generateAllSyntheticStems() {
    const sr = this.ctx.sampleRate;
    const totalSamples = Math.floor(this.loopDurationSec * sr);

    this.syntheticBuffers[0] = this._synthesizeUprightBass(sr, totalSamples);
    this.syntheticBuffers[1] = this._synthesizeArchtopGuitar(sr, totalSamples);
    this.syntheticBuffers[2] = this._synthesizeDrumKit(sr, totalSamples);
    this.syntheticBuffers[3] = this._synthesizeLeadVocal(sr, totalSamples);
  }

  /**
   * Stem 0: Slap Upright Double Bass (Walking 1-3-5-6-b7 rockabilly pattern + fingerboard slap click)
   */
  _synthesizeUprightBass(sr, totalSamples) {
    const buf = this.ctx.createBuffer(1, totalSamples, sr);
    const data = buf.getChannelData(0);
    const beatSec = 60 / this.tempo;

    // 16-beat walking bass frequencies (I - IV - I - V turnaround in E major/blues)
    const bassNotesHz = [
      // Bar 1 (E7)
      82.41, 103.83, 123.47, 138.59,
      // Bar 2 (A7)
      110.00, 138.59, 164.81, 146.83,
      // Bar 3 (E7)
      82.41, 123.47, 146.83, 123.47,
      // Bar 4 (B7 -> A7)
      123.47, 146.83, 110.00, 98.00
    ];

    let phase = 0;
    let bodyZ1 = 0;

    for (let beat = 0; beat < 16; beat++) {
      const f0 = bassNotesHz[beat];
      const startSample = Math.floor(beat * beatSec * sr);
      const noteLenSamples = Math.floor(beatSec * sr);
      const slapSamples = Math.floor((beatSec * 0.5) * sr); // Off-beat rockabilly fingerboard slap

      for (let n = 0; n < noteLenSamples && (startSample + n) < totalSamples; n++) {
        const t = n / sr;
        // Plucked gut string envelope
        const env = Math.exp(-t * 5.2) * (1.0 - Math.exp(-t * 140.0));
        // Subtle pitch drop on initial pluck tension
        const instFreq = f0 * (1.0 + 0.015 * Math.exp(-t * 45.0));
        phase += (2 * Math.PI * instFreq) / sr;

        // Gut string fundamental + woody 2nd & 3rd harmonics
        const stringSig =
          0.72 * Math.sin(phase) +
          0.28 * Math.sin(2 * phase + 0.3) * Math.exp(-t * 8.0) +
          0.12 * Math.sin(3 * phase) * Math.exp(-t * 14.0);

        // Initial finger pluck thump
        const pluckThump = Math.sin(2 * Math.PI * 155 * t) * Math.exp(-t * 55.0) * 0.25;

        // Off-beat rockabilly fingerboard slap click (at 50% of beat)
        let slapClick = 0;
        if (n >= slapSamples && n < slapSamples + Math.floor(0.035 * sr)) {
          const ts = (n - slapSamples) / sr;
          slapClick = (Math.random() * 2 - 1) * Math.exp(-ts * 180.0) * 0.22 * Math.sin(2 * Math.PI * 1950 * ts);
        }

        const raw = (stringSig * env + pluckThump + slapClick) * 0.78;
        // Warm hollow body filter
        bodyZ1 = 0.85 * bodyZ1 + 0.15 * raw;
        data[startSample + n] = 0.65 * raw + 0.35 * bodyZ1;
      }
    }
    return buf;
  }

  /**
   * Stem 1: Gibson ES-295 / Gretsch Archtop Guitar (Swing/Rockabilly double-stops & chord stabs)
   */
  _synthesizeArchtopGuitar(sr, totalSamples) {
    const buf = this.ctx.createBuffer(1, totalSamples, sr);
    const data = buf.getChannelData(0);
    const eigthSec = 60 / this.tempo / 2;

    // 32 eighth-note rhythmic chords / riffs across 4 bars
    const chordVoicings = [
      // E9 / E7 voicings
      [329.63, 415.30, 493.88], [329.63, 440.00, 554.37], [329.63, 415.30, 493.88], null,
      [329.63, 493.88, 659.25], [329.63, 415.30, 587.33], null, [329.63, 415.30, 493.88],
      // A9 / A7 voicings
      [220.00, 369.99, 440.00], [220.00, 415.30, 554.37], [220.00, 369.99, 493.88], null,
      [220.00, 369.99, 659.25], [220.00, 369.99, 493.88], null, [220.00, 349.23, 440.00],
      // E7 riff
      [329.63, 415.30, 493.88], [392.00, 493.88, 659.25], [415.30, 523.25, 659.25], null,
      [329.63, 415.30, 587.33], [329.63, 415.30, 493.88], null, [293.66, 369.99, 493.88],
      // B7 -> A7 turnaround
      [246.94, 369.99, 466.16], [246.94, 369.99, 587.33], [220.00, 349.23, 493.88], null,
      [329.63, 415.30, 493.88], [392.00, 493.88], [415.30, 523.25], [493.88, 659.25]
    ];

    for (let step = 0; step < 32; step++) {
      const notes = chordVoicings[step];
      if (!notes) continue;

      // Apply swing delay on odd 8th notes
      const swingOffset = (step % 2 === 1) ? eigthSec * 0.16 : 0;
      const startSample = Math.floor((step * eigthSec + swingOffset) * sr);
      const durSamples = Math.floor(eigthSec * 1.45 * sr);

      for (let n = 0; n < durSamples && (startSample + n) < totalSamples; n++) {
        const t = n / sr;
        const env = Math.exp(-t * 7.5) * (1.0 - Math.exp(-t * 250.0));
        let chordSum = 0;

        for (let k = 0; k < notes.length; k++) {
          // Slight strum stagger per string
          const ts = Math.max(0, t - k * 0.006);
          if (ts <= 0) continue;
          const f = notes[k];
          const w = 2 * Math.PI * f * ts;
          // P90 pickup rich odd/even harmonic blend
          const tone =
            Math.sin(w) +
            0.45 * Math.sin(2 * w) * Math.exp(-ts * 10) +
            0.25 * Math.sin(3 * w) * Math.exp(-ts * 16) +
            0.12 * Math.sin(4 * w) * Math.exp(-ts * 24);
          chordSum += tone;
        }

        // Tweed tube combo soft clipping
        const driven = Math.tanh(chordSum * env * 0.55) * 0.52;
        data[startSample + n] += driven;
      }
    }
    return buf;
  }

  /**
   * Stem 2: 1950s Gretsch / Slingerland Calfskin Drum Kit (Kick, Snare Backbeat, Swing Ride & Hi-Hat)
   */
  _synthesizeDrumKit(sr, totalSamples) {
    const buf = this.ctx.createBuffer(1, totalSamples, sr);
    const data = buf.getChannelData(0);
    const beatSec = 60 / this.tempo;

    for (let beat = 0; beat < 16; beat++) {
      const beatStart = Math.floor(beat * beatSec * sr);

      // 1. Calfskin 22" Kick Drum on beats 0, 2 of each bar (+ occasional pickup)
      if (beat % 2 === 0) {
        const kickLen = Math.floor(0.32 * sr);
        let kPhase = 0;
        for (let n = 0; n < kickLen && (beatStart + n) < totalSamples; n++) {
          const t = n / sr;
          const fKick = 56.0 + 78.0 * Math.exp(-t * 38.0);
          kPhase += (2 * Math.PI * fKick) / sr;
          const env = Math.exp(-t * 11.5);
          const beaterClick = (Math.random() * 2 - 1) * Math.exp(-t * 190.0) * 0.18;
          data[beatStart + n] += (Math.sin(kPhase) * env * 0.78 + beaterClick);
        }
      }

      // 2. Wood-Shell Snare Drum on backbeats (beats 1 & 3 of each bar)
      if (beat % 2 === 1) {
        const snareLen = Math.floor(0.28 * sr);
        for (let n = 0; n < snareLen && (beatStart + n) < totalSamples; n++) {
          const t = n / sr;
          const body = (0.65 * Math.sin(2 * Math.PI * 188 * t) + 0.35 * Math.sin(2 * Math.PI * 332 * t)) * Math.exp(-t * 22.0);
          const wires = (Math.random() * 2 - 1) * Math.exp(-t * 14.5) * 0.52;
          data[beatStart + n] += (body * 0.65 + wires);
        }
      }

      // 3. Zildjian Ride Cymbal & Shuffled Brush/Hi-Hat on quarter + swung 8th
      const swingSubOffsets = [0, beatSec * 0.64];
      for (let s = 0; s < swingSubOffsets.length; s++) {
        if (s === 1 && beat % 2 === 0) continue; // Classic jazz/rockabilly spang-a-lang ride pattern
        const cymStart = beatStart + Math.floor(swingSubOffsets[s] * sr);
        const cymLen = Math.floor(0.22 * sr);
        for (let n = 0; n < cymLen && (cymStart + n) < totalSamples; n++) {
          const t = n / sr;
          // Inharmonic metallic cymbal modes + high-passed shimmer
          const metallic =
            Math.sin(2 * Math.PI * 3140 * t) +
            Math.sin(2 * Math.PI * 4680 * t) +
            Math.sin(2 * Math.PI * 6920 * t) +
            (Math.random() * 2 - 1) * 1.4;
          const cymEnv = Math.exp(-t * (s === 0 ? 18.0 : 26.0));
          data[cymStart + n] += metallic * cymEnv * 0.085;
        }
      }
    }
    return buf;
  }

  /**
   * Stem 3: 1950s Lead Vocal (Formant-filtered glottal pulse train with expressive vibrato & phrasing)
   */
  _synthesizeLeadVocal(sr, totalSamples) {
    const buf = this.ctx.createBuffer(1, totalSamples, sr);
    const data = buf.getChannelData(0);
    const beatSec = 60 / this.tempo;

    // Expressive blues/rockabilly vocal phrases (startBeat, durationBeats, freqHz, vowelFormants [F1, F2, F3])
    const phrases = [
      { start: 0.5, dur: 1.5, f0: 220.00, formants: [730, 1090, 2440] }, // "Ah" (A3)
      { start: 2.0, dur: 1.2, f0: 261.63, formants: [570, 840, 2410] },  // "Oh" (C4)
      { start: 3.2, dur: 2.2, f0: 246.94, formants: [530, 1840, 2480] }, // "Eh" (B3)
      { start: 6.5, dur: 1.5, f0: 293.66, formants: [730, 1090, 2440] }, // "Ah" (D4)
      { start: 8.0, dur: 2.5, f0: 246.94, formants: [570, 840, 2410] },  // "Oh" (B3)
      { start: 11.0, dur: 1.5, f0: 220.00, formants: [660, 1720, 2410] }, // "Aa" (A3)
      { start: 12.5, dur: 2.8, f0: 196.00, formants: [570, 840, 2410] }  // "Oh" (G3)
    ];

    for (const p of phrases) {
      const startSample = Math.floor(p.start * beatSec * sr);
      const lenSamples = Math.floor(p.dur * beatSec * sr);
      let phase = 0;

      // 3 parallel formant resonator states
      const res = p.formants.map((f, idx) => {
        const bw = idx === 0 ? 85 : idx === 1 ? 110 : 160;
        const r = Math.exp((-Math.PI * bw) / sr);
        const w = (2 * Math.PI * f) / sr;
        return {
          a1: -2 * r * Math.cos(w),
          a2: r * r,
          b0: 1.0 - r,
          y1: 0,
          y2: 0
        };
      });

      for (let n = 0; n < lenSamples && (startSample + n) < totalSamples; n++) {
        const t = n / sr;
        const durSec = lenSamples / sr;

        // Smooth attack & release vocal envelope
        const att = 1.0 - Math.exp(-t * 28.0);
        const rel = 1.0 - Math.exp(-Math.max(0, durSec - t) * 22.0);
        const env = att * rel;

        // Natural 5.8 Hz crooner vibrato that blooms after 120ms + subtle scoop on attack
        const vibDepth = 0.014 * (1.0 - Math.exp(-t * 6.0));
        const scoop = -0.04 * Math.exp(-t * 24.0);
        const instFreq = p.f0 * (1.0 + scoop + vibDepth * Math.sin(2 * Math.PI * 5.8 * t));

        phase = (phase + instFreq / sr) % 1.0;

        // Rosenberg-style glottal pulse waveform + breathiness
        let glottal = 0;
        if (phase < 0.42) {
          const u = phase / 0.42;
          glottal = 3 * u * u - 2 * u * u * u;
        } else if (phase < 0.62) {
          const u = (phase - 0.42) / 0.20;
          glottal = 1.0 - u * u;
        }
        glottal -= 0.35; // remove DC offset
        const breath = (Math.random() * 2 - 1) * 0.06;
        const sourceExcitation = glottal + breath;

        // Pass through 3 parallel vocal tract formant resonators
        let vocalOut = 0;
        const weights = [1.0, 0.58, 0.24];
        for (let k = 0; k < 3; k++) {
          const fState = res[k];
          const y = fState.b0 * sourceExcitation - fState.a1 * fState.y1 - fState.a2 * fState.y2;
          fState.y2 = fState.y1;
          fState.y1 = y;
          vocalOut += y * weights[k];
        }

        data[startSample + n] += vocalOut * env * 0.42;
      }
    }
    return buf;
  }

  /**
   * Starts synchronized looping playback of all 4 stems (using custom buffer if loaded, else synthetic)
   */
  start() {
    this.stop();
    const now = this.ctx.currentTime + 0.02;

    for (let i = 0; i < 4; i++) {
      const node = this.ctx.createBufferSource();
      node.buffer = this.customBuffers[i] || this.syntheticBuffers[i];
      node.loop = true;
      node.connect(this.outputNodes[i]);
      node.start(now);
      this.activeBufferNodes.push(node);
    }

    this.isPlaying = true;
    this._updateGainRouting();
  }

  /**
   * Stops all playing stem buffer nodes
   */
  stop() {
    for (const node of this.activeBufferNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch (_) {
        // Ignore already stopped nodes
      }
    }
    this.activeBufferNodes = [];
    this.isPlaying = false;
  }

  /**
   * Decodes and assigns an uploaded audio file to one of the 4 stem slots (0..3)
   */
  async loadCustomStemFile(stemIndex, file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.customBuffers[stemIndex] = audioBuffer;
    this.sources[stemIndex].customFileName = file.name;

    if (this.isPlaying) {
      this.start();
    }
    return audioBuffer;
  }

  /**
   * Resets a stem slot back to the built-in procedural 1950s pattern
   */
  resetToSynthetic(stemIndex) {
    this.customBuffers[stemIndex] = null;
    this.sources[stemIndex].customFileName = null;
    if (this.isPlaying) {
      this.start();
    }
  }

  setMute(stemIndex, muted) {
    this.sources[stemIndex].muted = Boolean(muted);
    this._updateGainRouting();
  }

  setSolo(stemIndex, solo) {
    this.sources[stemIndex].solo = Boolean(solo);
    this._updateGainRouting();
  }

  _updateGainRouting() {
    const anySolo = this.sources.some((s) => s.solo);
    const now = this.ctx.currentTime;

    for (let i = 0; i < 4; i++) {
      const s = this.sources[i];
      let active = !s.muted;
      if (anySolo) {
        active = s.solo && !s.muted;
      }
      this.outputNodes[i].gain.setTargetAtTime(active ? 1.0 : 0.0, now, 0.015);
    }
  }
}

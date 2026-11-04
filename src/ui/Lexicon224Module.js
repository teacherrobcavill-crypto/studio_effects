/**
 * Lexicon224Module.js
 * Interactive Hardware Interface, Real-Time DSP Telemetry Visualizer,
 * and Right-Side Preset Algorithm & Signal Chain Explorer
 * Modeled after the 1978 Lexicon 224 Digital Reverberator & LARC Remote.
 */

import { Lexicon224AudioEngine } from '../audio/Lexicon224AudioEngine.js';
import { initDeclarativeTips } from './LearningTooltips.js';

/**
 * Plain-English Algorithm & Signal Chain Breakdown for each 224 Program Preset
 */
const PRESET_ALGORITHM_GUIDES = {
  'concert-hall': {
    code: 'PROGRAM 01 · CONCERT HALL A',
    title: 'Boston Symphony Hall Topology (David Griesinger 1978)',
    badge: 'LUSH CHORUSED HALL',
    summary:
      'Designed around Dr. David Griesinger’s measurements of Boston Symphony Hall. Uses a 35 ms pre-delay so vocals and instruments stay clear up front, followed by medium input diffusion (0.76) and deep 2.2 ms wandering delay modulation to eliminate metallic ringing and create an enveloping, concert-wide stereo tail.',
    chain: [
      {
        stage: '1. PRE-DELAY',
        val: '35 ms',
        desc: 'Separates direct dry sound from hall walls (Initial Time Delay Gap).'
      },
      {
        stage: '2. INPUT DIFFUSERS',
        val: '4× All-Pass (0.76)',
        desc: 'Softens sharp transients into a smooth early reflection cluster.'
      },
      {
        stage: '3. FDN-4 WANDERING TANKS',
        val: '0.75 Hz / 2.2 ms',
        desc: '4 delay loops modulated by quadrature LFOs using Hermite cubic reads.'
      },
      {
        stage: '4. HF AIR DAMPING',
        val: '4.2 kHz LPF',
        desc: 'One-pole low-pass filters absorb high frequencies on every pass (3.8s T60).'
      }
    ],
    basics: [
      {
        label: 'Why It Sounds Lush',
        text: 'Slow 0.75 Hz pitch drift continuously moves room resonant nodes so no single frequency ever rings out.'
      },
      {
        label: 'Best Studio Uses',
        text: 'Lead vocals, orchestral strings, grand piano, and 1980s synth brass (Vangelis / Blade Runner).'
      },
      {
        label: 'Quick Listening Tip',
        text: 'Try dropping MOD DEPTH to 0.0 ms while playing drums to hear how static and metallic a hall sounds without Griesinger’s wandering LFOs.'
      }
    ]
  },

  'vocal-plate': {
    code: 'PROGRAM 02 · VOCAL PLATE',
    title: 'Dense High-Diffusion Studio Plate Algorithm',
    badge: 'SILKY VOCAL HALO',
    summary:
      'Emulates the instant, ultra-dense reflection build-up of a tensioned metal plate (like the EMT-140) but with digital stereo decorrelation. Uses a tight 12 ms pre-delay, very high input diffusion (0.92), and bright 7.8 kHz damping so vocal sibilance and snare wire snap wrap smoothly around the stereo field.',
    chain: [
      {
        stage: '1. PRE-DELAY',
        val: '12 ms',
        desc: 'Tight gap gives immediate vocal intimacy without smearing consonant attacks.'
      },
      {
        stage: '2. INPUT DIFFUSERS',
        val: '4× All-Pass (0.92)',
        desc: 'Maximum all-pass coefficient multiplies echo density into an instant sheet.'
      },
      {
        stage: '3. FDN-4 WANDERING TANKS',
        val: '1.35 Hz / 0.9 ms',
        desc: 'Fast, shallow modulation keeps pitch rock-solid while preventing comb notches.'
      },
      {
        stage: '4. HF AIR DAMPING',
        val: '7.8 kHz LPF',
        desc: 'Bright top-end cutoff preserves airy vocal sheen over a focused 2.2s decay.'
      }
    ],
    basics: [
      {
        label: 'Plate vs. Hall',
        text: 'Plates reach full echo density almost instantaneously (0.92 diffusion), whereas Concert Halls build up gradually over 80–150 ms.'
      },
      {
        label: 'Best Studio Uses',
        text: 'Pop/rock lead vocals, acoustic snare drum, handclaps, and solo electric guitar.'
      },
      {
        label: 'Quick Listening Tip',
        text: 'Click ⚡ HIT SNARE and toggle between VOCAL PLATE and RICH CHAMBER to hear how 0.92 diffusion turns discrete echoes into pure silk.'
      }
    ]
  },

  'rich-chamber': {
    code: 'PROGRAM 03 · RICH CHAMBER',
    title: 'Acoustic Tile & Plaster Echo Chamber Topology',
    badge: 'WARM STUDIO ROOM',
    summary:
      'Models a classic underground studio echo chamber (like Capitol Records or Abbey Road Chamber 2). Lower input diffusion (0.65) preserves subtle, natural early wall reflections, while a short 1.6s decay and 5.6 kHz damping add three-dimensional weight without washing out busy mixes.',
    chain: [
      {
        stage: '1. PRE-DELAY',
        val: '18 ms',
        desc: 'Simulates a speaker & microphone placed 20 feet apart in a tiled room.'
      },
      {
        stage: '2. INPUT DIFFUSERS',
        val: '4× All-Pass (0.65)',
        desc: 'Moderate diffusion retains natural wood/plaster early reflection texture.'
      },
      {
        stage: '3. FDN-4 WANDERING TANKS',
        val: '0.90 Hz / 1.4 ms',
        desc: 'Gentle tank movement smooths out small-room boxy standing waves.'
      },
      {
        stage: '4. HF AIR DAMPING',
        val: '5.6 kHz LPF',
        desc: 'Natural high-frequency rolloff mimics shellacked plaster walls (1.6s T60).'
      }
    ],
    basics: [
      {
        label: 'Small Room Physics',
        text: 'Real acoustic chambers suffer from boxy standing modes below 300 Hz; the 224’s Householder matrix + 1.4 ms modulation erases that boxiness.'
      },
      {
        label: 'Best Studio Uses',
        text: 'Drum overheads, rhythm guitars, horn sections, and cohesive "glue" across an entire band bus.'
      },
      {
        label: 'Quick Listening Tip',
        text: 'Pull DIFFUSION down to 0.25 on drums to hear individual chamber wall reflections flutter before blending.'
      }
    ]
  },

  'large-acoustic': {
    code: 'PROGRAM 04 · LARGE ACOUSTIC',
    title: 'Cathedral & Stone Cavern Deep Absorption Network',
    badge: 'DARK CATHEDRAL',
    summary:
      'Simulates a massive stone cathedral with a wide 50 ms pre-delay and a monumental 6.8-second decay. Heavy high-frequency damping at 2.6 kHz models natural air absorption over long distances—highs vanish quickly while warm low-mid fundamental frequencies recirculate for seconds.',
    chain: [
      {
        stage: '1. PRE-DELAY',
        val: '50 ms',
        desc: 'Establishes vast physical distance (~17 meters) to the first stone boundary.'
      },
      {
        stage: '2. INPUT DIFFUSERS',
        val: '4× All-Pass (0.82)',
        desc: 'Builds a dense, billowing cloud of reflections from carved stone columns.'
      },
      {
        stage: '3. FDN-4 WANDERING TANKS',
        val: '0.45 Hz / 3.2 ms',
        desc: 'Slow, deep LFO excursion creates rolling, majestic spatial motion.'
      },
      {
        stage: '4. HF AIR DAMPING',
        val: '2.6 kHz LPF',
        desc: 'Steep HF roll-off leaves a warm, dark, velvety 6.8s low-mid tail.'
      }
    ],
    basics: [
      {
        label: 'Distance & Air Loss',
        text: 'In huge spaces, air molecules absorb treble energy rapidly. A 2.6 kHz loop filter means each recirculation gets progressively warmer and darker.'
      },
      {
        label: 'Best Studio Uses',
        text: 'Choirs, ambient pads, slow ballad snare hits, and cinematic sound design.'
      },
      {
        label: 'Quick Listening Tip',
        text: 'Switch the screen to FFT SPECTRUM and watch the high frequencies above the yellow 2.6 kHz cutoff line melt away into a warm bass cloud.'
      }
    ]
  },

  'infinite-bloom': {
    code: 'PROGRAM 05 · INFINITE BLOOM',
    title: 'High-Feedback Chorused Ambient Cloud Generator',
    badge: '14.5s AMBIENT CLOUD',
    summary:
      'Pushes the 4×4 unitary Householder feedback matrix near unity gain (14.5s T60) with wide 4.5 ms Hermite delay modulation. Incoming notes blossom into a self-sustaining, evolving synthesizer pad where harmonic overtones shimmer and weave across the left and right channels.',
    chain: [
      {
        stage: '1. PRE-DELAY',
        val: '60 ms',
        desc: 'Long swell onset lets the dry attack speak before the ambient bloom rises.'
      },
      {
        stage: '2. INPUT DIFFUSERS',
        val: '4× All-Pass (0.88)',
        desc: 'Smears every transient into a seamless, liquid harmonic sustain.'
      },
      {
        stage: '3. FDN-4 WANDERING TANKS',
        val: '0.60 Hz / 4.5 ms',
        desc: 'Wide 4.5 ms pitch-chorusing turns static chords into a living orchestra.'
      },
      {
        stage: '4. HF AIR DAMPING',
        val: '6.0 kHz LPF',
        desc: 'Open 6 kHz loop filter keeps upper harmonics shimmering for 14.5 seconds.'
      }
    ],
    basics: [
      {
        label: 'Unitary Matrix Stability',
        text: 'Because the 4×4 Householder matrix (H = I - 0.5·11ᵀ) is mathematically lossless, the 224 can sustain for 15+ seconds without exploding into feedback.'
      },
      {
        label: 'Best Studio Uses',
        text: 'Ambient soundscapes, Vangelis CS-80 swells, post-rock guitar textures, and freeze-tail transitions.'
      },
      {
        label: 'Quick Listening Tip',
        text: 'Select the Lush Breathy Vocal stem, press PLAY AUDIO for 2 seconds, then press STOP AUDIO and listen to the chord hang in the air for 14 seconds!'
      }
    ]
  }
};

export class Lexicon224Module {
  constructor(containerEl, options = {}) {
    if (!containerEl || !(containerEl instanceof HTMLElement)) {
      throw new Error('Lexicon224Module requires a valid HTMLElement container.');
    }

    this.containerEl = containerEl;
    this.options = options;
    this.engine = new Lexicon224AudioEngine(options);

    this.activePreset = 'concert-hall';
    this.visualizerMode = 'tail'; // 'tail' | 'spectrum'
    this.rafId = null;

    // Parameter state mirror
    this.params = {
      preDelay: 24.0,
      decay: 2.8,
      damping: 4500.0,
      diffusion: 0.72,
      modRate: 0.85,
      modDepth: 1.5,
      mix: 0.40,
      masterVol: 0.90,
      bypass: false
    };

    this.render();
    this.bindEvents();
    this.updatePresetGuideUI(this.activePreset);
    initDeclarativeTips(this.unitEl);
    this.startRenderLoop();

    // Listen for engine state changes
    this.engine.onPlayStateChange = (playing) => {
      this.updatePlayButtonUI(playing);
      if (this.options.onAudioStateChange) {
        this.options.onAudioStateChange(playing);
      }
    };
  }

  render() {
    const unit = document.createElement('section');
    unit.className = 'lex-root-wrapper';
    unit.innerHTML = `
      <div class="lex-workspace-grid">
        <!-- LEFT COLUMN: LARC Hardware Console -->
        <div class="lex-root">
          <!-- Top Status & Hardware Header -->
          <header class="lex-chassis-header">
            <div class="lex-brand">
              <div class="lex-badge">
                LEXICON 224
                <button type="button" class="edu-tip-badge edu-amber" data-edu-title="1978 Lexicon 224 Digital Reverberator" data-edu-tip="Introduced in 1978 and designed by Dr. David Griesinger, the Lexicon 224 brought world-class concert hall acoustics into a compact digital processor controlled by the iconic tabletop LARC (Lexicon Alphanumeric Remote Control). Click any '?' badge on the sliders or signal chain blocks to explore how each stage works!" data-edu-try="Select different Reverb Programs (01 to 05) and watch both the vertical sliders and the Right-Side Algorithm Explorer update in real time.">?</button>
              </div>
              <div class="lex-sub">DIGITAL REVERBERATOR · 1978 MICROPROCESSOR CONTROLLED SYSTEM</div>
            </div>
            <div class="lex-header-actions">
              <button id="lex-bypass-btn" class="lex-btn lex-btn-toggle" title="Toggle Hardware Reverb Bypass">
                <span class="lex-led-dot green active"></span>
                REVERB ACTIVE
              </button>
              <div class="lex-vol-wrap">
                <label>MASTER</label>
                <input id="lex-master-vol" type="range" min="0" max="1" step="0.01" value="0.90" title="Master Output Volume">
              </div>
            </div>
          </header>

          <!-- Main LARC Remote Console Section -->
          <div class="lex-console-body">
            <!-- Top Display & Telemetry Screen -->
            <div class="lex-screen-panel">
              <div class="lex-screen-topbar">
                <div class="lex-display-title">
                  <span class="lex-led-label">PROGRAM:</span>
                  <span id="lex-prog-name" class="lex-led-val-large">CONCERT HALL A</span>
                  <button type="button" class="edu-tip-badge edu-amber" data-edu-title="1978 Lexicon 224 Architecture" data-edu-tip="Its iconic sound comes from wandering delay lines modulated by low-frequency LFOs inside a 4-channel circulating matrix, preventing modal resonances and metallic flutter." data-edu-try="Turn the 'MOD DEPTH' slider up to 4ms and listen to the lush chorused tail, then set it to 0ms to hear how metallic the reverb becomes without wandering delay lines!">?</button>
                </div>

                <!-- Visualizer Mode Tabs & LFO status -->
                <div class="lex-screen-controls">
                  <div class="lex-lfo-indicator" title="4-Phase Wandering LFO Modulator Orbits">
                    <span class="lfo-label">LFO TANK DRIFT:</span>
                    <span id="lfo-dot-0" class="lfo-dot"></span>
                    <span id="lfo-dot-1" class="lfo-dot"></span>
                    <span id="lfo-dot-2" class="lfo-dot"></span>
                    <span id="lfo-dot-3" class="lfo-dot"></span>
                  </div>
                  <div class="lex-btn-group">
                    <button id="btn-vis-tail" class="lex-screen-btn active">REVERB TAIL</button>
                    <button id="btn-vis-spectrum" class="lex-screen-btn">FFT SPECTRUM</button>
                  </div>
                </div>
              </div>

              <!-- Canvas Visualizer -->
              <div class="lex-canvas-wrapper">
                <canvas id="lex-visualizer-canvas" width="860" height="185"></canvas>
                <div class="lex-meter-overlay">
                  <div class="meter-col">
                    <span class="meter-lbl">IN L/R</span>
                    <div class="meter-bar-track"><div id="meter-in" class="meter-bar-fill"></div></div>
                  </div>
                  <div class="meter-col">
                    <span class="meter-lbl">WET L/R</span>
                    <div class="meter-bar-track"><div id="meter-out" class="meter-bar-fill"></div></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Hardware Program Selector Buttons (LARC Style) -->
            <div class="lex-program-rack">
              <span class="rack-label">
                REVERB PROGRAMS (CLICK TO LOAD ALGORITHM &amp; VIEW SIGNAL CHAIN →)
              </span>
              <div class="lex-program-buttons">
                <button class="lex-prog-btn active" data-preset="concert-hall">
                  <span class="prog-num">01</span>
                  <span class="prog-txt">CONCERT HALL A</span>
                </button>
                <button class="lex-prog-btn" data-preset="vocal-plate">
                  <span class="prog-num">02</span>
                  <span class="prog-txt">VOCAL PLATE</span>
                </button>
                <button class="lex-prog-btn" data-preset="rich-chamber">
                  <span class="prog-num">03</span>
                  <span class="prog-txt">RICH CHAMBER</span>
                </button>
                <button class="lex-prog-btn" data-preset="large-acoustic">
                  <span class="prog-num">04</span>
                  <span class="prog-txt">LARGE ACOUSTIC</span>
                </button>
                <button class="lex-prog-btn" data-preset="infinite-bloom">
                  <span class="prog-num">05</span>
                  <span class="prog-txt">INFINITE BLOOM</span>
                </button>
              </div>
            </div>

            <!-- 7-Fader Slider Bank with LED Readouts -->
            <div class="lex-faders-bank">
              <!-- 1. Pre-Delay -->
              <div class="lex-fader-cell" data-fader-stage="preDelay">
                <div class="fader-display">
                  <span id="disp-preDelay" class="led-num">24</span>
                  <span class="led-unit">MS</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-preDelay" class="lex-slider" type="range" min="0" max="200" step="1" value="24" orient="vertical">
                </div>
                <label class="fader-label">
                  PRE-DELAY
                  <button type="button" class="edu-tip-badge" data-edu-title="Pre-Delay Line (ITDG)" data-edu-tip="Pre-delay is a circular delay buffer before the reverb tank that separates the direct dry sound from the onset of reverberation, preserving vocal diction and drum punch before the wet space blooms." data-edu-try="Set Pre-Delay to 80ms on vocals to keep the singer right in front of the speakers while bathed in a cavernous hall.">?</button>
                </label>
              </div>

              <!-- 2. Reverb Decay -->
              <div class="lex-fader-cell" data-fader-stage="decay">
                <div class="fader-display">
                  <span id="disp-decay" class="led-num">2.8</span>
                  <span class="led-unit">SEC</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-decay" class="lex-slider" type="range" min="0.2" max="15.0" step="0.1" value="2.8" orient="vertical">
                </div>
                <label class="fader-label">
                  REVERB TIME
                  <button type="button" class="edu-tip-badge" data-edu-title="T60 Decay Time (Feedback Scalar)" data-edu-tip="Calculates the exact per-sample loop attenuation scalar g = 10^(-3 * Delay / (T60 * fs)) so the circulating energy decays by 60 dB over this duration." data-edu-try="Try setting Reverb Time to 12s on Infinite Bloom to create an evolving ambient cloud.">?</button>
                </label>
              </div>

              <!-- 3. HF Damping -->
              <div class="lex-fader-cell" data-fader-stage="damping">
                <div class="fader-display">
                  <span id="disp-damping" class="led-num">4.5</span>
                  <span class="led-unit">KHZ</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-damping" class="lex-slider" type="range" min="500" max="18000" step="100" value="4500" orient="vertical">
                </div>
                <label class="fader-label">
                  HF DAMPING
                  <button type="button" class="edu-tip-badge" data-edu-title="High-Frequency Absorption" data-edu-tip="Simulates the acoustic absorption of air and porous hall materials using one-pole low-pass filters inside each feedback loop. High frequencies decay faster than lows, creating warm, natural depth." data-edu-try="Pull HF Damping down to 1.2 kHz for a dark, warm vintage 1970s concert hall tone.">?</button>
                </label>
              </div>

              <!-- 4. Diffusion -->
              <div class="lex-fader-cell" data-fader-stage="diffusion">
                <div class="fader-display">
                  <span id="disp-diffusion" class="led-num">0.72</span>
                  <span class="led-unit">AP</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-diffusion" class="lex-slider" type="range" min="0.0" max="0.99" step="0.01" value="0.72" orient="vertical">
                </div>
                <label class="fader-label">
                  DIFFUSION
                  <button type="button" class="edu-tip-badge" data-edu-title="Input Diffusion Cascade" data-edu-tip="Controls reflection density via 4 cascaded All-Pass filters with prime-number sample delays (142, 107, 379, 277). Higher diffusion creates a smooth, dense wash; lower diffusion reveals distinct early reflections." data-edu-try="Set Diffusion to 0.10 on drums to hear discrete echo flutter reflections, then push to 0.95 for instant smooth silk.">?</button>
                </label>
              </div>

              <!-- 5. Modulation Rate -->
              <div class="lex-fader-cell" data-fader-stage="modRate">
                <div class="fader-display">
                  <span id="disp-modRate" class="led-num">0.85</span>
                  <span class="led-unit">HZ</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-modRate" class="lex-slider" type="range" min="0.10" max="4.00" step="0.05" value="0.85" orient="vertical">
                </div>
                <label class="fader-label">
                  MOD RATE
                  <button type="button" class="edu-tip-badge" data-edu-title="LFO Wandering Rate" data-edu-tip="The frequency of the dual-quadrature wandering LFOs that move the fractional delay pointers across irrational ratios, continually smearing resonant modes." data-edu-try="Adjust Mod Rate between 0.5 Hz and 2.0 Hz to hear the chorusing pitch shimmer speed up without phase cancellation.">?</button>
                </label>
              </div>

              <!-- 6. Modulation Depth -->
              <div class="lex-fader-cell" data-fader-stage="modDepth">
                <div class="fader-display">
                  <span id="disp-modDepth" class="led-num">1.5</span>
                  <span class="led-unit">MS</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-modDepth" class="lex-slider" type="range" min="0.0" max="6.0" step="0.1" value="1.5" orient="vertical">
                </div>
                <label class="fader-label">
                  MOD DEPTH
                  <button type="button" class="edu-tip-badge" data-edu-title="Hermite Modulated Fractional Delay" data-edu-tip="The peak excursion of delay line modulation in milliseconds. 4-point Hermite cubic interpolation calculates the fractional sample reads with zero zipper noise." data-edu-try="Crank Mod Depth to 5.0ms on synth chords to experience the iconic rich 1980s Blade Runner / Vangelis reverb tail!">?</button>
                </label>
              </div>

              <!-- 7. Wet / Dry Mix -->
              <div class="lex-fader-cell" data-fader-stage="mix">
                <div class="fader-display">
                  <span id="disp-mix" class="led-num">40</span>
                  <span class="led-unit">%</span>
                </div>
                <div class="fader-track-wrap">
                  <input id="slider-mix" class="lex-slider" type="range" min="0" max="100" step="1" value="40" orient="vertical">
                </div>
                <label class="fader-label">
                  WET / DRY
                  <button type="button" class="edu-tip-badge" data-edu-title="Equal-Power Mix" data-edu-tip="Crossfades dry input and wet reverberation along a constant-power sinusoidal curve so perceived acoustic loudness remains steady across 0% to 100%." data-edu-try="Set to 100% to hear the pure reverberant soundfield with zero direct source signal.">?</button>
                </label>
              </div>
            </div>

            <!-- Bottom Audio Source Transport & Audition Deck -->
            <div class="lex-transport-deck">
              <div class="transport-stem-select">
                <label class="transport-lbl">AUDIO SOURCE:</label>
                <select id="lex-stem-select" class="lex-select">
                  <option value="drums">🎧 1980s Acoustic Drum Pattern (Townhouse Style)</option>
                  <option value="vocal">🎙️ Lush Breathy Vocal &amp; Synth Pad</option>
                  <option value="calibration">📐 Studio Dynamic Calibration Staircase</option>
                </select>
                <button id="lex-play-btn" class="lex-btn lex-btn-play">
                  <span class="icon">▶</span> <span id="lex-play-txt">PLAY AUDIO</span>
                </button>
              </div>

              <div class="transport-audition-actions">
                <button id="btn-hit-snare" class="lex-btn lex-btn-accent" title="Trigger single 1980s snare transient hit">
                  ⚡ HIT SNARE
                </button>
                <button id="btn-hit-impulse" class="lex-btn" title="Trigger 1-sample Dirac impulse delta function">
                  💥 DIRAC IMPULSE
                </button>
                <label class="lex-btn lex-btn-file" title="Load your own audio file (.wav, .mp3, .ogg)">
                  📁 DROP AUDIO FILE
                  <input id="lex-file-input" type="file" accept="audio/*" style="display:none;">
                </label>
              </div>
            </div>

            <!-- Deep Educational Foldable Notes -->
            <details class="edu-foldable edu-cyan lex-edu-drawer">
              <summary>
                <span class="edu-foldable-title">
                  <span class="edu-foldable-tag">DSP MATHEMATICS</span>
                  <span>The Mathematical Innovation of the Lexicon 224 Reverb</span>
                </span>
                <span class="edu-foldable-chevron">▼</span>
              </summary>
              <div class="edu-foldable-body">
                <div class="edu-grid-2col">
                  <div>
                    <h4>1. The Modal Resonance Problem &amp; Wandering Delays</h4>
                    <p>In standard fixed-length comb filter networks (Schroeder reverbs), recirculating impulses create repetitive frequency modes that ring like a metallic pipe. David Griesinger solved this by continuously modulating the delay length of the feedback lines using slow, decorrelated quadrature LFOs. Because the delay lengths never stand still, modal buildup cannot stabilize, producing a lush, silky sound that breathes.</p>
                  </div>
                  <div>
                    <h4>2. 4×4 Unitary Householder Matrix &amp; Zero-GC Hermite DSP</h4>
                    <p>To cross-couple the 4 delay tanks without gaining or losing energy, the 224 uses a unitary Householder reflection matrix: <code>y[i] = x[i] - 0.5 * sum(x)</code>. This distributes every reflection equally into all tanks in O(N) operations. Because delay pointers vary continuously by fractional samples, 4-point 3rd-order Hermite cubic interpolation is computed per sample on the audio thread with zero memory allocations.</p>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <!-- RIGHT COLUMN: Simplified Algorithm, Signal Chain & Preset Basics Panel -->
        <aside class="lex-algo-sidebar" aria-label="Preset Algorithm & Signal Chain Guide">
          <div class="algo-sidebar-header">
            <div class="algo-header-top">
              <span class="algo-eyebrow">ALGORITHMIC TOPOLOGY GUIDE</span>
              <span id="algo-preset-badge" class="algo-badge">LUSH CHORUSED HALL</span>
            </div>
            <h3 id="algo-preset-code" class="algo-code">PROGRAM 01 · CONCERT HALL A</h3>
            <div id="algo-preset-title" class="algo-subtitle">Boston Symphony Hall Topology (David Griesinger 1978)</div>
          </div>

          <p id="algo-preset-summary" class="algo-summary"></p>

          <!-- Interactive Signal Chain Block Diagram -->
          <div class="algo-section">
            <div class="algo-section-head">
              <span>SIGNAL CHAIN FLOW (CLICK BLOCK TO HIGHLIGHT FADER)</span>
              <button type="button" class="edu-tip-badge" data-edu-title="How the 224 Signal Chain Works" data-edu-tip="Every Lexicon 224 preset uses the same core 5-stage topology, but drastically reshapes the room geometry by changing the Pre-Delay gap, All-Pass Diffusion coefficient, Tank LFO excursion, and High-Frequency Damping filter." data-edu-try="Click any of the signal chain blocks below to highlight the corresponding hardware fader on the LARC console!">?</button>
            </div>

            <div class="algo-chain-flow">
              <button type="button" class="chain-node" data-highlight-fader="preDelay">
                <div class="chain-node-top">
                  <span class="chain-step">STAGE 1 · PRE-DELAY</span>
                  <span id="chain-val-preDelay" class="chain-live-pill">24 ms</span>
                </div>
                <div id="chain-desc-0" class="chain-node-desc">Separates dry sound from hall walls (ITDG).</div>
              </button>

              <div class="chain-arrow">↓</div>

              <button type="button" class="chain-node" data-highlight-fader="diffusion">
                <div class="chain-node-top">
                  <span class="chain-step">STAGE 2 · 4× ALL-PASS DIFFUSERS</span>
                  <span id="chain-val-diffusion" class="chain-live-pill">0.72 AP</span>
                </div>
                <div id="chain-desc-1" class="chain-node-desc">Prime-sample delays (142, 107, 379, 277) multiply echo density.</div>
              </button>

              <div class="chain-arrow">↓</div>

              <button type="button" class="chain-node chain-node-tank" data-highlight-fader="modDepth">
                <div class="chain-node-top">
                  <span class="chain-step">STAGE 3 · 4-TANK FDN + LFO CHORUS</span>
                  <span id="chain-val-mod" class="chain-live-pill">0.85 Hz · 1.5 ms</span>
                </div>
                <div id="chain-desc-2" class="chain-node-desc">Wandering Hermite delay lines + 4×4 Householder feedback matrix.</div>
              </button>

              <div class="chain-arrow">↺ <span class="loop-tag">FEEDBACK LOOP</span> ↓</div>

              <button type="button" class="chain-node" data-highlight-fader="damping">
                <div class="chain-node-top">
                  <span class="chain-step">STAGE 4 · HF DAMPING &amp; T60 DECAY</span>
                  <span id="chain-val-damp" class="chain-live-pill">4.5 kHz · 2.8s</span>
                </div>
                <div id="chain-desc-3" class="chain-node-desc">One-pole low-pass absorption filter + T60 loop gain scalar.</div>
              </button>

              <div class="chain-arrow">↓</div>

              <button type="button" class="chain-node" data-highlight-fader="mix">
                <div class="chain-node-top">
                  <span class="chain-step">STAGE 5 · STEREO TAP MATRIX</span>
                  <span id="chain-val-mix" class="chain-live-pill">40% MIX</span>
                </div>
                <div class="chain-node-desc">Decorrelated L/R cross-summing (+T0 ∓T1 ±T2 -T3) &amp; equal-power mix.</div>
              </button>
            </div>
          </div>

          <!-- Plain-English Basics Cards for the Active Preset -->
          <div class="algo-section">
            <div class="algo-section-head">
              <span>PRESET BASICS &amp; STUDIO CHEAT SHEET</span>
            </div>
            <div id="algo-basics-list" class="algo-basics-list"></div>
          </div>
        </aside>
      </div>
    `;

    this.unitEl = unit;
    this.containerEl.appendChild(unit);
    this.injectStyles();
    this.canvas = this.unitEl.querySelector('#lex-visualizer-canvas');
    this.canvasCtx = this.canvas.getContext('2d');
  }

  injectStyles() {
    if (document.getElementById('lexicon-224-styles')) return;
    const style = document.createElement('style');
    style.id = 'lexicon-224-styles';
    style.textContent = `
      .lex-root-wrapper {
        width: 100%;
        max-width: 1360px;
        margin: 0 auto;
      }
      .lex-workspace-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.65fr) minmax(320px, 1fr);
        gap: 16px;
        align-items: start;
        width: 100%;
      }
      .lex-root {
        display: flex;
        flex-direction: column;
        width: 100%;
        background: #17181d;
        border: 2px solid #2d303b;
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
        overflow: hidden;
      }
      .lex-chassis-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 18px;
        background: linear-gradient(180deg, #252833 0%, #1b1c24 100%);
        border-bottom: 2px solid #2d303b;
      }
      .lex-brand {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lex-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: 'Courier New', Courier, monospace;
        font-size: 19px;
        font-weight: 900;
        letter-spacing: 3px;
        color: #38bdf8;
        text-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
      }
      .lex-sub {
        font-size: 9.5px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 1.2px;
      }
      .lex-header-actions {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .lex-vol-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
      }
      .lex-vol-wrap input[type=range] {
        width: 90px;
        accent-color: #38bdf8;
      }
      .lex-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: all 0.15s ease;
        border: 1px solid #475569;
        background: #2a2d39;
        color: #f1f5f9;
      }
      .lex-btn:hover {
        background: #383d4e;
        border-color: #64748b;
      }
      .lex-btn-toggle.bypassed {
        border-color: #ef4444;
        color: #fca5a5;
        background: rgba(239, 68, 68, 0.15);
      }
      .lex-btn-play {
        background: rgba(56, 189, 248, 0.16);
        border-color: #38bdf8;
        color: #38bdf8;
      }
      .lex-btn-play.playing {
        background: #38bdf8;
        color: #0b0f19;
        box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
      }
      .lex-btn-accent {
        background: rgba(255, 146, 43, 0.2);
        border-color: #ff922b;
        color: #ffd8a8;
      }
      .lex-btn-accent:hover {
        background: #ff922b;
        color: #111;
      }
      .lex-led-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #334155;
      }
      .lex-led-dot.green.active {
        background: #22c55e;
        box-shadow: 0 0 8px #22c55e;
      }
      .lex-led-dot.red.active {
        background: #ef4444;
        box-shadow: 0 0 8px #ef4444;
      }

      /* Console Body */
      .lex-console-body {
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* Screen Panel */
      .lex-screen-panel {
        background: #0c0d12;
        border: 2px solid #232733;
        border-radius: 8px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8);
      }
      .lex-screen-topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #1e222e;
        padding-bottom: 8px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .lex-display-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .lex-led-label {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 1px;
      }
      .lex-led-val-large {
        font-family: 'Courier New', Courier, monospace;
        font-size: 17px;
        font-weight: 900;
        color: #f43f5e;
        text-shadow: 0 0 10px rgba(244, 63, 94, 0.6);
        letter-spacing: 2px;
      }
      .lex-screen-controls {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .lex-lfo-indicator {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .lfo-label {
        font-size: 10px;
        color: #64748b;
        font-weight: 700;
      }
      .lfo-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #1e293b;
        transition: all 0.08s ease;
      }
      .lfo-dot.lit {
        background: #38bdf8;
        box-shadow: 0 0 6px #38bdf8;
      }
      .lex-btn-group {
        display: flex;
        gap: 2px;
        background: #1a1c24;
        border-radius: 4px;
        padding: 2px;
        border: 1px solid #334155;
      }
      .lex-screen-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 10px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 3px;
        cursor: pointer;
      }
      .lex-screen-btn.active {
        background: #38bdf8;
        color: #0b0f19;
      }
      .lex-canvas-wrapper {
        position: relative;
        width: 100%;
        height: 185px;
        background: #08090d;
        border-radius: 6px;
        overflow: hidden;
      }
      #lex-visualizer-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .lex-meter-overlay {
        position: absolute;
        top: 10px;
        right: 12px;
        display: flex;
        gap: 10px;
        background: rgba(12, 14, 20, 0.85);
        padding: 6px 8px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .meter-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .meter-lbl {
        font-size: 8.5px;
        font-weight: 800;
        color: #64748b;
        letter-spacing: 0.5px;
      }
      .meter-bar-track {
        width: 8px;
        height: 60px;
        background: #1e2230;
        border-radius: 2px;
        position: relative;
        overflow: hidden;
      }
      .meter-bar-fill {
        width: 100%;
        height: 0%;
        position: absolute;
        bottom: 0;
        background: linear-gradient(180deg, #ef4444 0%, #eab308 25%, #22c55e 100%);
        transition: height 0.06s ease;
      }

      /* Program Selector Rack */
      .lex-program-rack {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rack-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: #94a3b8;
      }
      .lex-program-buttons {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
      }
      .lex-prog-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 9px 6px;
        background: #1e212b;
        border: 1px solid #363b4d;
        border-radius: 6px;
        color: #94a3b8;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .lex-prog-btn:hover {
        background: #272b38;
        border-color: #38bdf8;
        color: #e2e8f0;
      }
      .lex-prog-btn.active {
        background: linear-gradient(180deg, #1e3a5f 0%, #17253a 100%);
        border-color: #38bdf8;
        color: #ffffff;
        box-shadow: 0 0 14px rgba(56, 189, 248, 0.35);
      }
      .prog-num {
        font-family: 'Courier New', Courier, monospace;
        font-size: 10px;
        font-weight: 800;
        color: #f43f5e;
      }
      .lex-prog-btn.active .prog-num {
        color: #38bdf8;
      }
      .prog-txt {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.4px;
      }

      /* Fader Bank */
      .lex-faders-bank {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 8px;
        background: #13141a;
        padding: 12px 8px;
        border: 1px solid #282c38;
        border-radius: 8px;
      }
      .lex-fader-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 4px 2px;
        border-radius: 6px;
        border: 1px solid transparent;
        transition: all 0.2s ease;
      }
      .lex-fader-cell.fader-highlight {
        border-color: #38bdf8;
        background: rgba(56, 189, 248, 0.08);
        box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
      }
      .fader-display {
        background: #090a0e;
        border: 1px solid #242834;
        border-radius: 4px;
        padding: 4px 6px;
        width: 72px;
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .led-num {
        font-family: 'Courier New', Courier, monospace;
        font-size: 13px;
        font-weight: 800;
        color: #f43f5e;
        text-shadow: 0 0 8px rgba(244, 63, 94, 0.5);
      }
      .led-unit {
        font-size: 8.5px;
        font-weight: 700;
        color: #64748b;
      }
      .fader-track-wrap {
        height: 150px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #191b22;
        border-radius: 4px;
        padding: 10px 4px;
        box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.7);
      }
      .lex-slider {
        -webkit-appearance: slider-vertical;
        writing-mode: bt-lr;
        width: 24px;
        height: 130px;
        cursor: pointer;
        accent-color: #38bdf8;
      }
      .fader-label {
        font-size: 9px;
        font-weight: 800;
        color: #94a3b8;
        letter-spacing: 0.4px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Transport Deck */
      .lex-transport-deck {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: #1b1d25;
        border: 1px solid #2d313e;
        border-radius: 6px;
        gap: 10px;
        flex-wrap: wrap;
      }
      .transport-stem-select {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .transport-lbl {
        font-size: 10px;
        font-weight: 800;
        color: #94a3b8;
      }
      .lex-select {
        background: #0f1015;
        border: 1px solid #3b4252;
        color: #f1f5f9;
        font-size: 11px;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .transport-audition-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      /* Foldable Educational Drawer */
      .lex-edu-drawer {
        margin-top: 2px;
      }
      .edu-grid-2col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .edu-grid-2col h4 {
        color: #38bdf8;
        margin-bottom: 4px;
        font-size: 11.5px;
      }
      .edu-grid-2col code {
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        padding: 1px 4px;
        border-radius: 3px;
        font-family: ui-monospace, monospace;
      }

      /* =========================================================
         RIGHT-SIDE SIMPLIFIED ALGORITHM & SIGNAL CHAIN SIDEBAR
         ========================================================= */
      .lex-algo-sidebar {
        background: linear-gradient(180deg, #161922 0%, #11131a 100%);
        border: 2px solid #293040;
        border-radius: 10px;
        padding: 14px 15px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.65);
        color: #e2e8f0;
      }
      .algo-sidebar-header {
        border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        padding-bottom: 10px;
      }
      .algo-header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }
      .algo-eyebrow {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 9.5px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .algo-badge {
        padding: 2px 7px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.14);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #38bdf8;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 9.5px;
        font-weight: 800;
      }
      .algo-code {
        font-family: 'Courier New', Courier, monospace;
        font-size: 15px;
        font-weight: 900;
        color: #f43f5e;
        letter-spacing: 1px;
        margin: 0 0 2px 0;
      }
      .algo-subtitle {
        font-size: 11.5px;
        font-weight: 700;
        color: #f8fafc;
      }
      .algo-summary {
        font-size: 11.5px;
        line-height: 1.48;
        color: #cbd5e1;
        background: rgba(9, 11, 16, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-left: 3px solid #38bdf8;
        padding: 8px 10px;
        border-radius: 6px;
        margin: 0;
      }
      .algo-section {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .algo-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      .algo-chain-flow {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .chain-node {
        width: 100%;
        text-align: left;
        background: #1a1e29;
        border: 1px solid #2e3546;
        border-radius: 6px;
        padding: 7px 10px;
        cursor: pointer;
        transition: all 0.15s ease;
        color: #e2e8f0;
      }
      .chain-node:hover,
      .chain-node.active-node {
        border-color: #38bdf8;
        background: #1f2737;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
      }
      .chain-node-tank {
        border-left: 3px solid #f43f5e;
      }
      .chain-node-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 3px;
      }
      .chain-step {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 10px;
        font-weight: 800;
        color: #38bdf8;
      }
      .chain-node-tank .chain-step {
        color: #fb7185;
      }
      .chain-live-pill {
        font-family: 'Courier New', Courier, monospace;
        font-size: 10.5px;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 4px;
        background: #090b10;
        border: 1px solid rgba(244, 63, 94, 0.4);
        color: #f43f5e;
      }
      .chain-node-desc {
        font-size: 10.8px;
        line-height: 1.35;
        color: #94a3b8;
      }
      .chain-arrow {
        text-align: center;
        font-size: 10px;
        line-height: 1;
        color: #38bdf8;
        font-family: ui-monospace, monospace;
        padding: 1px 0;
      }
      .loop-tag {
        font-size: 8.5px;
        color: #fb7185;
        letter-spacing: 0.06em;
        font-weight: 800;
      }

      /* Basics Cards */
      .algo-basics-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .algo-basic-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-left: 3px solid #ffb74d;
        border-radius: 5px;
        padding: 6px 9px;
        font-size: 11px;
        line-height: 1.4;
        color: #dbeafe;
      }
      .algo-basic-card strong {
        display: block;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 10px;
        color: #ffd8a8;
        text-transform: uppercase;
        margin-bottom: 2px;
      }

      @media (max-width: 1120px) {
        .lex-workspace-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 780px) {
        .lex-faders-bank { grid-template-columns: repeat(4, 1fr); }
        .lex-program-buttons { grid-template-columns: repeat(3, 1fr); }
        .lex-transport-deck { flex-direction: column; align-items: stretch; }
        .edu-grid-2col { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  updatePresetGuideUI(presetKey) {
    const guide = PRESET_ALGORITHM_GUIDES[presetKey] || PRESET_ALGORITHM_GUIDES['concert-hall'];
    if (!this.unitEl || !guide) return;

    const badgeEl = this.unitEl.querySelector('#algo-preset-badge');
    const codeEl = this.unitEl.querySelector('#algo-preset-code');
    const titleEl = this.unitEl.querySelector('#algo-preset-title');
    const sumEl = this.unitEl.querySelector('#algo-preset-summary');
    const basicsEl = this.unitEl.querySelector('#algo-basics-list');

    if (badgeEl) badgeEl.textContent = guide.badge;
    if (codeEl) codeEl.textContent = guide.code;
    if (titleEl) titleEl.textContent = guide.title;
    if (sumEl) sumEl.textContent = guide.summary;

    guide.chain.forEach((step, idx) => {
      const descEl = this.unitEl.querySelector(`#chain-desc-${idx}`);
      if (descEl) descEl.textContent = step.desc;
    });

    if (basicsEl) {
      basicsEl.innerHTML = guide.basics
        .map(
          (b) => `
          <div class="algo-basic-card">
            <strong>${b.label}</strong>
            <span>${b.text}</span>
          </div>
        `
        )
        .join('');
    }

    this.syncLiveSignalChainPills();
  }

  syncLiveSignalChainPills() {
    if (!this.unitEl) return;
    const pdEl = this.unitEl.querySelector('#chain-val-preDelay');
    const diffEl = this.unitEl.querySelector('#chain-val-diffusion');
    const modEl = this.unitEl.querySelector('#chain-val-mod');
    const dampEl = this.unitEl.querySelector('#chain-val-damp');
    const mixEl = this.unitEl.querySelector('#chain-val-mix');

    if (pdEl) pdEl.textContent = `${Math.round(this.params.preDelay)} ms`;
    if (diffEl) diffEl.textContent = `${Number(this.params.diffusion).toFixed(2)} AP`;
    if (modEl) {
      modEl.textContent = `${Number(this.params.modRate).toFixed(2)} Hz · ${Number(
        this.params.modDepth
      ).toFixed(1)} ms`;
    }
    if (dampEl) {
      dampEl.textContent = `${(this.params.damping / 1000).toFixed(1)} kHz · ${Number(
        this.params.decay
      ).toFixed(1)}s`;
    }
    if (mixEl) mixEl.textContent = `${Math.round(this.params.mix * 100)}% MIX`;
  }

  highlightFaderCell(stageName) {
    if (!this.unitEl) return;
    this.unitEl.querySelectorAll('.lex-fader-cell').forEach((cell) => {
      const isMatch = cell.getAttribute('data-fader-stage') === stageName;
      cell.classList.toggle('fader-highlight', isMatch);
    });
    this.unitEl.querySelectorAll('.chain-node').forEach((node) => {
      const isMatch = node.getAttribute('data-highlight-fader') === stageName;
      node.classList.toggle('active-node', isMatch);
    });
  }

  bindEvents() {
    // 1. Program Presets
    const progButtons = this.unitEl.querySelectorAll('.lex-prog-btn');
    const progNameDisplay = this.unitEl.querySelector('#lex-prog-name');
    progButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        this.activePreset = preset;
        progButtons.forEach((b) => b.classList.toggle('active', b === btn));
        progNameDisplay.textContent = btn.querySelector('.prog-txt').textContent;

        const cfg = this.engine.applyPreset(preset);
        if (cfg) {
          Object.assign(this.params, cfg);
          this.syncSlidersFromParams();
        }
        this.updatePresetGuideUI(preset);
      });
    });

    // 2. Interactive Signal Chain Block Click -> Highlight Corresponding Fader
    this.unitEl.querySelectorAll('.chain-node').forEach((node) => {
      node.addEventListener('click', () => {
        const targetStage = node.getAttribute('data-highlight-fader');
        this.highlightFaderCell(targetStage);
      });
    });

    // 3. Sliders
    const bindSlider = (id, paramKey, scale = 1, isKhz = false) => {
      const slider = this.unitEl.querySelector(`#slider-${id}`);
      const disp = this.unitEl.querySelector(`#disp-${id}`);
      if (!slider || !disp) return;

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.params[paramKey] = val;
        this.engine.setParam(paramKey, val);

        if (isKhz) {
          disp.textContent = (val / 1000).toFixed(1);
        } else if (scale === 1 && Number.isInteger(val)) {
          disp.textContent = val.toString();
        } else {
          disp.textContent = val.toFixed(scale);
        }
        this.syncLiveSignalChainPills();
        this.highlightFaderCell(paramKey);
      });
    };

    bindSlider('preDelay', 'preDelay', 0);
    bindSlider('decay', 'decay', 1);
    bindSlider('damping', 'damping', 1, true);
    bindSlider('diffusion', 'diffusion', 2);
    bindSlider('modRate', 'modRate', 2);
    bindSlider('modDepth', 'modDepth', 1);

    // Wet/dry mix slider
    const mixSlider = this.unitEl.querySelector('#slider-mix');
    const mixDisp = this.unitEl.querySelector('#disp-mix');
    mixSlider.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value);
      this.params.mix = pct / 100.0;
      this.engine.setParam('mix', this.params.mix);
      mixDisp.textContent = Math.round(pct).toString();
      this.syncLiveSignalChainPills();
      this.highlightFaderCell('mix');
    });

    // Master volume
    const masterVol = this.unitEl.querySelector('#lex-master-vol');
    masterVol.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.params.masterVol = v;
      if (this.engine.masterGainNode) {
        this.engine.masterGainNode.gain.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02);
      }
    });

    // Bypass toggle
    const bypassBtn = this.unitEl.querySelector('#lex-bypass-btn');
    bypassBtn.addEventListener('click', () => {
      this.params.bypass = !this.params.bypass;
      this.engine.setParam('bypass', this.params.bypass ? 1.0 : 0.0);
      bypassBtn.classList.toggle('bypassed', this.params.bypass);
      const dot = bypassBtn.querySelector('.lex-led-dot');
      if (this.params.bypass) {
        dot.className = 'lex-led-dot red active';
        bypassBtn.lastChild.textContent = ' REVERB BYPASSED';
      } else {
        dot.className = 'lex-led-dot green active';
        bypassBtn.lastChild.textContent = ' REVERB ACTIVE';
      }
    });

    // Visualizer tabs
    const btnTail = this.unitEl.querySelector('#btn-vis-tail');
    const btnSpec = this.unitEl.querySelector('#btn-vis-spectrum');
    btnTail.addEventListener('click', () => {
      this.visualizerMode = 'tail';
      btnTail.classList.add('active');
      btnSpec.classList.remove('active');
    });
    btnSpec.addEventListener('click', () => {
      this.visualizerMode = 'spectrum';
      btnSpec.classList.add('active');
      btnTail.classList.remove('active');
    });

    // Audio Play / Stem Transport
    const playBtn = this.unitEl.querySelector('#lex-play-btn');
    const stemSelect = this.unitEl.querySelector('#lex-stem-select');
    playBtn.addEventListener('click', async () => {
      if (this.engine.isPlaying) {
        this.engine.stopStem();
      } else {
        const stemId = stemSelect.value;
        await this.engine.playStem(stemId);
      }
    });

    stemSelect.addEventListener('change', () => {
      if (this.engine.isPlaying) {
        this.engine.playStem(stemSelect.value);
      }
    });

    // Instant Auditions
    const hitSnareBtn = this.unitEl.querySelector('#btn-hit-snare');
    hitSnareBtn.addEventListener('click', () => {
      this.engine.triggerSnareHit();
    });

    const hitImpulseBtn = this.unitEl.querySelector('#btn-hit-impulse');
    hitImpulseBtn.addEventListener('click', () => {
      this.engine.triggerDiracImpulse();
    });

    // Custom Audio File
    const fileInput = this.unitEl.querySelector('#lex-file-input');
    fileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        const filename = await this.engine.loadCustomAudioFile(e.target.files[0]);
        if (!stemSelect.querySelector('option[value="custom"]')) {
          const opt = document.createElement('option');
          opt.value = 'custom';
          opt.textContent = `📁 File: ${filename.slice(0, 24)}`;
          stemSelect.appendChild(opt);
        }
        stemSelect.value = 'custom';
      }
    });
  }

  syncSlidersFromParams() {
    const setVal = (id, val, isKhz = false) => {
      const slider = this.unitEl.querySelector(`#slider-${id}`);
      const disp = this.unitEl.querySelector(`#disp-${id}`);
      if (!slider || !disp) return;
      slider.value = val;
      if (isKhz) {
        disp.textContent = (val / 1000).toFixed(1);
      } else if (Number.isInteger(val)) {
        disp.textContent = val.toString();
      } else {
        disp.textContent = val.toFixed(1);
      }
    };

    setVal('preDelay', this.params.preDelay);
    setVal('decay', this.params.decay);
    setVal('damping', this.params.damping, true);
    setVal('diffusion', this.params.diffusion);
    setVal('modRate', this.params.modRate);
    setVal('modDepth', this.params.modDepth);

    const mixSlider = this.unitEl.querySelector('#slider-mix');
    const mixDisp = this.unitEl.querySelector('#disp-mix');
    if (mixSlider && mixDisp) {
      const pct = Math.round(this.params.mix * 100);
      mixSlider.value = pct;
      mixDisp.textContent = pct.toString();
    }
    this.syncLiveSignalChainPills();
  }

  updatePlayButtonUI(isPlaying) {
    const playBtn = this.unitEl.querySelector('#lex-play-btn');
    const playTxt = this.unitEl.querySelector('#lex-play-txt');
    if (!playBtn || !playTxt) return;
    playBtn.classList.toggle('playing', isPlaying);
    playBtn.querySelector('.icon').textContent = isPlaying ? '⏹' : '▶';
    playTxt.textContent = isPlaying ? 'STOP AUDIO' : 'PLAY AUDIO';
  }

  startRenderLoop() {
    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    const inMeter = this.unitEl.querySelector('#meter-in');
    const outMeter = this.unitEl.querySelector('#meter-out');
    const lfoDots = [
      this.unitEl.querySelector('#lfo-dot-0'),
      this.unitEl.querySelector('#lfo-dot-1'),
      this.unitEl.querySelector('#lfo-dot-2'),
      this.unitEl.querySelector('#lfo-dot-3')
    ];

    const historyBuffer = new Float32Array(300);
    let historyPtr = 0;

    const render = () => {
      this.rafId = requestAnimationFrame(render);
      if (!canvas || !ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // Update Peak Meters
      const levels = this.engine.getLevels();
      if (inMeter) inMeter.style.height = `${Math.min(100, levels.inPeak * 130)}%`;
      if (outMeter) outMeter.style.height = `${Math.min(100, levels.outPeak * 130)}%`;

      // Update LFO dots based on telemetry
      const lfoPhases = this.engine.telemetry.lfoPhases;
      for (let i = 0; i < 4; i++) {
        if (lfoDots[i]) {
          const lit = Math.sin(lfoPhases[i]) > 0.15;
          lfoDots[i].classList.toggle('lit', lit);
        }
      }

      // Record rolling tail energy
      historyBuffer[historyPtr] = levels.outPeak;
      historyPtr = (historyPtr + 1) % historyBuffer.length;

      // Clear canvas with subtle phosphor persistence
      ctx.fillStyle = 'rgba(8, 9, 13, 0.28)';
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 60) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += 35) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      if (this.visualizerMode === 'tail') {
        const tankEnergies = this.engine.telemetry.tankEnergies;
        const centerX = 120;
        const centerY = h / 2;

        ctx.save();
        for (let i = 0; i < 4; i++) {
          const phase = lfoPhases[i];
          const energy = Math.min(1.0, tankEnergies[i] * 3.5);
          const orbitR = 30 + i * 16;
          const px = centerX + Math.cos(phase) * (orbitR + energy * 15);
          const py = centerY + Math.sin(phase) * (orbitR * 0.55 + energy * 10);

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, orbitR, orbitR * 0.55, 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#f43f5e';
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(px, py, 3.5 + energy * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        ctx.fillStyle = '#64748b';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText('FDN-4 TANK ORBITS', 55, h - 14);

        const waveStartX = 240;
        const waveWidth = w - waveStartX - 20;

        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
        ctx.shadowBlur = 6;

        ctx.beginPath();
        for (let i = 0; i < historyBuffer.length; i++) {
          const idx = (historyPtr + i) % historyBuffer.length;
          const val = historyBuffer[idx];
          const x = waveStartX + (i / historyBuffer.length) * waveWidth;
          const y = h / 2 - val * (h * 0.42);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
        ctx.beginPath();
        for (let i = 0; i < historyBuffer.length; i++) {
          const idx = (historyPtr + i) % historyBuffer.length;
          const val = historyBuffer[idx];
          const x = waveStartX + (i / historyBuffer.length) * waveWidth;
          const y = h / 2 + val * (h * 0.42);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#64748b';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText('STEREOPHONIC DECAY PROFILE (L/R)', waveStartX + 6, 20);
      } else {
        if (this.engine.analyserOut) {
          this.engine.analyserOut.getByteFrequencyData(this.engine.freqDomainOut);
          const barCount = 128;
          const barWidth = w / barCount;

          ctx.save();
          for (let i = 0; i < barCount; i++) {
            const v = this.engine.freqDomainOut[i] / 255.0;
            const barH = v * (h - 40);
            const x = i * barWidth;
            const y = h - barH - 20;

            const grad = ctx.createLinearGradient(0, y, 0, h - 20);
            grad.addColorStop(0, '#f43f5e');
            grad.addColorStop(0.5, '#38bdf8');
            grad.addColorStop(1, '#1e293b');

            ctx.fillStyle = grad;
            ctx.fillRect(x + 1, y, barWidth - 2, barH);
          }
          ctx.restore();

          const dampCutoffNorm = Math.log10(this.params.damping / 20) / Math.log10(20000 / 20);
          const dampX = dampCutoffNorm * w;

          ctx.strokeStyle = '#eab308';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(dampX, 10);
          ctx.lineTo(dampX, h - 20);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#eab308';
          ctx.font = '9.5px ui-monospace, monospace';
          ctx.fillText(`HF DAMP CUTOFF: ${this.params.damping.toFixed(0)} Hz`, dampX + 6, 26);
        }
      }
    };

    this.rafId = requestAnimationFrame(render);
  }

  ensureAudioGraph() {
    return this.engine.ensureAudioContext();
  }

  suspend() {
    this.engine.suspend();
    this.updatePlayButtonUI(false);
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.suspend();
    if (this.unitEl && this.unitEl.parentNode) {
      this.unitEl.parentNode.removeChild(this.unitEl);
    }
  }
}

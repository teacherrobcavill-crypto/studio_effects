/**
 * TapeEchoModule.js
 * Interactive Educational Module:
 *   Left Panel:  1974 Roland RE-201 Space Echo (Cutaway Free-Floating Tape Tank, 12-Pos Mode Selector, Repeat Rate, Intensity, Echo/Reverb Vol, Bass/Treble EQ)
 *   Right Panel: Late-1950s Watkins Copicat (Top-Down Tensioned Endless Loop, 3 Push-Button Head Selectors, Swell, Sustain, Motor Switch Pitch-Slur)
 *   Bottom Panel: Persistent Modular Historical Curriculum & Technical Comparison
 *   Overlay System: Contextual "Helpful Hints" (Magnetic Saturation, Wow & Flutter, Runaway Feedback)
 */

import { TapeEchoAudioEngine } from '../audio/TapeEchoAudioEngine.js';
import { initDeclarativeTips } from './LearningTooltips.js';

/**
 * Roland RE-201 12-Position Rotary Mode Table
 */
const RE201_MODES = [
  { mode: 1,  group: 'ECHO ONLY',     heads: [1],       reverb: false, label: 'Mode 1 · Head 1 Only (Short Slapback)' },
  { mode: 2,  group: 'ECHO ONLY',     heads: [2],       reverb: false, label: 'Mode 2 · Head 2 Only (Medium Repeat)' },
  { mode: 3,  group: 'ECHO ONLY',     heads: [3],       reverb: false, label: 'Mode 3 · Head 3 Only (Long Repeat)' },
  { mode: 4,  group: 'ECHO ONLY',     heads: [2, 3],    reverb: false, label: 'Mode 4 · Heads 2 + 3 (Syncopated Dual)' },
  { mode: 5,  group: 'ECHO + REVERB', heads: [1],       reverb: true,  label: 'Mode 5 · Head 1 + Spring Reverb' },
  { mode: 6,  group: 'ECHO + REVERB', heads: [2],       reverb: true,  label: 'Mode 6 · Head 2 + Spring Reverb' },
  { mode: 7,  group: 'ECHO + REVERB', heads: [3],       reverb: true,  label: 'Mode 7 · Head 3 + Spring Reverb' },
  { mode: 8,  group: 'ECHO + REVERB', heads: [1, 2],    reverb: true,  label: 'Mode 8 · Heads 1 + 2 + Spring Reverb' },
  { mode: 9,  group: 'ECHO + REVERB', heads: [2, 3],    reverb: true,  label: 'Mode 9 · Heads 2 + 3 + Spring Reverb' },
  { mode: 10, group: 'ECHO + REVERB', heads: [1, 3],    reverb: true,  label: 'Mode 10 · Heads 1 + 3 + Spring Reverb' },
  { mode: 11, group: 'ECHO + REVERB', heads: [1, 2, 3], reverb: true,  label: 'Mode 11 · Heads 1 + 2 + 3 + Spring Reverb (Full Space Echo)' },
  { mode: 12, group: 'REVERB ONLY',   heads: [],        reverb: true,  label: 'Mode 12 · Internal Spring Reverb Tank Only' }
];

/**
 * Contextual "Helpful Hints" Definitions
 */
const HELPFUL_HINTS = {
  saturation: {
    id: 'saturation',
    badge: 'HELPFUL HINT 01 · ANALOG DOMAIN',
    title: 'Hint: Magnetic Saturation',
    triggerDesc: 'Triggered by pushing Input Gain / Record Drive into the red zone (≥ 75%)',
    body: `
      <p><strong>Physical Mechanism:</strong> Magnetic tape consists of microscopic ferromagnetic iron-oxide ($\gamma\text{-Fe}_2\text{O}_3$) particles suspended in a binder on polyester film. As the <strong>Record Head</strong> applies a stronger electromagnetic field, more magnetic domains align with the signal. Once nearly all particles are aligned (approaching maximum magnetic remanence $B_{\text{sat}}$), further increases in input voltage yield diminishing increases in magnetization.</p>
      <p style="margin-top:6px;"><strong>Sonic Signature vs. Digital Clipping:</strong> Instead of chopping waveforms flat at $0\text{ dBFS}$ like a digital converter, magnetic saturation <em>gradually rounds off</em> transient peaks, acting as a natural, zero-attack limiter while generating warm odd-order ($3f_0, 5f_0$) and subtle bias-induced even-order ($2f_0$) harmonics.</p>
      <p style="margin-top:6px;"><strong>Modern DSP Emulation:</strong> Software emulations model this non-linear transfer curve using oversampled sigmoid waveshapers such as $y(t) = \tanh(G \cdot x(t) + \alpha x^2(t))$ or full differential <strong>Jiles-Atherton hysteresis</strong> equations that capture how magnetic memory depends on the history of the signal.</p>
    `,
    tryActionLabel: '🔥 Audition Hot Tape Drive (180%)',
    tryPreset: 'saturation-demo'
  },
  wowFlutter: {
    id: 'wowFlutter',
    badge: 'HELPFUL HINT 02 · ELECTROMECHANICAL TRANSPORT',
    title: 'Hint: Wow and Flutter',
    triggerDesc: 'Triggered by inspecting the moving tape transport mechanisms',
    body: `
      <p><strong>Mechanical Imperfections:</strong> No physical motor, capstan shaft, or tension pulley spins with mathematically constant angular velocity:</p>
      <ul style="margin:5px 0 6px 18px; line-height:1.45;">
        <li><strong>Wow ($0.1\text{ Hz} – 4\text{ Hz}$):</strong> Slow, cyclical pitch deviation caused by out-of-round capstan shafts, motor cogging, or the physical tape splice passing over the head block once per loop revolution (especially pronounced in the <strong>Watkins Copicat's</strong> short tensioned loop).</li>
        <li><strong>Flutter ($4\text{ Hz} – 100\text{ Hz}$):</strong> Rapid, quivering speed fluctuations caused by mechanical friction between the tape, guide rollers, felt pressure pads, and spring-loaded tension arms.</li>
      </ul>
      <p><strong>Modern DSP Emulation (Chorus &amp; Vibrato):</strong> Because tape speed changes alter the travel time between Record and Playback heads ($\tau(t) = d / v(t)$), modern digital <strong>chorus, vibrato, and tape plugins</strong> mathematically emulate these hardware flaws by modulating a fractional delay line with summed low-frequency oscillators (LFOs) and band-limited noise: $\tau(t) = \tau_0 + A_w \sin(2\pi f_{\text{wow}} t) + A_f \sin(2\pi f_{\text{flutter}} t)$.</p>
    `,
    tryActionLabel: '🌊 Compare Copicat Loop vs. RE-201 Tank',
    tryPreset: 'wow-flutter-demo'
  },
  runawayFeedback: {
    id: 'runawayFeedback',
    badge: 'HELPFUL HINT 03 · REGENERATION & STABILITY',
    title: 'Hint: Runaway Feedback',
    triggerDesc: 'Triggered by pushing Intensity (RE-201) or Sustain (Copicat) to extreme values (≥ 85%)',
    body: `
      <p><strong>Signal Regeneration Loop:</strong> Turning up <strong>Intensity</strong> or <strong>Sustain</strong> routes a portion ($\beta$) of the Playback Head output directly back into the Record Head input, forming a closed recursive loop with transfer function $H(\omega) = \frac{G(\omega)}{1 - \beta F(\omega) G(\omega)}$. When loop gain $|\beta F(\omega) G(\omega)| \ge 1$, echoes no longer decay—they grow exponentially into <strong>self-oscillation</strong>.</p>
      <p style="margin-top:6px;"><strong>How Analog Tolerances Shape the Howl:</strong> In a pure digital delay, loop gain $> 1.0$ instantly explodes into harsh full-spectrum clipping. In analog tape echoes, three physical boundaries tame and sculpt the runaway oscillation:</p>
      <ol style="margin:5px 0 6px 18px; line-height:1.45;">
        <li><strong>Head Gap Loss (LPF ~3 kHz):</strong> Finite playback head gap width attenuates high frequencies on every pass.</li>
        <li><strong>Coupling Capacitors &amp; Head Contour (HPF ~120 Hz):</strong> Sub-bass rolls off on each recirculation, focusing energy into the resonant midband ($250\text{ Hz} – 1.2\text{ kHz}$).</li>
        <li><strong>Oxide Saturation Ceiling:</strong> Magnetic tape hits soft saturation, clamping peak amplitude into a singing, playable pitch wave that Dub pioneers like <strong>King Tubby</strong> and <strong>Lee "Scratch" Perry</strong> swept with the Repeat Rate knob!</li>
      </ol>
    `,
    tryActionLabel: '🌀 Trigger Dub Self-Oscillation Howl',
    tryPreset: 'dub-oscillation-demo'
  }
};

export class TapeEchoModule {
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    this.onAudioStateChange = options.onAudioStateChange || null;

    this.engine = new TapeEchoAudioEngine({
      onTelemetryUpdate: (telem) => this._handleTelemetry(telem),
      onPlayStateChange: (playing) => {
        this._updateTransportUI(playing);
        if (this.onAudioStateChange) this.onAudioStateChange(playing);
      }
    });

    // Animation state for both hardware canvases
    this.reCanvas = null;
    this.reCtx = null;
    this.ccCanvas = null;
    this.ccCtx = null;
    this.animFrameId = null;
    this.lastFrameTime = performance.now();

    // Tape motion phase trackers
    this.reTapeOffset = 0;
    this.reCapstanAngle = 0;
    this.reTankLoops = [
      { phase: 0.0, amp: 1.0 },
      { phase: 1.2, amp: 0.85 },
      { phase: 2.5, amp: 1.1 },
      { phase: 3.9, amp: 0.9 },
      { phase: 5.1, amp: 1.05 }
    ];
    this.reFluxPulses = [];

    this.ccTapeOffset = 0;
    this.ccCapstanAngle = 0;
    this.ccSplicePos = 0.15; // 0..1 around the 21-inch loop
    this.ccFluxPulses = [];

    // Hover state for interactive hardware component mapping
    this.reHoveredPart = null;
    this.ccHoveredPart = null;
    this.mechHoverDurationMs = 0;

    // Helpful Hints state
    this.triggeredHints = new Set();
    this.activeHintId = null;

    // Curriculum active tab ('all', 'copicat', 'space-echo', 'comparison')
    this.activeCurriculumTab = 'all';

    this._render();
    this._bindEvents();
    initDeclarativeTips(this.mountEl);
    this._startAnimationLoop();
  }

  suspend() {
    this.engine.suspend();
    this._updateTransportUI(false);
  }

  _render() {
    this.mountEl.innerHTML = `
      <div class="te-module-shell">
        <!-- ==================================================================
             TOP STUDIO TRANSPORT, ROUTING & HELPFUL HINTS TRACKER BAR
             ================================================================== -->
        <header class="te-master-bar">
          <div class="te-master-left">
            <span class="te-era-pill">1958 – 1974 · MAGNETIC TAPE ECHO EVOLUTION</span>
            <div class="te-title-block">
              <h1>Roland RE-201 Space Echo &amp; Watkins Copicat</h1>
              <p>Interactive Cutaway Tape Transports • Multi-Head Routing • Real-Time Doppler Pitch Slur • Historical Curriculum</p>
            </div>
          </div>

          <!-- Shared Studio Audio Transport & Source Selector -->
          <div class="te-transport-cluster">
            <button type="button" id="te-btn-play" class="te-btn te-btn-play">▶ PLAY AUDIO</button>

            <label class="te-select-wrap" title="Select Musical Test Stem">
              <span class="te-select-label">SOURCE</span>
              <select id="te-stem-select" class="te-select">
                <option value="dub-skank">🎹 1974 Kingston Dub Skank &amp; Rimshot</option>
                <option value="shadows-guitar">🎸 1958 British Twang Lead ("Apache" Style)</option>
                <option value="rimshot-loop">🥁 Precision Rimshot Echo Tap Analyzer</option>
                <option value="cosmic-synth">🌌 1974 Berlin Cosmic Synth Arpeggio</option>
              </select>
            </label>

            <div class="te-oneshot-group">
              <button type="button" id="te-btn-chord" class="te-btn te-btn-oneshot" title="Trigger a single 1958 Twang Guitar Chord stab to hear the multi-head echo pattern">🎸 Pluck Chord</button>
              <button type="button" id="te-btn-rimshot" class="te-btn te-btn-oneshot" title="Trigger a single King Tubby Dub Rimshot transient">🥁 Rimshot Hit</button>
              <button type="button" id="te-btn-upload" class="te-btn te-btn-oneshot" title="Load your own .WAV or .MP3 audio file">📂 Load File</button>
              <input type="file" id="te-file-input" accept="audio/*" style="display:none;" />
            </div>

            <!-- Output Monitor Routing Switcher -->
            <div class="te-routing-pills" role="group" aria-label="Audio Routing Monitor">
              <button type="button" class="te-route-btn active" data-route="0" title="Listen to both machines side-by-side in stereo">BOTH ACTIVE</button>
              <button type="button" class="te-route-btn" data-route="1" title="Solo Roland RE-201 Space Echo">RE-201 SOLO</button>
              <button type="button" class="te-route-btn" data-route="2" title="Solo Watkins Copicat">COPICAT SOLO</button>
            </div>
          </div>

          <!-- Shared Preamp Input Gain / Tape Saturation Drive -->
          <div class="te-input-drive-box">
            <div class="te-drive-header">
              <span>INPUT GAIN / TAPE DRIVE</span>
              <span id="te-input-gain-val" class="te-drive-readout">100% (0.0 dB)</span>
              <button type="button" class="edu-tip-badge edu-amber"
                data-edu-title="Input Gain & Magnetic Oxide Saturation"
                data-edu-tip="Controls the input preamplifier level driving the magnetic Record Head on both units. Pushing Input Gain above 150% saturates the iron-oxide tape domains, soft-clipping transients and adding warm 2nd & 3rd harmonics."
                data-edu-try="Push Input Gain above 155% to light the red PEAK indicator and trigger the 'Magnetic Saturation' Helpful Hint!">?</button>
            </div>
            <div class="te-drive-slider-row">
              <input type="range" id="te-input-gain" min="0" max="200" step="1" value="100" class="te-range te-range-amber" />
              <span id="te-peak-led" class="te-peak-led" title="Magnetic Tape Peak Saturation Indicator">PEAK</span>
            </div>
          </div>
        </header>

        <!-- ==================================================================
             CONTEXTUAL "HELPFUL HINTS" BAR & FLOATING OVERLAY BANNER
             ================================================================== -->
        <section class="te-hints-bar" aria-label="Interactive Helpful Hints Curriculum">
          <div class="te-hints-bar-left">
            <span class="te-hints-tag">💡 HELPFUL HINTS OVERLAY SYSTEM</span>
            <span class="te-hints-sub">Interact with the controls &amp; cutaway mechanisms to unlock contextual engineering insights (or click any badge below):</span>
          </div>
          <div class="te-hints-pills">
            <button type="button" class="te-hint-pill" data-hint-id="saturation" id="hint-pill-saturation">
              <span class="te-hint-dot"></span>
              <span>1. Magnetic Saturation</span>
              <span class="te-hint-cond">(Push Input Gain High)</span>
            </button>
            <button type="button" class="te-hint-pill" data-hint-id="wowFlutter" id="hint-pill-wowFlutter">
              <span class="te-hint-dot"></span>
              <span>2. Wow &amp; Flutter</span>
              <span class="te-hint-cond">(Inspect Tape Transports)</span>
            </button>
            <button type="button" class="te-hint-pill" data-hint-id="runawayFeedback" id="hint-pill-runawayFeedback">
              <span class="te-hint-dot"></span>
              <span>3. Runaway Feedback</span>
              <span class="te-hint-cond">(Max Intensity / Sustain)</span>
            </button>
          </div>
        </section>

        <!-- Dynamic Contextual Helpful Hint Overlay Card (Shown when triggered or clicked) -->
        <aside id="te-hint-overlay" class="te-hint-overlay" style="display:none;" role="dialog" aria-live="polite">
          <div class="te-hint-card">
            <div class="te-hint-card-header">
              <div class="te-hint-card-titles">
                <span id="te-hint-badge" class="te-hint-card-badge">HELPFUL HINT</span>
                <h3 id="te-hint-title">Hint Title</h3>
                <span id="te-hint-trigger" class="te-hint-trigger-meta"></span>
              </div>
              <div class="te-hint-card-actions">
                <button type="button" id="te-hint-try-btn" class="te-btn te-btn-hint-try">🎧 Audition Concept</button>
                <button type="button" id="te-hint-close-btn" class="te-hint-close" aria-label="Dismiss Helpful Hint">✕ Dismiss</button>
              </div>
            </div>
            <div id="te-hint-body" class="te-hint-card-body"></div>
          </div>
        </aside>

        <!-- ==================================================================
             SPLIT-SCREEN DUAL HARDWARE STAGE
             LEFT: ROLAND RE-201 SPACE ECHO | RIGHT: WATKINS COPICAT
             ================================================================== -->
        <div class="te-dual-stage">

          <!-- ================================================================
               LEFT PANEL: 1974 ROLAND RE-201 SPACE ECHO
               ================================================================ -->
          <section class="te-unit-panel te-panel-re201" aria-label="Roland RE-201 Space Echo">
            <header class="te-unit-header re201-header">
              <div class="te-unit-brand">
                <span class="re201-badge">ROLAND · 1974</span>
                <div>
                  <h2>
                    RE-201 SPACE ECHO
                    <button type="button" class="edu-tip-badge"
                      data-edu-title="Roland RE-201 Space Echo (1974)"
                      data-edu-tip="Designed by Ikutaro Kakehashi in Osaka, Japan, the RE-201 replaced high-tension tape reels with a free-floating ballistic tape tank holding ~27 feet of endless 1/4-inch tape. Combined with 3 playback heads, a 12-position rotary mode selector, and an internal 3-spring reverb tank, it became the cornerstone of Dub, Reggae, and electronic music."
                      data-edu-try="Sweep REPEAT RATE while audio is playing to hear classic dub pitch-shifting, or push INTENSITY above 85% for analog self-oscillation!">?</button>
                  </h2>
                  <p>FREE-FLOATING TAPE TANK • 3 PLAYBACK HEADS + SPRING REVERB • SOLID-STATE BAXANDALL EQ</p>
                </div>
              </div>
              <div class="te-unit-telemetry">
                <span class="te-telem-chip" id="re-speed-readout">SPEED: 3.4 IPS</span>
                <span class="te-telem-chip" id="re-delay-readout">H1: 115ms · H2: 221ms · H3: 329ms</span>
              </div>
            </header>

            <!-- Cutaway Chassis Viewport: Free-Floating Tape Tank + 5 Heads + Capstan + Spring Reverb -->
            <div class="te-cutaway-wrap" id="re-cutaway-wrap">
              <canvas id="re-cutaway-canvas" width="660" height="255" class="te-cutaway-canvas"></canvas>

              <!-- Interactive Component Mapping Hotspot Badges (Hover-state tooltips on all exposed hardware parts) -->
              <div class="te-hotspot-layer">
                <button type="button" class="te-hw-hotspot" style="left: 28%; top: 27%;"
                  data-part="re-tank"
                  data-edu-title="Free-Floating Tape Tank (Loose Loop Reservoir)"
                  data-edu-tip="Under this smoked acrylic cover, ~27 feet of 1/4-inch magnetic tape folds freely in loose serpentine loops with zero reel-to-reel tension. By eliminating tight spring pull and spreading wear over 15× more tape length than the Copicat, the RE-201 drastically reduced tape degradation and stabilized wow & flutter."
                  data-edu-try="Turn REPEAT RATE up and down and watch the loose serpentine tape folds undulate faster or slower inside the acrylic tank!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Free-Floating Tank</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 14%; top: 73%;"
                  data-part="re-erase"
                  data-edu-title="Erase Head (Ultrasonic AC Bias)"
                  data-edu-tip="Positioned first in the head block. Feeds an ultrasonic ~60 kHz oscillator current to scramble and wipe previous magnetic domains before the tape reaches the Record Head."
                  data-edu-try="When INTENSITY is cranked past 85%, regenerated feedback deliberately overwhelms clean erasure to create endless dub loops.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Erase</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 26%; top: 76%;"
                  data-part="re-record"
                  data-edu-title="Record Head (Input + Feedback Imprinter)"
                  data-edu-tip="Magnetizes the moving ferric-oxide tape with the sum of your dry Input signal, AC bias current, and the Intensity feedback loop returning from the active playback heads."
                  data-edu-try="Increase INPUT GAIN to watch bright amber magnetic flux pulses launch from the Record Head onto the moving tape!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Record</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 41%; top: 78%;"
                  data-part="re-head1"
                  data-edu-title="Playback Head 1 (Short Delay Tap)"
                  data-edu-tip="Located ~1.05 inches past the Record Head. Produces the shortest delay repeat (56 ms to 185 ms depending on Repeat Rate). Active in Modes 1, 5, 8, 10, and 11."
                  data-edu-try="Select Mode 1 or Mode 5 to isolate Playback Head 1.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">PB Head 1</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 54%; top: 78%;"
                  data-part="re-head2"
                  data-edu-title="Playback Head 2 (Medium Delay Tap)"
                  data-edu-tip="Located ~2.0 inches past the Record Head (1.92× Head 1 spacing). Produces medium repeats (108 ms to 355 ms). Active in Modes 2, 4, 6, 8, 9, and 11."
                  data-edu-try="Select Mode 4 or Mode 9 to combine Head 2 + Head 3 for a syncopated reggae triplet feel!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">PB Head 2</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 67%; top: 76%;"
                  data-part="re-head3"
                  data-edu-title="Playback Head 3 (Long Delay Tap)"
                  data-edu-tip="Located ~3.0 inches past the Record Head (2.86× Head 1 spacing). Produces the longest repeats (160 ms to 530 ms). Active in Modes 3, 4, 7, 9, 10, and 11."
                  data-edu-try="Select Mode 3 and sweep REPEAT RATE for wide, pitch-gliding echoes.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">PB Head 3</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 83%; top: 68%;"
                  data-part="re-capstan"
                  data-edu-title="DC Servo Capstan Motor & Rubber Pinch Roller"
                  data-edu-tip="Clamps the magnetic tape against a precision rotating steel shaft driven by a variable-voltage DC motor. The REPEAT RATE knob varies motor voltage directly, changing physical tape speed from 1.75 IPS to 5.75 IPS."
                  data-edu-try="Modulate REPEAT RATE in real time to see capstan RPM change and hear mechanical Doppler pitch-shifting!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Capstan &amp; Pinch</span>
                </button>

                <button type="button" class="te-hw-hotspot" style="left: 77%; top: 23%;"
                  data-part="re-spring"
                  data-edu-title="Internal 3-Spring Reverb Tank"
                  data-edu-tip="Built into the lower chassis of the RE-201. Active in Modes 5–12, blending electro-mechanical helical spring dispersion with the multi-head tape delays."
                  data-edu-try="Switch to Mode 12 (REVERB ONLY) and turn up REVERB VOLUME to hear the isolated spring tank.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Spring Tank</span>
                </button>
              </div>

              <div class="te-cutaway-footer-bar">
                <span id="re-hover-status">Hover over any internal RE-201 component (Tank, Erase/Record/Playback Heads, Capstan, Spring) for signal-path physics</span>
              </div>
            </div>

            <!-- RE-201 Front Control Faceplate -->
            <div class="re201-faceplate">
              <!-- Left Column: 12-Position Rotary Mode Selector & Routing Matrix -->
              <div class="re201-mode-bay">
                <div class="te-control-title">
                  <span>MODE SELECTOR (12-POS ROTARY)</span>
                  <button type="button" class="edu-tip-badge"
                    data-edu-title="12-Position Mode Selector Switch"
                    data-edu-tip="Routes the 3 playback heads and internal spring reverb tank across 3 banks: Modes 1–4 (Echo Only), Modes 5–11 (Echo + Spring Reverb combinations), and Mode 12 (Spring Reverb Only)."
                    data-edu-try="Click the rotary dial or any of the 12 numbered buttons to switch head combinations in real time!">?</button>
                </div>

                <div class="re201-mode-main">
                  <!-- Interactive SVG Rotary Dial -->
                  <div class="re201-rotary-wrap" id="re-mode-dial-wrap" title="Click or scroll to step through Modes 1–12">
                    <svg viewBox="0 0 120 120" class="re201-rotary-svg">
                      <circle cx="60" cy="60" r="54" fill="#14181f" stroke="#2e3b33" stroke-width="2" />
                      <circle cx="60" cy="60" r="36" fill="#1e242d" stroke="#52b788" stroke-width="1.5" />
                      <g id="re-dial-pointer" transform="rotate(300 60 60)">
                        <line x1="60" y1="60" x2="60" y2="26" stroke="#74c69d" stroke-width="4" stroke-linecap="round" />
                        <circle cx="60" cy="28" r="3" fill="#d8f3dc" />
                      </g>
                      <circle cx="60" cy="60" r="10" fill="#0d1117" stroke="#95d5b2" stroke-width="1.5" />
                    </svg>
                    <div class="re201-mode-num-badge" id="re-mode-big-num">11</div>
                  </div>

                  <!-- 12 Direct Mode Buttons grouped by Bank -->
                  <div class="re201-mode-grid-wrap">
                    <div class="re201-bank-label">ECHO ONLY (1–4) · ECHO + REVERB (5–11) · REVERB (12)</div>
                    <div class="re201-mode-grid" id="re-mode-buttons">
                      ${RE201_MODES.map(
                        (m) => `
                        <button type="button" class="re-mode-btn ${m.mode === 11 ? 'active' : ''}"
                          data-mode="${m.mode}" title="${m.label}">
                          <span class="m-num">${m.mode}</span>
                          <span class="m-heads">${
                            m.heads.length ? 'H' + m.heads.join('+') : ''
                          }${m.reverb ? (m.heads.length ? '+R' : 'REV') : ''}</span>
                        </button>
                      `
                      ).join('')}
                    </div>
                    <div class="re201-active-mode-desc" id="re-mode-desc">
                      Mode 11 · Heads 1 + 2 + 3 + Spring Reverb (Full Space Echo)
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right Column: RE-201 Potentiometers (Repeat Rate, Intensity, Echo Vol, Reverb Vol, Bass, Treble) -->
              <div class="re201-knobs-bay">
                <div class="te-knobs-grid-6">
                  <!-- 1. REPEAT RATE -->
                  <div class="te-knob-card re-accent">
                    <div class="te-knob-head">
                      <label for="re-repeat-rate">REPEAT RATE</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Repeat Rate (Capstan Motor Speed)"
                        data-edu-tip="Directly varies the DC voltage fed to the capstan drive motor. Turning Repeat Rate faster increases tape speed (shortening delay time and pitching echoes UP); turning it slower decreases tape speed (lengthening delay time and pitching echoes DOWN)."
                        data-edu-try="Sweep Repeat Rate rapidly while echoes are ringing to hear authentic mechanical Doppler pitch-gliding!">?</button>
                    </div>
                    <input type="range" id="re-repeat-rate" min="0" max="100" step="1" value="52" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-repeat-rate-val">52% (3.4 IPS)</div>
                  </div>

                  <!-- 2. INTENSITY -->
                  <div class="te-knob-card re-accent">
                    <div class="te-knob-head">
                      <label for="re-intensity">INTENSITY</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Intensity (Feedback Regeneration Loop)"
                        data-edu-tip="Controls how much signal from the active Playback Heads is fed back into the Record Head. At low settings, echoes repeat once or twice; above 82%, loop gain exceeds unity and launches warm analog runaway self-oscillation!"
                        data-edu-try="Push Intensity past 85% to trigger runaway dub self-oscillation and unlock Helpful Hint #3!">?</button>
                    </div>
                    <input type="range" id="re-intensity" min="0" max="115" step="1" value="48" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-intensity-val">48% (4–5 Repeats)</div>
                  </div>

                  <!-- 3. ECHO VOLUME -->
                  <div class="te-knob-card">
                    <div class="te-knob-head">
                      <label for="re-echo-vol">ECHO VOLUME</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Echo Volume (Wet Tape Blend)"
                        data-edu-tip="Sets the output level of the multi-head magnetic tape delay signal blended with your dry instrument signal."
                        data-edu-try="Balance Echo Volume against Reverb Volume in Modes 5–11.">?</button>
                    </div>
                    <input type="range" id="re-echo-vol" min="0" max="120" step="1" value="72" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-echo-vol-val">72%</div>
                  </div>

                  <!-- 4. REVERB VOLUME -->
                  <div class="te-knob-card">
                    <div class="te-knob-head">
                      <label for="re-reverb-vol">REVERB VOL</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Reverb Volume (Spring Tank Blend)"
                        data-edu-tip="Sets the wet level of the internal 3-spring reverb tank (active in Modes 5 through 12)."
                        data-edu-try="Crank Reverb Volume in Mode 11 or 12 for dub spring splash!">?</button>
                    </div>
                    <input type="range" id="re-reverb-vol" min="0" max="120" step="1" value="38" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-reverb-vol-val">38%</div>
                  </div>

                  <!-- 5. BASS EQ -->
                  <div class="te-knob-card">
                    <div class="te-knob-head">
                      <label for="re-bass">BASS (WET EQ)</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Bass EQ (Delayed Signal Only)"
                        data-edu-tip="Active Baxandall low-shelf filter (±12 dB @ 180 Hz) placed strictly in the wet echo signal path. Cutting Bass prevents low-end mud during heavy feedback; boosting Bass creates massive dub sub-weight."
                        data-edu-try="Cut Bass to -6 dB while self-oscillating to thin out the loop into a high dub siren!">?</button>
                    </div>
                    <input type="range" id="re-bass" min="-12" max="12" step="0.5" value="0" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-bass-val">0.0 dB</div>
                  </div>

                  <!-- 6. TREBLE EQ -->
                  <div class="te-knob-card">
                    <div class="te-knob-head">
                      <label for="re-treble">TREBLE (WET EQ)</label>
                      <button type="button" class="edu-tip-badge"
                        data-edu-title="Treble EQ (Delayed Signal Only)"
                        data-edu-tip="Active Baxandall high-shelf filter (±12 dB @ 2.6 kHz) affecting only the delayed echo path. Boosting Treble counteracts magnetic head gap loss; cutting Treble creates dark, murky analog repeats."
                        data-edu-try="Sweep Treble from -10 dB to +10 dB while listening to the repeats.">?</button>
                    </div>
                    <input type="range" id="re-treble" min="-12" max="12" step="0.5" value="0" class="te-range te-range-green" />
                    <div class="te-knob-val" id="re-treble-val">0.0 dB</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ================================================================
               RIGHT PANEL: LATE-1950s WATKINS COPICAT
               ================================================================ -->
          <section class="te-unit-panel te-panel-copicat" aria-label="Watkins Copicat Tape Echo">
            <header class="te-unit-header copicat-header">
              <div class="te-unit-brand">
                <span class="copicat-badge">WATKINS / WEM · 1958</span>
                <div>
                  <h2>
                    WATKINS COPICAT
                    <button type="button" class="edu-tip-badge edu-amber"
                      data-edu-title="Watkins Copicat (Late 1950s)"
                      data-edu-tip="Engineered by Charlie Watkins in London in 1958, the Copicat was the first mass-produced portable tape echo in Britain. Its short (~21-inch), spring-tensioned spliced tape loop and 3 push-button playback heads defined the sound of The Shadows ('Apache') and early British rock & roll."
                      data-edu-try="Toggle the MOTOR SWITCH off and back on while audio is playing to hear the mechanical capstan ramp-up pitch-slur!">?</button>
                  </h2>
                  <p>TENSIONED ENDLESS TAPE LOOP • 3 PUSH-BUTTON HEADS • VALVE SUSTAIN • MOTOR PITCH-SLUR</p>
                </div>
              </div>
              <div class="te-unit-telemetry">
                <span class="te-telem-chip cc-chip" id="cc-motor-readout">MOTOR: 3.75 IPS (STABLE)</span>
                <span class="te-telem-chip cc-chip" id="cc-heads-readout">ACTIVE: HEAD 1 + HEAD 2</span>
              </div>
            </header>

            <!-- Top-Down Mechanical Chassis Viewport: Tension Arm + Short Loop + Static Head Block + Capstan -->
            <div class="te-cutaway-wrap" id="cc-cutaway-wrap">
              <canvas id="cc-cutaway-canvas" width="660" height="255" class="te-cutaway-canvas"></canvas>

              <!-- Interactive Component Mapping Hotspot Badges -->
              <div class="te-hotspot-layer">
                <button type="button" class="te-hw-hotspot cc-spot" style="left: 15%; top: 48%;"
                  data-part="cc-tension-arm"
                  data-edu-title="Spring-Loaded Tension Arm & Guide Pulley"
                  data-edu-tip="Pulls the short 21-inch spliced tape loop taut across the head block using a coiled mechanical spring. Because the loop is under constant tension, every minor pulley eccentricity or spring bounce directly modulates tape speed—creating the Copicat's signature pronounced Wow and Flutter!"
                  data-edu-try="Watch the tension arm flex and bounce whenever you toggle the MOTOR SWITCH!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Tension Arm</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 46%; top: 76%;"
                  data-part="cc-loop"
                  data-edu-title="Short Tensioned Spliced Tape Loop (~21 Inches)"
                  data-edu-tip="Unlike the Space Echo's 27-foot loose reservoir, the Copicat uses a short ~21-inch endless loop joined with splicing tape. Every point on the tape scrapes across the heads nearly twice per second, causing rapid oxide wear, gritty saturation, and a periodic splice thump."
                  data-edu-try="Follow the glowing orange diagonal SPLICE marker as it races around the tensioned loop!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">21&quot; Spliced Loop</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 29%; top: 23%;"
                  data-part="cc-erase-rec"
                  data-edu-title="Erase & Valve Record Head Block"
                  data-edu-tip="Wipes old signal and prints the incoming guitar/vocal signal plus regenerated Sustain feedback onto the tensioned tape loop through a high-impedance ECC83 / 6BR7 vacuum tube stage."
                  data-edu-try="Crank SUSTAIN above 85% to overload the valve record loop into gritty British self-oscillation.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Erase / Record</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 44%; top: 21%;"
                  data-part="cc-head1"
                  data-edu-title="Playback Head 1 (Short Tap ~92 ms)"
                  data-edu-tip="First playback head on the static alloy block. Engaged by Push-Button 1 for tight 1958 rockabilly and skiffle slapback."
                  data-edu-try="Click the HEAD 1 push-button below to toggle this head in or out.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Head 1 (Short)</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 56%; top: 21%;"
                  data-part="cc-head2"
                  data-edu-title="Playback Head 2 (Medium Tap ~182 ms)"
                  data-edu-tip="Second playback head on the static head block. Combining Head 1 + Head 2 + Head 3 produces the iconic galloping multi-tap echo heard on Hank Marvin & The Shadows' 'Apache'."
                  data-edu-try="Engage Heads 1 + 2 + 3 together with the 1958 British Twang Guitar stem!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Head 2 (Med)</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 69%; top: 23%;"
                  data-part="cc-head3"
                  data-edu-title="Playback Head 3 (Long Tap ~288 ms)"
                  data-edu-tip="Third playback head on the static block (~288 ms delay at 3.75 IPS). Provides spacious repeats and drives the longest regeneration loop when Sustain is raised."
                  data-edu-try="Engage Head 3 alone for wide 1950s ballad repeats.">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">Head 3 (Long)</span>
                </button>

                <button type="button" class="te-hw-hotspot cc-spot" style="left: 84%; top: 48%;"
                  data-part="cc-capstan"
                  data-edu-title="Shaded-Pole AC Capstan Motor & Pinch Roller"
                  data-edu-tip="A fixed-speed (~3.75 IPS) AC induction motor that pulls the tensioned loop past the static head block. Unlike the RE-201, the Copicat has no speed knob—instead, switching the Motor ON or OFF causes the heavy rotor to ramp up or coast down, creating a dramatic mechanical pitch-slur!"
                  data-edu-try="Flip the MOTOR SWITCH below while echoes are ringing to hear the pitch dive and slur back up!">
                  <span class="te-hotspot-dot"></span>
                  <span class="te-hotspot-label">AC Capstan Motor</span>
                </button>
              </div>

              <div class="te-cutaway-footer-bar">
                <span id="cc-hover-status">Hover over any Watkins Copicat component (Tension Arm, 21" Spliced Loop, Heads 1–3, Capstan Motor) for details</span>
              </div>
            </div>

            <!-- Watkins Copicat Front Control Deck -->
            <div class="copicat-faceplate">
              <!-- Left Column: 3 Mechanical Push-Button Head Selectors + Motor Switch -->
              <div class="copicat-switches-bay">
                <div class="te-control-title">
                  <span>HEAD SELECTORS (MULTI-HEAD PUSH-BUTTONS) &amp; MOTOR</span>
                  <button type="button" class="edu-tip-badge edu-amber"
                    data-edu-title="Copicat Mechanical Push-Button Head Selectors"
                    data-edu-tip="Three independent latching mechanical push-buttons allow any single head or multi-head combination (H1, H2, H3, H1+2, H2+3, H1+3, or H1+2+3) to be engaged simultaneously."
                    data-edu-try="Engage all three heads (H1 + H2 + H3) for The Shadows' classic galloping multi-head rhythm!">?</button>
                </div>

                <div class="cc-buttons-row">
                  <button type="button" class="cc-push-btn active" id="cc-btn-h1" data-head="1" aria-pressed="true">
                    <span class="cc-btn-lamp"></span>
                    <span class="cc-btn-cap">HEAD 1</span>
                    <span class="cc-btn-sub">SHORT (~92 ms)</span>
                  </button>

                  <button type="button" class="cc-push-btn active" id="cc-btn-h2" data-head="2" aria-pressed="true">
                    <span class="cc-btn-lamp"></span>
                    <span class="cc-btn-cap">HEAD 2</span>
                    <span class="cc-btn-cap-sub cc-btn-sub">MEDIUM (~182 ms)</span>
                  </button>

                  <button type="button" class="cc-push-btn" id="cc-btn-h3" data-head="3" aria-pressed="false">
                    <span class="cc-btn-lamp"></span>
                    <span class="cc-btn-cap">HEAD 3</span>
                    <span class="cc-btn-sub">LONG (~288 ms)</span>
                  </button>

                  <!-- Mechanical Motor Toggle Switch -->
                  <div class="cc-motor-box">
                    <button type="button" class="cc-motor-toggle active" id="cc-btn-motor" aria-pressed="true"
                      data-edu-title="Copicat Capstan Motor Switch (Ramp-Up Pitch-Slur)"
                      data-edu-tip="Switches the AC capstan drive motor ON or OFF. Turning the motor OFF lets the capstan coast to a stop (pitch-diving echoes down to zero); switching it back ON simulates the mechanical rotor ramp-up time and tension-arm bounce, creating an unmistakable upward pitch-slur before stabilizing at 3.75 IPS!"
                      data-edu-try="Click MOTOR ON/OFF or '⚡ Slur Test' while audio plays!">
                      <span class="cc-motor-led"></span>
                      <span class="cc-motor-label" id="cc-motor-btn-text">MOTOR: ON</span>
                      <span class="cc-motor-sub">AC 3.75 IPS</span>
                    </button>
                    <button type="button" id="cc-btn-slur-test" class="cc-slur-btn" title="Momentarily cut power and re-engage the capstan motor to demonstrate the mechanical ramp-up pitch-slur">
                      ⚡ Trigger Motor Pitch-Slur
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right Column: Swell & Sustain Rotary Potentiometers + Quick Presets -->
              <div class="copicat-knobs-bay">
                <div class="cc-knobs-row">
                  <!-- SWELL -->
                  <div class="te-knob-card cc-accent">
                    <div class="te-knob-head">
                      <label for="cc-swell">SWELL (ECHO VOLUME)</label>
                      <button type="button" class="edu-tip-badge edu-amber"
                        data-edu-title="Swell (Echo Output Level)"
                        data-edu-tip="Charlie Watkins labeled the wet echo volume 'SWELL'. Controls how loudly the summed output of the selected Playback Heads (1, 2, 3) is mixed with the dry signal."
                        data-edu-try="Turn Swell up to 80% with Heads 1+2+3 active to hear the full multi-head pattern.">?</button>
                    </div>
                    <input type="range" id="cc-swell" min="0" max="120" step="1" value="70" class="te-range te-range-teal" />
                    <div class="te-knob-val" id="cc-swell-val">70%</div>
                  </div>

                  <!-- SUSTAIN -->
                  <div class="te-knob-card cc-accent">
                    <div class="te-knob-head">
                      <label for="cc-sustain">SUSTAIN (REGENERATION)</label>
                      <button type="button" class="edu-tip-badge edu-amber"
                        data-edu-title="Sustain (Valve Feedback Regeneration)"
                        data-edu-tip="Controls how much signal from the active Playback Heads is fed back to the ECC83 valve Record Head stage. At maximum settings (≥ 85%), the short tensioned loop breaks into a gritty, mid-forward howling self-oscillation."
                        data-edu-try="Maximize Sustain past 85% to hear valve feedback oscillation and trigger Helpful Hint #3!">?</button>
                    </div>
                    <input type="range" id="cc-sustain" min="0" max="115" step="1" value="45" class="te-range te-range-teal" />
                    <div class="te-knob-val" id="cc-sustain-val">45%</div>
                  </div>
                </div>

                <!-- Instant Era Comparison Presets -->
                <div class="cc-preset-strip">
                  <span class="cc-preset-label">ERA PRESETS:</span>
                  <button type="button" class="cc-preset-btn" data-preset="apache-1960" title="Hank Marvin / The Shadows 1960 multi-head galloping echo">🎸 1960 "Apache" Gallop (H1+2+3)</button>
                  <button type="button" class="cc-preset-btn" data-preset="rockabilly-58" title="1958 British Rock & Roll tight single-head slapback">🎙️ 1958 London Slapback (H1)</button>
                  <button type="button" class="cc-preset-btn" data-preset="king-tubby-74" title="1974 King Tubby Dub Space Echo multi-head + spring reverb">🎛️ 1974 Black Ark Dub (RE-201)</button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ==================================================================
             PERSISTENT, MODULAR HISTORICAL CURRICULUM & COMPARISON PANEL BELOW
             ================================================================== -->
        <section class="te-curriculum-panel" aria-label="Historical Curriculum and Hardware Comparison">
          <header class="te-curr-header">
            <div class="te-curr-title-group">
              <span class="te-curr-tag">📚 HISTORICAL CURRICULUM &amp; ENGINEERING ANALYSIS</span>
              <h3>From the Tensioned Loop to the Free-Floating Tank: How Mechanical Tape Design Shaped Modern Music</h3>
            </div>
            <div class="te-curr-tabs" role="tablist">
              <button type="button" class="te-curr-tab active" data-curr-tab="all" role="tab" aria-selected="true">All 3 Modules (Side-by-Side)</button>
              <button type="button" class="te-curr-tab" data-curr-tab="copicat" role="tab" aria-selected="false">1. Watkins Copicat (Late 1950s)</button>
              <button type="button" class="te-curr-tab" data-curr-tab="space-echo" role="tab" aria-selected="false">2. Roland Space Echo (1974)</button>
              <button type="button" class="te-curr-tab" data-curr-tab="comparison" role="tab" aria-selected="false">3. Technical Comparison Matrix</button>
            </div>
          </header>

          <div class="te-curr-grid" id="te-curr-grid">
            <!-- MODULE 1: WATKINS COPICAT (LATE 1950s) -->
            <article class="te-curr-card" data-curr-section="copicat">
              <div class="te-curr-card-head cc-border">
                <span class="te-curr-num">01 · LATE 1950s LONDON</span>
                <h4>Watkins Copicat (1958): Charlie Watkins &amp; The Birth of Portable British Tape Echo</h4>
              </div>
              <div class="te-curr-card-body">
                <p>
                  <strong>Charlie Watkins' Engineering Breakthrough:</strong> In 1958, London accordion shop owner and audio pioneer <strong>Charlie Watkins</strong> (founder of Watkins Electric Music / WEM) heard Guy Mitchell’s American hit <em>"Singing the Blues"</em> and set out to recreate studio reel-to-reel slapback echo in a lunchbox-sized unit that working musicians could carry to gigs. Priced at just <strong>£38 10s</strong>, the <strong>Watkins Copicat</strong> became one of the world's first mass-produced portable tape echoes—selling over 1,000 units in its first months.
                </p>
                <p>
                  <strong>Defining Early British Rock &amp; Roll:</strong> Before the Copicat, tape echo required two bulky studio reel-to-reel machines (like the Ampex 350 at Sun Records). The Copicat gave British beat and instrumental bands instant access to multi-tap rhythmic ambiance. It immortalized the shivering guitar lead on <strong>Johnny Kidd &amp; The Pirates'</strong> <em>"Shakin' All Over"</em> (1960) and the galloping, syncopated melody of <strong>Hank Marvin &amp; The Shadows'</strong> <em>"Apache"</em>—inspiring an entire generation of British Invasion guitarists (Jimmy Page, David Gilmour, Brian May).
                </p>
                <p>
                  <strong>Physical Constraints of the Short Tensioned Loop:</strong> To keep the chassis compact, Watkins wrapped a short <strong>~21-inch endless spliced loop</strong> of $\frac{1}{4}\text{-inch}$ magnetic tape around a <strong>spring-loaded tension arm</strong> and pulled it across a static block of Erase, Record, and 3 Playback heads at $3.75\text{ IPS}$. Because the entire loop completed a full revolution every $0.56\text{ seconds}$:
                </p>
                <ul>
                  <li><strong>Rapid Tape Degradation:</strong> Every inch of tape scraped across five metal heads and pinch rollers over <em>100 times per minute</em>, rapidly shedding magnetic iron-oxide particles, depleting tape lubricant, and dulling high frequencies within hours of gigging.</li>
                  <li><strong>Pronounced Wow, Flutter &amp; Splice Thump:</strong> Constant mechanical tension from the spring arm, combined with pulley eccentricities and the glued $45^\circ$ tape splice repeatedly striking the head block, produced unmistakable pitch warble (<strong>wow and flutter</strong>) and rhythmic splice dropouts.</li>
                </ul>
              </div>
            </article>

            <!-- MODULE 2: ROLAND RE-201 SPACE ECHO (1974) -->
            <article class="te-curr-card" data-curr-section="space-echo">
              <div class="te-curr-card-head re-border">
                <span class="te-curr-num">02 · 1974 OSAKA, JAPAN</span>
                <h4>Roland RE-201 Space Echo (1974): The Free-Floating Tape Tank Revolution</h4>
              </div>
              <div class="te-curr-card-body">
                <p>
                  <strong>Mechanical Evolution — The Free-Floating Tape Tank:</strong> Introduced in 1974 by Roland founder <strong>Ikutaro Kakehashi</strong> (building on earlier Japanese Ace Tone designs), the <strong>RE-201 Space Echo</strong> solved the #1 failure mode of 1950s/60s tape echoes: high-tension loop wear. Instead of stretching a short loop around spring pulleys or pinching it onto reels, the RE-201 fed roughly <strong>27 feet ($8.2\text{ meters}$) of endless $\frac{1}{4}\text{-inch}$ tape</strong> into a wide, shallow <strong>free-floating ballistic chamber</strong> beneath a clear acrylic lid.
                </p>
                <p>
                  <strong>Why Eliminating Loop Tension Changed Everything:</strong>
                </p>
                <ul>
                  <li><strong>Drastically Reduced Mechanical Wear:</strong> Because the capstan and pinch roller only pulled tape across the head block while the remaining 26 feet of tape folded loosely in serpentine ribbons with zero spring tension, any single point on the tape passed over the heads only once every ~25–90 seconds—extending tape life by more than $15\times$.</li>
                  <li><strong>Stabilized Wow &amp; Flutter ($0.18\%\text{ WRMS}$):</strong> Decoupling the head block from a taut endless loop via precision ball-bearing rollers and felt dampers smoothed out mechanical jitter, yielding silkier pitch stability and wider frequency bandwidth.</li>
                  <li><strong>12-Position Multi-Head &amp; Spring Reverb Matrix:</strong> Combining 3 unequally spaced playback heads with an internal 3-spring reverb tank and a variable-speed DC servo capstan motor (**Repeat Rate**) turned the RE-201 into a playable rhythmic instrument—foundational to <strong>Jamaican Dub &amp; Reggae</strong> (Lee "Scratch" Perry, King Tubby, Scientist), cosmic electronic music (Tangerine Dream, Brian Eno), and modern alternative production (Radiohead, Portishead).</li>
                </ul>
              </div>
            </article>

            <!-- MODULE 3: DIRECT HARDWARE & SONIC COMPARISON -->
            <article class="te-curr-card" data-curr-section="comparison">
              <div class="te-curr-card-head cmp-border">
                <span class="te-curr-num">03 · ENGINEERING CONTRAST</span>
                <h4>Hardware Comparison: Tensioned Loop vs. Free-Floating Tank &amp; Sonic Signatures</h4>
              </div>
              <div class="te-curr-card-body">
                <p>
                  How a tape machine physically transports magnetic oxide past its heads directly dictates its musical character:
                </p>
                <table class="te-cmp-table">
                  <thead>
                    <tr>
                      <th>Engineering Dimension</th>
                      <th>Watkins Copicat (1958)</th>
                      <th>Roland RE-201 Space Echo (1974)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Tape Transport Mechanism</strong></td>
                      <td>~21-inch spliced loop under continuous <strong>spring-arm tension</strong></td>
                      <td>~27-foot endless loop folding loosely in a <strong>free-floating tank</strong></td>
                    </tr>
                    <tr>
                      <td><strong>Speed &amp; Pitch Control</strong></td>
                      <td>Fixed $3.75\text{ IPS}$ AC motor; <strong>Motor Switch</strong> creates start/stop pitch-slur</td>
                      <td>Continuous DC servo <strong>Repeat Rate</strong> ($1.75–5.75\text{ IPS}$) for live Doppler sweeps</td>
                    </tr>
                    <tr>
                      <td><strong>Head Switching &amp; Reverb</strong></td>
                      <td>3 independent latching push-buttons (Heads 1, 2, 3); no reverb tank</td>
                      <td>12-position rotary switch routing Heads 1–3 + built-in <strong>3-Spring Reverb</strong></td>
                    </tr>
                    <tr>
                      <td><strong>Wow, Flutter &amp; Wear</strong></td>
                      <td>High ($>0.6\%$); rapid oxide wear &amp; audible splice pass every $0.56\text{ s}$</td>
                      <td>Low ($0.18\%\text{ WRMS}$); gentle organic drift &amp; $15\times$ longer tape life</td>
                    </tr>
                    <tr>
                      <td><strong>Sonic Signature</strong></td>
                      <td><strong>Gritty, barking, unstable modulation</strong> with tube mid-bite &amp; chorus warble</td>
                      <td><strong>Rhythmic poly-tap complexity</strong>, warm dub bass/treble sculpting &amp; smooth self-oscillation</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </div>
    `;

    this.reCanvas = this.mountEl.querySelector('#re-cutaway-canvas');
    this.reCtx = this.reCanvas ? this.reCanvas.getContext('2d') : null;
    this.ccCanvas = this.mountEl.querySelector('#cc-cutaway-canvas');
    this.ccCtx = this.ccCanvas ? this.ccCanvas.getContext('2d') : null;

    this._updateRe201Readouts();
    this._updateCopicatReadouts();
  }

  _bindEvents() {
    const q = (sel) => this.mountEl.querySelector(sel);
    const qa = (sel) => this.mountEl.querySelectorAll(sel);

    // 1. Transport Play / Stop
    const playBtn = q('#te-btn-play');
    const stemSelect = q('#te-stem-select');
    if (playBtn) {
      playBtn.addEventListener('click', async () => {
        if (this.engine.isPlaying) {
          this.engine.stopStem();
        } else {
          await this.engine.playStem(stemSelect ? stemSelect.value : 'dub-skank');
        }
      });
    }

    if (stemSelect) {
      stemSelect.addEventListener('change', async () => {
        this.engine.currentStemId = stemSelect.value;
        if (this.engine.isPlaying) {
          await this.engine.playStem(stemSelect.value);
        }
      });
    }

    // One-shot buttons
    const chordBtn = q('#te-btn-chord');
    if (chordBtn) {
      chordBtn.addEventListener('click', () => {
        this.engine.triggerGuitarChord();
        this._spawnFluxPulse('both', 1.0);
      });
    }

    const rimBtn = q('#te-btn-rimshot');
    if (rimBtn) {
      rimBtn.addEventListener('click', () => {
        this.engine.triggerDubRimshot();
        this._spawnFluxPulse('both', 1.0);
      });
    }

    // File upload
    const uploadBtn = q('#te-btn-upload');
    const fileInput = q('#te-file-input');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const name = await this.engine.loadCustomAudioFile(file);
        if (stemSelect) {
          let customOpt = stemSelect.querySelector('option[value="custom"]');
          if (!customOpt) {
            customOpt = document.createElement('option');
            customOpt.value = 'custom';
            stemSelect.appendChild(customOpt);
          }
          customOpt.textContent = `📂 Custom: ${name}`;
          stemSelect.value = 'custom';
        }
      });
    }

    // Output Routing Mode (0 = Both, 1 = RE-201 Solo, 2 = Copicat Solo)
    qa('.te-route-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = Number(btn.getAttribute('data-route'));
        qa('.te-route-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this.engine.setParam('routingMode', route, 0.02);
      });
    });

    // Shared Input Gain / Drive
    const inputGainSlider = q('#te-input-gain');
    const inputGainVal = q('#te-input-gain-val');
    if (inputGainSlider) {
      inputGainSlider.addEventListener('input', () => {
        const pct = Number(inputGainSlider.value);
        const linear = pct / 100.0;
        const db = linear > 0.01 ? (20 * Math.log10(linear)).toFixed(1) : '-∞';
        if (inputGainVal) {
          inputGainVal.textContent = `${pct}% (${db > 0 ? '+' : ''}${db} dB)`;
        }
        this.engine.setParam('inputGain', linear, 0.02);

        // Contextual Hint Trigger: Magnetic Saturation when Input Gain >= 150%
        if (pct >= 150) {
          this.triggerHelpfulHint('saturation');
        }
      });
    }

    // ── Roland RE-201 Controls ──
    // 12-Position Mode Buttons & Rotary Dial
    qa('.re-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = Number(btn.getAttribute('data-mode'));
        this._setRe201Mode(m);
      });
    });

    const dialWrap = q('#re-mode-dial-wrap');
    if (dialWrap) {
      dialWrap.addEventListener('click', () => {
        const cur = this.engine.getParam('reMode') || 11;
        const next = (cur % 12) + 1;
        this._setRe201Mode(next);
      });
    }

    const reRepeatRate = q('#re-repeat-rate');
    if (reRepeatRate) {
      reRepeatRate.addEventListener('input', () => {
        const norm = Number(reRepeatRate.value) / 100.0;
        this.engine.setParam('reRepeatRate', norm, 0.035);
        this._updateRe201Readouts();
      });
    }

    const reIntensity = q('#re-intensity');
    if (reIntensity) {
      reIntensity.addEventListener('input', () => {
        const pct = Number(reIntensity.value);
        const norm = pct / 100.0;
        this.engine.setParam('reIntensity', norm, 0.02);
        this._updateRe201Readouts();
        if (pct >= 85) {
          this.triggerHelpfulHint('runawayFeedback');
        }
      });
    }

    const reEchoVol = q('#re-echo-vol');
    if (reEchoVol) {
      reEchoVol.addEventListener('input', () => {
        const pct = Number(reEchoVol.value);
        this.engine.setParam('reEchoVol', pct / 100.0, 0.02);
        q('#re-echo-vol-val').textContent = `${pct}%`;
      });
    }

    const reReverbVol = q('#re-reverb-vol');
    if (reReverbVol) {
      reReverbVol.addEventListener('input', () => {
        const pct = Number(reReverbVol.value);
        this.engine.setParam('reReverbVol', pct / 100.0, 0.02);
        q('#re-reverb-vol-val').textContent = `${pct}%`;
      });
    }

    const reBass = q('#re-bass');
    if (reBass) {
      reBass.addEventListener('input', () => {
        const db = Number(reBass.value);
        this.engine.setParam('reBass', db, 0.025);
        q('#re-bass-val').textContent = `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
      });
    }

    const reTreble = q('#re-treble');
    if (reTreble) {
      reTreble.addEventListener('input', () => {
        const db = Number(reTreble.value);
        this.engine.setParam('reTreble', db, 0.025);
        q('#re-treble-val').textContent = `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
      });
    }

    // ── Watkins Copicat Controls ──
    [1, 2, 3].forEach((hNum) => {
      const btn = q(`#cc-btn-h${hNum}`);
      if (btn) {
        btn.addEventListener('click', () => {
          const paramName = `ccHead${hNum}`;
          const nextVal = this.engine.getParam(paramName) > 0.5 ? 0 : 1;
          this.engine.setParam(paramName, nextVal, 0.01);
          btn.classList.toggle('active', nextVal === 1);
          btn.setAttribute('aria-pressed', String(nextVal === 1));
          this._updateCopicatReadouts();
        });
      }
    });

    const ccMotorBtn = q('#cc-btn-motor');
    if (ccMotorBtn) {
      ccMotorBtn.addEventListener('click', () => {
        const nextMotor = this.engine.getParam('ccMotorOn') > 0.5 ? 0 : 1;
        this._setCopicatMotor(nextMotor);
      });
    }

    const ccSlurBtn = q('#cc-btn-slur-test');
    if (ccSlurBtn) {
      ccSlurBtn.addEventListener('click', async () => {
        if (!this.engine.isPlaying) {
          await this.engine.triggerGuitarChord();
        }
        // Cut motor briefly for 420ms then ramp back up to highlight the mechanical pitch-slur
        this._setCopicatMotor(0);
        setTimeout(() => {
          this._setCopicatMotor(1);
        }, 420);
      });
    }

    const ccSwell = q('#cc-swell');
    if (ccSwell) {
      ccSwell.addEventListener('input', () => {
        const pct = Number(ccSwell.value);
        this.engine.setParam('ccSwell', pct / 100.0, 0.02);
        q('#cc-swell-val').textContent = `${pct}%`;
      });
    }

    const ccSustain = q('#cc-sustain');
    if (ccSustain) {
      ccSustain.addEventListener('input', () => {
        const pct = Number(ccSustain.value);
        this.engine.setParam('ccSustain', pct / 100.0, 0.02);
        q('#cc-sustain-val').textContent =
          pct >= 85 ? `${pct}% (RUNAWAY VALVE OSC!)` : `${pct}%`;
        if (pct >= 85) {
          this.triggerHelpfulHint('runawayFeedback');
        }
      });
    }

    // Era Presets
    qa('.cc-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._applyEraPreset(btn.getAttribute('data-preset'));
      });
    });

    // ── Interactive Hardware Hotspots & Tape Mechanism Observation (Triggers Hint: Wow & Flutter) ──
    qa('.te-hw-hotspot').forEach((spot) => {
      const partId = spot.getAttribute('data-part');
      const title = spot.getAttribute('data-edu-title');
      const tip = spot.getAttribute('data-edu-tip');
      spot.addEventListener('mouseenter', () => {
        if (partId.startsWith('re-')) {
          this.reHoveredPart = partId;
          const st = q('#re-hover-status');
          if (st) st.innerHTML = `<strong>${title}:</strong> ${tip}`;
        } else {
          this.ccHoveredPart = partId;
          const st = q('#cc-hover-status');
          if (st) st.innerHTML = `<strong>${title}:</strong> ${tip}`;
        }
        // Observing tape transport components triggers Hint: Wow and Flutter
        if (
          partId === 're-tank' ||
          partId === 're-capstan' ||
          partId === 'cc-tension-arm' ||
          partId === 'cc-loop' ||
          partId === 'cc-capstan'
        ) {
          this.triggerHelpfulHint('wowFlutter');
        }
      });
      spot.addEventListener('mouseleave', () => {
        if (partId.startsWith('re-')) {
          this.reHoveredPart = null;
        } else {
          this.ccHoveredPart = null;
        }
      });
    });

    // Also trigger Wow & Flutter hint when observing either cutaway canvas for ~1.2 seconds
    ['#re-cutaway-canvas', '#cc-cutaway-canvas'].forEach((sel) => {
      const c = q(sel);
      if (!c) return;
      let hoverTimer = null;
      c.addEventListener('mouseenter', () => {
        hoverTimer = setTimeout(() => {
          this.triggerHelpfulHint('wowFlutter');
        }, 900);
      });
      c.addEventListener('mouseleave', () => {
        if (hoverTimer) clearTimeout(hoverTimer);
      });
    });

    // ── Helpful Hints Overlay & Pills ──
    qa('.te-hint-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const hintId = pill.getAttribute('data-hint-id');
        this.triggerHelpfulHint(hintId, true);
      });
    });

    const closeHintBtn = q('#te-hint-close-btn');
    if (closeHintBtn) {
      closeHintBtn.addEventListener('click', () => {
        const overlay = q('#te-hint-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    }

    const tryHintBtn = q('#te-hint-try-btn');
    if (tryHintBtn) {
      tryHintBtn.addEventListener('click', () => {
        if (!this.activeHintId) return;
        const hint = HELPFUL_HINTS[this.activeHintId];
        if (hint && hint.tryPreset) {
          this._applyEraPreset(hint.tryPreset);
        }
      });
    }

    // ── Curriculum Section Tabs ──
    qa('.te-curr-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-curr-tab');
        this.activeCurriculumTab = target;
        qa('.te-curr-tab').forEach((t) => {
          const active = t === tab;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', String(active));
        });

        const grid = q('#te-curr-grid');
        if (grid) {
          grid.classList.toggle('single-col', target !== 'all');
        }
        qa('.te-curr-card').forEach((card) => {
          const sec = card.getAttribute('data-curr-section');
          card.style.display = target === 'all' || target === sec ? 'flex' : 'none';
        });
      });
    });
  }

  _setRe201Mode(modeNum) {
    const m = Math.max(1, Math.min(12, Math.round(modeNum)));
    this.engine.setParam('reMode', m, 0.01);

    const q = (sel) => this.mountEl.querySelector(sel);
    const qa = (sel) => this.mountEl.querySelectorAll(sel);

    qa('.re-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-mode')) === m);
    });

    const bigNum = q('#re-mode-big-num');
    if (bigNum) bigNum.textContent = String(m);

    const pointer = q('#re-dial-pointer');
    if (pointer) {
      const deg = (m - 1) * 30;
      pointer.setAttribute('transform', `rotate(${deg} 60 60)`);
    }

    const modeObj = RE201_MODES.find((item) => item.mode === m);
    const descEl = q('#re-mode-desc');
    if (descEl && modeObj) {
      descEl.textContent = modeObj.label;
    }
  }

  _setCopicatMotor(motorOn) {
    const isOn = motorOn > 0.5 ? 1 : 0;
    this.engine.setParam('ccMotorOn', isOn, 0.01);

    const q = (sel) => this.mountEl.querySelector(sel);
    const btn = q('#cc-btn-motor');
    const txt = q('#cc-motor-btn-text');
    if (btn) {
      btn.classList.toggle('active', isOn === 1);
      btn.setAttribute('aria-pressed', String(isOn === 1));
    }
    if (txt) {
      txt.textContent = isOn === 1 ? 'MOTOR: ON' : 'MOTOR: OFF (COASTING)';
    }
    this._updateCopicatReadouts();
  }

  _updateRe201Readouts() {
    const q = (sel) => this.mountEl.querySelector(sel);
    const rateNorm = this.engine.getParam('reRepeatRate') ?? 0.52;
    const ips = (1.75 + rateNorm * 4.0).toFixed(2);
    const h1Ms = Math.round(185 * Math.pow(0.30, rateNorm));
    const h2Ms = Math.round(h1Ms * 1.92);
    const h3Ms = Math.round(h1Ms * 2.86);

    const rateValEl = q('#re-repeat-rate-val');
    if (rateValEl) rateValEl.textContent = `${Math.round(rateNorm * 100)}% (${ips} IPS)`;

    const speedChip = q('#re-speed-readout');
    if (speedChip) speedChip.textContent = `SPEED: ${ips} IPS`;

    const delayChip = q('#re-delay-readout');
    if (delayChip) delayChip.textContent = `H1: ${h1Ms}ms · H2: ${h2Ms}ms · H3: ${h3Ms}ms`;

    const intensityPct = Math.round((this.engine.getParam('reIntensity') ?? 0.48) * 100);
    const intValEl = q('#re-intensity-val');
    if (intValEl) {
      intValEl.textContent =
        intensityPct >= 85
          ? `${intensityPct}% (RUNAWAY SELF-OSC!)`
          : `${intensityPct}%`;
    }
  }

  _updateCopicatReadouts() {
    const q = (sel) => this.mountEl.querySelector(sel);
    const h1 = this.engine.getParam('ccHead1') > 0.5;
    const h2 = this.engine.getParam('ccHead2') > 0.5;
    const h3 = this.engine.getParam('ccHead3') > 0.5;
    const activeList = [];
    if (h1) activeList.push('H1');
    if (h2) activeList.push('H2');
    if (h3) activeList.push('H3');

    const headsChip = q('#cc-heads-readout');
    if (headsChip) {
      headsChip.textContent =
        activeList.length > 0 ? `ACTIVE: ${activeList.join(' + ')}` : 'ACTIVE: MUTE (DRY ONLY)';
    }
  }

  /**
   * Triggers or opens one of the 3 Contextual "Helpful Hints"
   */
  triggerHelpfulHint(hintId, forceShow = false) {
    const hint = HELPFUL_HINTS[hintId];
    if (!hint) return;

    const alreadyTriggered = this.triggeredHints.has(hintId);
    if (alreadyTriggered && !forceShow) return;

    this.triggeredHints.add(hintId);
    this.activeHintId = hintId;

    const q = (sel) => this.mountEl.querySelector(sel);
    const pill = q(`#hint-pill-${hintId}`);
    if (pill) {
      pill.classList.add('unlocked');
    }

    const overlay = q('#te-hint-overlay');
    if (overlay) {
      q('#te-hint-badge').textContent = hint.badge;
      q('#te-hint-title').textContent = hint.title;
      q('#te-hint-trigger').textContent = hint.triggerDesc;
      q('#te-hint-body').innerHTML = hint.body;
      q('#te-hint-try-btn').textContent = hint.tryActionLabel;
      overlay.style.display = 'block';
    }
  }

  _applyEraPreset(presetId) {
    const q = (sel) => this.mountEl.querySelector(sel);
    const setSlider = (id, val, eventType = 'input') => {
      const el = q(id);
      if (el) {
        el.value = String(val);
        el.dispatchEvent(new Event(eventType));
      }
    };

    if (presetId === 'apache-1960') {
      // Hank Marvin / The Shadows 1960 Copicat Multi-Head Gallop
      this.engine.setParam('ccHead1', 1);
      this.engine.setParam('ccHead2', 1);
      this.engine.setParam('ccHead3', 1);
      ['#cc-btn-h1', '#cc-btn-h2', '#cc-btn-h3'].forEach((s) => {
        const b = q(s);
        if (b) {
          b.classList.add('active');
          b.setAttribute('aria-pressed', 'true');
        }
      });
      setSlider('#cc-swell', 84);
      setSlider('#cc-sustain', 58);
      this._setCopicatMotor(1);
      this._updateCopicatReadouts();
      if (!this.engine.isPlaying) {
        const stemSel = q('#te-stem-select');
        if (stemSel) stemSel.value = 'shadows-guitar';
        this.engine.playStem('shadows-guitar');
      }
    } else if (presetId === 'rockabilly-58') {
      // 1958 London Skiffle / Rock & Roll single-head slapback
      this.engine.setParam('ccHead1', 1);
      this.engine.setParam('ccHead2', 0);
      this.engine.setParam('ccHead3', 0);
      q('#cc-btn-h1')?.classList.add('active');
      q('#cc-btn-h2')?.classList.remove('active');
      q('#cc-btn-h3')?.classList.remove('active');
      setSlider('#cc-swell', 78);
      setSlider('#cc-sustain', 22);
      this._setCopicatMotor(1);
      this._updateCopicatReadouts();
      this.engine.triggerGuitarChord();
    } else if (presetId === 'king-tubby-74') {
      // 1974 Black Ark / King Tubby Dub Space Echo
      this._setRe201Mode(11);
      setSlider('#re-repeat-rate', 44);
      setSlider('#re-intensity', 78);
      setSlider('#re-echo-vol', 85);
      setSlider('#re-reverb-vol', 64);
      setSlider('#re-bass', -3.5);
      setSlider('#re-treble', 4.5);
      if (!this.engine.isPlaying) {
        const stemSel = q('#te-stem-select');
        if (stemSel) stemSel.value = 'dub-skank';
        this.engine.playStem('dub-skank');
      }
    } else if (presetId === 'saturation-demo') {
      setSlider('#te-input-gain', 180);
      if (!this.engine.isPlaying) {
        this.engine.triggerGuitarChord();
      }
    } else if (presetId === 'wow-flutter-demo') {
      this._setCopicatMotor(0);
      setTimeout(() => this._setCopicatMotor(1), 400);
      if (!this.engine.isPlaying) {
        this.engine.playStem('shadows-guitar');
      }
    } else if (presetId === 'dub-oscillation-demo') {
      this._setRe201Mode(9);
      setSlider('#re-intensity', 96);
      this.engine.triggerDubRimshot();
    }
  }

  _updateTransportUI(playing) {
    const playBtn = this.mountEl.querySelector('#te-btn-play');
    if (!playBtn) return;
    playBtn.classList.toggle('is-playing', playing);
    playBtn.textContent = playing ? '⏹ STOP AUDIO' : '▶ PLAY AUDIO';
  }

  _handleTelemetry(telem) {
    const peakLed = this.mountEl.querySelector('#te-peak-led');
    if (peakLed) {
      const isHot = telem.inPeak > 0.88 || (this.engine.getParam('inputGain') || 1) >= 1.45;
      peakLed.classList.toggle('is-peaking', isHot);
    }

    const motorChip = this.mountEl.querySelector('#cc-motor-readout');
    if (motorChip && typeof telem.ccMotorSpeed === 'number') {
      const spdIps = (telem.ccMotorSpeed * 3.75).toFixed(2);
      const status =
        telem.ccMotorSpeed > 0.96
          ? 'STABLE'
          : telem.ccMotorSpeed < 0.06
          ? 'STOPPED'
          : 'PITCH-SLURRING';
      motorChip.textContent = `MOTOR: ${spdIps} IPS (${status})`;
    }

    if (telem.inPeak > 0.18 && Math.random() < 0.45) {
      this._spawnFluxPulse('both', Math.min(1.0, telem.inPeak));
    }
  }

  _spawnFluxPulse(target = 'both', strength = 0.8) {
    if (target === 'both' || target === 're') {
      this.reFluxPulses.push({ progress: 0.0, strength });
      if (this.reFluxPulses.length > 24) this.reFluxPulses.shift();
    }
    if (target === 'both' || target === 'cc') {
      this.ccFluxPulses.push({ progress: 0.0, strength });
      if (this.ccFluxPulses.length > 24) this.ccFluxPulses.shift();
    }
  }

  // ==========================================================================
  // REAL-TIME HARDWARE CUTAWAY CANVAS RENDERERS
  // ==========================================================================

  _startAnimationLoop() {
    const tick = (now) => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      this._drawRolandRe201Cutaway(dt, now);
      this._drawWatkinsCopicatCutaway(dt, now);

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  /**
   * Renders the Roland RE-201 Space Echo Cutaway Chassis:
   *  - Upper Free-Floating Tape Tank with undulating serpentine loose tape loops
   *  - Curved 5-Head Block (Erase, Record, Playback Heads 1, 2, 3)
   *  - Variable-speed DC Capstan & Rubber Pinch Roller (speed dynamically tied to Repeat Rate)
   *  - Internal 3-Spring Reverb Tank & Backlit Roland VU/Peak Meter
   */
  _drawRolandRe201Cutaway(dt, now) {
    const ctx = this.reCtx;
    if (!ctx) return;
    const W = this.reCanvas.width;
    const H = this.reCanvas.height;

    const repeatRate = this.engine.getParam('reRepeatRate') ?? 0.52;
    const intensity = this.engine.getParam('reIntensity') ?? 0.48;
    const mode = Math.round(this.engine.getParam('reMode') ?? 11);
    const modeInfo = RE201_MODES.find((m) => m.mode === mode) || RE201_MODES[10];

    // Visual tape speed maps dynamically to Repeat Rate (1.75 IPS .. 5.75 IPS)
    const ips = 1.75 + repeatRate * 4.0;
    const speedPxPerSec = 42 + repeatRate * 165;
    this.reTapeOffset = (this.reTapeOffset + speedPxPerSec * dt) % 28;
    this.reCapstanAngle += (2.2 + repeatRate * 8.5) * dt;

    ctx.clearRect(0, 0, W, H);

    // 1. Brushed Anodized Dark Green/Charcoal RE-201 Interior Chassis Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0d1311');
    bgGrad.addColorStop(1, '#141c19');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle chassis grid & industrial rivets
    ctx.strokeStyle = 'rgba(116, 198, 157, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 24; x < W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // 2. UPPER LEFT: FREE-FLOATING TAPE TANK (Smoked Acrylic Cutaway Window)
    const tankX = 28;
    const tankY = 18;
    const tankW = 355;
    const tankH = 112;

    ctx.save();
    ctx.fillStyle =
      this.reHoveredPart === 're-tank'
        ? 'rgba(45, 106, 79, 0.32)'
        : 'rgba(10, 16, 14, 0.92)';
    ctx.strokeStyle =
      this.reHoveredPart === 're-tank' ? '#74c69d' : 'rgba(116, 198, 157, 0.38)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(tankX, tankY, tankW, tankH, 8);
    ctx.fill();
    ctx.stroke();

    // Draw Free-Floating Serpentine Magnetic Tape Ribbons inside the tank
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tankX + 4, tankY + 4, tankW - 8, tankH - 8, 6);
    ctx.clip();

    ctx.strokeStyle = '#b07d4f'; // Warm brown ferric-oxide magnetic tape
    ctx.lineWidth = 2.6;
    ctx.beginPath();

    // Entry from right capstan discharge (tankX + tankW - 14, tankY + 86) folding leftwards
    const numFolds = 11;
    const foldSpanX = (tankW - 44) / numFolds;
    ctx.moveTo(tankX + tankW - 10, tankY + 95);

    for (let f = numFolds; f >= 0; f--) {
      const fx = tankX + 22 + f * foldSpanX;
      const wave1 = Math.sin(now * 0.0025 * (0.7 + repeatRate * 1.6) + f * 1.35) * 14;
      const wave2 = Math.cos(now * 0.004 * (0.6 + repeatRate * 1.4) - f * 0.9) * 9;
      const topY = tankY + 26 + Math.abs(wave1);
      const botY = tankY + tankH - 22 - Math.abs(wave2);

      ctx.bezierCurveTo(
        fx + foldSpanX * 0.45,
        topY,
        fx + foldSpanX * 0.15,
        botY,
        fx,
        f % 2 === 0 ? topY + 8 : botY - 8
      );
    }
    // Exit on bottom-left out to tension damper guide
    ctx.lineTo(tankX + 14, tankY + tankH - 6);
    ctx.stroke();

    // Smoked Acrylic Lid Glare & Label
    const glare = ctx.createLinearGradient(tankX, tankY, tankX + tankW, tankY + tankH);
    glare.addColorStop(0, 'rgba(255,255,255,0.06)');
    glare.addColorStop(0.5, 'rgba(255,255,255,0.01)');
    glare.addColorStop(1, 'rgba(116,198,157,0.05)');
    ctx.fillStyle = glare;
    ctx.fillRect(tankX, tankY, tankW, tankH);
    ctx.restore();

    ctx.fillStyle = '#95d5b2';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(
      `FREE-FLOATING TAPE TANK (27 FT LOOSE LOOP · ${ips.toFixed(1)} IPS)`,
      tankX + 10,
      tankY + 15
    );
    ctx.restore();

    // 3. UPPER RIGHT: INTERNAL 3-SPRING REVERB TANK & ROLAND LEVEL METER
    const spX = 402;
    const spY = 18;
    const spW = 234;
    const spH = 66;
    const revActive = modeInfo.reverb;

    ctx.fillStyle =
      this.reHoveredPart === 're-spring'
        ? 'rgba(64, 145, 108, 0.28)'
        : 'rgba(14, 20, 18, 0.9)';
    ctx.strokeStyle = revActive ? '#52b788' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(spX, spY, spW, spH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = revActive ? '#74c69d' : '#64748b';
    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.fillText(
      revActive ? '3-SPRING REVERB TANK (ENGAGED)' : '3-SPRING REVERB TANK (BYPASSED M1–4)',
      spX + 10,
      spY + 14
    );

    // Draw 3 helical springs
    for (let s = 0; s < 3; s++) {
      const sy = spY + 26 + s * 14;
      ctx.strokeStyle = revActive ? '#95d5b2' : '#475569';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(spX + 14, sy);
      for (let x = spX + 18; x < spX + spW - 14; x += 5) {
        const vib = revActive
          ? Math.sin(now * 0.018 + x * 0.25 + s) * (1.8 + this.engine.telemetry.rePeak * 3.5)
          : 1.5 * Math.sin(x * 0.5);
        ctx.lineTo(x, sy + vib);
      }
      ctx.stroke();
    }

    // Backlit Roland VU Meter + Peak LED (Right Middle)
    const vuX = 402;
    const vuY = 92;
    const vuW = 234;
    const vuH = 38;
    ctx.fillStyle = '#1b1912';
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(vuX, vuY, vuW, vuH, 5);
    ctx.fill();
    ctx.stroke();

    // Warm VU meter scale bar
    const levelNorm = Math.min(1.0, (this.engine.telemetry.rePeak || 0) * 0.9 + (intensity > 0.85 ? 0.65 : 0));
    const meterGrad = ctx.createLinearGradient(vuX + 8, 0, vuX + vuW - 50, 0);
    meterGrad.addColorStop(0, '#52b788');
    meterGrad.addColorStop(0.7, '#f59e0b');
    meterGrad.addColorStop(1, '#ef4444');
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(vuX + 10, vuY + 18, vuW - 68, 10);
    ctx.fillStyle = meterGrad;
    ctx.fillRect(vuX + 10, vuY + 18, (vuW - 68) * levelNorm, 10);

    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.fillText('LEVEL METER (ECHO + FEEDBACK)', vuX + 10, vuY + 13);

    // Peak LED inside meter housing
    const isPeak = (this.engine.telemetry.inPeak || 0) > 0.85 || intensity > 0.88;
    ctx.fillStyle = isPeak ? '#ff3b30' : '#451a1c';
    ctx.beginPath();
    ctx.arc(vuX + vuW - 26, vuY + 20, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 8.5px ui-monospace, monospace';
    ctx.fillText('PEAK', vuX + vuW - 38, vuY + 34);

    // 4. LOWER CURVED HEAD BLOCK: ERASE, RECORD, PLAYBACK HEADS 1, 2, 3 + CAPSTAN/PINCH ROLLER
    const heads = [
      { id: 're-erase',  label: 'ERASE', x: 92,  y: 185, active: true, color: '#f97316' },
      { id: 're-record', label: 'REC',   x: 172, y: 192, active: true, color: '#ef4444' },
      { id: 're-head1',  label: 'PB 1',  x: 270, y: 196, active: modeInfo.heads.includes(1), color: '#52b788' },
      { id: 're-head2',  label: 'PB 2',  x: 356, y: 196, active: modeInfo.heads.includes(2), color: '#52b788' },
      { id: 're-head3',  label: 'PB 3',  x: 442, y: 192, active: modeInfo.heads.includes(3), color: '#52b788' }
    ];

    const leftGuideX = 44;
    const leftGuideY = 165;
    const capstanX = 548;
    const capstanY = 168;

    // Active Feedback Regeneration Loop Arc from active PB heads back to REC head
    if (intensity > 0.05 && modeInfo.heads.length > 0) {
      ctx.save();
      ctx.strokeStyle =
        intensity >= 0.85
          ? `rgba(255, 107, 107, ${0.55 + 0.35 * Math.sin(now * 0.015)})`
          : `rgba(82, 183, 136, ${Math.min(0.75, intensity * 0.7)})`;
      ctx.lineWidth = intensity >= 0.85 ? 2.6 : 1.6;
      ctx.setLineOffset = -this.reTapeOffset;
      ctx.setLineDash([5, 5]);
      modeInfo.heads.forEach((hIdx) => {
        const hObj = heads[hIdx + 1];
        ctx.beginPath();
        ctx.moveTo(hObj.x, hObj.y + 16);
        ctx.quadraticCurveTo((hObj.x + 172) * 0.5, 232, 172, 208);
        ctx.stroke();
      });
      ctx.restore();
    }

    // Draw Animated Magnetic Tape Path from Tank -> Left Guide -> Heads -> Capstan -> Back into Tank
    ctx.save();
    ctx.strokeStyle = '#c08552';
    ctx.lineWidth = 4.0;
    ctx.beginPath();
    ctx.moveTo(tankX + 16, tankY + tankH);
    ctx.lineTo(leftGuideX, leftGuideY);
    heads.forEach((h) => ctx.lineTo(h.x, h.y - 10));
    ctx.lineTo(capstanX, capstanY + 12);
    ctx.lineTo(tankX + tankW - 14, tankY + tankH);
    ctx.stroke();

    // Animated dashed oxide motion markers along the tape path (speed matches Repeat Rate!)
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 14]);
    ctx.lineDashOffset = -this.reTapeOffset;
    ctx.beginPath();
    ctx.moveTo(leftGuideX, leftGuideY);
    heads.forEach((h) => ctx.lineTo(h.x, h.y - 10));
    ctx.lineTo(capstanX, capstanY + 12);
    ctx.stroke();
    ctx.restore();

    // Left Bearing Guide Roller
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(leftGuideX, leftGuideY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw the 5 Magnetic Heads
    heads.forEach((h) => {
      const isHovered = this.reHoveredPart === h.id;
      ctx.save();
      ctx.fillStyle = h.active ? '#1e293b' : '#0f172a';
      ctx.strokeStyle = isHovered ? '#ffffff' : h.active ? h.color : '#334155';
      ctx.lineWidth = isHovered ? 2.5 : 1.8;

      if (h.active) {
        ctx.shadowColor = h.color;
        ctx.shadowBlur = isHovered ? 14 : 7;
      }

      ctx.beginPath();
      ctx.roundRect(h.x - 20, h.y - 8, 40, 24, 4);
      ctx.fill();
      ctx.stroke();

      // Pole piece gap line at top of head
      ctx.strokeStyle = h.active ? h.color : '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y - 10);
      ctx.lineTo(h.x, h.y - 2);
      ctx.stroke();

      ctx.fillStyle = h.active ? '#f8fafc' : '#64748b';
      ctx.font = 'bold 9.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(h.label, h.x, h.y + 10);
      ctx.restore();
    });

    // Draw Rotating DC Servo Capstan & Rubber Pinch Roller on Right
    ctx.save();
    const isCapHover = this.reHoveredPart === 're-capstan';
    // Steel Capstan Shaft (above tape)
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = isCapHover ? '#74c69d' : '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(capstanX, capstanY - 4, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rotating spokes on Capstan
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = this.reCapstanAngle + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(capstanX, capstanY - 4);
      ctx.lineTo(capstanX + Math.cos(a) * 9, capstanY - 4 + Math.sin(a) * 9);
      ctx.stroke();
    }

    // Rubber Pinch Roller (pressing tape up against capstan)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = isCapHover ? '#74c69d' : '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(capstanX, capstanY + 23, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    for (let k = 0; k < 4; k++) {
      const a = -this.reCapstanAngle * 0.8 + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(capstanX, capstanY + 23);
      ctx.lineTo(capstanX + Math.cos(a) * 11, capstanY + 23 + Math.sin(a) * 11);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Renders the Watkins Copicat Top-Down Mechanical View:
   *  - Two-tone Turquoise & Cream British chassis surface
   *  - Left Spring-Loaded Tension Arm & Guide Roller (visibly flexing with wow/flutter & motor startup)
   *  - Short (~21-inch) Tensioned Spliced Tape Loop with animated diagonal splice marker
   *  - Static Cast-Alloy Head Block: Erase, Record, Playback Heads 1, 2, 3
   *  - Right Shaded-Pole AC Capstan Motor & Pinch Roller
   */
  _drawWatkinsCopicatCutaway(dt, now) {
    const ctx = this.ccCtx;
    if (!ctx) return;
    const W = this.ccCanvas.width;
    const H = this.ccCanvas.height;

    const motorSpeed = this.engine.telemetry.ccMotorSpeed ?? 1.0;
    const h1 = this.engine.getParam('ccHead1') > 0.5;
    const h2 = this.engine.getParam('ccHead2') > 0.5;
    const h3 = this.engine.getParam('ccHead3') > 0.5;
    const sustain = this.engine.getParam('ccSustain') ?? 0.45;

    // Tensioned loop speed scales with motorSpeed + noticeable wow & flutter jitter
    const wowJitter =
      motorSpeed > 0.05
        ? 1.0 + 0.09 * Math.sin(now * 0.011) + 0.04 * Math.sin(now * 0.068)
        : 0.0;
    const effectiveSpeed = motorSpeed * wowJitter;

    this.ccTapeOffset = (this.ccTapeOffset + effectiveSpeed * 145 * dt) % 24;
    this.ccCapstanAngle += effectiveSpeed * 6.2 * dt;
    this.ccSplicePos = (this.ccSplicePos + effectiveSpeed * 0.62 * dt) % 1.0;

    ctx.clearRect(0, 0, W, H);

    // 1. Classic Watkins Copicat Turquoise-Teal & Cream Top Deck
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0f292e');
    bgGrad.addColorStop(1, '#131f24');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Cream molded inner deck recess plate
    ctx.fillStyle = 'rgba(245, 240, 225, 0.06)';
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(22, 16, W - 44, H - 36, 12);
    ctx.fill();
    ctx.stroke();

    // 2. Mechanical Tension Arm & Spring Assembly on Left
    const armBounce =
      motorSpeed > 0.04
        ? Math.sin(now * 0.0115) * 3.8 +
          Math.sin(now * 0.065) * 1.4 +
          (1.0 - motorSpeed) * 12.0
        : 8.0;
    const leftPulleyX = 112 + armBounce;
    const leftPulleyY = 122;
    const rightCapstanX = 548;
    const rightCapstanY = 122;

    // Draw Coiled Tension Spring anchoring the left tension arm
    ctx.save();
    ctx.strokeStyle =
      this.ccHoveredPart === 'cc-tension-arm' ? '#fbbf24' : '#94a3b8';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(38, 122);
    for (let sx = 44; sx < leftPulleyX - 24; sx += 6) {
      const sy = 122 + ((sx / 6) % 2 === 0 ? -5 : 5);
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(leftPulleyX - 18, 122);
    ctx.stroke();

    // Pivoting Metal Tension Arm Bar
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(76, 198);
    ctx.lineTo(leftPulleyX, leftPulleyY);
    ctx.stroke();
    ctx.restore();

    // 3. Top Static Cast-Alloy Head Block (Erase, Record, Head 1, Head 2, Head 3)
    const ccHeads = [
      { id: 'cc-erase-rec', label: 'ERASE', x: 185, y: 60, active: motorSpeed > 0.05, color: '#f97316' },
      { id: 'cc-erase-rec', label: 'REC',   x: 236, y: 55, active: motorSpeed > 0.05, color: '#ef4444' },
      { id: 'cc-head1',     label: 'HEAD 1', x: 302, y: 52, active: h1, color: '#2dd4bf' },
      { id: 'cc-head2',     label: 'HEAD 2', x: 378, y: 52, active: h2, color: '#2dd4bf' },
      { id: 'cc-head3',     label: 'HEAD 3', x: 454, y: 55, active: h3, color: '#2dd4bf' }
    ];

    // 4. Draw Short (~21-Inch) Continuously Tensioned Endless Tape Loop
    ctx.save();
    const isLoopHover = this.ccHoveredPart === 'cc-loop';
    ctx.strokeStyle = isLoopHover ? '#f59e0b' : '#b87d4b';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(leftPulleyX, leftPulleyY - 26);
    ccHeads.forEach((h) => ctx.lineTo(h.x, h.y + 18));
    ctx.lineTo(rightCapstanX, rightCapstanY - 22);
    ctx.arc(rightCapstanX, rightCapstanY, 22, -Math.PI / 2, Math.PI / 2, false);
    ctx.lineTo(leftPulleyX, leftPulleyY + 26);
    ctx.arc(leftPulleyX, leftPulleyY, 26, Math.PI / 2, -Math.PI / 2, false);
    ctx.closePath();
    ctx.stroke();

    // Moving Tape Oxide Dashes around the taut loop
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([8, 14]);
    ctx.lineDashOffset = -this.ccTapeOffset;
    ctx.stroke();

    // Draw Visible 45-Degree Tape Splice Marker traveling around the loop
    const spliceAngle = this.ccSplicePos * Math.PI * 2;
    const loopCenterX = (leftPulleyX + rightCapstanX) * 0.5;
    const loopCenterY = 114;
    const spX = loopCenterX + Math.cos(spliceAngle) * 215;
    const spY = loopCenterY + Math.sin(spliceAngle) * 44;

    ctx.fillStyle = '#fb923c';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(spX, spY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fed7aa';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillText('SPLICE', spX - 18, spY + 16);
    ctx.restore();

    // Sustain Regeneration Feedback Arc inside the loop
    if (sustain > 0.05 && (h1 || h2 || h3)) {
      ctx.save();
      ctx.strokeStyle =
        sustain >= 0.85
          ? `rgba(251, 146, 60, ${0.6 + 0.35 * Math.sin(now * 0.018)})`
          : `rgba(45, 212, 191, ${Math.min(0.75, sustain * 0.7)})`;
      ctx.lineWidth = sustain >= 0.85 ? 2.5 : 1.6;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = this.ccTapeOffset;
      [
        { on: h1, x: 302 },
        { on: h2, x: 378 },
        { on: h3, x: 454 }
      ].forEach((tap) => {
        if (!tap.on) return;
        ctx.beginPath();
        ctx.moveTo(tap.x, 72);
        ctx.quadraticCurveTo((tap.x + 236) * 0.5, 118, 236, 72);
        ctx.stroke();
      });
      ctx.restore();
    }

    // Center Loop Label & ECC83 Valve Glow
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.3)';
    ctx.beginPath();
    ctx.roundRect(195, 98, 275, 44, 6);
    ctx.fill();
    ctx.stroke();

    // Glowing ECC83 Vacuum Tube Filament indicator inside chassis
    const valveGlow = 0.45 + 0.35 * Math.min(1.0, (this.engine.telemetry.ccPeak || 0) + sustain * 0.4);
    ctx.fillStyle = `rgba(251, 146, 60, ${valveGlow})`;
    ctx.beginPath();
    ctx.arc(216, 120, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.fillText('ECC83 / 6BR7 VALVE STAGE', 232, 116);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('SHORT 21" TENSIONED ENDLESS LOOP', 232, 131);
    ctx.restore();

    // Draw Left Tension Pulley Wheel
    ctx.save();
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = this.ccHoveredPart === 'cc-tension-arm' ? '#f59e0b' : '#475569';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(leftPulleyX, leftPulleyY, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(leftPulleyX, leftPulleyY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw Static Head Block & 5 Heads
    ccHeads.forEach((h) => {
      const isHovered = this.ccHoveredPart === h.id;
      ctx.save();
      ctx.fillStyle = h.active ? '#1e293b' : '#0f172a';
      ctx.strokeStyle = isHovered ? '#ffffff' : h.active ? h.color : '#334155';
      ctx.lineWidth = isHovered ? 2.5 : 1.8;
      if (h.active) {
        ctx.shadowColor = h.color;
        ctx.shadowBlur = isHovered ? 12 : 6;
      }
      ctx.beginPath();
      ctx.roundRect(h.x - 22, h.y - 12, 44, 26, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = h.active ? '#f8fafc' : '#64748b';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(h.label, h.x, h.y + 4);
      ctx.restore();
    });

    // Draw Right Shaded-Pole AC Capstan Motor & Pinch Roller
    ctx.save();
    const isCapHover = this.ccHoveredPart === 'cc-capstan';
    ctx.fillStyle = '#d97706'; // Brass capstan wheel
    ctx.strokeStyle = isCapHover ? '#ffffff' : '#fef3c7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rightCapstanX, rightCapstanY, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rotating spokes on Capstan
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.2;
    for (let k = 0; k < 3; k++) {
      const a = this.ccCapstanAngle + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(rightCapstanX, rightCapstanY);
      ctx.lineTo(rightCapstanX + Math.cos(a) * 16, rightCapstanY + Math.sin(a) * 16);
      ctx.stroke();
    }

    // Pinch Roller below/beside Capstan
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = isCapHover ? '#2dd4bf' : '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rightCapstanX + 26, rightCapstanY + 18, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

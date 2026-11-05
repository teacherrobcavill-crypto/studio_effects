/**
 * TapeFlangingModule.js
 * Master UI & Simulation Coordinator for 1960s Studio Tape Flanging ("Through the Zero").
 * 
 * Unites:
 *  - Dual Studer J37 4-Track Tape Transports & Tactile Flange Rim (StuderJ37Canvas)
 *  - Tektronix P1 Green Phosphor CRT Oscilloscope with 3 switchable views (OscilloscopeCanvas)
 *  - Abbey Road BPO Varispeed AC Frequency Oscillator & LFO Cam Simulator
 *  - Interactive Studio Clipboard with 4 self-guided pedagogical labs (ClipboardLabs)
 *  - Zero-persistence browser audio pipeline with preset 1960s stems and custom drag & drop
 */

import { FlangeAudioEngine } from '../audio/FlangeAudioEngine.js';
import { FlangePhysicsEngine } from '../physics/FlangePhysicsEngine.js';
import { StuderJ37Canvas } from './StuderJ37Canvas.js';
import { OscilloscopeCanvas } from './OscilloscopeCanvas.js';
import { ClipboardLabs } from './ClipboardLabs.js';

export class TapeFlangingModule {
  constructor(mountContainer, options = {}) {
    this.mount = mountContainer;
    this.options = options;

    this.audio = new FlangeAudioEngine();
    this.physics = new FlangePhysicsEngine();

    this.studerCanvas = null;
    this.scopeCanvas = null;
    this.clipboard = null;

    this.animFrameId = null;
    this.lastFrameTime = performance.now();

    this._buildDOM();
    this._initCanvases();
    this._bindControls();
    this._startLoop();
  }

  _buildDOM() {
    this.mount.innerHTML = `
      <div class="flange-app-shell">
        <!-- Top Studio Control Bar -->
        <header class="flange-master-bar">
          <div class="bar-brand">
            <span class="era-tag">1966–1968 · TAPE FLANGING</span>
            <div class="brand-titles">
              <h2>Dual-Machine Mechanical Flanger ("Through the Zero")</h2>
              <p>Studer J37 4-Track Transports · Ken Townsend BPO Varispeed · Comb Filter Physics</p>
            </div>
          </div>

          <!-- Transport, Stem Picker & File Drop -->
          <div class="bar-actions">
            <button type="button" id="btn-play-pause" class="btn-primary-play">
              <span id="play-icon">▶</span>
              <span id="play-label">START AUDIO</span>
            </button>

            <!-- 5 Authentic 1960s Stems -->
            <div class="stem-selector-cluster" role="radiogroup" aria-label="1960s Preset Stems">
              <span class="cluster-label">STEM:</span>
              <button type="button" class="btn-stem active" data-stem="drums" title="Glyn Johns 1968 Mono Room Breakbeat">Drums</button>
              <button type="button" class="btn-stem" data-stem="vocals" title="Psychedelic 1967 Double-Tracked Vocal Phrase">Vocals</button>
              <button type="button" class="btn-stem" data-stem="guitars" title="12-String Rickenbacker &amp; Vox AC30 Chime">Guitars</button>
              <button type="button" class="btn-stem" data-stem="bass" title="Flatwound Tic-Tac P-Bass (Abbey Road Style)">Bass</button>
              <button type="button" class="btn-stem" data-stem="keys" title="Hammond B3 Organ &amp; Leslie Chorus">Keys</button>
              <button type="button" class="btn-stem" data-stem="noise" title="Broadband Pink Noise (Textbook Comb Filter Calibrator)">Noise</button>
            </div>

            <!-- Zero-Persistence Local File Loader Dropzone -->
            <label class="btn-upload-file" id="drop-zone" title="Load your personal .wav/.mp3 into local browser RAM (zero server upload)">
              <span>📂 Load File</span>
              <input type="file" id="file-input" accept="audio/*" style="display:none;" />
            </label>

            <!-- Master Volume -->
            <div class="volume-cluster">
              <label for="master-vol">VOL:</label>
              <input type="range" id="master-vol" min="0" max="1" step="0.01" value="0.85" />
            </div>
          </div>
        </header>

        <!-- Zero-Persistence Privacy Banner -->
        <div class="privacy-banner">
          <span class="shield-icon">🛡️</span>
          <span><strong>Zero-Persistence Audio Sandbox:</strong> User files are decoded directly into volatile browser RAM via HTML5 FileReader. Audio buffers are destroyed upon session unload. Zero bytes leave your machine.</span>
        </div>

        <!-- Upper Visual Lab: CRT Oscilloscope & Live Telemetry -->
        <section class="crt-oscilloscope-section">
          <div class="crt-card-header">
            <div class="crt-title-block">
              <span class="crt-badge">TEKTRONIX / TELEQUIPMENT CRT</span>
              <span class="crt-model">P1 Phosphor Tube (555 Dual-Beam)</span>
            </div>

            <!-- 3 Switchable Pedagogical Modes -->
            <div class="crt-mode-tabs" role="tablist">
              <button type="button" class="btn-crt-mode active" data-mode="comb">
                1. Comb Filter Spectrum (FFT &amp; Notches)
              </button>
              <button type="button" class="btn-crt-mode" data-mode="phase">
                2. Dual-Trace Phase Waveforms (Superimposed)
              </button>
              <button type="button" class="btn-crt-mode" data-mode="tape">
                3. Tape Head Magnetic Flux Strip (Sync Marks)
              </button>
            </div>
          </div>

          <div class="crt-screen-wrapper">
            <canvas id="scope-canvas" width="1120" height="260"></canvas>
          </div>

          <!-- Real-Time Educational Telemetry Ticker -->
          <div class="telemetry-bar">
            <div class="telemetry-item">
              <span class="t-label">DELAY OFFSET (Δt):</span>
              <span class="t-val highlight" id="t-deltat">0.00 ms</span>
            </div>
            <div class="telemetry-item">
              <span class="t-label">REPRO HEAD GAP (Δx):</span>
              <span class="t-val" id="t-deltax">0.00 mm</span>
            </div>
            <div class="telemetry-item">
              <span class="t-label">POLARITY:</span>
              <span class="t-val" id="t-polarity">0° (Normal In-Phase)</span>
            </div>
            <div class="telemetry-item">
              <span class="t-label">DECK B SPEED:</span>
              <span class="t-val" id="t-speed">15.00 IPS (50.0 Hz)</span>
            </div>
            <div class="telemetry-item">
              <span class="t-label">THROUGH-ZERO STATE:</span>
              <span class="t-val tag" id="t-state">AT ZERO POINT (NULL POSSIBLE)</span>
            </div>
          </div>
        </section>

        <!-- Main Mechanical Workbench: Studer J37 Canvas & Hardware Consoles -->
        <main class="flange-workbench-grid">
          <!-- Left Column: Top-Down Studer J37 Tape Transports -->
          <div class="studer-canvas-card">
            <div class="deck-top-bar">
              <span class="card-tag">DUAL MECHANICAL TRANSPORTS</span>
              <span class="tactile-instruction">💡 <strong>Interactive Flange:</strong> Click &amp; drag directly on Deck B's left supply reel rim to slow down the tape!</span>
            </div>
            <div class="studer-canvas-wrapper">
              <canvas id="studer-canvas" width="940" height="390"></canvas>
            </div>
          </div>

          <!-- Right Column: Hardware Controls & BPO Varispeed Box -->
          <aside class="hardware-rack-card">
            <!-- Hardware Section 1: Red Phase Invert & Audition Routing -->
            <div class="rack-unit bakelite-unit">
              <div class="unit-title">ABBEY ROAD CONSOLE · CHANNEL ROUTING</div>
              
              <div class="routing-controls-grid">
                <!-- Red Bakelite Phase Invert Push Button -->
                <div class="phase-invert-cluster">
                  <button type="button" id="btn-phase-invert" class="btn-bakelite-invert" title="Flip Deck B polarity 180 degrees. At Δt = 0ms, audio completely vanishes!">
                    <span class="btn-indicator-lamp" id="lamp-phase"></span>
                    <span class="btn-text">PHASE INVERT 180°</span>
                  </button>
                  <span class="sub-hint">Required for Through-Zero Null</span>
                </div>

                <!-- Audition Selector -->
                <div class="audition-cluster">
                  <label>LISTEN MODE:</label>
                  <div class="btn-group-audition">
                    <button type="button" class="btn-aud active" data-aud="flange">FLANGE SUM</button>
                    <button type="button" class="btn-aud" data-aud="deckA">DECK A (REF)</button>
                    <button type="button" class="btn-aud" data-aud="deckB">DECK B (SLAVE)</button>
                    <button type="button" class="btn-aud" data-aud="null">NULL DIFF</button>
                  </div>
                </div>
              </div>

              <!-- Wet/Dry Mix Slider -->
              <div class="slider-row">
                <div class="slider-label-row">
                  <span>DECK B MIX / FLANGE INTENSITY:</span>
                  <span id="val-mix">100%</span>
                </div>
                <input type="range" id="slider-mix" min="0" max="1" step="0.01" value="1.0" />
              </div>

              <!-- Tape Saturation Drive Slider -->
              <div class="slider-row">
                <div class="slider-label-row">
                  <span>TAPE SATURATION (Hysteresis Warmth):</span>
                  <span id="val-sat">50%</span>
                </div>
                <input type="range" id="slider-sat" min="0" max="1" step="0.01" value="0.50" />
              </div>
            </div>

            <!-- Hardware Section 2: Ken Townsend B.P.O. Varispeed Frequency Generator -->
            <div class="rack-unit bpo-oscillator-unit">
              <div class="unit-header-bpo">
                <div class="bpo-metal-badge">B.P.O. OSCILLATOR</div>
                <div class="bpo-desc">British Post Office External Capstan AC Frequency Generator</div>
              </div>

              <!-- Mode Toggle: Manual Vernier Dial vs Automated LFO -->
              <div class="bpo-mode-switch-row">
                <span class="switch-label">CONTROL SOURCE:</span>
                <div class="switch-toggle-cluster">
                  <button type="button" class="btn-source-mode active" id="btn-mode-manual">MANUAL VERNIER</button>
                  <button type="button" class="btn-source-mode" id="btn-mode-lfo">AUTOMATED LFO</button>
                </div>
              </div>

              <!-- Manual Vernier Dial Panel -->
              <div id="panel-manual-vernier" class="vernier-panel">
                <div class="vernier-gauge-row">
                  <div class="vernier-readout">
                    <span class="dial-num" id="val-bpo-freq">50.00</span>
                    <span class="dial-unit">Hz (Cycles/Sec)</span>
                  </div>
                  <div class="vernier-status-text" id="vernier-speed-desc">Nominal 15.00 IPS Locked Sync</div>
                </div>

                <div class="vernier-dial-slider-row">
                  <span class="tick-label">45 Hz (-10%)</span>
                  <input type="range" id="slider-bpo-dial" min="45.0" max="55.0" step="0.05" value="50.0" />
                  <span class="tick-label">55 Hz (+10%)</span>
                </div>

                <div class="vernier-nudges">
                  <button type="button" class="btn-nudge" data-nudge="-0.20">◀ -0.2 Hz</button>
                  <button type="button" class="btn-nudge" data-nudge="-0.05">◀ -0.05 Hz</button>
                  <button type="button" class="btn-nudge btn-zero-lock" id="btn-lock-zero">★ LOCK ZERO POINT ★</button>
                  <button type="button" class="btn-nudge" data-nudge="+0.05">+0.05 Hz ▶</button>
                  <button type="button" class="btn-nudge" data-nudge="+0.20">+0.2 Hz ▶</button>
                </div>
              </div>

              <!-- Automated LFO Panel -->
              <div id="panel-automated-lfo" class="lfo-panel" style="display: none;">
                <div class="lfo-controls-grid">
                  <div class="lfo-col">
                    <label>WAVEFORM / CAM:</label>
                    <div class="btn-group-waveform">
                      <button type="button" class="btn-wave active" data-wave="sine">Sine</button>
                      <button type="button" class="btn-wave" data-wave="triangle">Triangle</button>
                      <button type="button" class="btn-wave" data-wave="cam">Mechanical Cam</button>
                    </div>
                  </div>

                  <div class="lfo-col">
                    <div class="slider-label-row">
                      <span>LFO SWEEP RATE:</span>
                      <span id="val-lfo-rate">0.25 Hz</span>
                    </div>
                    <input type="range" id="slider-lfo-rate" min="0.02" max="2.0" step="0.01" value="0.25" />
                  </div>

                  <div class="lfo-col">
                    <div class="slider-label-row">
                      <span>SWEEP DEPTH:</span>
                      <span id="val-lfo-depth">50%</span>
                    </div>
                    <input type="range" id="slider-lfo-depth" min="0" max="1" step="0.02" value="0.50" />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </main>

        <!-- Lower Section: Studio Session Clipboard (4 Guided Labs) & Deep-Dive Notes -->
        <section class="flange-lower-section">
          <!-- 4 Guided Student Labs Clipboard -->
          <div class="clipboard-mount" id="clipboard-container"></div>

          <!-- Deep-Dive Historical & Engineering Collapsible Drawers -->
          <div class="flange-curriculum-accordion">
            <details class="edu-foldable" open>
              <summary>
                <div class="edu-fold-header">
                  <span class="edu-fold-pill">DSP DERIVATION</span>
                  <strong>The Mathematical Anatomy of Through-Zero Comb Filtering</strong>
                </div>
                <span class="fold-arrow">▼</span>
              </summary>
              <div class="edu-fold-content">
                <p>When an acoustic signal $x(t)$ is split and recombined with a variable delay $\Delta t$, the continuous-time impulse response is:</p>
                <div class="math-block">
                  $$h(t) = \delta(t) \pm \delta(t - \Delta t)$$
                </div>
                <p>Taking the continuous Fourier transform yields the complex frequency response:</p>
                <div class="math-block">
                  $$H(\omega) = 1 \pm e^{-j \omega \Delta t}$$
                </div>
                <p>The squared magnitude response produces the characteristic cosine ripple (the "teeth" of the comb):</p>
                <div class="math-block">
                  $$|H(\omega)|^2 = 2 \pm 2\cos(\omega \Delta t)$$
                </div>
                <p>Notice that for <strong>Inverted Polarity</strong>, as $\Delta t \to 0$, $|H(\omega)|^2 = 2 - 2(1) = 0$ for <em>all frequencies</em>! The entire frequency spectrum flat-lines into total silence. This acoustic singularity can only occur in <strong>Through-Zero</strong> systems where the delayed line can cross seamlessly from positive to negative time relative to the reference track.</p>
              </div>
            </details>

            <details class="edu-foldable">
              <summary>
                <div class="edu-fold-header">
                  <span class="edu-fold-pill">HISTORICAL ARCHIVE</span>
                  <strong>Ken Townsend, George Martin, and the Birth of ADT &amp; Flanging (1966)</strong>
                </div>
                <span class="fold-arrow">▼</span>
              </summary>
              <div class="edu-fold-content">
                <p>During the April 1966 sessions for <em>Revolver</em> at EMI Studios (Abbey Road Studio 2), John Lennon grew exhausted from manually double-tracking his vocals for hours on end. Ken Townsend, then Abbey Road’s technical engineer, designed <strong>Artificial Double Tracking (ADT)</strong> by routing the sync head output of a Studer J37 4-track tape recorder through a secondary slave tape machine driven by a British Post Office variable-frequency oscillator.</p>
                <p>Townsend’s breakthrough was recognizing that by altering the capstan motor frequency from 50 Hz, he could advance or retard the slave tape by mere milliseconds. When Lennon asked George Martin how the magical doubling effect worked, Martin humorously replied:</p>
                <blockquote class="martin-quote">
                  "Now, listen, John... we take the original image and split it through a double-bifurcated splurging cadencor, which is synchronized by a secret flanging motor at 15 IPS!"
                </blockquote>
                <p>Lennon enthusiastically adopted the phrase, telling everyone: <em>"Flange it again, Ken!"</em> In the following year, Olympic Studios engineer George Chkiantz discovered that pressing one’s thumb physically against the supply reel rim swept the notches continuously across zero, producing the jet-plane swoosh heard on Small Faces’ "Itchycoo Park" and Jimi Hendrix’s <em>Axis: Bold as Love</em>.</p>
              </div>
            </details>
          </div>
        </section>
      </div>
    `;
  }

  _initCanvases() {
    const studerEl = this.mount.querySelector('#studer-canvas');
    if (studerEl) {
      this.studerCanvas = new StuderJ37Canvas(studerEl, this.physics, this.audio);
    }

    const scopeEl = this.mount.querySelector('#scope-canvas');
    if (scopeEl) {
      this.scopeCanvas = new OscilloscopeCanvas(scopeEl, this.physics, this.audio);
    }

    const clipboardEl = this.mount.querySelector('#clipboard-container');
    if (clipboardEl) {
      this.clipboard = new ClipboardLabs(clipboardEl, this.physics, this.audio, (evt, val) => {
        this._handleLabEvent(evt, val);
      });
    }
  }

  _bindControls() {
    // 1. Play / Pause
    const playBtn = this.mount.querySelector('#btn-play-pause');
    const playIcon = this.mount.querySelector('#play-icon');
    const playLabel = this.mount.querySelector('#play-label');

    const updatePlayState = (playing) => {
      if (playing) {
        playBtn.classList.add('is-playing');
        playIcon.textContent = '⏸';
        playLabel.textContent = 'PAUSE AUDIO';
      } else {
        playBtn.classList.remove('is-playing');
        playIcon.textContent = '▶';
        playLabel.textContent = 'START AUDIO';
      }
      if (this.options.onAudioStateChange) {
        this.options.onAudioStateChange(playing);
      }
    };

    playBtn.addEventListener('click', async () => {
      if (this.audio.isPlaying) {
        this.audio.stop();
        updatePlayState(false);
      } else {
        await this.audio.play();
        updatePlayState(true);
      }
    });

    // 2. Preset Stems
    const stemBtns = this.mount.querySelectorAll('.btn-stem');
    stemBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        stemBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.selectStem(btn.dataset.stem);
      });
    });

    // 3. Zero-Persistence File Ingestion & Drag-and-Drop
    const fileInput = this.mount.querySelector('#file-input');
    const dropZone = this.mount.querySelector('#drop-zone');

    const handleFile = async (file) => {
      if (!file) return;
      try {
        stemBtns.forEach((b) => b.classList.remove('active'));
        dropZone.classList.add('has-file');
        const res = await this.audio.loadCustomFile(file);
        dropZone.querySelector('span').textContent = `📁 ${res.fileName.substring(0, 14)}...`;
        updatePlayState(true);
      } catch (err) {
        alert(`Error loading local file: ${err.message}`);
      }
    };

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    // 4. Master Volume
    const masterVol = this.mount.querySelector('#master-vol');
    masterVol.addEventListener('input', (e) => {
      this.audio.setMasterVolume(parseFloat(e.target.value));
    });

    // 5. CRT Mode Switcher
    const crtBtns = this.mount.querySelectorAll('.btn-crt-mode');
    crtBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        crtBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.scopeCanvas) {
          this.scopeCanvas.setMode(btn.dataset.mode);
        }
      });
    });

    // 6. Phase Invert 180° Red Button
    const phaseBtn = this.mount.querySelector('#btn-phase-invert');
    const phaseLamp = this.mount.querySelector('#lamp-phase');

    phaseBtn.addEventListener('click', () => {
      const nextInvert = !this.audio.isPhaseInverted;
      this.audio.setPhaseInvert(nextInvert);
      if (nextInvert) {
        phaseBtn.classList.add('active');
        phaseLamp.classList.add('lamp-lit');
      } else {
        phaseBtn.classList.remove('active');
        phaseLamp.classList.remove('lamp-lit');
      }
    });

    // 7. Audition Mode Buttons
    const audBtns = this.mount.querySelectorAll('.btn-aud');
    audBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        audBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.setAuditionMode(btn.dataset.aud);
      });
    });

    // 8. Sliders: Mix & Tape Saturation
    const mixSlider = this.mount.querySelector('#slider-mix');
    const mixVal = this.mount.querySelector('#val-mix');
    mixSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      mixVal.textContent = `${Math.round(val * 100)}%`;
      this.audio.setWetDryMix(val);
    });

    const satSlider = this.mount.querySelector('#slider-sat');
    const satVal = this.mount.querySelector('#val-sat');
    satSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      satVal.textContent = `${Math.round(val * 100)}%`;
      this.audio.setTapeSaturation(val);
    });

    // 9. BPO Varispeed Controls
    const btnManual = this.mount.querySelector('#btn-mode-manual');
    const btnLFO = this.mount.querySelector('#btn-mode-lfo');
    const panelManual = this.mount.querySelector('#panel-manual-vernier');
    const panelLFO = this.mount.querySelector('#panel-automated-lfo');

    btnManual.addEventListener('click', () => {
      btnManual.classList.add('active');
      btnLFO.classList.remove('active');
      panelManual.style.display = 'block';
      panelLFO.style.display = 'none';
      this.physics.setLFO(false);
    });

    btnLFO.addEventListener('click', () => {
      btnLFO.classList.add('active');
      btnManual.classList.remove('active');
      panelManual.style.display = 'none';
      panelLFO.style.display = 'block';
      this.physics.setLFO(true);
    });

    // BPO Vernier Dial
    const bpoSlider = this.mount.querySelector('#slider-bpo-dial');
    const bpoFreqVal = this.mount.querySelector('#val-bpo-freq');
    const bpoSpeedDesc = this.mount.querySelector('#vernier-speed-desc');

    const updateBPOFreq = (freq) => {
      this.physics.setBPOFrequency(freq);
      bpoFreqVal.textContent = freq.toFixed(2);
      bpoSlider.value = freq;

      const ips = (15.0 * (freq / 50.0)).toFixed(2);
      if (Math.abs(freq - 50.0) < 0.05) {
        bpoSpeedDesc.textContent = 'Nominal 15.00 IPS Locked Sync';
      } else if (freq < 50.0) {
        bpoSpeedDesc.textContent = `Retard / Lag: ${ips} IPS (Deck B runs behind)`;
      } else {
        bpoSpeedDesc.textContent = `Advance / Lead: ${ips} IPS (Deck B pulls ahead)`;
      }
    };

    bpoSlider.addEventListener('input', (e) => {
      updateBPOFreq(parseFloat(e.target.value));
    });

    // Nudge Buttons & Zero Lock
    this.mount.querySelectorAll('.btn-nudge').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.id === 'btn-lock-zero') {
          this.physics.resetToZeroPoint();
          updateBPOFreq(50.0);
        } else {
          const delta = parseFloat(btn.dataset.nudge);
          const cur = this.physics.bpoFrequencyHz;
          updateBPOFreq(cur + delta);
        }
      });
    });

    // LFO Waveforms & Sliders
    const waveBtns = this.mount.querySelectorAll('.btn-wave');
    waveBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        waveBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.physics.setLFO(true, btn.dataset.wave, this.physics.lfoRateHz, this.physics.lfoDepth);
      });
    });

    const lfoRate = this.mount.querySelector('#slider-lfo-rate');
    const lfoRateVal = this.mount.querySelector('#val-lfo-rate');
    lfoRate.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      lfoRateVal.textContent = `${val.toFixed(2)} Hz`;
      this.physics.setLFO(true, this.physics.lfoWaveform, val, this.physics.lfoDepth);
    });

    const lfoDepth = this.mount.querySelector('#slider-lfo-depth');
    const lfoDepthVal = this.mount.querySelector('#val-lfo-depth');
    lfoDepth.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      lfoDepthVal.textContent = `${Math.round(val * 100)}%`;
      this.physics.setLFO(true, this.physics.lfoWaveform, this.physics.lfoRateHz, val);
    });

    // Window resize coordinator
    window.addEventListener('resize', () => {
      this._handleResize();
    });
  }

  _handleResize() {
    const studerEl = this.mount.querySelector('#studer-canvas');
    if (studerEl && this.studerCanvas) {
      const rect = studerEl.parentElement.getBoundingClientRect();
      const w = Math.floor(rect.width);
      if (w > 300) {
        this.studerCanvas.resize(w, Math.floor(w * 0.42));
      }
    }

    const scopeEl = this.mount.querySelector('#scope-canvas');
    if (scopeEl && this.scopeCanvas) {
      const rect = scopeEl.parentElement.getBoundingClientRect();
      const w = Math.floor(rect.width);
      if (w > 300) {
        this.scopeCanvas.resize(w, 260);
      }
    }
  }

  _handleLabEvent(evt, val) {
    // Sync UI elements when lab auto-configures
    if (evt === 'configured') {
      const state = this.physics.getState();

      // Update Phase Invert UI
      const phaseBtn = this.mount.querySelector('#btn-phase-invert');
      const phaseLamp = this.mount.querySelector('#lamp-phase');
      if (this.audio.isPhaseInverted) {
        phaseBtn.classList.add('active');
        phaseLamp.classList.add('lamp-lit');
      } else {
        phaseBtn.classList.remove('active');
        phaseLamp.classList.remove('lamp-lit');
      }

      // Update Stem buttons
      const stemBtns = this.mount.querySelectorAll('.btn-stem');
      stemBtns.forEach((b) => {
        b.classList.toggle('active', b.dataset.stem === this.audio.activeStemId);
      });

      // Update Vernier Dial
      const bpoSlider = this.mount.querySelector('#slider-bpo-dial');
      const bpoFreqVal = this.mount.querySelector('#val-bpo-freq');
      if (bpoSlider) bpoSlider.value = state.bpoFrequencyHz;
      if (bpoFreqVal) bpoFreqVal.textContent = state.bpoFrequencyHz.toFixed(2);
    }
  }

  /**
   * Main Simulation & Animation Loop (~60 FPS)
   */
  _startLoop() {
    const loop = (now) => {
      const dt = (now - this.lastFrameTime) / 1000.0;
      this.lastFrameTime = now;

      // 1. Step Physics Engine
      this.physics.update(dt);
      const state = this.physics.getState();

      // 2. Synchronize Audio Engine Delay & Dynamic Filter
      this.audio.syncPhysicsState(state);

      // 3. Render Studer J37 Tape Transports
      if (this.studerCanvas) {
        this.studerCanvas.render();
      }

      // 4. Render CRT Oscilloscope
      if (this.scopeCanvas) {
        this.scopeCanvas.render();
      }

      // 5. Update Interactive Clipboard Progress
      if (this.clipboard) {
        this.clipboard.update(dt);
      }

      // 6. Update Telemetry Bar
      this._updateTelemetry(state);

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  _updateTelemetry(state) {
    const dtEl = this.mount.querySelector('#t-deltat');
    const dxEl = this.mount.querySelector('#t-deltax');
    const polEl = this.mount.querySelector('#t-polarity');
    const spdEl = this.mount.querySelector('#t-speed');
    const stEl = this.mount.querySelector('#t-state');

    if (dtEl) {
      dtEl.textContent = `${state.deltaT_ms >= 0 ? '+' : ''}${state.deltaT_ms.toFixed(2)} ms (${state.deltaT_microsec} µs)`;
    }
    if (dxEl) {
      dxEl.textContent = `${state.tapeDisplacementMm >= 0 ? '+' : ''}${state.tapeDisplacementMm.toFixed(2)} mm`;
    }
    if (polEl) {
      polEl.textContent = this.audio.isPhaseInverted ? '180° (Phase Inverted)' : '0° (Normal In-Phase)';
      polEl.style.color = this.audio.isPhaseInverted ? '#ef4444' : '#4ade80';
    }
    if (spdEl) {
      spdEl.textContent = `${state.deckBSpeedIps.toFixed(2)} IPS (${state.bpoFrequencyHz.toFixed(2)} Hz)`;
    }
    if (stEl) {
      const isAtZero = Math.abs(state.deltaT_ms) < 0.15;
      if (isAtZero && this.audio.isPhaseInverted) {
        stEl.textContent = '★ TOTAL THROUGH-ZERO NULL ★';
        stEl.style.color = '#ef4444';
        stEl.style.borderColor = '#ef4444';
      } else if (isAtZero && !this.audio.isPhaseInverted) {
        stEl.textContent = '★ COHERENT ZERO SUM (+6 dB) ★';
        stEl.style.color = '#22c55e';
        stEl.style.borderColor = '#22c55e';
      } else if (Math.abs(state.deltaT_ms) > 15.0) {
        stEl.textContent = 'HAAS REGION: ADT / DOUBLE TRACKING';
        stEl.style.color = '#38bdf8';
        stEl.style.borderColor = '#38bdf8';
      } else {
        stEl.textContent = 'COMB FILTER FLANGING REGION';
        stEl.style.color = '#f59e0b';
        stEl.style.borderColor = '#f59e0b';
      }
    }
  }

  suspend() {
    if (this.audio) {
      this.audio.stop();
      const playIcon = this.mount.querySelector('#play-icon');
      const playLabel = this.mount.querySelector('#play-label');
      const playBtn = this.mount.querySelector('#btn-play-pause');
      if (playBtn) playBtn.classList.remove('is-playing');
      if (playIcon) playIcon.textContent = '▶';
      if (playLabel) playLabel.textContent = 'START AUDIO';
    }
  }

  destroy() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    if (this.audio) {
      this.audio.destroy();
    }
  }
}

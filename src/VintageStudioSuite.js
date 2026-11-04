import { injectScopedStyles } from './vintage-suite/injectScopedStyles.js';
import { ProceduralStemGenerator } from './vintage-suite/ProceduralStemGenerator.js';
import { GatedReverbModule } from './vintage-suite/GatedReverbModule.js';
import { DolbyCompanderModule } from './vintage-suite/DolbyCompanderModule.js';
import { SmpteSynchronizerModule } from './vintage-suite/SmpteSynchronizerModule.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

/**
 * Vintage Studio Technology Interactive Suite (1970s–1990s)
 * Portable, zero-global-pollution host integration class.
 */
export class VintageStudioSuite {
  /**
   * @param {HTMLElement} containerElement - DOM node to mount the UI inside
   * @param {Object} options
   * @param {AudioContext} [options.audioContext] - Shared AudioContext from host web app
   * @param {AudioNode} [options.destination] - Target output node (defaults to audioContext.destination)
   * @param {string} [options.initialModule] - 'gated-reverb' | 'dolby-compander' | 'smpte-sync' | 'all'
   */
  constructor(containerElement, options = {}) {
    if (!containerElement || !(containerElement instanceof HTMLElement)) {
      throw new Error('VintageStudioSuite requires a valid HTMLElement containerElement.');
    }

    this.containerElement = containerElement;
    this.externalAudioContext = options.audioContext || null;
    this.externalDestination = options.destination || null;
    this.ownsAudioContext = false;
    this.audioContext = this.externalAudioContext;

    this.currentModuleName = options.initialModule || 'all';
    this.activeModules = [];
    this.slotBuses = [];
    this.scheduledSources = [];
    this.abortController = new AbortController();

    // Master Stem & Transport State
    this.isPlaying = false;
    this.selectedStem = 'drums-1981'; // 'drums-1981' | 'vocal-pad' | 'calibration' | 'custom'
    this.customAudioBuffer = null;
    this.stemBuffers = {};
    this.masterVolume = 0.85;

    injectScopedStyles(this.containerElement);
    this.buildShellDOM();
    this.mount(this.currentModuleName);

    registerHubAudioCoordinator(() => {
      if (this.isPlaying) {
        this.stopStemLoop();
        this.isPlaying = false;
        this.syncShellUI();
      }
      if (this.audioContext && this.audioContext.state === 'running') {
        this.audioContext.suspend().catch(() => {});
      }
      notifyHubAudioState('app-vintage-suite', false);
    });
  }

  /**
   * Lazily initializes or resumes the AudioContext only when needed.
   * Never instantiates a global AudioContext on file load.
   * @returns {AudioContext}
   */
  ensureAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.ownsAudioContext = true;
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    if (!this.masterSourceBus) {
      this.masterSourceBus = this.audioContext.createGain();
      this.masterSourceBus.gain.value = 1.0;

      this.masterOutputBus = this.audioContext.createGain();
      this.masterOutputBus.gain.value = this.masterVolume;

      const targetDest = this.externalDestination || this.audioContext.destination;
      this.masterOutputBus.connect(targetDest);

      this.rebuildSeriesRouting();
    }

    return this.audioContext;
  }

  /**
   * Routes masterSourceBus through the currently active/focused rack module slot
   * so each rack unit (Gated Reverb, Dolby Compander, or SMPTE Synchronizer) is
   * auditioned cleanly without Rack Unit 01's 18ms pre-delay flamming into Rack Unit 03.
   */
  rebuildSeriesRouting() {
    if (!this.audioContext || !this.masterSourceBus || !this.masterOutputBus) return;

    try {
      this.masterSourceBus.disconnect();
    } catch (_) {}

    this.slotBuses.forEach((slot) => {
      try {
        slot.out.disconnect();
      } catch (_) {}
    });

    if (this.slotBuses.length === 0) {
      this.masterSourceBus.connect(this.masterOutputBus);
      return;
    }

    const idx = Math.min(
      this.slotBuses.length - 1,
      Math.max(0, this.activeSlotIndex || 0)
    );
    const activeSlot = this.slotBuses[idx];
    if (activeSlot) {
      this.masterSourceBus.connect(activeSlot.in);
      activeSlot.out.connect(this.masterOutputBus);
    } else {
      this.masterSourceBus.connect(this.masterOutputBus);
    }
  }

  buildShellDOM() {
    this.containerElement.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'vst-suite-root';
    root.innerHTML = `
      <header class="vst-suite-master-bar">
        <div class="vst-suite-brand">
          <span class="vst-suite-badge">1970s–1990s DSP</span>
          <div class="vst-suite-title-block">
            <div class="vst-suite-title">VINTAGE STUDIO TECHNOLOGY INTERACTIVE SUITE</div>
            <div class="vst-suite-subtitle">SSL 4000E / Drawmer DS201 Gated Reverb · Dolby A Cat. 22 Compander · Studer A800 / Zeta-3 SMPTE Sync</div>
          </div>
        </div>

        <nav class="vst-suite-module-tabs" aria-label="Rack Module Selector">
          <button type="button" class="vst-suite-tab-btn" data-mount="all">ALL 3 RACK UNITS</button>
          <button type="button" class="vst-suite-tab-btn" data-mount="gated-reverb">01 · GATED REVERB</button>
          <button type="button" class="vst-suite-tab-btn" data-mount="dolby-compander">02 · DOLBY A/B + AIR</button>
          <button type="button" class="vst-suite-tab-btn" data-mount="smpte-sync">03 · SMPTE 24-TRK SYNC</button>
        </nav>

        <div class="vst-suite-transport-strip">
          <button type="button" class="vst-suite-btn vst-suite-btn-power" data-action="toggle-play">
            <span class="vst-suite-led-dot" data-led="power"></span>
            <span data-label="play-text">START TEST SIGNAL</span>
          </button>

          <select class="vst-suite-select" data-action="select-stem" title="Procedural Test Signal & Stem Generator">
            <option value="drums-1981">Stem 1: 1981 Acoustic Drum Kit (Snare &amp; Toms)</option>
            <option value="vocal-pad">Stem 2: Breathy Vocal &amp; Analog Synth Pad</option>
            <option value="calibration">Stem 3: 1kHz / 8.5kHz / Quiet Floor Alignment</option>
            <option value="custom" disabled>Stem 4: Custom Loaded AudioBuffer</option>
          </select>

          <label class="vst-suite-file-label" title="Load custom WAV/MP3/OGG file into AudioBuffer">
            📂 LOAD AUDIO
            <input type="file" class="vst-suite-file-input" accept="audio/*" data-action="load-file" />
          </label>

          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-family:var(--vst-font-mono); font-size:10px; color:var(--vst-text-muted);">OUT</span>
            <input type="range" class="vst-suite-slider" data-action="master-vol" min="0" max="1.2" step="0.02" value="0.85" style="width:74px;" />
          </div>
        </div>
      </header>

      <div class="vst-suite-rack-stack" data-container="rack-stack"></div>
    `;

    this.rootEl = root;
    this.rackStackEl = root.querySelector('[data-container="rack-stack"]');
    this.containerElement.appendChild(root);

    this.bindShellEvents();
  }

  bindShellEvents() {
    const sig = { signal: this.abortController.signal };

    // Module Switcher Tabs
    this.rootEl.querySelectorAll('[data-mount]').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          const target = btn.getAttribute('data-mount');
          this.mount(target);
        },
        sig
      );
    });

    // Play / Stop Master Stem Generator
    const playBtn = this.rootEl.querySelector('[data-action="toggle-play"]');
    if (playBtn) {
      playBtn.addEventListener(
        'click',
        () => {
          this.togglePlayback();
        },
        sig
      );
    }

    // Stem Selector
    const stemSelect = this.rootEl.querySelector('[data-action="select-stem"]');
    if (stemSelect) {
      stemSelect.addEventListener(
        'change',
        () => {
          this.selectedStem = stemSelect.value;
          if (this.isPlaying) {
            this.restartStemLoop();
          }
        },
        sig
      );
    }

    // Custom Audio File Loader
    const fileInput = this.rootEl.querySelector('[data-action="load-file"]');
    if (fileInput) {
      fileInput.addEventListener(
        'change',
        async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            const ctx = this.ensureAudioContext();
            const arrayBuf = await file.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arrayBuf);
            this.setInputBuffer(decoded);
          } catch (err) {
            console.error('Failed to decode uploaded audio file:', err);
          }
        },
        sig
      );
    }

    // Master Volume Slider
    const volSlider = this.rootEl.querySelector('[data-action="master-vol"]');
    if (volSlider) {
      volSlider.addEventListener(
        'input',
        () => {
          this.masterVolume = parseFloat(volSlider.value);
          if (this.masterOutputBus && this.audioContext) {
            this.masterOutputBus.gain.setTargetAtTime(
              this.masterVolume,
              this.audioContext.currentTime,
              0.015
            );
          }
        },
        sig
      );
    }
  }

  getOrCreateStemBuffer(stemKey) {
    const ctx = this.ensureAudioContext();
    if (stemKey === 'custom' && this.customAudioBuffer) {
      return this.customAudioBuffer;
    }
    if (!this.stemBuffers[stemKey]) {
      if (stemKey === 'drums-1981') {
        this.stemBuffers[stemKey] = ProceduralStemGenerator.create80sDrumStem(ctx);
      } else if (stemKey === 'vocal-pad') {
        this.stemBuffers[stemKey] = ProceduralStemGenerator.createVocalPadStem(ctx);
      } else if (stemKey === 'calibration') {
        this.stemBuffers[stemKey] = ProceduralStemGenerator.createCalibrationStem(ctx);
      }
    }
    return this.stemBuffers[stemKey];
  }

  togglePlayback() {
    this.ensureAudioContext();
    this.activeModules.forEach((m) => m.ensureAudioGraph());
    this.rebuildSeriesRouting();

    if (this.isPlaying) {
      this.stopStemLoop();
      this.isPlaying = false;
    } else {
      this.isPlaying = true;
      this.restartStemLoop();
    }
    this.syncShellUI();
    notifyHubAudioState('app-vintage-suite', this.isPlaying);
  }

  stopStemLoop() {
    if (this.loopSourceNode) {
      try {
        this.loopSourceNode.stop();
        this.loopSourceNode.disconnect();
      } catch (_) {}
      this.loopSourceNode = null;
    }
  }

  restartStemLoop() {
    this.stopStemLoop();
    const ctx = this.ensureAudioContext();
    this.activeModules.forEach((m) => m.ensureAudioGraph());
    this.rebuildSeriesRouting();

    const buffer = this.getOrCreateStemBuffer(this.selectedStem);
    if (!buffer) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.masterSourceBus);
    src.start();
    this.loopSourceNode = src;
    this.scheduledSources.push(src);
  }

  triggerSingleSnareHit() {
    const ctx = this.ensureAudioContext();
    this.activeModules.forEach((m) => m.ensureAudioGraph());
    this.rebuildSeriesRouting();

    if (!this.stemBuffers.singleSnare) {
      this.stemBuffers.singleSnare = ProceduralStemGenerator.createSingleSnareHit(ctx);
    }

    const hitSrc = ctx.createBufferSource();
    hitSrc.buffer = this.stemBuffers.singleSnare;
    hitSrc.connect(this.masterSourceBus);
    hitSrc.start();
    this.scheduledSources.push(hitSrc);
    notifyHubAudioState('app-vintage-suite', true);
    setTimeout(() => {
      if (!this.isPlaying) notifyHubAudioState('app-vintage-suite', false);
    }, 900);
  }

  syncShellUI() {
    if (!this.rootEl) return;

    this.rootEl.querySelectorAll('[data-mount]').forEach((btn) => {
      btn.classList.toggle(
        'vst-suite-active',
        btn.getAttribute('data-mount') === this.currentModuleName
      );
    });

    const playBtn = this.rootEl.querySelector('[data-action="toggle-play"]');
    const playLed = this.rootEl.querySelector('[data-led="power"]');
    const playText = this.rootEl.querySelector('[data-label="play-text"]');

    if (playBtn) playBtn.classList.toggle('vst-suite-playing', this.isPlaying);
    if (playLed) {
      playLed.className = `vst-suite-led-dot ${this.isPlaying ? 'vst-suite-on-green' : ''}`;
    }
    if (playText) {
      playText.textContent = this.isPlaying ? 'STOP TEST SIGNAL' : 'START TEST SIGNAL';
    }
  }

  /**
   * Mounts either an individual rack simulator or all 3 units.
   * @param {'gated-reverb' | 'dolby-compander' | 'smpte-sync' | 'all'} moduleName
   */
  mount(moduleName = 'all') {
    this.currentModuleName = moduleName;

    // Cleanly tear down existing mounted modules
    this.activeModules.forEach((m) => m.destroy());
    this.activeModules = [];

    this.slotBuses.forEach((slot) => {
      try {
        slot.in.disconnect();
        slot.out.disconnect();
      } catch (_) {}
    });
    this.slotBuses = [];

    if (this.rackStackEl) {
      this.rackStackEl.innerHTML = '';
    }

    this.activeSlotIndex = 0;

    const createSlotBag = (slotIndex) => {
      let slotObj = null;
      const ensureSlot = () => {
        const ctx = this.ensureAudioContext();
        if (!slotObj) {
          slotObj = {
            in: ctx.createGain(),
            out: ctx.createGain()
          };
          this.slotBuses[slotIndex] = slotObj;
          this.rebuildSeriesRouting();
        }
        return slotObj;
      };

      return {
        ensureAudioContext: () => this.ensureAudioContext(),
        getInputNode: () => ensureSlot().in,
        getOutputNode: () => ensureSlot().out,
        onTriggerSingleHit: () => this.triggerSingleSnareHit()
      };
    };

    if (moduleName === 'gated-reverb' || moduleName === 'all') {
      const idx = this.activeModules.length;
      this.activeModules.push(new GatedReverbModule(this.rackStackEl, createSlotBag(idx)));
    }
    if (moduleName === 'dolby-compander' || moduleName === 'all') {
      const idx = this.activeModules.length;
      this.activeModules.push(new DolbyCompanderModule(this.rackStackEl, createSlotBag(idx)));
    }
    if (moduleName === 'smpte-sync' || moduleName === 'all') {
      const idx = this.activeModules.length;
      this.activeModules.push(new SmpteSynchronizerModule(this.rackStackEl, createSlotBag(idx)));
    }

    // When all 3 rack units are mounted, automatically switch active audio monitoring
    // to whichever rack unit the user interacts with so Unit 01's 18ms pre-delay
    // never flams into Unit 03's SMPTE Synchronizer.
    this.activeModules.forEach((mod, idx) => {
      if (mod.unitEl) {
        mod.unitEl.addEventListener(
          'pointerdown',
          () => {
            if (this.activeSlotIndex !== idx) {
              this.activeSlotIndex = idx;
              mod.ensureAudioGraph();
              this.rebuildSeriesRouting();
            }
          },
          { signal: this.abortController.signal }
        );
      }
    });

    if (this.audioContext) {
      this.activeModules.forEach((m) => m.ensureAudioGraph());
      this.rebuildSeriesRouting();
    }

    this.syncShellUI();
    initDeclarativeTips(this.rootEl);
  }

  /**
   * Injects a custom external AudioBuffer into the suite's input stem generator.
   * @param {AudioBuffer} audioBuffer
   */
  setInputBuffer(audioBuffer) {
    if (!audioBuffer) return;
    this.customAudioBuffer = audioBuffer;
    this.selectedStem = 'custom';

    if (this.rootEl) {
      const sel = this.rootEl.querySelector('[data-action="select-stem"]');
      if (sel) {
        const customOpt = sel.querySelector('option[value="custom"]');
        if (customOpt) customOpt.disabled = false;
        sel.value = 'custom';
      }
    }

    if (this.isPlaying) {
      this.restartStemLoop();
    }
  }

  /**
   * Strictly tears down all audio sources, Web Audio nodes, RAF loops, and DOM listeners.
   */
  destroy() {
    this.stopStemLoop();
    this.scheduledSources.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch (_) {}
    });
    this.scheduledSources = [];

    this.activeModules.forEach((m) => m.destroy());
    this.activeModules = [];

    this.slotBuses.forEach((slot) => {
      try {
        slot.in.disconnect();
        slot.out.disconnect();
      } catch (_) {}
    });
    this.slotBuses = [];

    if (this.masterSourceBus) {
      try {
        this.masterSourceBus.disconnect();
      } catch (_) {}
      this.masterSourceBus = null;
    }

    if (this.masterOutputBus) {
      try {
        this.masterOutputBus.disconnect();
      } catch (_) {}
      this.masterOutputBus = null;
    }

    if (this.ownsAudioContext && this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }

    this.abortController.abort();
    if (this.containerElement) {
      this.containerElement.innerHTML = '';
    }
  }
}

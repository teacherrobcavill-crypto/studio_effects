/**
 * @fileoverview Stage 4: 1960s EMT-140 Studio Hardware Rack UI Controller,
 * Fluted Bakelite SVG Rotary Knobs, Backlit Gondola Damper Scale, Moving-Coil Analog VU Needles +
 * 12-Segment Peak Ladders, Drag-and-Drop Audio Decoder, and One-Click Standalone Web App Exporter.
 */

import { AudioEngine } from './AudioEngine.js';
import { PlateVisualizer } from './PlateVisualizer.js';

const KNOB_DEFINITIONS = [
  {
    id: 'knob-input-gain',
    param: 'inputGain',
    label: 'INPUT GAIN',
    min: -24.0,
    max: 12.0,
    step: 0.1,
    defaultVal: 0.0,
    format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`
  },
  {
    id: 'knob-predelay',
    param: 'preDelay',
    label: 'PRE-DELAY',
    min: 0.0,
    max: 250.0,
    step: 1.0,
    defaultVal: 18.0,
    format: (v) => `${Math.round(v)} ms`
  },
  {
    id: 'knob-plate-size',
    param: 'plateSize',
    label: 'PLATE TENSION',
    min: 0.5,
    max: 2.0,
    step: 0.01,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`
  },
  {
    id: 'knob-decay',
    param: 'decay',
    label: 'NACHHALL T60',
    min: 0.2,
    max: 12.0,
    step: 0.1,
    defaultVal: 3.2,
    format: (v) => `${v.toFixed(1)} s`
  },
  {
    id: 'knob-damping',
    param: 'damping',
    label: 'DAMPER PAD',
    min: 0.0,
    max: 100.0,
    step: 1.0,
    defaultVal: 35.0,
    format: (v) => `${Math.round(v)}%`
  },
  {
    id: 'knob-mix',
    param: 'mix',
    label: 'WET / DRY',
    min: 0.0,
    max: 100.0,
    step: 1.0,
    defaultVal: 50.0,
    format: (v) => `${Math.round(v)}%`
  },
  {
    id: 'knob-output',
    param: 'outputGain',
    label: 'OUTPUT GAIN',
    min: -24.0,
    max: 6.0,
    step: 0.1,
    defaultVal: 0.0,
    format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`
  }
];

const VU_THRESHOLDS_DB = [-30, -24, -20, -16, -12, -9, -6, -4, -3, -1.5, 0, 1.5];

class PlateReverbApp {
  constructor() {
    this.audioEngine = new AudioEngine();
    this.visualizer = null;
    this.knobs = new Map();
    this.vuInputSegs = [];
    this.vuOutputSegs = [];

    // Ballistic smoothing for 1960s moving-coil analog VU needles
    this.needleAngleIn = -42.0;
    this.needleAngleOut = -42.0;

    this._initDOM();
    this._initVisualizer();
    this._initKnobs();
    this._initVUMeters();
    this._bindHardwareControls();
    this._bindDragAndDrop();
    this._bindWebAppExportButtons();
    this._updateGondolaScale();
    this._startRenderLoop();
  }

  _initDOM() {
    this.powerBtn = document.getElementById('btn-power');
    this.pilotJewel = document.getElementById('pilot-jewel');
    this.subSelect = document.getElementById('source-sub-select');
    this.trigBtn = document.getElementById('btn-trigger-impulse');
    this.loopBtn = document.getElementById('btn-loop-toggle');
    this.fileInput = document.getElementById('hidden-file-input');
    this.lowCutSwitch = document.getElementById('switch-lowcut');
    this.dropOverlay = document.getElementById('drop-overlay');

    // 1960s Gondola Mechanical Dial Elements
    this.gondolaNeedle = document.getElementById('gondola-needle');
    this.gondolaGapEl = document.getElementById('gondola-gap-val');
    this.gondolaRt60El = document.getElementById('gondola-rt60-val');
    this.gondolaAlloyEl = document.getElementById('gondola-alloy-val');

    // Analog Moving-Coil Needles
    this.vuNeedleIn = document.getElementById('vu-needle-in');
    this.vuNeedleOut = document.getElementById('vu-needle-out');
  }

  _initVisualizer() {
    const viewportContainer = document.getElementById('plate-canvas-container');
    this.visualizer = new PlateVisualizer(viewportContainer, this.audioEngine);

    const resetCamBtn = document.getElementById('btn-reset-camera');
    if (resetCamBtn) {
      resetCamBtn.addEventListener('click', () => {
        this.visualizer.resetCamera();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 1960s Fluted Black Phenolic Bakelite Skirted Knobs with Spun-Aluminum Caps
  // ---------------------------------------------------------------------------
  _initKnobs() {
    const startAngleDeg = -135;
    const endAngleDeg = 135;
    const radius = 32;
    const cx = 40;
    const cy = 40;

    const polarToCartesian = (angleDeg, r) => {
      const rad = ((angleDeg - 90) * Math.PI) / 180.0;
      return {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad)
      };
    };

    const describeArc = (angStart, angEnd, r) => {
      if (Math.abs(angEnd - angStart) < 0.1) return '';
      const start = polarToCartesian(angEnd, r);
      const end = polarToCartesian(angStart, r);
      const largeArcFlag = angEnd - angStart <= 180 ? '0' : '1';
      return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    };

    let ticksMarkup = '';
    for (let i = 0; i <= 10; i++) {
      const a = startAngleDeg + (i / 10) * (endAngleDeg - startAngleDeg);
      const p1 = polarToCartesian(a, 35.0);
      const p2 = polarToCartesian(a, 38.5);
      ticksMarkup += `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#cbd5e1" stroke-width="1.3" />`;
    }

    // Fluted Bakelite grip serrations
    let flutesMarkup = '';
    for (let i = 0; i < 12; i++) {
      const a = i * 30;
      const p = polarToCartesian(a, 22.5);
      flutesMarkup += `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.2" fill="#090b0d" />`;
    }

    const fullTrackPath = describeArc(startAngleDeg, endAngleDeg, radius);

    KNOB_DEFINITIONS.forEach((def) => {
      const container = document.getElementById(def.id);
      if (!container) return;

      container.innerHTML = `
        <div class="knob-tooltip">${def.format(def.defaultVal)}</div>
        <div class="knob-svg-wrap" title="Drag vertically, scroll wheel, or double-click to reset">
          <svg class="knob-svg" viewBox="0 0 80 80">
            <defs>
              <radialGradient id="bakeliteGrad" cx="35%" cy="30%" r="70%">
                <stop offset="0%" stop-color="#383e47" />
                <stop offset="55%" stop-color="#181b20" />
                <stop offset="100%" stop-color="#090b0d" />
              </radialGradient>
              <linearGradient id="spunSilverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f8fafc" />
                <stop offset="45%" stop-color="#94a3b8" />
                <stop offset="55%" stop-color="#e2e8f0" />
                <stop offset="100%" stop-color="#475569" />
              </linearGradient>
            </defs>
            ${ticksMarkup}
            <path class="knob-track" d="${fullTrackPath}" />
            <path class="knob-arc" d="" />
            <circle class="knob-skirt" cx="${cx}" cy="${cy}" r="26" />
            <circle class="knob-cap-outer" cx="${cx}" cy="${cy}" r="22" />
            ${flutesMarkup}
            <circle class="knob-cap-silver" cx="${cx}" cy="${cy}" r="11.5" />
            <line class="knob-pointer" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 21}" />
          </svg>
        </div>
        <div class="knob-label">${def.label}</div>
        <div class="knob-readout">${def.format(def.defaultVal)}</div>
      `;

      const arcEl = container.querySelector('.knob-arc');
      const pointerEl = container.querySelector('.knob-pointer');
      const readoutEl = container.querySelector('.knob-readout');
      const tooltipEl = container.querySelector('.knob-tooltip');
      const svgWrap = container.querySelector('.knob-svg-wrap');

      const state = {
        def,
        value: def.defaultVal,
        updateUI: (val) => {
          const clamped = Math.max(def.min, Math.min(def.max, val));
          state.value = clamped;
          const norm = (clamped - def.min) / (def.max - def.min);
          const angle = startAngleDeg + norm * (endAngleDeg - startAngleDeg);

          arcEl.setAttribute('d', describeArc(startAngleDeg, angle, radius));
          const tip = polarToCartesian(angle, 21);
          const base = polarToCartesian(angle, 7);
          pointerEl.setAttribute('x1', base.x.toFixed(2));
          pointerEl.setAttribute('y1', base.y.toFixed(2));
          pointerEl.setAttribute('x2', tip.x.toFixed(2));
          pointerEl.setAttribute('y2', tip.y.toFixed(2));

          const formatted = def.format(clamped);
          readoutEl.textContent = formatted;
          tooltipEl.textContent = formatted;
        }
      };

      state.updateUI(def.defaultVal);
      this.knobs.set(def.param, state);

      let startY = 0;
      let startVal = state.value;

      const onPointerMove = (e) => {
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = startY - clientY;
        const range = def.max - def.min;
        const sensitivity = e.shiftKey ? 450.0 : 160.0;
        const nextVal = startVal + (deltaY / sensitivity) * range;
        const stepped = Math.round(nextVal / def.step) * def.step;
        state.updateUI(stepped);
        this._onKnobChange(def.param, state.value);
      };

      const onPointerUp = () => {
        container.classList.remove('dragging');
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
      };

      svgWrap.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startVal = state.value;
        container.classList.add('dragging');
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
      });

      svgWrap.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        startVal = state.value;
        container.classList.add('dragging');
        window.addEventListener('touchmove', onPointerMove, { passive: true });
        window.addEventListener('touchend', onPointerUp);
      }, { passive: true });

      svgWrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const nextVal = state.value + dir * def.step * 2.0;
        state.updateUI(nextVal);
        this._onKnobChange(def.param, state.value);
      }, { passive: false });

      svgWrap.addEventListener('dblclick', () => {
        state.updateUI(def.defaultVal);
        this._onKnobChange(def.param, state.value);
      });
    });
  }

  _onKnobChange(param, value) {
    switch (param) {
      case 'inputGain':
        this.audioEngine.setGain(value);
        break;
      case 'preDelay':
        this.audioEngine.setPreDelay(value);
        break;
      case 'plateSize':
        this.audioEngine.setPlateSize(value);
        this.visualizer.setPlateSizeScale(value);
        break;
      case 'decay':
        this.audioEngine.setDecay(value);
        this._updateGondolaScale();
        break;
      case 'damping': {
        const norm = value / 100.0;
        this.audioEngine.setDamping(norm);
        this.visualizer.setDampingPosition(norm);
        this._updateGondolaScale();
        break;
      }
      case 'mix':
        this.audioEngine.setWetDry(value / 100.0);
        break;
      case 'outputGain':
        this.audioEngine.setOutputLevel(value);
        break;
    }
  }

  _updateGondolaScale() {
    const decay = this.audioEngine.params.decaySeconds;
    const damp = this.audioEngine.params.damping;
    // Map decay (0.2s .. 12.0s) and mechanical damping onto gondola pointer percentage
    const norm = Math.max(0.04, Math.min(0.96, ((decay - 0.2) / 11.8) * (1.0 - damp * 0.35)));
    if (this.gondolaNeedle) {
      this.gondolaNeedle.style.left = `${(norm * 100).toFixed(1)}%`;
    }
    if (this.gondolaGapEl) {
      const gapMm = Math.round(180 - damp * 172);
      this.gondolaGapEl.textContent = `PAD GAP: ${gapMm} mm`;
    }
    if (this.gondolaRt60El) {
      this.gondolaRt60El.textContent = `RT60: ${decay.toFixed(1)} s`;
    }
  }

  // ---------------------------------------------------------------------------
  // Dual Backlit Analog VU Needles + 12-Segment Peak LED Ladders
  // ---------------------------------------------------------------------------
  _initVUMeters() {
    const buildLadder = (containerId, targetArray) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = '';
      for (let i = 0; i < 12; i++) {
        const seg = document.createElement('div');
        let colorClass = 'green';
        if (i >= 8 && i <= 10) colorClass = 'amber';
        if (i === 11) colorClass = 'red';
        seg.className = `vu-seg ${colorClass}`;
        el.appendChild(seg);
        targetArray.push(seg);
      }
    };

    buildLadder('vu-input-ladder', this.vuInputSegs);
    buildLadder('vu-output-ladder', this.vuOutputSegs);
  }

  _updateVUMeters(inDb, outDb) {
    for (let i = 0; i < 12; i++) {
      const thresh = VU_THRESHOLDS_DB[i];
      if (this.vuInputSegs[i]) {
        this.vuInputSegs[i].classList.toggle('on', inDb >= thresh);
      }
      if (this.vuOutputSegs[i]) {
        this.vuOutputSegs[i].classList.toggle('on', outDb >= thresh);
      }
    }

    // Update 1960s Moving-Coil Analog Needles (-42 deg to +42 deg)
    const targetInAngle = Math.max(-42.0, Math.min(42.0, ((inDb + 36.0) / 39.0) * 84.0 - 42.0));
    const targetOutAngle = Math.max(-42.0, Math.min(42.0, ((outDb + 36.0) / 39.0) * 84.0 - 42.0));

    this.needleAngleIn += (targetInAngle - this.needleAngleIn) * 0.25;
    this.needleAngleOut += (targetOutAngle - this.needleAngleOut) * 0.22;

    if (this.vuNeedleIn) {
      this.vuNeedleIn.setAttribute('transform', `rotate(${this.needleAngleIn.toFixed(1)} 55 68)`);
    }
    if (this.vuNeedleOut) {
      this.vuNeedleOut.setAttribute('transform', `rotate(${this.needleAngleOut.toFixed(1)} 155 68)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Hardware Buttons, Switches & Source Selectors
  // ---------------------------------------------------------------------------
  _bindHardwareControls() {
    if (this.powerBtn) {
      this.powerBtn.addEventListener('click', async () => {
        if (!this.audioEngine.isInitialized) {
          await this.audioEngine.init();
          this._updatePowerUI(true);
          await this.audioEngine.triggerImpulse('rimshot');
        } else {
          const nextState = !this.audioEngine.isPowered;
          await this.audioEngine.setPower(nextState);
          this._updatePowerUI(nextState);
        }
      });
    }

    const sourceTabs = document.querySelectorAll('.hw-tab-btn[data-source]');
    sourceTabs.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const srcType = btn.getAttribute('data-source');
        sourceTabs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        this._populateSubSelect(srcType);

        try {
          await this.audioEngine.setSourceType(srcType);
          this._updatePowerUI(true);
          if (srcType === 'stem') {
            this.audioEngine.startLoop();
          } else if (srcType === 'file' && !this.audioEngine.customFileBuffer) {
            this.fileInput.click();
          }
          this._syncTransportButtons();
        } catch (_) {
          this._populateSubSelect('impulse');
        }
      });
    });

    if (this.subSelect) {
      this.subSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (this.audioEngine.sourceType === 'impulse') {
          this.audioEngine.impulseSubType = val;
          this.audioEngine.triggerImpulse(val);
          this._updatePowerUI(true);
        } else if (this.audioEngine.sourceType === 'stem') {
          this.audioEngine.stemSubType = val;
          if (this.audioEngine.isLoopPlaying) {
            this.audioEngine.startLoop();
          }
        }
      });
    }

    if (this.trigBtn) {
      this.trigBtn.addEventListener('click', async () => {
        await this.audioEngine.triggerImpulse(this.audioEngine.impulseSubType);
        this._updatePowerUI(true);
      });
    }

    if (this.loopBtn) {
      this.loopBtn.addEventListener('click', async () => {
        if (this.audioEngine.sourceType === 'impulse') {
          this.audioEngine.sourceType = 'stem';
          document.querySelectorAll('.hw-tab-btn[data-source]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-source') === 'stem');
          });
          this._populateSubSelect('stem');
        }
        await this.audioEngine.toggleLoopPlayback();
        this._updatePowerUI(true);
        this._syncTransportButtons();
      });
    }

    if (this.fileInput) {
      this.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          await this._handleLoadedFile(file);
        }
      });
    }

    const matBtns = document.querySelectorAll('.mat-push-btn[data-material]');
    const matNames = ['STEEL (EMT 140)', 'GOLD (EMT 240)', 'ALUMINIUM', 'TITANIUM'];
    matBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const matIdx = parseInt(btn.getAttribute('data-material'), 10);
        matBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        this.audioEngine.setMaterial(matIdx);
        this.visualizer.setMaterialPreset(matIdx);
        if (this.gondolaAlloyEl) this.gondolaAlloyEl.textContent = `PLATE: ${matNames[matIdx]}`;
      });
    });

    if (this.lowCutSwitch) {
      this.lowCutSwitch.addEventListener('click', () => {
        const next = !this.audioEngine.params.lowCut;
        this.audioEngine.setLowCut(next);
        this.lowCutSwitch.classList.toggle('active', next);
        const stateText = this.lowCutSwitch.querySelector('.sw-text');
        if (stateText) stateText.textContent = next ? '80Hz ON' : 'LINEAR';
      });
    }

    this._populateSubSelect('impulse');
  }

  _populateSubSelect(sourceType) {
    if (!this.subSelect) return;
    this.subSelect.innerHTML = '';

    if (sourceType === 'impulse') {
      const opts = [
        { value: 'rimshot', label: 'Acoustic Rimshot Transient' },
        { value: 'click', label: 'Dirac Delta Impulse Click' },
        { value: 'noise', label: '15ms White Noise Burst' }
      ];
      opts.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === this.audioEngine.impulseSubType) opt.selected = true;
        this.subSelect.appendChild(opt);
      });
      this.subSelect.disabled = false;
    } else if (sourceType === 'stem') {
      const opts = [
        { value: 'drums', label: '1960s Studio Drum Groove (110 BPM)' },
        { value: 'guitar', label: 'Dry Archtop Guitar Chords' },
        { value: 'vocal', label: 'Dry Vocal Formant Phrase' }
      ];
      opts.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === this.audioEngine.stemSubType) opt.selected = true;
        this.subSelect.appendChild(opt);
      });
      this.subSelect.disabled = false;
    } else if (sourceType === 'mic') {
      const opt = document.createElement('option');
      opt.value = 'mic';
      opt.textContent = 'Live Studio Microphone Input';
      this.subSelect.appendChild(opt);
      this.subSelect.disabled = true;
    } else if (sourceType === 'file') {
      const opt = document.createElement('option');
      opt.value = 'file';
      opt.textContent = this.audioEngine.customFileName || 'Drop or Select Audio File (.wav/.mp3/.ogg/.flac)';
      this.subSelect.appendChild(opt);
      this.subSelect.disabled = true;
    }
  }

  _syncTransportButtons() {
    if (!this.loopBtn) return;
    if (this.audioEngine.isLoopPlaying) {
      this.loopBtn.classList.add('playing');
      this.loopBtn.textContent = 'STOP LOOP';
    } else {
      this.loopBtn.classList.remove('playing');
      this.loopBtn.textContent = 'PLAY LOOP';
    }
  }

  _updatePowerUI(powered) {
    if (this.powerBtn) {
      this.powerBtn.classList.toggle('active', powered);
      this.powerBtn.textContent = powered ? 'MAINS ON' : 'MAINS OFF';
    }
    if (this.pilotJewel) {
      this.pilotJewel.classList.toggle('active', powered);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & Drop Audio File Decoder
  // ---------------------------------------------------------------------------
  _bindDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dropOverlay) this.dropOverlay.classList.add('visible');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null && this.dropOverlay) {
        this.dropOverlay.classList.remove('visible');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (this.dropOverlay) this.dropOverlay.classList.remove('visible');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        await this._handleLoadedFile(files[0]);
      }
    });
  }

  async _handleLoadedFile(file) {
    try {
      await this.audioEngine.loadAudioFile(file);
      this._updatePowerUI(true);
      document.querySelectorAll('.hw-tab-btn[data-source]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-source') === 'file');
      });
      this._populateSubSelect('file');
      this._syncTransportButtons();
    } catch (err) {
      console.error('Failed to decode dropped audio file:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // One-Click Copy / Download Self-Contained Web App Bundle
  // ---------------------------------------------------------------------------
  _bindWebAppExportButtons() {
    const copyBtn = document.getElementById('btn-copy-webapp');
    const downloadBtn = document.getElementById('btn-download-webapp');

    const getStandaloneHtml = async () => {
      for (const candidate of ['emt140-webapp.html', 'dist/index.html']) {
        try {
          const res = await fetch(candidate);
          if (res.ok) return await res.text();
        } catch (_) {}
      }
      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    };

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const htmlSource = await getStandaloneHtml();
        await navigator.clipboard.writeText(htmlSource);
        const origText = copyBtn.textContent;
        copyBtn.textContent = 'COPIED TO CLIPBOARD!';
        setTimeout(() => {
          copyBtn.textContent = origText;
        }, 2200);
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        const htmlSource = await getStandaloneHtml();
        const blob = new Blob([htmlSource], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'emt140-plate-reverb-webapp.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }
  }

  _startRenderLoop() {
    const tick = (nowMs) => {
      const telemetry = this.audioEngine.getTelemetry();
      this._updateVUMeters(telemetry.inputDb, telemetry.outputDb);
      if (this.visualizer) {
        this.visualizer.update(nowMs, telemetry);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.plateReverbApp = new PlateReverbApp();
});

import { MATERIAL_LIST, MATERIALS } from '../physics/Materials.js';
import { POLAR_PATTERNS } from '../physics/AcousticMath.js';
import { SCENARIOS } from './Scenarios.js';

export class UIManager {
  constructor(state, callbacks) {
    this.state = state;
    this.cb = callbacks;
    this.activeScenarioId = SCENARIOS[0].id;
    this.lastSolution = null;

    this._populateMaterialSelectors();
    this._populateScenarioButtons();
    this._bindControls();

    this.combCanvas = document.getElementById('comb-canvas');
    this.combCtx = this.combCanvas.getContext('2d');
    this.specCanvas = document.getElementById('spectrum-canvas');
    this.specCtx = this.specCanvas.getContext('2d');

    this._resizeCanvases();
    window.addEventListener('resize', () => this._resizeCanvases());
  }

  _resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [this.combCanvas, this.specCanvas]) {
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
    }
    if (this.lastSolution) {
      this._drawTransferFunction(this.lastSolution);
    }
  }

  _populateMaterialSelectors() {
    const faces = ['floor', 'ceiling', 'left', 'right', 'front', 'back'];
    for (const face of faces) {
      const select = document.getElementById(`mat-${face}`);
      if (!select) continue;
      select.innerHTML = '';
      for (const mat of MATERIAL_LIST) {
        const opt = document.createElement('option');
        opt.value = mat.id;
        opt.textContent = `${mat.name} (α₁ₖ=${mat.absorption[1000].toFixed(2)})`;
        if (this.state.surfaceMaterials[face] === mat.id) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', (e) => {
        this.state.surfaceMaterials[face] = e.target.value;
        this.cb.onRoomChanged();
      });
    }

    // Quick uniform room material preset buttons
    document.querySelectorAll('[data-uniform-mat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const matId = btn.getAttribute('data-uniform-mat');
        for (const face of faces) {
          this.state.surfaceMaterials[face] = matId;
          const sel = document.getElementById(`mat-${face}`);
          if (sel) sel.value = matId;
        }
        this.cb.onRoomChanged();
      });
    });
  }

  _populateScenarioButtons() {
    const container = document.getElementById('scenario-buttons');
    if (!container) return;
    container.innerHTML = '';

    SCENARIOS.forEach((scen) => {
      const btn = document.createElement('button');
      btn.className = `scenario-btn ${scen.id === this.activeScenarioId ? 'active' : ''}`;
      btn.dataset.scenarioId = scen.id;
      btn.innerHTML = `
        <span class="scen-num">${scen.number}</span>
        <span class="scen-info">
          <strong>${scen.title}</strong>
          <small>${scen.badge}</small>
        </span>
      `;
      btn.addEventListener('click', () => {
        this.activeScenarioId = scen.id;
        document.querySelectorAll('.scenario-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.scenarioId === scen.id);
        });
        this.cb.onLoadScenario(scen);
      });
      container.appendChild(btn);
    });
  }

  _bindControls() {
    // Transport Play / Stop
    const playBtn = document.getElementById('btn-play');
    playBtn.addEventListener('click', async () => {
      const playing = await this.cb.onTogglePlay();
      this.setPlayingUI(playing);
    });

    // Single Impulse Clap button
    const clapBtn = document.getElementById('btn-clap');
    clapBtn.addEventListener('click', () => {
      this.cb.onTriggerClap();
    });

    // Instrument selector buttons
    document.querySelectorAll('[data-instrument]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inst = btn.getAttribute('data-instrument');
        this.state.instrument = inst;
        document.querySelectorAll('[data-instrument]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-instrument') === inst);
        });
        this.cb.onInstrumentChanged(inst);
      });
    });

    // Master Volume
    const volSlider = document.getElementById('slider-volume');
    volSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('val-volume').textContent = `${Math.round(val * 100)}%`;
      this.cb.onVolumeChanged(val);
    });

    // Acoustic Layer Toggles (Direct, Early Reflections, Late Reverb, Image Ghosts, Wavefronts)
    const bindToggle = (id, key, isVisualOnly = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        const checked = e.target.checked;
        if (isVisualOnly) {
          this.cb.onVisualToggle(key, checked);
        } else {
          this.state.layers[key] = checked;
          this.cb.onLayerToggle(key, checked);
        }
      });
    };
    bindToggle('toggle-direct', 'direct', false);
    bindToggle('toggle-early', 'earlyReflections', false);
    bindToggle('toggle-reverb', 'lateReverb', false);
    bindToggle('toggle-ghosts', 'imageGhosts', true);
    bindToggle('toggle-wavefronts', 'wavefronts', true);

    // Room Dimension Sliders (Width, Height, Depth)
    const bindDim = (axis, sliderId, valId) => {
      const slider = document.getElementById(sliderId);
      const valEl = document.getElementById(valId);
      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.state.dimensions[axis] = v;
        valEl.textContent = `${v.toFixed(1)} m`;
        this._updateCoordSliderBounds();
        this.cb.onRoomChanged();
      });
    };
    bindDim('width', 'dim-width', 'val-dim-width');
    bindDim('height', 'dim-height', 'val-dim-height');
    bindDim('depth', 'dim-depth', 'val-dim-depth');

    // Source & Mic 3D Coordinate Sliders
    const bindCoord = (entity, axis, sliderId, valId) => {
      const slider = document.getElementById(sliderId);
      const valEl = document.getElementById(valId);
      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.state[entity][axis] = v;
        valEl.textContent = `${v.toFixed(2)} m`;
        this.cb.onCoordinatesChanged();
      });
    };
    bindCoord('sourcePos', 'x', 'src-x', 'val-src-x');
    bindCoord('sourcePos', 'y', 'src-y', 'val-src-y');
    bindCoord('sourcePos', 'z', 'src-z', 'val-src-z');
    bindCoord('micPos', 'x', 'mic-x', 'val-mic-x');
    bindCoord('micPos', 'y', 'mic-y', 'val-mic-y');
    bindCoord('micPos', 'z', 'mic-z', 'val-mic-z');

    // Polar Pattern & Mic Yaw Angle
    const polarSelect = document.getElementById('select-polar');
    polarSelect.innerHTML = '';
    Object.values(POLAR_PATTERNS).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (this.state.polarPattern === p.id) opt.selected = true;
      polarSelect.appendChild(opt);
    });
    polarSelect.addEventListener('change', (e) => {
      this.state.polarPattern = e.target.value;
      this.cb.onPolarChanged();
    });

    const yawSlider = document.getElementById('mic-yaw');
    const yawVal = document.getElementById('val-mic-yaw');
    yawSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.state.micYawDeg = v;
      yawVal.textContent = `${Math.round(v)}°`;
      this.cb.onPolarChanged();
    });
  }

  _updateCoordSliderBounds() {
    const { width, height, depth } = this.state.dimensions;
    const halfW = (width / 2 - 0.22).toFixed(2);
    const maxH = (height - 0.22).toFixed(2);
    const halfD = (depth / 2 - 0.22).toFixed(2);

    for (const prefix of ['src', 'mic']) {
      const sx = document.getElementById(`${prefix}-x`);
      const sy = document.getElementById(`${prefix}-y`);
      const sz = document.getElementById(`${prefix}-z`);
      if (sx) { sx.min = -halfW; sx.max = halfW; }
      if (sy) { sy.min = 0.22; sy.max = maxH; }
      if (sz) { sz.min = -halfD; sz.max = halfD; }
    }
  }

  setPlayingUI(isPlaying) {
    const playBtn = document.getElementById('btn-play');
    if (!playBtn) return;
    playBtn.classList.toggle('playing', isPlaying);
    playBtn.innerHTML = isPlaying
      ? `<span class="status-dot live"></span> STOP STUDIO ENGINE`
      : `<span class="status-dot"></span> START AUDIO ENGINE`;
  }

  /**
   * Synchronizes all DOM sliders/inputs when a Scenario preset is loaded or 3D nodes are dragged.
   */
  syncControlsFromState(scenarioObj = null) {
    this._updateCoordSliderBounds();

    const { width, height, depth } = this.state.dimensions;
    this._setSlider('dim-width', 'val-dim-width', width, `${width.toFixed(1)} m`);
    this._setSlider('dim-height', 'val-dim-height', height, `${height.toFixed(1)} m`);
    this._setSlider('dim-depth', 'val-dim-depth', depth, `${depth.toFixed(1)} m`);

    this.syncCoordinateSliders();

    const polarSel = document.getElementById('select-polar');
    if (polarSel) polarSel.value = this.state.polarPattern;
    this._setSlider('mic-yaw', 'val-mic-yaw', this.state.micYawDeg, `${Math.round(this.state.micYawDeg)}°`);

    // Surface materials
    for (const face of ['floor', 'ceiling', 'left', 'right', 'front', 'back']) {
      const sel = document.getElementById(`mat-${face}`);
      if (sel) sel.value = this.state.surfaceMaterials[face];
    }

    // Instrument buttons
    document.querySelectorAll('[data-instrument]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-instrument') === this.state.instrument);
    });

    // Layer checkboxes
    if (this.state.layers) {
      document.getElementById('toggle-direct').checked = this.state.layers.direct;
      document.getElementById('toggle-early').checked = this.state.layers.earlyReflections;
      document.getElementById('toggle-reverb').checked = this.state.layers.lateReverb;
    }

    // Update Scenario Lesson Banner
    if (scenarioObj) {
      document.getElementById('scenario-title').textContent = `${scenarioObj.number} · ${scenarioObj.title}`;
      document.getElementById('scenario-lesson').textContent = scenarioObj.lesson;
    }
  }

  syncCoordinateSliders() {
    const s = this.state.sourcePos;
    const m = this.state.micPos;
    this._setSlider('src-x', 'val-src-x', s.x, `${s.x.toFixed(2)} m`);
    this._setSlider('src-y', 'val-src-y', s.y, `${s.y.toFixed(2)} m`);
    this._setSlider('src-z', 'val-src-z', s.z, `${s.z.toFixed(2)} m`);
    this._setSlider('mic-x', 'val-mic-x', m.x, `${m.x.toFixed(2)} m`);
    this._setSlider('mic-y', 'val-mic-y', m.y, `${m.y.toFixed(2)} m`);
    this._setSlider('mic-z', 'val-mic-z', m.z, `${m.z.toFixed(2)} m`);
  }

  _setSlider(sliderId, valId, value, formatted) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (slider) slider.value = value;
    if (valEl) valEl.textContent = formatted;
  }

  /**
   * Updates all telemetry HUD readouts, Sabine RT60 bars, reflection table, and Bode curve.
   */
  updateTelemetry(solution) {
    this.lastSolution = solution;

    // 1. Primary Acoustic Telemetry Cards
    document.getElementById('hud-direct-dist').textContent = `${solution.direct.distance.toFixed(2)} m`;
    document.getElementById('hud-direct-delay').textContent = `${solution.direct.delayMs.toFixed(2)} ms`;
    document.getElementById('hud-itdg').textContent = `${solution.itdgMs.toFixed(2)} ms`;
    document.getElementById('hud-crit-dist').textContent = `${solution.criticalDistance.toFixed(2)} m`;
    document.getElementById('hud-schroeder').textContent = `${Math.round(solution.schroederFreq)} Hz`;
    document.getElementById('hud-volume').textContent = `${solution.reverb.volume.toFixed(1)} m³`;

    // Direct-to-Reverberant field status indicator
    const fieldBadge = document.getElementById('hud-field-regime');
    if (solution.direct.distance <= solution.criticalDistance) {
      fieldBadge.textContent = 'Direct-Field Dominated (d < dc)';
      fieldBadge.className = 'regime-pill direct-dom';
    } else {
      fieldBadge.textContent = 'Reverberant-Field Dominated (d > dc)';
      fieldBadge.className = 'regime-pill reverb-dom';
    }

    // 2. Boundary Loading Readout
    const bl = solution.boundaryLoading;
    document.getElementById('hud-boundary-boost').textContent = `+${bl.boostDb.toFixed(1)} dB`;
    document.getElementById('hud-boundary-regime').textContent = bl.spaceRegime;

    // 3. Sabine & Eyring RT60 Bars (125 Hz, 1 kHz, 4 kHz)
    for (const freq of [125, 1000, 4000]) {
      const sab = solution.reverb.sabine[freq];
      const eyr = solution.reverb.eyring[freq];
      const sabins = solution.reverb.sabins[freq];

      const valEl = document.getElementById(`rt60-val-${freq}`);
      const barEl = document.getElementById(`rt60-bar-${freq}`);
      const subEl = document.getElementById(`rt60-sub-${freq}`);

      if (valEl) valEl.textContent = `${sab.toFixed(2)} s`;
      if (subEl) subEl.textContent = `Eyring ${eyr.toFixed(2)}s · ${sabins.toFixed(1)} Sabins`;
      if (barEl) {
        const pct = Math.min(100, (sab / 2.8) * 100);
        barEl.style.width = `${pct}%`;
      }
    }

    // 4. Fundamental Axial Modes Readout
    const mX = solution.modes.axial.width[0].freq.toFixed(1);
    const mY = solution.modes.axial.height[0].freq.toFixed(1);
    const mZ = solution.modes.axial.depth[0].freq.toFixed(1);
    document.getElementById('hud-modes').textContent = `X:${mX}Hz · Y:${mY}Hz · Z:${mZ}Hz`;

    // 5. Six-Surface Specular Reflection Table
    const tbody = document.getElementById('reflection-table-body');
    if (tbody) {
      tbody.innerHTML = solution.reflections
        .map((r) => {
          const isFirst = solution.firstReflection && solution.firstReflection.id === r.id;
          return `
            <tr class="${isFirst ? 'first-arrival-row' : ''}">
              <td>
                <span class="wall-dot" style="background:${r.color}"></span>
                ${r.label}
              </td>
              <td class="mono">${r.totalDistance.toFixed(2)}m</td>
              <td class="mono">+${r.deltaTimeMs.toFixed(2)}ms</td>
              <td class="mono">${r.levelDb1k.toFixed(1)}dB</td>
              <td class="mono">${Math.round(r.firstCombNotchHz)}Hz</td>
            </tr>
          `;
        })
        .join('');
    }

    // 6. Redraw Real-time Acoustic Transfer Function / Comb Filter Canvas
    this._drawTransferFunction(solution);
  }

  /**
   * Renders the mathematical Room Transfer Function H(f) (20Hz - 20kHz)
   * showing real-time comb filtering notches, boundary loading boost, and axial modes.
   */
  _drawTransferFunction(solution) {
    const canvas = this.combCanvas;
    if (!canvas) return;
    const ctx = this.combCtx;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background Grid
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, W, H);

    const minF = 20;
    const maxF = 20000;
    const logSpan = Math.log(maxF / minF);
    const freqToX = (f) => ((Math.log(f / minF) / logSpan) * (W - 36)) + 28;
    const dbToY = (db) => {
      // Map [+16 dB .. -26 dB] to [12 .. H - 18]
      const norm = (16 - db) / 42;
      return 12 + norm * (H - 30);
    };

    // Horizontal dB lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6c757d';
    ctx.font = `${Math.max(9, Math.floor(H * 0.075))}px ui-monospace, SFMono-Regular, monospace`;

    for (const db of [12, 6, 0, -6, -12, -18, -24]) {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(28, y);
      ctx.lineTo(W - 8, y);
      ctx.stroke();
      if (db === 12 || db === 0 || db === -12 || db === -24) {
        ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 2, y + 3);
      }
    }

    // 0 dB reference line highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    ctx.moveTo(28, dbToY(0));
    ctx.lineTo(W - 8, dbToY(0));
    ctx.stroke();

    // Vertical Frequency Grid (60Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 10kHz)
    const gridFreqs = [
      { f: 63, lbl: '63' },
      { f: 125, lbl: '125' },
      { f: 250, lbl: '250' },
      { f: 500, lbl: '500' },
      { f: 1000, lbl: '1k' },
      { f: 2000, lbl: '2k' },
      { f: 4000, lbl: '4k' },
      { f: 10000, lbl: '10k' }
    ];
    for (const g of gridFreqs) {
      const x = freqToX(g.f);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, H - 16);
      ctx.stroke();
      ctx.fillText(g.lbl, x - 8, H - 4);
    }

    // Plot Axial Room Mode markers on bottom axis (< 200 Hz)
    ctx.strokeStyle = 'rgba(255, 146, 43, 0.45)';
    for (const m of solution.modes.allModes) {
      if (m.freq >= 20 && m.freq <= 250) {
        const mx = freqToX(m.freq);
        ctx.beginPath();
        ctx.moveTo(mx, H - 26);
        ctx.lineTo(mx, H - 16);
        ctx.stroke();
      }
    }

    // Plot Transfer Function Curve H(f)
    const { freqs, magDb } = solution.responseCurve;
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = freqToX(freqs[i]);
      const y = dbToY(magDb[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Subtle gradient fill under transfer function
    ctx.lineTo(freqToX(freqs[freqs.length - 1]), H - 16);
    ctx.lineTo(freqToX(freqs[0]), H - 16);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 10, 0, H - 16);
    grad.addColorStop(0, 'rgba(0, 245, 212, 0.28)');
    grad.addColorStop(1, 'rgba(0, 245, 212, 0.01)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /**
   * Renders real-time Web Audio FFT Spectrum + 3-Band Sabine RT60 Decay Envelope at 60fps.
   */
  renderLiveAudioFrame(analyserData) {
    const canvas = this.specCanvas;
    if (!canvas) return;
    const ctx = this.specCtx;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, W, H);

    // 1. Draw Sabine 3-Band Exponential Decay Curves (125Hz, 1kHz, 4kHz) as background reference
    if (this.lastSolution) {
      const bands = [
        { freq: 125, color: 'rgba(255, 107, 107, 0.55)', label: '125Hz' },
        { freq: 1000, color: 'rgba(0, 245, 212, 0.55)', label: '1kHz' },
        { freq: 4000, color: 'rgba(77, 171, 247, 0.55)', label: '4kHz' }
      ];
      const maxTimeSec = 2.2;
      for (const b of bands) {
        const rt = this.lastSolution.reverb.sabine[b.freq];
        ctx.beginPath();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        for (let px = 0; px < W; px += 4) {
          const t = (px / W) * maxTimeSec;
          // dB drop over time: -60 * (t / rt)
          const dbDrop = Math.min(60, 60 * (t / Math.max(0.05, rt)));
          const y = 10 + (dbDrop / 60) * (H - 22);
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }

    // 2. Draw Live FFT Spectrum Bars + Time-Domain Waveform if Audio is Active
    if (analyserData) {
      const { freqData, timeData } = analyserData;
      const numBars = 64;
      const barW = W / numBars;

      for (let i = 0; i < numBars; i++) {
        // Log-mapped bin index
        const binIdx = Math.min(
          freqData.length - 1,
          Math.floor(Math.pow(i / numBars, 1.85) * (freqData.length * 0.65))
        );
        const val = freqData[binIdx] / 255.0;
        const barH = val * (H - 18);

        ctx.fillStyle = `rgba(56, 217, 169, ${0.25 + val * 0.65})`;
        ctx.fillRect(i * barW + 1, H - barH - 4, Math.max(1, barW - 2), barH);
      }

      // Overlay Time-Domain Oscilloscope Trace
      ctx.beginPath();
      ctx.strokeStyle = '#ffd43b';
      ctx.lineWidth = 1.5;
      const slice = W / 256;
      for (let i = 0; i < 256; i++) {
        const v = (timeData[i * 4] - 128) / 128.0;
        const y = H * 0.5 + v * (H * 0.36);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();
    }
  }
}

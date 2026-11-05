/**
 * main.js
 * Application Bootstrap, UI Event Bindings, Master AudioContext Lifecycle,
 * and 60fps Canvas Rendering Loop for the 1950s Recording Studio Simulator.
 */

import { AudioEngine } from './audio/Studio1950AudioEngine.js';
import { RackController } from './ui/RackController.js';
import { VUMeterCanvas } from './ui/VUMeterCanvas.js';
import { RoomCanvas } from './ui/RoomCanvas.js';
import {
  initDeclarativeTips,
  registerHubAudioCoordinator,
  notifyHubAudioState
} from './ui/LearningTooltips.js';

class StudioApp {
  constructor() {
    this.audio = new AudioEngine();
    this.rack = new RackController();

    // Initialize Master Stereo VU Meters + Vari-Mu Gain Reduction Meter
    this.vuLeft = new VUMeterCanvas(document.getElementById('vu-left'), {
      mode: 'vu',
      label: 'MASTER L'
    });
    this.vuRight = new VUMeterCanvas(document.getElementById('vu-right'), {
      mode: 'vu',
      label: 'MASTER R'
    });
    this.vuGr = new VUMeterCanvas(document.getElementById('vu-gr'), {
      mode: 'gr',
      label: '660 VARI-MU'
    });

    this.roomCanvas = null;
    this.lastFrameTime = performance.now();

    // Hardware state flags
    this.state = {
      pultecBypass: false,
      variMuBypass: false,
      tapeBypass: false,
      latheBypass: false,
      masterSpeedIps: 15,
      slapSpeedIps: 15,
      latheMono: true
    };

    this._initUI();
    initDeclarativeTips();
    registerHubAudioCoordinator(() => {
      if (this.audio && this.audio.isInitialized && this.audio.stemGenerator && this.audio.stemGenerator.isPlaying) {
        this.audio.stemGenerator.stop();
        this._updateTransportUI(false);
        notifyHubAudioState('app-1950s-studio', false);
      }
    });
    this._startRenderLoop();
  }

  _initUI() {
    // 1. Initialize all Bakelite rotary knobs
    this.rack.initKnobs((id, val) => this._handleKnobChange(id, val));

    // 2. Master Play / Stop Session Button
    const btnPlay = document.getElementById('btn-master-play');
    btnPlay.addEventListener('click', async () => {
      await this._ensureAudioReady();
      if (this.audio.stemGenerator.isPlaying) {
        this.audio.stemGenerator.stop();
        this._updateTransportUI(false);
        notifyHubAudioState('app-1950s-studio', false);
      } else {
        this.audio.stemGenerator.start();
        this._updateTransportUI(true);
        notifyHubAudioState('app-1950s-studio', true);
      }
    });

    // 3. Session Preset Selector
    const presetSelect = document.getElementById('preset-select');
    presetSelect.addEventListener('change', async (e) => {
      await this._ensureAudioReady();
      this.applyPreset(e.target.value);
    });

    // 4. Equal-Power A/B Crossfader
    const abFader = document.getElementById('ab-crossfader');
    const abReadout = document.getElementById('ab-readout');
    abFader.addEventListener('input', (e) => {
      const mix = parseFloat(e.target.value);
      this.audio.setABMix(mix);
      const pctB = Math.round(mix * 100);
      abReadout.textContent = pctB >= 50 ? `${pctB}% B` : `${100 - pctB}% A`;
    });

    // 5. Room 4x4 Bleed Toggle
    const btnBleed = document.getElementById('btn-bleed-toggle');
    btnBleed.addEventListener('click', async () => {
      await this._ensureAudioReady();
      const next = !this.audio.liveRoom.bleedEnabled;
      this.audio.liveRoom.setBleedEnabled(next);
      btnBleed.classList.toggle('active', next);
      btnBleed.textContent = next ? '4×4 MIC BLEED: ON' : '4×4 MIC BLEED: OFF';
    });

    // 6. Stem Solo / Mute & Custom Audio File Uploaders
    document.querySelectorAll('[data-stem-solo]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const idx = parseInt(btn.dataset.stemSolo, 10);
        const next = !this.audio.stemGenerator.sources[idx].solo;
        this.audio.setElementSolo(idx, next);
        document.querySelectorAll(`[data-stem-solo="${idx}"]`).forEach((b) => {
          b.classList.toggle('active', next);
        });
      });
    });

    document.querySelectorAll('[data-stem-mute]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const idx = parseInt(btn.dataset.stemMute, 10);
        const next = !this.audio.stemGenerator.sources[idx].muted;
        this.audio.stemGenerator.setMute(idx, next);
        document.querySelectorAll(`[data-stem-mute="${idx}"]`).forEach((b) => {
          b.classList.toggle('active', next);
        });
      });
    });

    document.querySelectorAll('[data-stem-file]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        await this._ensureAudioReady();
        const idx = parseInt(input.dataset.stemFile, 10);
        const label = document.getElementById(`stem-label-${idx}`);
        if (label) label.textContent = `Loading ${file.name}...`;
        try {
          await this.audio.stemGenerator.loadCustomStemFile(idx, file);
          if (label) label.textContent = file.name;
        } catch (err) {
          console.error('Error decoding stem audio file:', err);
          if (label) label.textContent = 'Decode Error (Using Synth)';
        }
      });
    });

    // 7. Console Channel Mic Selectors, Pad & Phase Switches
    document.querySelectorAll('[data-ch-mic]').forEach((select) => {
      select.addEventListener('change', async (e) => {
        await this._ensureAudioReady();
        const chIdx = parseInt(select.dataset.chMic, 10);
        const modelIdx = parseInt(e.target.value, 10);
        this.audio.consoleEngine.setChannelMicModel(chIdx, modelIdx);
        this.audio.syncRoomToConsoleProximity();
      });
    });

    document.querySelectorAll('[data-ch-pad]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const chIdx = parseInt(btn.dataset.chPad, 10);
        const next = !this.audio.consoleEngine.channels[chIdx].state.pad;
        this.audio.consoleEngine.setChannelPad(chIdx, next);
        btn.classList.toggle('active', next);
      });
    });

    document.querySelectorAll('[data-ch-phase]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const chIdx = parseInt(btn.dataset.chPhase, 10);
        const next = !this.audio.consoleEngine.channels[chIdx].state.phaseInvert;
        this.audio.consoleEngine.setChannelPhaseInvert(chIdx, next);
        btn.classList.toggle('active', next);
      });
    });

    // 8. Hardware Bypass Buttons (Pultec, Vari-Mu, Tape, Lathe)
    const btnPultecByp = document.getElementById('btn-pultec-bypass');
    btnPultecByp.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this._setStageBypass('S-05', !this.state.pultecBypass);
    });

    const btnVariMuByp = document.getElementById('btn-varimu-bypass');
    btnVariMuByp.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this._setStageBypass('S-06', !this.state.variMuBypass);
    });

    const btnTapeByp = document.getElementById('btn-tape-bypass');
    btnTapeByp.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this._setStageBypass('S-08', !this.state.tapeBypass);
    });

    const btnLatheByp = document.getElementById('btn-lathe-bypass');
    btnLatheByp.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this._setStageBypass('S-09', !this.state.latheBypass);
    });

    // 9. Master Tape Speed (15 IPS vs 7.5 IPS) & Slapback Speed (15 IPS = 135ms vs 7.5 IPS = 270ms)
    const btnTapeSpeed = document.getElementById('btn-tape-speed');
    btnTapeSpeed.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this.state.masterSpeedIps = this.state.masterSpeedIps === 15 ? 7.5 : 15;
      this.audio.tapeSystem.setMasterSpeed(this.state.masterSpeedIps);
      btnTapeSpeed.textContent = `MASTER: ${this.state.masterSpeedIps} IPS`;
      this._updateReelAnimation();
    });

    const btnSlapSpeed = document.getElementById('btn-slap-speed');
    const slapStatus = document.getElementById('slapback-status');
    btnSlapSpeed.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this.state.slapSpeedIps = this.state.slapSpeedIps === 15 ? 7.5 : 15;
      this.audio.tapeSystem.setSlapbackSpeed(this.state.slapSpeedIps);
      const ms = this.state.slapSpeedIps === 15 ? 135 : 270;
      btnSlapSpeed.textContent = `SLAP DECK: ${this.state.slapSpeedIps} IPS (${ms}ms)`;
      slapStatus.textContent = `2.025" HEAD GAP: ${ms} ms`;
    });

    // 10. Cutting Lathe Mono/Stereo, Platter RPM (33.3, 45, 78) & Monitor Speaker Voicing
    const btnLatheMono = document.getElementById('btn-lathe-mono');
    btnLatheMono.addEventListener('click', async () => {
      await this._ensureAudioReady();
      this.state.latheMono = !this.state.latheMono;
      this.audio.cuttingLathe.setLatheParam('monoCut', this.state.latheMono ? 1 : 0);
      btnLatheMono.classList.toggle('active', this.state.latheMono);
      btnLatheMono.textContent = this.state.latheMono ? 'LATERAL MONO' : 'WESTREX STEREO';
    });

    document.querySelectorAll('[data-lathe-rpm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const rpm = parseFloat(btn.dataset.latheRpm);
        this.audio.cuttingLathe.setLatheParam('rpm', rpm);
        document.querySelectorAll('[data-lathe-rpm]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.querySelectorAll('[data-monitor-mode]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        const mode = btn.dataset.monitorMode;
        this.audio.cuttingLathe.setMonitorMode(mode);
        document.querySelectorAll('[data-monitor-mode]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  async _ensureAudioReady() {
    if (!this.audio.isInitialized) {
      if (!this._initPromise) {
        this._initPromise = (async () => {
          await this.audio.init();
          // If user dragged mics/sources/gobos on the preview canvas before audio started, copy their positions
          if (this.previewRoom) {
            for (let i = 0; i < 4; i++) {
              this.audio.liveRoom.sources[i].x = this.previewRoom.sources[i].x;
              this.audio.liveRoom.sources[i].y = this.previewRoom.sources[i].y;
              this.audio.liveRoom.mics[i].x = this.previewRoom.mics[i].x;
              this.audio.liveRoom.mics[i].y = this.previewRoom.mics[i].y;
              this.audio.liveRoom.mics[i].angle = this.previewRoom.mics[i].angle;
            }
            for (let g = 0; g < this.previewRoom.gobos.length; g++) {
              this.audio.liveRoom.gobos[g].x = this.previewRoom.gobos[g].x;
              this.audio.liveRoom.gobos[g].y = this.previewRoom.gobos[g].y;
              this.audio.liveRoom.gobos[g].angle = this.previewRoom.gobos[g].angle;
            }
            this.audio.syncRoomToConsoleProximity();
          }
          // Point the existing RoomCanvas instance to the live room engine so active drags aren't interrupted
          if (this.fallbackRoomCanvas) {
            this.fallbackRoomCanvas.room = this.audio.liveRoom;
            this.fallbackRoomCanvas.onRoomChanged = () => this.audio.syncRoomToConsoleProximity();
            this.roomCanvas = this.fallbackRoomCanvas;
          } else {
            this.roomCanvas = new RoomCanvas(
              document.getElementById('room-canvas'),
              this.audio.liveRoom,
              () => this.audio.syncRoomToConsoleProximity()
            );
          }
        })();
      }
      await this._initPromise;
    } else if (this.audio.ctx.state === 'suspended') {
      await this.audio.ctx.resume();
    }
  }

  _updateTransportUI(playing) {
    const btnPlay = document.getElementById('btn-master-play');
    const icon = document.getElementById('play-icon');
    const label = document.getElementById('play-label');
    const badge = document.getElementById('audio-status-badge');
    const powerLamp = document.getElementById('power-lamp');

    btnPlay.classList.toggle('active', playing);
    icon.textContent = playing ? '■' : '▶';
    label.textContent = playing ? 'STOP STUDIO SESSION' : 'START STUDIO SESSION';

    if (playing) {
      badge.textContent = 'ON AIR';
      badge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-950/90 text-red-300 border border-red-500/60 font-bold whitespace-nowrap';
      powerLamp.className = 'jewel-lamp active-red';
    } else {
      badge.textContent = 'PAUSED';
      badge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-stone-900 text-amber-400 border border-amber-500/40 font-bold whitespace-nowrap';
      powerLamp.className = 'jewel-lamp active-amber';
    }

    this._updateReelAnimation();
  }

  _updateReelAnimation() {
    const rSupply = document.getElementById('reel-supply');
    const rTakeup = document.getElementById('reel-takeup');
    const playing = this.audio.isInitialized && this.audio.stemGenerator.isPlaying && !this.state.tapeBypass;

    rSupply.classList.remove('tape-reel-spinning', 'tape-reel-fast');
    rTakeup.classList.remove('tape-reel-spinning', 'tape-reel-fast');

    if (playing) {
      const cls = this.state.masterSpeedIps === 15 ? 'tape-reel-fast' : 'tape-reel-spinning';
      rSupply.classList.add(cls);
      rTakeup.classList.add(cls);
    }
  }

  _setStageBypass(stageId, bypassed) {
    if (stageId === 'S-05') {
      this.state.pultecBypass = bypassed;
      this.audio.consoleEngine.setPultecParam('bypass', bypassed ? 1 : 0);
      const btn = document.getElementById('btn-pultec-bypass');
      btn.classList.toggle('active', !bypassed);
      btn.textContent = bypassed ? 'EQ BYPASSED' : 'EQ IN';
    } else if (stageId === 'S-06') {
      this.state.variMuBypass = bypassed;
      this.audio.consoleEngine.setVariMuParam('bypass', bypassed ? 1 : 0);
      const btn = document.getElementById('btn-varimu-bypass');
      btn.classList.toggle('active', !bypassed);
      btn.textContent = bypassed ? 'BYPASSED' : 'LIMITER IN';
    } else if (stageId === 'S-08') {
      this.state.tapeBypass = bypassed;
      this.audio.tapeSystem.setMasterParam('bypass', bypassed ? 1 : 0);
      const btn = document.getElementById('btn-tape-bypass');
      btn.classList.toggle('active', !bypassed);
      btn.textContent = bypassed ? 'TAPE BYP' : 'TAPE IN';
      this._updateReelAnimation();
    } else if (stageId === 'S-09') {
      this.state.latheBypass = bypassed;
      this.audio.cuttingLathe.setLatheParam('bypass', bypassed ? 1 : 0);
      const btn = document.getElementById('btn-lathe-bypass');
      btn.classList.toggle('active', !bypassed);
      btn.textContent = bypassed ? 'LATHE BYP' : 'LATHE IN';
    }
  }

  /**
   * Routes knob adjustments from RackController directly to the active DSP engines
   */
  async _handleKnobChange(id, val) {
    await this._ensureAudioReady();

    if (id === 'master-vol') {
      this.audio.setMasterVolumeDb(val);
      return;
    }

    if (id === 'room-damping') {
      this.audio.liveRoom.setRoomDamping(val);
      return;
    }
    if (id === 'room-reverb') {
      this.audio.liveRoom.setReverbMix(val);
      return;
    }

    // Channel Strip Controls (ch-drive-0..3, ch-aux-0..3, ch-pan-0..3, ch-fader-0..3)
    if (id.startsWith('ch-')) {
      const parts = id.split('-');
      const paramType = parts[1];
      const chIdx = parseInt(parts[2], 10);
      if (paramType === 'drive') this.audio.consoleEngine.setChannelDrive(chIdx, val);
      else if (paramType === 'aux') this.audio.consoleEngine.setChannelAuxSend(chIdx, val);
      else if (paramType === 'pan') this.audio.consoleEngine.setChannelPan(chIdx, val);
      else if (paramType === 'fader') this.audio.consoleEngine.setChannelFader(chIdx, val);
      return;
    }

    // Pultec EQP-1A3 Controls
    if (id.startsWith('pultec-')) {
      const paramName = id.replace('pultec-', '');
      this.audio.consoleEngine.setPultecParam(paramName, val);
      return;
    }

    // Fairchild 660 Vari-Mu Controls
    if (id.startsWith('varimu-')) {
      const paramName = id.replace('varimu-', '');
      this.audio.consoleEngine.setVariMuParam(paramName, val);
      return;
    }

    // Ampex 300/350 Tape System Controls
    if (id.startsWith('tape-')) {
      const paramName = id.replace('tape-', '');
      if (paramName === 'slapReturn') {
        this.audio.tapeSystem.setSlapbackReturn(val);
      } else if (paramName === 'slapFeedback') {
        this.audio.tapeSystem.setSlapbackFeedback(val);
      } else {
        this.audio.tapeSystem.setMasterParam(paramName, val);
      }
      return;
    }

    // Scully 601 Cutting Lathe Controls
    if (id.startsWith('lathe-')) {
      const paramName = id.replace('lathe-', '');
      this.audio.cuttingLathe.setLatheParam(paramName, val);
    }
  }

  /**
   * Applies a complete historical studio configuration preset across all 4 stages & updates UI knobs
   */
  applyPreset(presetId) {
    const cfg = this.audio.getPresetConfig(presetId);

    this.rack.setKnobValue('room-damping', cfg.roomDamping, true);
    this.rack.setKnobValue('room-reverb', cfg.reverbMix, true);

    for (const [k, v] of Object.entries(cfg.pultec)) {
      this.rack.setKnobValue(`pultec-${k}`, v, true);
    }
    for (const [k, v] of Object.entries(cfg.variMu)) {
      this.rack.setKnobValue(`varimu-${k}`, v, true);
    }
    for (const [k, v] of Object.entries(cfg.tape)) {
      if (k === 'tapeSpeed') {
        this.state.masterSpeedIps = v;
        this.audio.tapeSystem.setMasterSpeed(v);
        document.getElementById('btn-tape-speed').textContent = `MASTER: ${v} IPS`;
      } else if (k === 'slapSpeed') {
        this.state.slapSpeedIps = v;
        this.audio.tapeSystem.setSlapbackSpeed(v);
        const ms = v === 15 ? 135 : 270;
        document.getElementById('btn-slap-speed').textContent = `SLAP DECK: ${v} IPS (${ms}ms)`;
        document.getElementById('slapback-status').textContent = `2.025" HEAD GAP: ${ms} ms`;
      } else {
        this.rack.setKnobValue(`tape-${k}`, v, true);
      }
    }

    for (const [k, v] of Object.entries(cfg.lathe)) {
      if (k === 'rpm') {
        this.audio.cuttingLathe.setLatheParam('rpm', v);
        document.querySelectorAll('[data-lathe-rpm]').forEach((b) => {
          b.classList.toggle('active', parseFloat(b.dataset.latheRpm) === v);
        });
      } else if (k === 'monoCut') {
        this.state.latheMono = v === 1;
        this.audio.cuttingLathe.setLatheParam('monoCut', v);
        const btnMono = document.getElementById('btn-lathe-mono');
        btnMono.classList.toggle('active', this.state.latheMono);
        btnMono.textContent = this.state.latheMono ? 'LATERAL MONO' : 'WESTREX STEREO';
      } else if (k === 'monitorMode') {
        this.audio.cuttingLathe.setMonitorMode(v);
        document.querySelectorAll('[data-monitor-mode]').forEach((b) => {
          b.classList.toggle('active', b.dataset.monitorMode === v);
        });
      } else {
        this.rack.setKnobValue(`lathe-${k}`, v, true);
      }
    }

    this._updateReelAnimation();
  }

  /**
   * 60fps Master Render Loop for VU Ballistics, 2D Room Canvas, and Signal Flow Telemetry
   */
  _startRenderLoop() {
    // Create offline preview RoomCanvas before audio starts so the 2D floorplan is visible immediately
    this.previewRoom = {
      roomDims: { width: 35.0, depth: 25.0, height: 14.0 },
      rt60: 0.54,
      bleedEnabled: true,
      sources: [
        { id: 0, name: 'Upright Bass', x: 6.5, y: 7.0, z: 3.5, color: '#f59e0b' },
        { id: 1, name: 'Archtop Guitar', x: 28.5, y: 7.0, z: 3.0, color: '#38bdf8' },
        { id: 2, name: 'Calfskin Kit', x: 17.5, y: 4.2, z: 3.5, color: '#10b981' },
        { id: 3, name: 'Lead Vocal', x: 17.5, y: 20.8, z: 5.2, color: '#f43f5e' }
      ],
      mics: [
        { id: 0, name: 'Mic 1 (Bass)', x: 7.2, y: 10.5, z: 3.5, angle: -Math.PI / 2, micModel: 1 },
        { id: 1, name: 'Mic 2 (Guitar)', x: 27.8, y: 10.5, z: 3.0, angle: -Math.PI / 2, micModel: 2 },
        { id: 2, name: 'Mic 3 (Drums OH)', x: 17.5, y: 8.6, z: 6.2, angle: -Math.PI / 2, micModel: 0 },
        { id: 3, name: 'Mic 4 (Vocal)', x: 17.5, y: 17.2, z: 5.2, angle: Math.PI / 2, micModel: 0 }
      ],
      gobos: [
        { id: 0, name: 'Gobo A', x: 11.8, y: 13.0, angle: 0.38, length: 8.5 },
        { id: 1, name: 'Gobo B', x: 23.2, y: 13.0, angle: -0.38, length: 8.5 }
      ],
      getGoboEndpoints(g) {
        const half = g.length * 0.5;
        return {
          x1: g.x - Math.cos(g.angle) * half,
          y1: g.y - Math.sin(g.angle) * half,
          x2: g.x + Math.cos(g.angle) * half,
          y2: g.y + Math.sin(g.angle) * half
        };
      },
      matrixCells: Array.from({ length: 4 }, (_, s) =>
        Array.from({ length: 4 }, (__, m) => ({
          distanceFt: s === m ? 2.4 : 11.5,
          delayMs: s === m ? 2.1 : 10.2,
          occludedByGobo: s !== m && Math.abs(s - m) === 1
        }))
      ),
      updateAcoustics() {
        for (let s = 0; s < 4; s++) {
          const src = this.sources[s];
          for (let m = 0; m < 4; m++) {
            const mic = this.mics[m];
            const distFt = Math.max(0.35, Math.hypot(src.x - mic.x, src.y - mic.y, src.z - mic.z));
            this.matrixCells[s][m].distanceFt = distFt;
            this.matrixCells[s][m].delayMs = (distFt / 1125.0) * 1000.0;
          }
        }
      }
    };
    this.previewRoom.updateAcoustics();

    this.fallbackRoomCanvas = new RoomCanvas(
      document.getElementById('room-canvas'),
      this.previewRoom,
      async () => {
        await this._ensureAudioReady();
      }
    );

    const summaryEl = document.getElementById('telemetry-summary');

    const tick = (now) => {
      const dt = Math.max(0.001, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      const telemetry = this.audio.getMeterTelemetry();

      // 1. Update 300ms Ballistic VU & Vari-Mu GR Meters
      this.vuLeft.updateAndDraw(telemetry.rmsL, telemetry.peakL, dt);
      this.vuRight.updateAndDraw(telemetry.rmsR, telemetry.peakR, dt);
      this.vuGr.updateAndDraw(telemetry.variMuGrDb || 0, 0, dt);

      // 2. Update 2D Live Room Floorplan
      const activeRoomCanvas = this.roomCanvas || this.fallbackRoomCanvas;
      const chPeaks = this.audio.isInitialized
        ? this.audio.consoleEngine.telemetry.channelPeaks
        : [0.15, 0.15, 0.15, 0.15];
      const soloStates = this.audio.isInitialized
        ? this.audio.consoleEngine.channels.map((ch) => ch.state.solo)
        : [false, false, false, false];
      activeRoomCanvas.draw(chPeaks, soloStates);

      // 3. Update Telemetry Summary in Header
      if (this.audio.isInitialized && summaryEl) {
        summaryEl.textContent =
          `RT60: ${(telemetry.rt60 || 0.54).toFixed(2)}s | ` +
          `Slap: ${telemetry.slapDelayMs || 135}ms | ` +
          `Lathe: ${telemetry.latheIps || 19.5} ips | ` +
          `HF: ${((telemetry.latheScanHz || 14500) / 1000).toFixed(1)} kHz`;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.studioApp = new StudioApp();
});

/**
 * OscilloscopeCanvas.js
 * 1960s Telequipment / Tektronix Tube CRT Oscilloscope (P1 Green Phosphor).
 * 
 * Switchable Pedagogical Modes:
 *  1. Comb Filter Spectrum (Frequency Domain):
 *     Live FFT curve overlaid with theoretical comb-filter notch markers calculated dynamically:
 *       f_notch(n) = (2n + 1) / (2 * |Δt|)  [Normal Polarity]
 *       f_notch(n) = n / |Δt|                [Inverted Polarity]
 *     Watch comb teeth spread apart as Δt -> 0 and compress as Δt increases.
 * 
 *  2. Dual-Trace Phase Waveforms (Time Domain):
 *     Deck A (Amber trace) and Deck B (Green trace) superimposed, highlighting constructive
 *     doubling (+6dB) vs destructive flat-line phase cancellation at the Zero Point.
 * 
 *  3. Animated Tape Path & Magnetic Flux Strip:
 *     Zoomed-in cutaway showing virtual magnetic tape ribbons passing over Playback Repro Heads,
 *     with printed sync stripes showing physical millimeter slippage (381 mm/s at 15 IPS).
 */

export class OscilloscopeCanvas {
  constructor(canvasElement, physicsEngine, audioEngine) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.physics = physicsEngine;
    this.audio = audioEngine;

    this.mode = 'comb'; // 'comb' | 'phase' | 'tape'
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    // Persistent phosphor trace buffers
    this.fftData = new Float32Array(1024);
    this.timeDataA = new Uint8Array(512);
    this.timeDataB = new Uint8Array(512);
    this.timeDataSum = new Uint8Array(512);

    // Phosphor glow persistence canvas
    this.phosphorCanvas = document.createElement('canvas');
    this.phosphorCtx = this.phosphorCanvas.getContext('2d');
    this._syncPhosphorSize();
  }

  setMode(mode) {
    if (['comb', 'phase', 'tape'].includes(mode)) {
      this.mode = mode;
    }
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this._syncPhosphorSize();
  }

  _syncPhosphorSize() {
    this.phosphorCanvas.width = this.canvas.width;
    this.phosphorCanvas.height = this.canvas.height;
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const state = this.physics.getState();

    // 1. Dark CRT Faceplate Background
    ctx.fillStyle = '#060a08';
    ctx.fillRect(0, 0, w, h);

    // Circular/Curved CRT Glass Bezel Vignette
    this._drawCRTBezel(ctx, w, h);

    // 2. Graticule Scale Grid (10x8 divisions with centimeter ticks)
    this._drawGraticule(ctx, w, h);

    // 3. Render Mode-Specific Pedagogical Visualization
    if (this.mode === 'comb') {
      this._renderCombFilterSpectrum(ctx, w, h, state);
    } else if (this.mode === 'phase') {
      this._renderDualTracePhase(ctx, w, h, state);
    } else if (this.mode === 'tape') {
      this._renderTapeHeadSyncStrip(ctx, w, h, state);
    }

    // 4. CRT Phosphor Bloom & Glass Glare Overlay
    this._drawCRTGlare(ctx, w, h);
  }

  /**
   * Mode 1: Real-time FFT Comb Filter Spectrum with Dynamic Theoretical Notches
   */
  _renderCombFilterSpectrum(ctx, w, h, state) {
    const padL = 45;
    const padR = 25;
    const padT = 36;
    const padB = 40;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Fetch live frequency data
    if (this.audio.masterAnalyser && this.audio.isPlaying) {
      this.audio.masterAnalyser.getFloatFrequencyData(this.fftData);
    } else {
      this.fftData.fill(-90);
    }

    const minFreq = 40;
    const maxFreq = 18000;
    const minDb = -85;
    const maxDb = -10;

    const freqToX = (f) => {
      const norm = (Math.log10(f) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq));
      return padL + Math.max(0, Math.min(1, norm)) * plotW;
    };

    const dbToY = (db) => {
      const norm = (db - minDb) / (maxDb - minDb);
      return padT + (1 - Math.max(0, Math.min(1, norm))) * plotH;
    };

    // Frequency Axis Guides (100Hz, 500Hz, 1kHz, 5kHz, 10kHz)
    const guides = [100, 250, 500, 1000, 2500, 5000, 10000, 15000];
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(74, 222, 128, 0.45)';

    guides.forEach((freq) => {
      const x = freqToX(freq);
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.12)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      ctx.fillText(label, x, padT + plotH + 14);
    });

    // Draw Live FFT Curve (P1 Green Phosphor)
    ctx.save();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 10;
    ctx.beginPath();

    const sr = this.audio.ctx ? this.audio.ctx.sampleRate : 44100;
    const binCount = this.fftData.length;
    let started = false;

    for (let i = 2; i < binCount; i++) {
      const freq = (i * sr) / (binCount * 2);
      if (freq < minFreq || freq > maxFreq) continue;
      const x = freqToX(freq);
      const y = dbToY(this.fftData[i]);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    // Calculate Theoretical Comb Filter Notches
    const deltaT_sec = Math.abs(state.deltaT_ms) / 1000.0;
    const isInverted = this.audio.isPhaseInverted;

    // Render Theoretical Comb Notch Markers (Vertical Amber dashed lines)
    if (deltaT_sec > 0.00005) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 8;

      const notchFreqs = [];
      for (let n = 0; n < 30; n++) {
        // Normal Polarity: f_n = (2n + 1) / (2 * Δt)
        // Inverted Polarity: f_n = n / Δt (with n=0 being DC null, n=1, 2, 3...)
        let fNotch = 0;
        if (isInverted) {
          fNotch = n / deltaT_sec;
        } else {
          fNotch = (2 * n + 1) / (2 * deltaT_sec);
        }

        if (fNotch >= minFreq && fNotch <= maxFreq) {
          notchFreqs.push({ n, f: fNotch });
          const nx = freqToX(fNotch);

          ctx.beginPath();
          ctx.moveTo(nx, padT);
          ctx.lineTo(nx, padT + plotH);
          ctx.stroke();

          // Notch frequency marker label at top
          if (n < 6) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 8.5px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`f${n}`, nx, padT - 5);
          }
        }
      }
      ctx.restore();

      // Live Formula Readout Header
      this._drawCombFormulaHUD(ctx, state, deltaT_sec, isInverted, notchFreqs, padL, padT);
    } else {
      // Exactly at The Zero Point
      ctx.save();
      ctx.fillStyle = isInverted ? '#ef4444' : '#22c55e';
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const msg = isInverted
        ? '★ THE ZERO POINT: TOTAL PHASE CANCELLATION (NULL) ★'
        : '★ THE ZERO POINT: PERFECT IN-PHASE SUM (+6 dB ACOUSTIC BOOST) ★';
      ctx.fillText(msg, w / 2, padT + 22);
      ctx.restore();
    }
  }

  /**
   * HUD Formula overlay for Mode 1
   */
  _drawCombFormulaHUD(ctx, state, dtSec, isInverted, notchFreqs, left, top) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 12, 0.88)';
    ctx.fillRect(left + 8, top + 6, 320, 68);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 8, top + 6, 320, 68);

    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'left';
    ctx.fillText('COMB FILTER NOTCH EQUATION:', left + 16, top + 22);

    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#f8fafc';
    const formulaStr = isInverted
      ? `f_notch(n) = n / |Δt|   [Inverted 180° Polarity]`
      : `f_notch(n) = (2n + 1) / (2 · |Δt|)   [Normal]`;
    ctx.fillText(formulaStr, left + 16, top + 38);

    const f0Str = notchFreqs.length > 0
      ? `f0 = ${Math.round(notchFreqs[0].f)} Hz · f1 = ${notchFreqs[1] ? Math.round(notchFreqs[1].f) : '--'} Hz`
      : `Δt too small (notches in ultrasound)`;
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`Δt = ${state.deltaT_ms >= 0 ? '+' : ''}${state.deltaT_ms.toFixed(2)} ms  |  ${f0Str}`, left + 16, top + 56);
    ctx.restore();
  }

  /**
   * Mode 2: Dual-Trace Phase Waveforms (Superimposed Deck A Amber vs Deck B Green)
   */
  _renderDualTracePhase(ctx, w, h, state) {
    const padL = 40;
    const padR = 25;
    const padT = 30;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const midY = padT + plotH / 2;

    // Fetch time-domain data
    if (this.audio.deckAAnalyser && this.audio.isPlaying) {
      this.audio.deckAAnalyser.getByteTimeDomainData(this.timeDataA);
    } else {
      this.timeDataA.fill(128);
    }

    if (this.audio.deckBAnalyser && this.audio.isPlaying) {
      this.audio.deckBAnalyser.getByteTimeDomainData(this.timeDataB);
    } else {
      this.timeDataB.fill(128);
    }

    if (this.audio.masterAnalyser && this.audio.isPlaying) {
      this.audio.masterAnalyser.getByteTimeDomainData(this.timeDataSum);
    } else {
      this.timeDataSum.fill(128);
    }

    // Zero Volt Center Reference Axis
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, midY);
    ctx.lineTo(padL + plotW, midY);
    ctx.stroke();

    const nPoints = Math.min(256, this.timeDataA.length);

    // 1. Trace A: Amber (Deck A Master Reference)
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < nPoints; i++) {
      const x = padL + (i / (nPoints - 1)) * plotW;
      const val = (this.timeDataA[i] - 128) / 128;
      const y = midY - val * (plotH * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 2. Trace B: Green Phosphor (Deck B Modulated Slave)
    ctx.save();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < nPoints; i++) {
      const x = padL + (i / (nPoints - 1)) * plotW;
      const val = (this.timeDataB[i] - 128) / 128;
      const y = midY - val * (plotH * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 3. Trace Master Sum: Cyan Glowing Line
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < nPoints; i++) {
      const x = padL + (i / (nPoints - 1)) * plotW;
      const val = (this.timeDataSum[i] - 128) / 128;
      const y = midY - val * (plotH * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Dual Trace Legend & Phase Condition HUD
    const isAtZero = Math.abs(state.deltaT_ms) < 0.15;
    const isNull = isAtZero && this.audio.isPhaseInverted;
    const isDoubled = isAtZero && !this.audio.isPhaseInverted;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 10, 8, 0.9)';
    ctx.fillRect(padL + 10, padT + 8, 280, 56);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 10, padT + 8, 280, 56);

    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('■ DECK A (Reference)', padL + 18, padT + 22);

    ctx.fillStyle = '#22c55e';
    ctx.fillText('■ DECK B (Slave)', padL + 18, padT + 36);

    ctx.fillStyle = '#38bdf8';
    ctx.fillText('┄ MASTER SUM (Output)', padL + 18, padT + 50);

    // Callout box on right
    ctx.textAlign = 'right';
    if (isNull) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText('★ TOTAL DESTRUCTIVE NULL ★', padL + plotW - 10, padT + 24);
      ctx.fillStyle = '#fca5a5';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.fillText('Deck B 180° cancels Deck A completely', padL + plotW - 10, padT + 40);
    } else if (isDoubled) {
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText('★ CONSTRUCTIVE COHERENCE (+6dB) ★', padL + plotW - 10, padT + 24);
      ctx.fillStyle = '#86efac';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.fillText('Waveforms aligned identically in time', padL + plotW - 10, padT + 40);
    } else {
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`Δt Phase Delay = ${state.deltaT_ms >= 0 ? '+' : ''}${state.deltaT_ms.toFixed(2)} ms`, padL + plotW - 10, padT + 24);
    }
    ctx.restore();
  }

  /**
   * Mode 3: Virtual Tape Path & Magnetic Flux Sync Stripes
   */
  _renderTapeHeadSyncStrip(ctx, w, h, state) {
    const padL = 40;
    const padR = 40;
    const topY = 40;
    const stripH = 48;

    // Track 1: Deck A Tape Ribbon
    const tapeAY = topY + 28;
    this._drawTapeStrip(ctx, padL, tapeAY, w - padL - padR, stripH, 'DECK A TAPE (15.00 IPS MASTER)', 0.0, '#f59e0b');

    // Track 2: Deck B Tape Ribbon
    const tapeBY = tapeAY + stripH + 46;
    const offsetPixels = (state.tapeDisplacementMm * 3.5); // visual scaling
    this._drawTapeStrip(ctx, padL, tapeBY, w - padL - padR, stripH, 'DECK B TAPE (SLAVE FLANGER)', offsetPixels, '#22c55e');

    // Center Vertical Repro Playback Head Gap Line across both ribbons
    const headX = w / 2;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3.0;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(headX, topY + 10);
    ctx.lineTo(headX, tapeBY + stripH + 20);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▼ PLAYBACK REPRO HEAD GAP ▼', headX, topY + 20);

    // Dimension line between sync stripes at the head
    const stripeBX = headX - offsetPixels;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(stripeBX, tapeBY + stripH / 2);
    ctx.lineTo(headX, tapeBY + stripH / 2);
    ctx.stroke();

    // Measurement readout
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillText(`Δx = ${state.tapeDisplacementMm >= 0 ? '+' : ''}${state.tapeDisplacementMm.toFixed(2)} mm  (${state.deltaT_ms.toFixed(2)} ms)`, headX, tapeBY + stripH + 34);

    ctx.restore();
  }

  /**
   * Helper to draw a magnetic oxide tape ribbon with animated sync stripes
   */
  _drawTapeStrip(ctx, x, y, width, height, title, offsetPx, accentColor) {
    ctx.save();

    // Oxide Tape Base
    const grad = ctx.createLinearGradient(x, y, x, y + height);
    grad.addColorStop(0, '#452317');
    grad.addColorStop(0.5, '#5d301f');
    grad.addColorStop(1, '#3b1c11');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(x, y, width, height);

    // Animate moving sync stripes (15 IPS = 381 mm/s)
    const stripeSpacing = 42;
    const now = performance.now() * 0.08;
    const shift = (now + offsetPx) % stripeSpacing;

    ctx.strokeStyle = 'rgba(254, 240, 138, 0.6)';
    ctx.lineWidth = 2;
    for (let sx = x - stripeSpacing + shift; sx < x + width; sx += stripeSpacing) {
      if (sx >= x && sx <= x + width) {
        ctx.beginPath();
        ctx.moveTo(sx, y + 4);
        ctx.lineTo(sx, y + height - 4);
        ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle = accentColor;
    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 8, y - 8);

    ctx.restore();
  }

  /**
   * Classic Tektronix 10x8 Graticule Grid
   */
  _drawGraticule(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.16)';
    ctx.lineWidth = 1;

    const cols = 10;
    const rows = 8;
    const dx = w / cols;
    const dy = h / rows;

    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * dx, 0);
      ctx.lineTo(c * dx, h);
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * dy);
      ctx.lineTo(w, r * dy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * CRT Tube Bezel Shadow & Vignette
   */
  _drawCRTBezel(ctx, w, h) {
    ctx.save();
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.72);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.7, 'rgba(0, 12, 6, 0.4)');
    grad.addColorStop(1, 'rgba(0, 5, 2, 0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * Curved Glass Reflection Glare
   */
  _drawCRTGlare(ctx, w, h) {
    ctx.save();
    const glare = ctx.createLinearGradient(0, 0, w, h);
    glare.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
    glare.addColorStop(0.3, 'rgba(255, 255, 255, 0.01)');
    glare.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

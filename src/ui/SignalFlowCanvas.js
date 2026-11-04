/**
 * SignalFlowCanvas.js
 * Real-Time 60fps Animated Signal Routing & Telemetry Block Diagram (Stages S-01 through S-09).
 * Displays:
 *  - Stage-by-stage input/output RMS & Peak bar meters
 *  - Animated audio signal particles traveling across the analog bus and parallel Slapback Aux loop (S-07)
 *  - Real-time THD / Saturation / Gain Reduction / Stylus Acceleration Limiter telemetry badges
 *  - Interactive click-on-stage to toggle hardware bypass on Pultec (S-05), Vari-Mu (S-06), Tape (S-08), or Lathe (S-09)
 */

export class SignalFlowCanvas {
  constructor(canvas, onStageToggleBypass) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStageToggleBypass = onStageToggleBypass;
    this.flowOffset = 0;

    this.stageNodes = [
      { id: 'S-01', title: '4 STEMS', sub: 'Bass/Gtr/Drm/Voc', bypassable: false, bypassed: false },
      { id: 'S-02', title: 'LIVE ROOM', sub: '35x25 Bleed/ISM', bypassable: false, bypassed: false },
      { id: 'S-03', title: 'MICS & PRE', sub: 'U47/44BX + VF14', bypassable: false, bypassed: false },
      { id: 'S-04', title: 'RCA 76-D BUS', sub: '4-Ch LCR Sum', bypassable: false, bypassed: false },
      { id: 'S-05', title: 'PULTEC EQP-1A', sub: 'LC Tank + 12AX7', bypassable: true, bypassed: false },
      { id: 'S-06', title: 'FAIRCHILD 660', sub: '6386 Vari-Mu', bypassable: true, bypassed: false },
      { id: 'S-07', title: 'SUN SLAPBACK', sub: '2.025" Aux Loop', bypassable: false, bypassed: false },
      { id: 'S-08', title: 'AMPEX 300 1/4"', sub: 'J-A Hysteresis', bypassable: true, bypassed: false },
      { id: 'S-09', title: 'SCULLY LATHE', sub: 'RIAA + Altec 604', bypassable: true, bypassed: false }
    ];

    this.nodeRects = [];
    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
      const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;

      for (const box of this.nodeRects) {
        if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
          if (box.node.bypassable) {
            box.node.bypassed = !box.node.bypassed;
            if (this.onStageToggleBypass) {
              this.onStageToggleBypass(box.node.id, box.node.bypassed);
            }
          }
          break;
        }
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
      const py = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
      let overBypassable = false;
      for (const box of this.nodeRects) {
        if (box.node.bypassable && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
          overBypassable = true;
          break;
        }
      }
      this.canvas.style.cursor = overBypassable ? 'pointer' : 'default';
    });
  }

  setStageBypassState(stageId, bypassed) {
    const st = this.stageNodes.find((s) => s.id === stageId);
    if (st) st.bypassed = Boolean(bypassed);
  }

  draw(telemetry) {
    this.flowOffset = (this.flowOffset + 0.9) % 18;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Background oscillo-grid
    ctx.fillStyle = '#0e1113';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 184, 77, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const padX = 14;
    const gap = 10;
    const count = this.stageNodes.length;
    const boxW = (w - padX * 2 - gap * (count - 1)) / count;
    const boxH = h - 24;
    const boxY = 12;

    this.nodeRects = [];

    // 1. Draw Main Analog Bus Conduit Line + Animated Signal Flow Dashes
    ctx.save();
    ctx.strokeStyle = '#333940';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(padX, h * 0.5);
    ctx.lineTo(w - padX, h * 0.5);
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 12]);
    ctx.lineDashOffset = -this.flowOffset;
    ctx.beginPath();
    ctx.moveTo(padX, h * 0.5);
    ctx.lineTo(w - padX, h * 0.5);
    ctx.stroke();
    ctx.restore();

    // 2. Render each Stage Block (S-01 through S-09)
    for (let i = 0; i < count; i++) {
      const node = this.stageNodes[i];
      const bx = padX + i * (boxW + gap);
      const by = boxY;

      this.nodeRects.push({ x: bx, y: by, w: boxW, h: boxH, node });

      const stMetric = (telemetry.stages && telemetry.stages[node.id]) || { rms: 0, peak: 0 };
      const rmsNorm = Math.min(1.0, stMetric.rms * 2.6);
      const isClipping = stMetric.peak > 0.92;

      // Box background & border
      ctx.fillStyle = node.bypassed ? '#16181a' : '#1b1f23';
      ctx.strokeStyle = node.bypassed
        ? '#454a50'
        : isClipping
        ? '#ef4444'
        : rmsNorm > 0.45
        ? '#f59e0b'
        : '#3d454d';
      ctx.lineWidth = isClipping ? 2.0 : 1.4;

      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      // Stage ID Header Badge
      ctx.fillStyle = node.bypassed ? '#292d32' : '#2c2214';
      ctx.fillRect(bx + 2, by + 2, boxW - 4, 15);

      ctx.fillStyle = node.bypassed ? '#777d84' : '#fbbf24';
      ctx.font = 'bold 9px "Courier Prime", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(node.id, bx + 5, by + 12);

      if (node.bypassable) {
        ctx.textAlign = 'right';
        ctx.fillStyle = node.bypassed ? '#ef4444' : '#10b981';
        ctx.fillText(node.bypassed ? 'BYP' : 'ON', bx + boxW - 5, by + 12);
      }

      // Stage Title & Subtitle
      ctx.textAlign = 'center';
      ctx.fillStyle = node.bypassed ? '#6c7279' : '#e5e0d5';
      ctx.font = 'bold 9.5px "Courier Prime", monospace';
      ctx.fillText(node.title, bx + boxW * 0.5, by + 29);

      ctx.fillStyle = '#9299a1';
      ctx.font = '8.5px "Courier Prime", monospace';
      ctx.fillText(node.sub, bx + boxW * 0.5, by + 41);

      // Horizontal Level Meter Bar inside the stage block
      const meterX = bx + 6;
      const meterY = by + 48;
      const meterW = boxW - 12;
      const meterH = 7;

      ctx.fillStyle = '#0d0f11';
      ctx.fillRect(meterX, meterY, meterW, meterH);

      if (!node.bypassed) {
        const fillW = Math.max(2, rmsNorm * meterW);
        const grad = ctx.createLinearGradient(meterX, 0, meterX + meterW, 0);
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(0.7, '#f59e0b');
        grad.addColorStop(1.0, '#ef4444');
        ctx.fillStyle = grad;
        ctx.fillRect(meterX, meterY, fillW, meterH);
      }

      // Stage-specific telemetry readout at bottom of block
      ctx.font = '8.5px "Courier Prime", monospace';
      ctx.fillStyle = '#cbd5e1';
      let bottomText = `${(20 * Math.log10(Math.max(1e-4, stMetric.rms))).toFixed(1)} dB`;

      if (node.id === 'S-06' && !node.bypassed) {
        bottomText = `GR: -${(telemetry.variMuGrDb || 0).toFixed(1)} dB`;
        ctx.fillStyle = telemetry.variMuGrDb > 3 ? '#fbbf24' : '#cbd5e1';
      } else if (node.id === 'S-07') {
        bottomText = `DLY: ${telemetry.slapDelayMs || 135} ms`;
        ctx.fillStyle = '#38bdf8';
      } else if (node.id === 'S-08' && !node.bypassed) {
        const satPct = Math.round((telemetry.masterTapeSat || 0) * 100);
        bottomText = `SAT: ${satPct}%`;
      } else if (node.id === 'S-09' && !node.bypassed) {
        bottomText = `${telemetry.latheIps || 19.5} ips | ${(telemetry.latheScanHz / 1000).toFixed(1)}k`;
      }

      ctx.fillText(bottomText, bx + boxW * 0.5, by + boxH - 6);
    }
  }
}

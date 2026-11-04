/**
 * RoomCanvas.js
 * Interactive 2D Top-Down 35ft x 25ft 1950s Studio Live Room Acoustic Placement Canvas.
 * Supports:
 *  - Dragging all 4 Sound Sources (Upright Bass, Archtop Guitar, Calfskin Kit, Lead Vocal)
 *  - Dragging all 4 Microphones & rotating their polar orientation axis (Shift+Drag, Mouse Wheel, or Aim Handle)
 *  - Dragging & rotating the 2 Acoustic Gobos (Baffle A & B) with live ray-cast occlusion visualization
 *  - Rendering real-time Polar Pattern Lobes (Cardioid U47, Figure-8 RCA 44-BX, Supercardioid Shure 55SH)
 *  - Rendering the 4x4 Direct + Cross-Bleed Acoustic Matrix rays with propagation delay (ms) & proximity readouts
 */

export class RoomCanvas {
  constructor(canvas, liveRoomEngine, onRoomChanged) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = liveRoomEngine;
    this.onRoomChanged = onRoomChanged;

    this.dragTarget = null; // { type: 'source'|'mic'|'micAim'|'gobo'|'goboEnd', index: number }
    this.hoverInfo = null;
    this.pulsePhase = 0;

    this._bindEvents();
  }

  _ftToPx(xFt, yFt) {
    const pad = 6;
    const availW = this.canvas.width - pad * 2;
    const availH = this.canvas.height - pad * 2;
    return {
      px: pad + (xFt / this.room.roomDims.width) * availW,
      py: pad + (yFt / this.room.roomDims.depth) * availH,
      scale: availW / this.room.roomDims.width
    };
  }

  _pxToFt(px, py) {
    const pad = 6;
    const availW = this.canvas.width - pad * 2;
    const availH = this.canvas.height - pad * 2;
    const xFt = ((px - pad) / availW) * this.room.roomDims.width;
    const yFt = ((py - pad) / availH) * this.room.roomDims.depth;
    return {
      x: Math.max(1.2, Math.min(this.room.roomDims.width - 1.2, xFt)),
      y: Math.max(1.2, Math.min(this.room.roomDims.depth - 1.2, yFt))
    };
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      py: ((e.clientY - rect.top) / rect.height) * this.canvas.height
    };
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const { px, py } = this._getCanvasCoords(e);
      const hit = this._hitTest(px, py, e.shiftKey);
      if (hit) {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
        this.dragTarget = hit;
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const { px, py } = this._getCanvasCoords(e);
      if (!this.dragTarget) {
        this.hoverInfo = this._hitTest(px, py, false);
        this.canvas.style.cursor = this.hoverInfo ? 'grab' : 'default';
        return;
      }

      this.canvas.style.cursor = 'grabbing';
      const ft = this._pxToFt(px, py);

      if (this.dragTarget.type === 'source') {
        const src = this.room.sources[this.dragTarget.index];
        src.x = ft.x;
        src.y = ft.y;
      } else if (this.dragTarget.type === 'mic') {
        const mic = this.room.mics[this.dragTarget.index];
        if (e.shiftKey) {
          // Rotate mic heading toward cursor
          mic.angle = Math.atan2(ft.y - mic.y, ft.x - mic.x);
        } else {
          mic.x = ft.x;
          mic.y = ft.y;
        }
      } else if (this.dragTarget.type === 'micAim') {
        const mic = this.room.mics[this.dragTarget.index];
        mic.angle = Math.atan2(ft.y - mic.y, ft.x - mic.x);
      } else if (this.dragTarget.type === 'gobo') {
        const gobo = this.room.gobos[this.dragTarget.index];
        if (e.shiftKey) {
          gobo.angle = Math.atan2(ft.y - gobo.y, ft.x - gobo.x);
        } else {
          gobo.x = ft.x;
          gobo.y = ft.y;
        }
      } else if (this.dragTarget.type === 'goboEnd') {
        const gobo = this.room.gobos[this.dragTarget.index];
        gobo.angle = Math.atan2(ft.y - gobo.y, ft.x - gobo.x);
      }

      this.room.updateAcoustics();
      if (this.onRoomChanged) this.onRoomChanged();
    });

    const endDrag = () => {
      this.dragTarget = null;
      this.canvas.style.cursor = 'default';
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    // Wheel rotates hovered Mic or Gobo angle smoothly
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const { px, py } = this._getCanvasCoords(e);
        const hit = this._hitTest(px, py, false);
        if (!hit) return;

        if (hit.type === 'mic' || hit.type === 'micAim') {
          e.preventDefault();
          this.room.mics[hit.index].angle += (e.deltaY > 0 ? 1 : -1) * 0.12;
          this.room.updateAcoustics();
          if (this.onRoomChanged) this.onRoomChanged();
        } else if (hit.type === 'gobo' || hit.type === 'goboEnd') {
          e.preventDefault();
          this.room.gobos[hit.index].angle += (e.deltaY > 0 ? 1 : -1) * 0.12;
          this.room.updateAcoustics();
          if (this.onRoomChanged) this.onRoomChanged();
        }
      },
      { passive: false }
    );
  }

  _hitTest(px, py, shiftKey) {
    // 1. Check Microphone aim handles first
    for (let i = 0; i < this.room.mics.length; i++) {
      const m = this.room.mics[i];
      const pos = this._ftToPx(m.x, m.y);
      const aimX = pos.px + Math.cos(m.angle) * 28;
      const aimY = pos.py + Math.sin(m.angle) * 28;
      if (Math.hypot(px - aimX, py - aimY) < 12) {
        return { type: 'micAim', index: i };
      }
    }

    // 2. Check Microphones
    for (let i = 0; i < this.room.mics.length; i++) {
      const m = this.room.mics[i];
      const pos = this._ftToPx(m.x, m.y);
      if (Math.hypot(px - pos.px, py - pos.py) < 19) {
        return { type: shiftKey ? 'micAim' : 'mic', index: i };
      }
    }

    // 3. Check Sound Sources
    for (let i = 0; i < this.room.sources.length; i++) {
      const s = this.room.sources[i];
      const pos = this._ftToPx(s.x, s.y);
      if (Math.hypot(px - pos.px, py - pos.py) < 22) {
        return { type: 'source', index: i };
      }
    }

    // 4. Check Gobo Baffles (center & rotation ends)
    for (let i = 0; i < this.room.gobos.length; i++) {
      const g = this.room.gobos[i];
      const seg = this.room.getGoboEndpoints(g);
      const p1 = this._ftToPx(seg.x1, seg.y1);
      const p2 = this._ftToPx(seg.x2, seg.y2);
      const pc = this._ftToPx(g.x, g.y);

      if (Math.hypot(px - p1.px, py - p1.py) < 14 || Math.hypot(px - p2.px, py - p2.py) < 14) {
        return { type: 'goboEnd', index: i };
      }
      if (Math.hypot(px - pc.px, py - pc.py) < 24) {
        return { type: 'gobo', index: i };
      }
    }

    return null;
  }

  /**
   * Renders the 2D Live Room Floorplan, Polar Lobes, Acoustic Bleed Rays, Gobos, and Sources/Mics
   */
  draw(channelPeaks = [0, 0, 0, 0]) {
    this.pulsePhase = (this.pulsePhase + 0.06) % (Math.PI * 2);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // 1. Studio Hardwood Floor & Acoustic Grid (5 ft squares filling the entire square canvas)
    ctx.fillStyle = '#121518';
    ctx.fillRect(0, 0, w, h);

    const topLeft = this._ftToPx(0, 0);
    const botRight = this._ftToPx(this.room.roomDims.width, this.room.roomDims.depth);
    const roomW = botRight.px - topLeft.px;
    const roomH = botRight.py - topLeft.py;

    // Warm studio floor tint
    const floorGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 25, w * 0.5, h * 0.5, w * 0.68);
    floorGrad.addColorStop(0, '#20252a');
    floorGrad.addColorStop(1, '#121518');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(topLeft.px, topLeft.py, roomW, roomH);

    // 5-foot acoustic grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 35; x += 5) {
      const p = this._ftToPx(x, 0);
      ctx.beginPath();
      ctx.moveTo(p.px, topLeft.py);
      ctx.lineTo(p.px, botRight.py);
      ctx.stroke();
    }
    for (let y = 0; y <= 25; y += 5) {
      const p = this._ftToPx(0, y);
      ctx.beginPath();
      ctx.moveTo(topLeft.px, p.py);
      ctx.lineTo(botRight.px, p.py);
      ctx.stroke();
    }

    // Acoustic Tile Studio Walls Border
    ctx.strokeStyle = '#68727c';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(topLeft.px, topLeft.py, roomW, roomH);

    // Scale legend
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 11px "Courier Prime", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`35' × 25' × 14' LIVE ROOM  |  RT60: ${this.room.rt60.toFixed(2)}s`, topLeft.px + 10, topLeft.py + 18);

    // 2. Draw 4x4 Direct & Cross-Bleed Acoustic Ray-Cast Paths
    for (let s = 0; s < 4; s++) {
      const src = this.room.sources[s];
      const sp = this._ftToPx(src.x, src.y);

      for (let m = 0; m < 4; m++) {
        if (!this.room.bleedEnabled && s !== m) continue;
        const mic = this.room.mics[m];
        const mp = this._ftToPx(mic.x, mic.y);
        const cell = this.room.matrixCells[s][m];

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sp.px, sp.py);
        ctx.lineTo(mp.px, mp.py);

        if (cell.occludedByGobo) {
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 1.6;
        } else if (s === m) {
          ctx.strokeStyle = src.color;
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = 2.6;
        } else {
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = 'rgba(226, 223, 215, 0.25)';
          ctx.lineWidth = 1.2;
        }
        ctx.stroke();
        ctx.restore();

        // Draw primary Source-to-Mic distance & propagation delay label
        if (s === m) {
          const midX = (sp.px + mp.px) * 0.5;
          const midY = (sp.py + mp.py) * 0.5;
          ctx.fillStyle = 'rgba(14, 16, 18, 0.9)';
          ctx.fillRect(midX - 34, midY - 9, 68, 17);
          ctx.fillStyle = cell.occludedByGobo ? '#f87171' : '#fcd34d';
          ctx.font = 'bold 10.5px "Courier Prime", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${cell.distanceFt.toFixed(1)}' (${cell.delayMs.toFixed(1)}ms)`, midX, midY + 3);
        }
      }
    }

    // 3. Draw Microphone Polar Pattern Lobes P(theta) = (1 - beta) + beta * cos(theta)
    for (let m = 0; m < 4; m++) {
      const mic = this.room.mics[m];
      const mp = this._ftToPx(mic.x, mic.y);
      const lobeRadiusPx = 56;
      const beta = mic.micModel === 1 ? 1.0 : mic.micModel === 2 ? 0.63 : 0.5;

      // Positive Polarity Front Lobe
      ctx.save();
      ctx.beginPath();
      for (let deg = 0; deg <= 360; deg += 5) {
        const rad = (deg * Math.PI) / 180;
        const p = (1.0 - beta) + beta * Math.cos(rad);
        const r = Math.max(0, p) * lobeRadiusPx;
        const x = mp.px + Math.cos(mic.angle + rad) * r;
        const y = mp.py + Math.sin(mic.angle + rad) * r;
        if (deg === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 184, 77, 0.13)';
      ctx.strokeStyle = 'rgba(255, 184, 77, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.fill();
      ctx.stroke();

      // Negative Polarity Rear Lobe (Figure-8 RCA 44-BX & Supercardioid Shure 55SH)
      if (beta > 0.5) {
        ctx.beginPath();
        for (let deg = 0; deg <= 360; deg += 5) {
          const rad = (deg * Math.PI) / 180;
          const p = (1.0 - beta) + beta * Math.cos(rad);
          const r = Math.max(0, -p) * lobeRadiusPx;
          const x = mp.px + Math.cos(mic.angle + rad) * r;
          const y = mp.py + Math.sin(mic.angle + rad) * r;
          if (deg === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.52)';
        ctx.lineWidth = 1.4;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Draw Movable Acoustic Gobos (Wood/Fiberglass Baffles)
    for (let g = 0; g < this.room.gobos.length; g++) {
      const gobo = this.room.gobos[g];
      const seg = this.room.getGoboEndpoints(gobo);
      const p1 = this._ftToPx(seg.x1, seg.y1);
      const p2 = this._ftToPx(seg.x2, seg.y2);
      const pc = this._ftToPx(gobo.x, gobo.y);

      ctx.save();
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();

      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p1.px, p1.py);
      ctx.lineTo(p2.px, p2.py);
      ctx.stroke();

      // Rotation end handles
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(p1.px, p1.py, 6, 0, Math.PI * 2);
      ctx.arc(p2.px, p2.py, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold 11px "Courier Prime", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(gobo.name, pc.px, pc.py - 12);
      ctx.restore();
    }

    // 5. Draw 4 Sound Sources (with animated acoustic wave rings when playing)
    for (let s = 0; s < 4; s++) {
      const src = this.room.sources[s];
      const sp = this._ftToPx(src.x, src.y);
      const level = Math.min(1.0, channelPeaks[s] || 0.25);

      // Animated sound wave ring
      const waveR = 18 + ((this.pulsePhase * 5 + s * 3) % 24) * (0.45 + level);
      ctx.strokeStyle = src.color;
      ctx.globalAlpha = Math.max(0.1, 0.6 - waveR / 55);
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(sp.px, sp.py, waveR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Source icon circle
      ctx.fillStyle = '#181b1e';
      ctx.strokeStyle = src.color;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.arc(sp.px, sp.py, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = src.color;
      ctx.font = 'bold 12px "Courier Prime", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`S${s + 1}`, sp.px, sp.py);

      ctx.fillStyle = '#f3f4f6';
      ctx.font = 'bold 11px "Courier Prime", monospace';
      ctx.fillText(src.name.split(' ')[1] || src.name, sp.px, sp.py - 25);
    }

    // 6. Draw 4 Microphones & Orientation Aim Handles
    const micCodes = ['U47', '44BX', '55SH'];
    for (let m = 0; m < 4; m++) {
      const mic = this.room.mics[m];
      const mp = this._ftToPx(mic.x, mic.y);
      const aimX = mp.px + Math.cos(mic.angle) * 28;
      const aimY = mp.py + Math.sin(mic.angle) * 28;

      // Aim vector line & handle
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(mp.px, mp.py);
      ctx.lineTo(aimX, aimY);
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(aimX, aimY, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Mic body capsule
      ctx.fillStyle = '#292d32';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mp.px, mp.py, 13.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 10.5px "Courier Prime", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`M${m + 1}`, mp.px, mp.py);

      ctx.fillStyle = '#fcd34d';
      ctx.font = 'bold 10px "Courier Prime", monospace';
      ctx.fillText(micCodes[mic.micModel] || 'U47', mp.px, mp.py + 22);
    }
  }
}

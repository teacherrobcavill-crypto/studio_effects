/**
 * StuderJ37Canvas.js
 * Period-Accurate Dual Studer J37 4-Track Tape Deck Mechanical Interface (1966-1968).
 * 
 * Features:
 *  - Top-down view of twin synchronized Studer J37 tape transports.
 *  - Olive-grey hammered enamel finish, brushed aluminum top plates, NAB hub adapters,
 *    and spinning 10.5" aluminum reels with realistic tape packs.
 *  - "The Thumb on the Flange" tactile physics control: Click & drag directly on
 *    Deck B's supply reel outer rim to apply braking friction.
 *  - Animated tape path, tension rollers, capstan, and pinch rollers.
 *  - Twin amber incandescent backlit VU meters with ballistic needle response.
 *  - Integrated Abbey Road BPO Varispeed control module and Phase Invert button.
 */

export class StuderJ37Canvas {
  constructor(canvasElement, physicsEngine, audioEngine, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.physics = physicsEngine;
    this.audio = audioEngine;
    this.options = options;

    // Viewport dimensions
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    // Interaction state
    this.isPointerDown = false;
    this.pointerX = 0;
    this.pointerY = 0;
    this.isHoveringFlange = false;

    // VU meter ballistic filter values
    this.vuA = 0;
    this.vuB = 0;

    // Layout cache
    this.layout = {};

    this._bindEvents();
    this._updateLayout();
  }

  /**
   * Recalculates deck coordinates based on canvas aspect ratio
   */
  _updateLayout() {
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    const gap = 14;
    const deckW = (this.width - gap * 3) / 2;
    const deckH = this.height - 20;
    const topY = 10;

    // Deck A (Left: Master Reference)
    this.layout.deckA = {
      x: gap,
      y: topY,
      w: deckW,
      h: deckH,
      label: 'STUDER J37 · DECK A [REFERENCE 15 IPS]'
    };

    // Deck B (Right: Slave Flanger)
    this.layout.deckB = {
      x: gap * 2 + deckW,
      y: topY,
      w: deckW,
      h: deckH,
      label: 'STUDER J37 · DECK B [SLAVE FLANGER]'
    };

    // Sub-elements within each deck
    [this.layout.deckA, this.layout.deckB].forEach((deck, dIdx) => {
      const reelR = Math.min(deck.w * 0.23, deck.h * 0.29);
      const reelY = deck.y + reelR + 32;

      // Supply reel (Left reel)
      deck.supplyReel = {
        cx: deck.x + deck.w * 0.26,
        cy: reelY,
        r: reelR,
        isFlangeInteractive: (dIdx === 1) // Deck B supply reel is interactive
      };

      // Takeup reel (Right reel)
      deck.takeupReel = {
        cx: deck.x + deck.w * 0.74,
        cy: reelY,
        r: reelR,
        isFlangeInteractive: false
      };

      // Head Block assembly (Center bottom)
      deck.headBlock = {
        cx: deck.x + deck.w * 0.50,
        cy: reelY + reelR * 0.82,
        w: deck.w * 0.36,
        h: deck.h * 0.22
      };

      // VU Meter (top center of deck)
      deck.vuMeter = {
        x: deck.x + deck.w * 0.35,
        y: deck.y + 12,
        w: deck.w * 0.30,
        h: 46
      };
    });
  }

  /**
   * Bind mouse and touch events for the tactile flange rim
   */
  _bindEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (this.canvas.width / rect.width),
        y: (clientY - rect.top) * (this.canvas.height / rect.height)
      };
    };

    const isInsideFlange = (pos) => {
      if (!this.layout.deckB) return false;
      const reel = this.layout.deckB.supplyReel;
      const dx = pos.x - reel.cx;
      const dy = pos.y - reel.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= reel.r * 1.15 && dist >= reel.r * 0.25;
    };

    const handleStart = (e) => {
      const pos = getPos(e);
      this.pointerX = pos.x;
      this.pointerY = pos.y;

      if (isInsideFlange(pos)) {
        e.preventDefault();
        this.isPointerDown = true;
        const reel = this.layout.deckB.supplyReel;
        const dist = Math.sqrt((pos.x - reel.cx) ** 2 + (pos.y - reel.cy) ** 2);
        const normR = (dist - reel.r * 0.25) / (reel.r * 0.85);
        this.physics.applyThumbBrake(normR, 0.85);
        this.canvas.style.cursor = 'grabbing';
      }
    };

    const handleMove = (e) => {
      const pos = getPos(e);
      this.pointerX = pos.x;
      this.pointerY = pos.y;

      const hovering = isInsideFlange(pos);
      this.isHoveringFlange = hovering;

      if (this.isPointerDown) {
        e.preventDefault();
        const reel = this.layout.deckB.supplyReel;
        const dist = Math.sqrt((pos.x - reel.cx) ** 2 + (pos.y - reel.cy) ** 2);
        const normR = Math.max(0, Math.min(1, (dist - reel.r * 0.25) / (reel.r * 0.85)));
        this.physics.applyThumbBrake(normR, 0.9);
      } else {
        this.canvas.style.cursor = hovering ? 'grab' : 'default';
      }
    };

    const handleEnd = () => {
      if (this.isPointerDown) {
        this.isPointerDown = false;
        this.physics.releaseThumbBrake();
        this.canvas.style.cursor = this.isHoveringFlange ? 'grab' : 'default';
      }
    };

    this.canvas.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);

    this.canvas.addEventListener('touchstart', handleStart, { passive: false });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
  }

  /**
   * Set canvas resolution dynamically
   */
  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this._updateLayout();
  }

  /**
   * Main Render Loop
   */
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const state = this.physics.getState();

    // Background console tray
    ctx.fillStyle = '#171a21';
    ctx.fillRect(0, 0, w, h);

    // Draw Deck A & Deck B
    this._drawDeck(this.layout.deckA, state.reelAngleA, false, state);
    this._drawDeck(this.layout.deckB, state.reelAngleB, true, state);

    // Draw Central Synchronizer / Flange Status Bridge
    this._drawCenterSyncBridge(state);
  }

  /**
   * Draws one Studer J37 chassis
   */
  _drawDeck(deck, reelAngle, isDeckB, state) {
    const ctx = this.ctx;

    // 1. Hammered Enamel Olive-Grey Chassis
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    const grad = ctx.createLinearGradient(deck.x, deck.y, deck.x, deck.y + deck.h);
    grad.addColorStop(0, '#3e4844');
    grad.addColorStop(0.5, '#303936');
    grad.addColorStop(1, '#252c2a');

    ctx.fillStyle = grad;
    this._roundRect(ctx, deck.x, deck.y, deck.w, deck.h, 12);
    ctx.fill();
    ctx.restore();

    // Chassis Bezel Border
    ctx.strokeStyle = '#4e5b56';
    ctx.lineWidth = 2;
    this._roundRect(ctx, deck.x, deck.y, deck.w, deck.h, 12);
    ctx.stroke();

    // Brushed Aluminum Top Plate inset
    const inset = 10;
    const plateGrad = ctx.createLinearGradient(deck.x + inset, deck.y + inset, deck.x + deck.w - inset, deck.y + deck.h - inset);
    plateGrad.addColorStop(0, '#757c85');
    plateGrad.addColorStop(0.5, '#606770');
    plateGrad.addColorStop(1, '#4d535b');

    ctx.fillStyle = plateGrad;
    this._roundRect(ctx, deck.x + inset, deck.y + inset, deck.w - inset * 2, deck.h - inset * 2, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Deck Header Badge
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(deck.label, deck.x + 22, deck.y + 26);

    // Sub-label (Status)
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = isDeckB ? '#38bdf8' : '#34d399';
    const statusText = isDeckB
      ? `Slave: ${state.deckBSpeedIps.toFixed(2)} IPS · Offset: ${state.deltaT_ms >= 0 ? '+' : ''}${state.deltaT_ms.toFixed(2)} ms`
      : `Master: 15.00 IPS Locked (Abbey Road Sync)`;
    ctx.fillText(statusText, deck.x + 22, deck.y + 40);

    // 2. Animated Magnetic Tape Path
    this._drawTapePath(deck, isDeckB);

    // 3. Head Block Assembly
    this._drawHeadBlock(deck.headBlock, isDeckB);

    // 4. VU Meter
    this._drawVUMeter(deck.vuMeter, isDeckB, state);

    // 5. Supply & Takeup 10.5" Aluminum NAB Reels
    this._drawNABReel(deck.supplyReel, reelAngle, true, isDeckB, state);
    this._drawNABReel(deck.takeupReel, reelAngle * 1.05, false, false, state);

    // Deck B Interactive Flange Overlay
    if (isDeckB) {
      this._drawFlangeInteractionHUD(deck.supplyReel, state);
    }
  }

  /**
   * Draws 10.5" NAB aluminum tape reel with realistic cutouts and tape pack
   */
  _drawNABReel(reel, angle, isSupply, isDeckBFlange, state) {
    const ctx = this.ctx;
    const cx = reel.cx;
    const cy = reel.cy;
    const r = reel.r;

    // Magnetic tape pack beneath aluminum flange
    const tapeR = isSupply ? r * 0.88 : r * 0.65;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
    const tapeGrad = ctx.createRadialGradient(cx, cy, r * 0.28, cx, cy, tapeR);
    tapeGrad.addColorStop(0, '#3e2417');
    tapeGrad.addColorStop(0.8, '#4f2e1e');
    tapeGrad.addColorStop(1, '#2f1a0e');
    ctx.fillStyle = tapeGrad;
    ctx.fill();

    // Subtle concentric winding lines on tape pack
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    for (let wr = r * 0.35; wr < tapeR; wr += 4.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, wr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Aluminum Outer Flange (10.5" Plate)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Outer metal rim
    const rimGrad = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r);
    rimGrad.addColorStop(0, '#c7cbd1');
    rimGrad.addColorStop(0.5, '#e4e7eb');
    rimGrad.addColorStop(1, '#9aa0a6');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2, true);
    ctx.fill();

    // 3 Large Classic NAB Oval Spoke Cutouts (120 degrees apart)
    for (let spoke = 0; spoke < 3; spoke++) {
      ctx.save();
      ctx.rotate((spoke * 2 * Math.PI) / 3);

      ctx.fillStyle = '#b0b6be';
      ctx.strokeStyle = '#858d96';
      ctx.lineWidth = 1.5;

      // Spoke shape
      ctx.beginPath();
      ctx.moveTo(-10, r * 0.32);
      ctx.lineTo(-14, r * 0.88);
      ctx.arc(0, r * 0.88, 14, Math.PI, 0, true);
      ctx.lineTo(10, r * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    // Center metallic NAB Hub Adapter (Chrome / Bakelite twist lock)
    const hubR = r * 0.30;
    const hubGrad = ctx.createRadialGradient(0, 0, hubR * 0.2, 0, 0, hubR);
    hubGrad.addColorStop(0, '#e5e7eb');
    hubGrad.addColorStop(0.4, '#9ca3af');
    hubGrad.addColorStop(0.85, '#374151');
    hubGrad.addColorStop(1, '#111827');
    ctx.fillStyle = hubGrad;
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3 Chrome Flange Screws on Hub
    for (let s = 0; s < 3; s++) {
      ctx.save();
      ctx.rotate((s * 2 * Math.PI) / 3);
      ctx.fillStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.arc(0, hubR * 0.65, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Visual HUD overlay and tactile cues on Deck B Supply Reel
   */
  _drawFlangeInteractionHUD(reel, state) {
    const ctx = this.ctx;
    const cx = reel.cx;
    const cy = reel.cy;
    const r = reel.r;

    // Outer tactile flange rim guide
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.04, 0, Math.PI * 2);

    if (state.isBraking) {
      // Glow under active physical thumb braking
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 18;
      ctx.stroke();

      // Tactile touch point & friction ripples
      const dragR = state.dragRadiusMm ? (state.dragRadiusMm / 133.0) * r : r * 0.95;
      ctx.beginPath();
      ctx.arc(this.pointerX, this.pointerY, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Friction Braking Badge
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      this._roundRect(ctx, cx - 65, cy + r + 8, 130, 22, 5);
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 10.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`BRAKING: ${Math.round(state.frictionIntensity * 100)}%`, cx, cy + r + 23);
    } else {
      // Idle / Hover State
      ctx.strokeStyle = this.isHoveringFlange ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = this.isHoveringFlange ? 3 : 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();

      // Helper tooltip on reel
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      this._roundRect(ctx, cx - 75, cy + r + 8, 150, 20, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#7dd3fc';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☝ DRAG RIM TO FLANGE', cx, cy + r + 22);
    }
    ctx.restore();
  }

  /**
   * Tape ribbon traveling across rollers and heads
   */
  _drawTapePath(deck, isDeckB) {
    const ctx = this.ctx;
    const sup = deck.supplyReel;
    const tak = deck.takeupReel;
    const hb = deck.headBlock;

    ctx.save();
    ctx.strokeStyle = '#422416'; // Ferric oxide brown tape
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(sup.cx, sup.cy + sup.r * 0.88);
    ctx.lineTo(deck.x + deck.w * 0.16, hb.cy - 12); // Tension arm roller
    ctx.lineTo(hb.cx - hb.w * 0.45, hb.cy);
    ctx.lineTo(hb.cx + hb.w * 0.45, hb.cy);
    ctx.lineTo(deck.x + deck.w * 0.84, hb.cy - 12); // Capstan pinch roller
    ctx.lineTo(tak.cx, tak.cy + tak.r * 0.65);
    ctx.stroke();

    // Metallic Tension Rollers & Guides
    const rollers = [
      { x: deck.x + deck.w * 0.16, y: hb.cy - 12 },
      { x: deck.x + deck.w * 0.84, y: hb.cy - 12 }
    ];
    rollers.forEach((pt) => {
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }

  /**
   * J37 Tape Head Assembly Cover & Repro Head Gaps
   */
  _drawHeadBlock(hb, isDeckB) {
    const ctx = this.ctx;
    ctx.save();
    // Head cover box
    ctx.fillStyle = '#262c2a';
    this._roundRect(ctx, hb.cx - hb.w / 2, hb.cy - hb.h / 2, hb.w, hb.h, 6);
    ctx.fill();
    ctx.strokeStyle = '#4e5b56';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Studer shield logo
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STUDER J37 HEAD BLOCK', hb.cx, hb.cy - hb.h * 0.22);

    // 4 Discrete Head Stacks: Erase, Record, Sync, Repro
    const headNames = ['ERA', 'REC', 'SYNC', 'REPRO'];
    const spacing = hb.w * 0.22;
    headNames.forEach((name, i) => {
      const hx = hb.cx - hb.w * 0.33 + i * spacing;
      const hy = hb.cy + 6;

      ctx.fillStyle = (name === 'REPRO') ? '#0284c7' : '#374151';
      ctx.fillRect(hx - 10, hy - 12, 20, 24);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - 10, hy - 12, 20, 24);

      // Micro gap in repro head
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(hx - 1, hy - 10, 2, 20);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillText(name, hx, hy + 22);
    });
    ctx.restore();
  }

  /**
   * Incandescent Backlit VU Meter with Ballistic Needles
   */
  _drawVUMeter(vu, isDeckB, state) {
    const ctx = this.ctx;

    // Fetch audio level from analyser if available
    let targetLevel = 0.55;
    const analyser = isDeckB ? this.audio.deckBAnalyser : this.audio.deckAAnalyser;
    if (analyser && this.audio.isPlaying) {
      const data = new Uint8Array(128);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < 128; i++) {
        const val = (data[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / 128);
      targetLevel = Math.min(1.1, rms * 3.8);
    } else {
      targetLevel = 0.05;
    }

    // Ballistic smoothing
    if (isDeckB) {
      this.vuB += (targetLevel - this.vuB) * 0.28;
    } else {
      this.vuA += (targetLevel - this.vuA) * 0.28;
    }
    const vuVal = isDeckB ? this.vuB : this.vuA;

    ctx.save();
    // Warm Incandescent Backlit meter housing
    const bgGrad = ctx.createLinearGradient(vu.x, vu.y, vu.x, vu.y + vu.h);
    bgGrad.addColorStop(0, '#fef08a');
    bgGrad.addColorStop(0.8, '#fde047');
    bgGrad.addColorStop(1, '#eab308');

    ctx.fillStyle = bgGrad;
    this._roundRect(ctx, vu.x, vu.y, vu.w, vu.h, 6);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Scale markings: -20 to +3 dB
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('-20  -10   -5   -1  0  +1 +2 +3', vu.x + vu.w / 2, vu.y + 14);

    // Red zone bar (+0 to +3 dB)
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(vu.x + vu.w * 0.68, vu.y + 6, vu.w * 0.26, 3);

    // Ballistic needle pivot at bottom center
    const pivotX = vu.x + vu.w / 2;
    const pivotY = vu.y + vu.h + 8;
    const needleAngle = -Math.PI * 0.65 + vuVal * (Math.PI * 0.50);

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(needleAngle);

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -vu.h * 1.05);
    ctx.stroke();
    ctx.restore();

    // Label: VU DECK A / VU DECK B
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.fillText(isDeckB ? 'DECK B (SLAVE)' : 'DECK A (MASTER)', vu.x + vu.w / 2, vu.y + vu.h - 6);

    ctx.restore();
  }

  /**
   * Central Synchronizer & Phase Alignment Bridge between Deck A and Deck B
   */
  _drawCenterSyncBridge(state) {
    const ctx = this.ctx;
    const midX = this.width / 2;
    const topY = 16;
    const w = 170;
    const h = 42;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    this._roundRect(ctx, midX - w / 2, topY, w, h, 6);
    ctx.fill();

    // Through-Zero Alignment Indicator
    const isAtZero = Math.abs(state.deltaT_ms) < 0.15;
    ctx.strokeStyle = isAtZero ? '#22c55e' : (state.isBraking ? '#f59e0b' : '#38bdf8');
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillStyle = isAtZero ? '#4ade80' : '#f8fafc';
    const zeroLabel = isAtZero ? '★ THE ZERO POINT ★' : `OFFSET: ${state.deltaT_ms >= 0 ? '+' : ''}${state.deltaT_ms.toFixed(2)} ms`;
    ctx.fillText(zeroLabel, midX, topY + 16);

    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Δx = ${state.tapeDisplacementMm >= 0 ? '+' : ''}${state.tapeDisplacementMm.toFixed(2)} mm on head`, midX, topY + 32);

    ctx.restore();
  }

  /**
   * Helper: Rounded rectangle
   */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

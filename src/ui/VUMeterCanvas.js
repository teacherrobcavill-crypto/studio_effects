/**
 * VUMeterCanvas.js
 * Authentic 1950s Weston Model 862 / Simpson Illuminated Analog VU Meter &
 * Fairchild 660 Gain Reduction (GR) Meter with 300ms Ballistic Integration and
 * 2nd-Order Underdamped Needle Overshoot Physics (zeta = 0.81, 1.2% overshoot).
 */

export class VUMeterCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @param {'vu'|'gr'} options.mode - 'vu' (-20 to +3 VU) or 'gr' (0 to -20 dB Gain Reduction)
   * @param {string} options.label - Meter faceplate inscription (e.g. 'MASTER L', 'VARI-MU GR')
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = options.mode || 'vu';
    this.label = options.label || 'VU';

    // Needle physical state (normalized 0.0 to 1.0 across the meter arc)
    this.needlePos = this.mode === 'gr' ? 1.0 : 0.0;
    this.needleVel = 0.0;
    this.peakLedHold = 0.0;
  }

  /**
   * Updates ballistic needle physics at 60fps and renders the illuminated vintage meter
   * @param {number} value - RMS amplitude (for 'vu' mode) or positive dB gain reduction (for 'gr' mode)
   * @param {number} peak - Instantaneous peak amplitude (for overload jewel lamp)
   * @param {number} dt - Frame delta time in seconds (~0.0166s)
   */
  updateAndDraw(value, peak = 0, dt = 1 / 60) {
    let targetNorm = 0.0;

    if (this.mode === 'vu') {
      // Convert linear RMS to VU dB (calibrated so RMS = 0.25 -> 0 VU, giving +12dB headroom)
      const db = 20 * Math.log10(Math.max(1e-5, value / 0.25));
      // Map [-20 VU, +3 VU] to [0.0, 1.0] with authentic non-linear Weston scale compression
      const clampedDb = Math.max(-20, Math.min(3.5, db));
      if (clampedDb <= 0) {
        // -20 to 0 VU occupies 0.0 to 0.72 of the arc
        targetNorm = Math.pow((clampedDb + 20) / 20, 1.35) * 0.72;
      } else {
        // 0 to +3 VU occupies 0.72 to 1.0 of the arc (red overload zone)
        targetNorm = 0.72 + (clampedDb / 3.5) * 0.28;
      }
    } else {
      // Fairchild 660 Gain Reduction meter: 0 dB rests on the right (0.85), deflects left as GR increases
      const grDb = Math.max(0, Math.min(20, value));
      targetNorm = Math.max(0.0, 0.88 - (grDb / 20.0) * 0.85);
    }

    // 2nd-order D'Arsonval moving-coil ballistic differential equation:
    // Natural frequency wn = 13.5 rad/s (300ms rise time to 99%), damping ratio zeta = 0.81 (1.2% overshoot)
    const wn = 14.0;
    const zeta = 0.81;
    const safeDt = Math.min(0.05, dt);

    const accel = wn * wn * (targetNorm - this.needlePos) - 2.0 * zeta * wn * this.needleVel;
    this.needleVel += accel * safeDt;
    this.needlePos += this.needleVel * safeDt;

    // Soft mechanical rubber end-stops
    if (this.needlePos < -0.02) {
      this.needlePos = -0.02;
      this.needleVel *= -0.25;
    } else if (this.needlePos > 1.03) {
      this.needlePos = 1.03;
      this.needleVel *= -0.25;
    }

    if (peak > 0.88 || (this.mode === 'vu' && this.needlePos > 0.74)) {
      this.peakLedHold = 1.0;
    } else {
      this.peakLedHold = Math.max(0.0, this.peakLedHold - safeDt * 3.5);
    }

    this._drawFaceplate();
  }

  _drawFaceplate() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // 1. Warm Tungsten-Backlit Cream Faceplate Gradient
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.85, 8, w * 0.5, h * 0.55, w * 0.7);
    bgGrad.addColorStop(0, '#fff4d6');
    bgGrad.addColorStop(0.65, '#eddcb4');
    bgGrad.addColorStop(1, '#c9b282');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const pivotX = w * 0.5;
    const pivotY = h * 1.18;
    const radius = h * 0.94;
    const startAngle = -Math.PI * 0.73; // -131.4 deg
    const endAngle = -Math.PI * 0.27;   // -48.6 deg
    const zeroVuAngle = startAngle + 0.72 * (endAngle - startAngle);

    // 2. Scale Arcs (Black main arc + Red overload zone for VU)
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#241e18';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, radius, startAngle, this.mode === 'vu' ? zeroVuAngle : endAngle);
    ctx.stroke();

    if (this.mode === 'vu') {
      ctx.lineWidth = 4.0;
      ctx.strokeStyle = '#b92b27';
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, radius, zeroVuAngle, endAngle);
      ctx.stroke();
    }

    // 3. Scale Tick Marks & Labels
    ctx.font = 'bold 9px "Courier Prime", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const ticks =
      this.mode === 'vu'
        ? [
            { label: '-20', norm: 0.0, red: false },
            { label: '-10', norm: 0.28, red: false },
            { label: '-7', norm: 0.42, red: false },
            { label: '-5', norm: 0.52, red: false },
            { label: '-3', norm: 0.61, red: false },
            { label: '0', norm: 0.72, red: false },
            { label: '+1', norm: 0.81, red: true },
            { label: '+2', norm: 0.90, red: true },
            { label: '+3', norm: 1.0, red: true }
          ]
        : [
            { label: '-20', norm: 0.03, red: true },
            { label: '-15', norm: 0.24, red: true },
            { label: '-10', norm: 0.45, red: false },
            { label: '-6', norm: 0.62, red: false },
            { label: '-3', norm: 0.75, red: false },
            { label: '0', norm: 0.88, red: false }
          ];

    for (const t of ticks) {
      const ang = startAngle + t.norm * (endAngle - startAngle);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);

      const rInner = radius - 5;
      const rOuter = radius + 6;
      const rText = radius + 15;

      ctx.strokeStyle = t.red ? '#b92b27' : '#241e18';
      ctx.lineWidth = t.label === '0' ? 2.2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(pivotX + cos * rInner, pivotY + sin * rInner);
      ctx.lineTo(pivotX + cos * rOuter, pivotY + sin * rOuter);
      ctx.stroke();

      ctx.fillStyle = t.red ? '#b92b27' : '#241e18';
      ctx.fillText(t.label, pivotX + cos * rText, pivotY + sin * rText);
    }

    // 4. Center Inscription ("VU" or "dB GR" + Label)
    ctx.fillStyle = '#382f25';
    ctx.font = 'bold 13px "Courier Prime", monospace';
    ctx.fillText(this.mode === 'vu' ? 'VU' : 'dB GR', pivotX, h * 0.62);

    ctx.font = 'bold 8.5px "Courier Prime", monospace';
    ctx.fillStyle = '#6b5a45';
    ctx.fillText(this.label, pivotX, h * 0.78);

    // 5. Peak Overload Jewel Indicator (top right corner)
    const ledX = w - 14;
    const ledY = 13;
    ctx.beginPath();
    ctx.arc(ledX, ledY, 4.5, 0, Math.PI * 2);
    if (this.peakLedHold > 0.1) {
      ctx.fillStyle = `rgba(235, 35, 30, ${0.4 + 0.6 * this.peakLedHold})`;
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = 8;
    } else {
      ctx.fillStyle = '#4a201e';
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#241e18';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 6. Ballistic Spade Needle + Subtle Drop Shadow
    const needleAngle = startAngle + this.needlePos * (endAngle - startAngle);
    const nCos = Math.cos(needleAngle);
    const nSin = Math.sin(needleAngle);
    const needleLen = radius + 10;

    // Shadow
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(pivotX + 2, pivotY + 2);
    ctx.lineTo(pivotX + nCos * needleLen + 2, pivotY + nSin * needleLen + 2);
    ctx.stroke();

    // Actual Needle
    ctx.strokeStyle = '#181412';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(pivotX + nCos * needleLen, pivotY + nSin * needleLen);
    ctx.stroke();

    // Spade tip
    const spadeDist = radius - 2;
    ctx.fillStyle = '#181412';
    ctx.beginPath();
    ctx.arc(pivotX + nCos * spadeDist, pivotY + nSin * spadeDist, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // 7. Bottom Bakelite Pivot Escutcheon Cap & Glass Vignette
    ctx.fillStyle = '#1d1916';
    ctx.beginPath();
    ctx.arc(pivotX, h + 8, 22, Math.PI, 0);
    ctx.fill();

    // Top glass highlight reflection
    const glassGrad = ctx.createLinearGradient(0, 0, 0, h * 0.35);
    glassGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
    glassGrad.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, w, h * 0.35);
  }
}

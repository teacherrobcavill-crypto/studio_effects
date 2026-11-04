/**
 * LiveRoomEngine.js
 * Stage 1: 1950s Live Room Acoustic Simulator (35ft W x 25ft D x 14ft H).
 * Implements:
 *  - Full 4x4 Source-to-Microphone Cross-Bleed Delay & Polar Attenuation Matrix
 *  - Propagation delay tau = d / 1125 ft/s (causes real acoustic comb filtering & phase coherence)
 *  - Polar pattern directional equation P(theta) = (1 - beta) + beta * cos(theta) with true Figure-8 rear phase inversion
 *  - Line-segment intersection ray-casting against movable Acoustic Gobos (diffraction low-pass + attenuation)
 *  - 6-Wall 1st-Order Image Source Method (ISM) Early Reflections + Sabine Room Convolution Reverb
 */

export class LiveRoomEngine {
  constructor(audioContext) {
    this.ctx = audioContext;

    // Room dimensions in feet (Classic Sun / Chess / RCA Studio B dimensions)
    this.roomDims = { width: 35.0, depth: 25.0, height: 14.0 };
    this.speedOfSoundFtSec = 1125.0;

    // 4 Sound Sources (Upright Bass, Archtop Guitar, Calfskin Kit, Lead Vocal)
    this.sources = [
      { id: 0, name: 'Upright Bass', x: 9.0, y: 8.5, z: 3.5, color: '#f59e0b' },
      { id: 1, name: 'Archtop Guitar', x: 25.5, y: 8.5, z: 3.0, color: '#38bdf8' },
      { id: 2, name: 'Calfskin Kit', x: 17.5, y: 5.5, z: 3.5, color: '#10b981' },
      { id: 3, name: 'Lead Vocal', x: 17.5, y: 17.5, z: 5.2, color: '#f43f5e' }
    ];

    // 4 Studio Microphones (initially placed near each respective source, with orientation angle in radians)
    // micModel: 0 = Neumann U47 (Cardioid), 1 = RCA 44-BX (Figure-8), 2 = Shure 55SH (Supercardioid)
    this.mics = [
      { id: 0, name: 'Mic 1 (Bass)', x: 9.0, y: 11.0, z: 3.5, angle: -Math.PI / 2, micModel: 1 },
      { id: 1, name: 'Mic 2 (Guitar)', x: 25.5, y: 10.8, z: 3.0, angle: -Math.PI / 2, micModel: 2 },
      { id: 2, name: 'Mic 3 (Drums OH)', x: 17.5, y: 8.8, z: 6.2, angle: -Math.PI / 2, micModel: 0 },
      { id: 3, name: 'Mic 4 (Vocal)', x: 17.5, y: 15.6, z: 5.2, angle: Math.PI / 2, micModel: 0 }
    ];

    // 2 Movable Wood/Fiberglass Acoustic Baffles (Gobos) defined by center (x, y), angle, and width (6 ft)
    this.gobos = [
      { id: 0, name: 'Gobo A', x: 13.2, y: 11.5, angle: 0.35, length: 6.5 },
      { id: 1, name: 'Gobo B', x: 21.8, y: 11.5, angle: -0.35, length: 6.5 }
    ];

    // Room acoustic parameters
    this.roomDamping = 0.35; // Wall absorption alpha (0.15 = live plaster/tile, 0.75 = heavy drapes/celotex)
    this.bleedEnabled = true;
    this.reverbMix = 0.28;

    // Input nodes for the 4 stems & Output nodes for the 4 microphones
    this.sourceInputs = Array.from({ length: 4 }, () => this.ctx.createGain());
    this.micOutputs = Array.from({ length: 4 }, () => this.ctx.createGain());

    // Build 4x4 Direct + Bleed Acoustic Matrix + Early Reflection taps + Sabine Reverb
    this.matrixCells = [];
    this._buildAcousticGraph();
    this.updateAcoustics();
  }

  _buildAcousticGraph() {
    // Create Sabine diffuse room reverb convolver shared across the room
    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbConvolver.buffer = this._generateSabineImpulseResponse(0.85, this.roomDamping);
    this.reverbSendBus = this.ctx.createGain();
    this.reverbSendBus.gain.value = 0.22;
    this.reverbSendBus.connect(this.reverbConvolver);

    // 4x4 Direct & Cross-Bleed Acoustic Matrix (Source i -> Mic j)
    for (let s = 0; s < 4; s++) {
      this.matrixCells[s] = [];
      // Feed source into room diffuse excitation bus
      const roomExcite = this.ctx.createGain();
      roomExcite.gain.value = 0.25;
      this.sourceInputs[s].connect(roomExcite);
      roomExcite.connect(this.reverbSendBus);

      for (let m = 0; m < 4; m++) {
        // Propagation delay node (up to 100ms max room diagonal)
        const delayNode = this.ctx.createDelay(0.15);
        // Air absorption & Gobo diffraction low-pass filter
        const airFilter = this.ctx.createBiquadFilter();
        airFilter.type = 'lowpass';
        airFilter.frequency.value = 16000;
        airFilter.Q.value = 0.5;

        // Distance + Polar + Gobo shadow gain (can be negative for Figure-8 rear lobe!)
        const pathGain = this.ctx.createGain();
        pathGain.gain.value = s === m ? 1.0 : 0.1;

        // 1st-Order Image Source Early Reflection cluster tap (Floor + nearest wall bounce)
        const erDelay = this.ctx.createDelay(0.15);
        const erFilter = this.ctx.createBiquadFilter();
        erFilter.type = 'lowpass';
        erFilter.frequency.value = 4200;
        const erGain = this.ctx.createGain();
        erGain.gain.value = 0.08;

        // Connect Direct / Bleed path: Source s -> Delay -> Air/Gobo Filter -> Polar/Dist Gain -> Mic m
        this.sourceInputs[s].connect(delayNode);
        delayNode.connect(airFilter);
        airFilter.connect(pathGain);
        pathGain.connect(this.micOutputs[m]);

        // Connect Image-Source Early Reflection path: Source s -> erDelay -> erFilter -> erGain -> Mic m
        this.sourceInputs[s].connect(erDelay);
        erDelay.connect(erFilter);
        erFilter.connect(erGain);
        erGain.connect(this.micOutputs[m]);

        this.matrixCells[s][m] = {
          delayNode,
          airFilter,
          pathGain,
          erDelay,
          erFilter,
          erGain,
          distanceFt: 2.5,
          delayMs: 2.2,
          gainDb: 0.0,
          occludedByGobo: false
        };
      }
    }

    // Connect diffuse room tail into each microphone output (scaled by mic diffuse field sensitivity)
    this.micReverbGains = this.mics.map((_, m) => {
      const g = this.ctx.createGain();
      g.gain.value = this.reverbMix * 0.35;
      this.reverbConvolver.connect(g);
      g.connect(this.micOutputs[m]);
      return g;
    });
  }

  /**
   * Synthesizes a physical Sabine Room Impulse Response based on room volume V = 35*25*14 = 12,250 ft^3
   * and surface absorption alpha: RT60 = 0.049 * V / (S * alpha)
   */
  _generateSabineImpulseResponse(rt60Sec, damping) {
    const sr = this.ctx.sampleRate;
    const length = Math.floor(sr * Math.max(0.35, Math.min(2.2, rt60Sec)));
    const buffer = this.ctx.createBuffer(2, length, sr);
    const decayRate = 6.9078 / rt60Sec; // ln(1000) / RT60

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      const lpAlpha = 0.35 + (1.0 - damping) * 0.45;
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        // Pre-delay of 12ms before diffuse field builds up
        if (t < 0.012) {
          data[i] = 0;
          continue;
        }
        const white = Math.random() * 2 - 1;
        lp = lpAlpha * white + (1.0 - lpAlpha) * lp;
        const env = Math.exp(-decayRate * (t - 0.012));
        data[i] = lp * env * 0.38;
      }
    }
    return buffer;
  }

  /**
   * Returns endpoints [x1, y1, x2, y2] of a Gobo baffle segment
   */
  getGoboEndpoints(gobo) {
    const half = gobo.length * 0.5;
    const dx = Math.cos(gobo.angle) * half;
    const dy = Math.sin(gobo.angle) * half;
    return {
      x1: gobo.x - dx,
      y1: gobo.y - dy,
      x2: gobo.x + dx,
      y2: gobo.y + dy
    };
  }

  /**
   * 2D Line-Segment Intersection test between ray (Ax,Ay)->(Bx,By) and Gobo segment (Cx,Cy)->(Dx,Dy)
   */
  _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) =>
      (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
    return (
      ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
      ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
    );
  }

  /**
   * Checks if the acoustic path between Source s and Mic m is shadowed by any Gobo baffle
   */
  _isPathShadowedByGobo(src, mic) {
    for (const gobo of this.gobos) {
      const seg = this.getGoboEndpoints(gobo);
      if (this._segmentsIntersect(src.x, src.y, mic.x, mic.y, seg.x1, seg.y1, seg.x2, seg.y2)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluates 1st-Order Polar Pattern response P(theta) = (1 - beta) + beta * cos(theta)
   * Preserves sign for Figure-8 rear-lobe 180-degree phase inversion.
   */
  _evaluatePolarGain(micModel, thetaRad) {
    // 0: Neumann U47 Cardioid (beta = 0.5)
    // 1: RCA 44-BX Velocity Ribbon Figure-8 (beta = 1.0)
    // 2: Shure 55SH Unidyne Supercardioid (beta = 0.63)
    const beta = micModel === 1 ? 1.0 : micModel === 2 ? 0.63 : 0.5;
    return (1.0 - beta) + beta * Math.cos(thetaRad);
  }

  /**
   * Computes 1st-Order Image-Source Method (ISM) earliest wall/floor reflection distance
   */
  _computeNearestImageDistance(src, mic) {
    const W = this.roomDims.width;
    const D = this.roomDims.depth;
    const H = this.roomDims.height;

    // 6 virtual mirror images across West (x=0), East (x=W), North (y=0), South (y=D), Floor (z=0), Ceiling (z=H)
    const images = [
      { x: -src.x, y: src.y, z: src.z },
      { x: 2 * W - src.x, y: src.y, z: src.z },
      { x: src.x, y: -src.y, z: src.z },
      { x: src.x, y: 2 * D - src.y, z: src.z },
      { x: src.x, y: src.y, z: -src.z },
      { x: src.x, y: src.y, z: 2 * H - src.z }
    ];

    let minDist = Infinity;
    for (const img of images) {
      const d = Math.hypot(img.x - mic.x, img.y - mic.y, img.z - mic.z);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  /**
   * Recomputes the entire 4x4 Acoustic Propagation, Polar Pattern, Gobo Occlusion, and ISM Matrix in real time
   */
  updateAcoustics() {
    const now = this.ctx.currentTime;
    const wallReflectivity = 1.0 - this.roomDamping;

    // Sabine RT60 calculation: V = 12,250 ft^3, Total Surface Area S = 3,430 ft^2
    const V = this.roomDims.width * this.roomDims.depth * this.roomDims.height;
    const S =
      2 * (this.roomDims.width * this.roomDims.depth +
           this.roomDims.width * this.roomDims.height +
           this.roomDims.depth * this.roomDims.height);
    this.rt60 = (0.049 * V) / (S * Math.max(0.12, this.roomDamping));

    for (let s = 0; s < 4; s++) {
      const src = this.sources[s];

      for (let m = 0; m < 4; m++) {
        const mic = this.mics[m];
        const cell = this.matrixCells[s][m];

        // 1. 3D Euclidean Distance & Speed of Sound Delay
        const dx = src.x - mic.x;
        const dy = src.y - mic.y;
        const dz = src.z - mic.z;
        const distFt = Math.max(0.35, Math.hypot(dx, dy, dz));
        const delaySec = distFt / this.speedOfSoundFtSec;

        // 2. Inverse-Square Distance Attenuation (normalized to reference distance d_ref = 2.5 ft)
        const dRef = 2.5;
        const distAtten = Math.min(2.2, dRef / Math.pow(distFt, 0.92));

        // 3. Polar Pattern Angle & Directional Gain
        const angleToSource = Math.atan2(dy, dx);
        const relAngle = angleToSource - mic.angle;
        const polarGain = this._evaluatePolarGain(mic.micModel, relAngle);

        // 4. Ray-Cast Gobo Baffle Diffraction Shadow Check
        const shadowed = this._isPathShadowedByGobo(src, mic);
        const goboGainFactor = shadowed ? 0.26 : 1.0; // -11.7 dB shadow attenuation

        // 5. Cross-Bleed Toggle (if bleed disabled, mute off-diagonal paths s !== m)
        const bleedGate = (!this.bleedEnabled && s !== m) ? 0.0 : 1.0;

        const totalDirectGain = distAtten * polarGain * goboGainFactor * bleedGate;

        // 6. Air Absorption & Gobo Diffraction Low-Pass Cutoff
        const airCutoffHz = shadowed
          ? 1450.0
          : Math.max(2500.0, 18500.0 / (1.0 + 0.028 * distFt));

        // 7. 1st-Order Image Source Method (ISM) Early Reflection Delay & Gain
        const imgDistFt = this._computeNearestImageDistance(src, mic);
        const erDelaySec = Math.min(0.14, imgDistFt / this.speedOfSoundFtSec);
        const erGainVal = (dRef / Math.max(2.0, imgDistFt)) * wallReflectivity * 0.25 * bleedGate;

        // Smoothly update Web Audio parameters
        cell.delayNode.delayTime.setTargetAtTime(delaySec, now, 0.015);
        cell.airFilter.frequency.setTargetAtTime(airCutoffHz, now, 0.015);
        cell.pathGain.gain.setTargetAtTime(totalDirectGain, now, 0.015);

        cell.erDelay.delayTime.setTargetAtTime(erDelaySec, now, 0.02);
        cell.erFilter.frequency.setTargetAtTime(3800 * wallReflectivity + 1200, now, 0.02);
        cell.erGain.gain.setTargetAtTime(erGainVal, now, 0.02);

        // Store telemetry for UI inspection & Channel MicWorklet proximity effect
        cell.distanceFt = distFt;
        cell.delayMs = delaySec * 1000.0;
        cell.gainDb = 20.0 * Math.log10(Math.max(1e-4, Math.abs(totalDirectGain)));
        cell.occludedByGobo = shadowed;
      }
    }

    // Update diffuse reverb return level
    for (let m = 0; m < 4; m++) {
      this.micReverbGains[m].gain.setTargetAtTime(this.reverbMix * wallReflectivity * 0.45, now, 0.02);
    }
  }

  /**
   * Returns the primary distance (ft) from Mic m to its paired primary Source m (for Proximity Effect)
   */
  getPrimaryMicDistance(micIndex) {
    return this.matrixCells[micIndex][micIndex].distanceFt;
  }

  setRoomDamping(dampingVal) {
    this.roomDamping = Math.max(0.1, Math.min(0.85, dampingVal));
    this.updateAcoustics();
    this.reverbConvolver.buffer = this._generateSabineImpulseResponse(this.rt60, this.roomDamping);
  }

  setReverbMix(mixVal) {
    this.reverbMix = Math.max(0.0, Math.min(1.0, mixVal));
    this.updateAcoustics();
  }

  setBleedEnabled(enabled) {
    this.bleedEnabled = Boolean(enabled);
    this.updateAcoustics();
  }
}

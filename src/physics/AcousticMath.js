import { MATERIALS } from './Materials.js';

export const SPEED_OF_SOUND = 343.0; // m/s at 20°C dry air
export const MIN_DISTANCE = 0.22;    // Minimum acoustic clamping distance (m)

// Air intensity attenuation coefficient m (m^-1) per frequency band (20°C, 50% RH)
const AIR_ABSORPTION_M = {
  125: 0.0001,
  1000: 0.0011,
  4000: 0.0062
};

export const POLAR_PATTERNS = {
  omnidirectional: {
    id: 'omnidirectional',
    name: 'Omnidirectional (Pressure)',
    directivityFactor: 1.0,
    formula: (cosTheta) => 1.0
  },
  cardioid: {
    id: 'cardioid',
    name: 'Cardioid (Unidirectional)',
    directivityFactor: 3.0,
    formula: (cosTheta) => 0.5 * (1.0 + cosTheta)
  },
  supercardioid: {
    id: 'supercardioid',
    name: 'Supercardioid (Tight Studio)',
    directivityFactor: 3.7,
    formula: (cosTheta) => 0.37 + 0.63 * cosTheta
  },
  figure8: {
    id: 'figure8',
    name: 'Figure-8 (1950s Velocity Ribbon)',
    directivityFactor: 3.0,
    formula: (cosTheta) => cosTheta // Signed cosine (phase inverts on rear lobe, zero at 90° nulls)
  }
};

/**
 * Evaluates directional microphone sensitivity for an incoming wave vector
 * arriving from `targetPos` into `micPos`, given microphone yaw angle (in radians).
 * Yaw = 0 points along -Z (towards Front wall).
 */
export function evaluatePolarPattern(patternId, micPos, targetPos, micYawRad = 0) {
  const pattern = POLAR_PATTERNS[patternId] || POLAR_PATTERNS.cardioid;
  const dx = targetPos.x - micPos.x;
  const dy = targetPos.y - micPos.y;
  const dz = targetPos.z - micPos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-5) {
    return { signedGain: 1.0, magnitude: 1.0, angleDeg: 0, pan: 0 };
  }

  // Unit vector from mic towards acoustic arrival direction
  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;

  // Microphone forward axis (horizontal plane yaw)
  const fwdX = Math.sin(micYawRad);
  const fwdY = 0;
  const fwdZ = -Math.cos(micYawRad);

  // Microphone right-ear axis for stereo panning
  const rightX = Math.cos(micYawRad);
  const rightZ = Math.sin(micYawRad);

  const cosTheta = Math.max(-1, Math.min(1, ux * fwdX + uy * fwdY + uz * fwdZ));
  const signedGain = pattern.formula(cosTheta);
  const magnitude = Math.abs(signedGain);
  const angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
  const pan = Math.max(-0.95, Math.min(0.95, ux * rightX + uz * rightZ));

  return { signedGain, magnitude, angleDeg, pan };
}

/**
 * Computes Sabine and Eyring-Norris reverberation time (RT60) across 125Hz, 1kHz, and 4kHz.
 */
export function computeRoomReverb(dimensions, surfaceMaterials) {
  const { width, height, depth } = dimensions;
  const volume = width * height * depth;

  const areas = {
    floor: width * depth,
    ceiling: width * depth,
    left: depth * height,
    right: depth * height,
    front: width * height,
    back: width * height
  };

  const totalArea =
    areas.floor + areas.ceiling + areas.left + areas.right + areas.front + areas.back;

  const bands = [125, 1000, 4000];
  const sabine = {};
  const eyring = {};
  const sabins = {};
  const meanAlpha = {};

  for (const freq of bands) {
    let surfaceSabins = 0;
    for (const face of Object.keys(areas)) {
      const matId = surfaceMaterials[face] || 'wood_oak';
      const mat = MATERIALS[matId] || MATERIALS.wood_oak;
      const alpha = mat.absorption[freq] ?? 0.1;
      surfaceSabins += areas[face] * alpha;
    }

    const airSabins = 4.0 * AIR_ABSORPTION_M[freq] * volume;
    const totalSabins = Math.max(0.05, surfaceSabins + airSabins);
    const avgAlpha = Math.min(0.98, surfaceSabins / totalArea);

    sabins[freq] = totalSabins;
    meanAlpha[freq] = avgAlpha;
    sabine[freq] = (0.161 * volume) / totalSabins;

    const eyringDenom = -totalArea * Math.log(1.0 - avgAlpha) + airSabins;
    eyring[freq] = (0.161 * volume) / Math.max(0.05, eyringDenom);
  }

  return {
    volume,
    totalArea,
    areas,
    sabins,
    meanAlpha,
    sabine,
    eyring
  };
}

/**
 * Computes First-Order Image-Source reflections for all 6 boundaries of the rectangular studio.
 */
export function computeImageSourceReflections(
  dimensions,
  sourcePos,
  micPos,
  surfaceMaterials,
  polarPattern = 'cardioid',
  micYawRad = 0,
  directDistance = 1.0
) {
  const halfW = dimensions.width / 2;
  const halfD = dimensions.depth / 2;
  const H = dimensions.height;

  // Define the 6 planes and their mirrored virtual image source coordinates
  const boundaryDefs = [
    {
      id: 'left',
      label: 'Left Wall (-X)',
      axis: 'x',
      planeCoord: -halfW,
      color: '#ff6b6b',
      imageSource: { x: -dimensions.width - sourcePos.x, y: sourcePos.y, z: sourcePos.z }
    },
    {
      id: 'right',
      label: 'Right Wall (+X)',
      axis: 'x',
      planeCoord: halfW,
      color: '#f59f00',
      imageSource: { x: dimensions.width - sourcePos.x, y: sourcePos.y, z: sourcePos.z }
    },
    {
      id: 'floor',
      label: 'Floor (Y=0)',
      axis: 'y',
      planeCoord: 0,
      color: '#4dabf7',
      imageSource: { x: sourcePos.x, y: -sourcePos.y, z: sourcePos.z }
    },
    {
      id: 'ceiling',
      label: 'Ceiling (+Y)',
      axis: 'y',
      planeCoord: H,
      color: '#9775fa',
      imageSource: { x: sourcePos.x, y: 2 * H - sourcePos.y, z: sourcePos.z }
    },
    {
      id: 'front',
      label: 'Front Wall (-Z)',
      axis: 'z',
      planeCoord: -halfD,
      color: '#20c997',
      imageSource: { x: sourcePos.x, y: sourcePos.y, z: -dimensions.depth - sourcePos.z }
    },
    {
      id: 'back',
      label: 'Back Wall (+Z)',
      axis: 'z',
      planeCoord: halfD,
      color: '#e64980',
      imageSource: { x: sourcePos.x, y: sourcePos.y, z: dimensions.depth - sourcePos.z }
    }
  ];

  const directDelaySec = directDistance / SPEED_OF_SOUND;

  return boundaryDefs.map((def) => {
    const img = def.imageSource;

    // Parametric intersection u along segment from imageSource -> micPos where plane is crossed
    const denom = micPos[def.axis] - img[def.axis];
    const u = Math.abs(denom) > 1e-6 ? (def.planeCoord - img[def.axis]) / denom : 0.5;

    const reflectionPoint = {
      x: img.x + u * (micPos.x - img.x),
      y: img.y + u * (micPos.y - img.y),
      z: img.z + u * (micPos.z - img.z)
    };

    const totalDistance = Math.max(
      MIN_DISTANCE,
      Math.hypot(micPos.x - img.x, micPos.y - img.y, micPos.z - img.z)
    );

    const arrivalTimeSec = totalDistance / SPEED_OF_SOUND;
    const deltaTimeSec = Math.max(0.0001, arrivalTimeSec - directDelaySec);
    const deltaTimeMs = deltaTimeSec * 1000;
    const extraPathMeters = Math.max(0.01, totalDistance - directDistance);

    const matId = surfaceMaterials[def.id] || 'wood_oak';
    const mat = MATERIALS[matId] || MATERIALS.wood_oak;

    // Pressure reflection coefficient R(f) = sqrt(1 - alpha(f))
    const reflectionCoeff = {
      125: Math.sqrt(Math.max(0, 1.0 - mat.absorption[125])),
      1000: Math.sqrt(Math.max(0, 1.0 - mat.absorption[1000])),
      4000: Math.sqrt(Math.max(0, 1.0 - mat.absorption[4000]))
    };

    // Polar pattern evaluated towards the reflection point on the wall
    const polar = evaluatePolarPattern(polarPattern, micPos, reflectionPoint, micYawRad);

    // Distance attenuation (1 / r)
    const distanceGain = 1.0 / totalDistance;
    // Relative gain compared to direct path
    const relativeDistanceRatio = directDistance / totalDistance;

    // Effective band gains at microphone
    const bandGain = {
      125: distanceGain * reflectionCoeff[125] * polar.magnitude,
      1000: distanceGain * reflectionCoeff[1000] * polar.magnitude,
      4000:
        distanceGain *
        reflectionCoeff[4000] *
        polar.magnitude *
        Math.exp(-2 * AIR_ABSORPTION_M[4000] * totalDistance)
    };

    const levelDb1k = 20 * Math.log10(Math.max(1e-5, relativeDistanceRatio * reflectionCoeff[1000] * polar.magnitude));
    const firstCombNotchHz = 1.0 / (2.0 * deltaTimeSec);

    return {
      id: def.id,
      label: def.label,
      color: def.color,
      materialId: matId,
      materialName: mat.name,
      imageSource: img,
      reflectionPoint,
      totalDistance,
      extraPathMeters,
      arrivalTimeSec,
      deltaTimeSec,
      deltaTimeMs,
      reflectionCoeff,
      polar,
      distanceGain,
      bandGain,
      levelDb1k,
      firstCombNotchHz
    };
  });
}

/**
 * Computes low-frequency boundary loading (radiation impedance boost when a sound source
 * approaches 1, 2, or 3 rigid room boundaries: half-space, quarter-space, eighth-space).
 */
export function computeBoundaryLoading(dimensions, sourcePos, surfaceMaterials) {
  const halfW = dimensions.width / 2;
  const halfD = dimensions.depth / 2;

  const distances = [
    { face: 'left', d: Math.max(0.05, sourcePos.x + halfW) },
    { face: 'right', d: Math.max(0.05, halfW - sourcePos.x) },
    { face: 'floor', d: Math.max(0.05, sourcePos.y) },
    { face: 'ceiling', d: Math.max(0.05, dimensions.height - sourcePos.y) },
    { face: 'front', d: Math.max(0.05, sourcePos.z + halfD) },
    { face: 'back', d: Math.max(0.05, halfD - sourcePos.z) }
  ];

  // Quarter-wavelength coupling radius (~1.4m for 60-125Hz bass region)
  const couplingRadius = 1.45;
  let totalBoostDb = 0;
  let activeBoundaries = 0;
  let nearestDist = Infinity;

  for (const item of distances) {
    if (item.d < nearestDist) nearestDist = item.d;
    const mat = MATERIALS[surfaceMaterials[item.face]] || MATERIALS.wood_oak;
    const rigidity = 1.0 - mat.absorption[125] * 0.75; // Rigid walls load stronger than bass traps

    if (item.d < couplingRadius) {
      const proximity = Math.pow(1.0 - item.d / couplingRadius, 1.35);
      totalBoostDb += 3.2 * proximity * rigidity;
      if (proximity > 0.35) activeBoundaries++;
    }
  }

  let spaceRegime = 'Free / Full-Space (4π sr)';
  if (activeBoundaries >= 3) {
    spaceRegime = 'Eighth-Space Corner (π/2 sr)';
  } else if (activeBoundaries === 2) {
    spaceRegime = 'Quarter-Space Edge (π sr)';
  } else if (activeBoundaries === 1) {
    spaceRegime = 'Half-Space Wall (2π sr)';
  }

  // Corner turnover frequency where in-phase boundary coupling transitions to comb notches
  const turnoverHz = Math.min(280, Math.max(65, SPEED_OF_SOUND / (4.0 * Math.max(0.25, nearestDist))));

  return {
    boostDb: Math.min(12.0, totalBoostDb),
    activeBoundaries,
    nearestDist,
    turnoverHz,
    spaceRegime
  };
}

/**
 * Computes fundamental axial standing-wave modes of the rectangular enclosure:
 * f = (c / 2) * (n / L)
 */
export function computeRoomModes(dimensions) {
  const { width, height, depth } = dimensions;
  const axial = {
    width: [1, 2, 3].map((n) => ({ order: n, freq: (SPEED_OF_SOUND / 2) * (n / width), axis: 'X (Width)' })),
    height: [1, 2, 3].map((n) => ({ order: n, freq: (SPEED_OF_SOUND / 2) * (n / height), axis: 'Y (Height)' })),
    depth: [1, 2, 3].map((n) => ({ order: n, freq: (SPEED_OF_SOUND / 2) * (n / depth), axis: 'Z (Depth)' }))
  };

  const allModes = [...axial.width, ...axial.height, ...axial.depth].sort((a, b) => a.freq - b.freq);
  return { axial, allModes };
}

/**
 * Computes the complete physical acoustic state of the room for the current frame,
 * including the 256-bin complex frequency response curve (20 Hz - 20 kHz) showing
 * real comb-filtering and boundary loading at the microphone position.
 */
export function solveRoomAcoustics(state) {
  const { dimensions, sourcePos, micPos, surfaceMaterials, polarPattern, micYawDeg } = state;
  const micYawRad = ((micYawDeg || 0) * Math.PI) / 180;

  // 1. Direct Path
  const directDistance = Math.max(
    MIN_DISTANCE,
    Math.hypot(micPos.x - sourcePos.x, micPos.y - sourcePos.y, micPos.z - sourcePos.z)
  );
  const directDelaySec = directDistance / SPEED_OF_SOUND;
  const directDelayMs = directDelaySec * 1000;
  const directPolar = evaluatePolarPattern(polarPattern, micPos, sourcePos, micYawRad);
  const directGain = (1.0 / directDistance) * Math.max(0.03, directPolar.magnitude);

  // 2. Reverb & Absorption (Sabine & Eyring)
  const reverb = computeRoomReverb(dimensions, surfaceMaterials);

  // 3. First-Order Image Source Reflections (6 walls)
  const reflections = computeImageSourceReflections(
    dimensions,
    sourcePos,
    micPos,
    surfaceMaterials,
    polarPattern,
    micYawRad,
    directDistance
  );

  // Sort copy by arrival time to find ITDG (Initial Time Delay Gap)
  const sortedByDelay = [...reflections].sort((a, b) => a.deltaTimeMs - b.deltaTimeMs);
  const firstReflection = sortedByDelay[0];
  const itdgMs = firstReflection ? firstReflection.deltaTimeMs : 0;

  // 4. Boundary Loading & Room Modes
  const boundaryLoading = computeBoundaryLoading(dimensions, sourcePos, surfaceMaterials);
  const modes = computeRoomModes(dimensions);

  // 5. Critical Distance dc and Schroeder Frequency fS
  const patObj = POLAR_PATTERNS[polarPattern] || POLAR_PATTERNS.cardioid;
  const rt60Mid = reverb.sabine[1000];
  const criticalDistance = 0.057 * Math.sqrt((patObj.directivityFactor * reverb.volume) / Math.max(0.05, rt60Mid));
  const schroederFreq = 2000 * Math.sqrt(rt60Mid / Math.max(1.0, reverb.volume));

  // 6. Complex Frequency Transfer Function H(f) (Comb filter + boundary loading + axial modes)
  const responseCurve = computeTransferFunctionCurve(
    directDistance,
    directDelaySec,
    directGain,
    directPolar.signedGain,
    reflections,
    boundaryLoading,
    modes.allModes
  );

  return {
    direct: {
      distance: directDistance,
      delaySec: directDelaySec,
      delayMs: directDelayMs,
      gain: directGain,
      levelDb: 20 * Math.log10(Math.max(1e-5, directGain)),
      polar: directPolar
    },
    reverb,
    reflections,
    firstReflection,
    itdgMs,
    boundaryLoading,
    modes,
    criticalDistance,
    schroederFreq,
    responseCurve
  };
}

/**
 * Evaluates the exact acoustic interference transfer function H(f) across 240 log-spaced
 * frequencies from 20 Hz to 20,000 Hz by coherent phasor summation:
 * H(f) = g_0 * exp(-j*2*pi*f*t_0) + sum_{i=1}^6 g_i(f) * exp(-j*2*pi*f*t_i)
 */
function computeTransferFunctionCurve(
  directDistance,
  directDelaySec,
  directGain,
  directSignedPolar,
  reflections,
  boundaryLoading,
  allModes
) {
  const numBins = 240;
  const minF = 20;
  const maxF = 20000;
  const logRatio = Math.log(maxF / minF);

  const freqs = new Float32Array(numBins);
  const magDb = new Float32Array(numBins);

  const signDirect = directSignedPolar >= 0 ? 1 : -1;
  const normRef = Math.max(1e-4, 1.0 / directDistance);

  for (let k = 0; k < numBins; k++) {
    const f = minF * Math.exp((k / (numBins - 1)) * logRatio);
    freqs[k] = f;

    const omega = 2.0 * Math.PI * f;
    let re = signDirect * directGain * Math.cos(omega * directDelaySec);
    let im = -signDirect * directGain * Math.sin(omega * directDelaySec);

    // Interpolate frequency-dependent reflection coefficient across 125Hz -> 1kHz -> 4kHz
    for (let i = 0; i < reflections.length; i++) {
      const r = reflections[i];
      let gBand;
      if (f <= 125) {
        gBand = r.bandGain[125];
      } else if (f <= 1000) {
        const t = Math.log(f / 125) / Math.log(1000 / 125);
        gBand = r.bandGain[125] * (1 - t) + r.bandGain[1000] * t;
      } else if (f <= 4000) {
        const t = Math.log(f / 1000) / Math.log(4000 / 1000);
        gBand = r.bandGain[1000] * (1 - t) + r.bandGain[4000] * t;
      } else {
        const hfRoll = Math.exp(-0.00004 * (f - 4000) * r.totalDistance);
        gBand = r.bandGain[4000] * hfRoll;
      }

      const signRefl = r.polar.signedGain >= 0 ? 1 : -1;
      const gSigned = signRefl * gBand;
      re += gSigned * Math.cos(omega * r.arrivalTimeSec);
      im -= gSigned * Math.sin(omega * r.arrivalTimeSec);
    }

    const mag = Math.hypot(re, im) / normRef;
    let db = 20 * Math.log10(Math.max(1e-4, mag));

    // Add smooth low-shelf boundary loading boost below turnover frequency
    if (boundaryLoading.boostDb > 0.05) {
      const shelfFactor = 1.0 / (1.0 + Math.pow(f / boundaryLoading.turnoverHz, 2));
      db += boundaryLoading.boostDb * shelfFactor;
    }

    // Subtle axial standing wave modal peaks in the low-frequency modal region (< 250 Hz)
    if (f < 260) {
      for (let m = 0; m < allModes.length; m++) {
        const mf = allModes[m].freq;
        const bw = Math.max(3.5, mf * 0.045);
        const diff = f - mf;
        if (Math.abs(diff) < bw * 2.5) {
          db += 2.8 * Math.exp(-(diff * diff) / (2 * bw * bw));
        }
      }
    }

    magDb[k] = Math.max(-30, Math.min(18, db));
  }

  return { freqs, magDb };
}

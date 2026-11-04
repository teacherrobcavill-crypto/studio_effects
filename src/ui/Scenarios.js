/**
 * 4 Guided Educational Acoustic Scenarios & State Automation
 */

export const SCENARIOS = [
  {
    id: 'live_studio_1950',
    number: '01',
    title: '1950s Live Tracking Room (Sabine Balance)',
    subtitle: 'Classic Columbia 30th St / Capitol Studio A proportions with warm oak & plaster decay',
    badge: 'RT60 & Critical Distance',
    instrument: 'guitar',
    dimensions: { width: 8.5, height: 4.2, depth: 10.0 },
    surfaceMaterials: {
      floor: 'wood_oak',
      ceiling: 'acoustic_tile',
      left: 'plaster',
      right: 'wood_oak',
      front: 'plaster',
      back: 'heavy_velour'
    },
    sourcePos: { x: -0.6, y: 1.25, z: -2.2 },
    micPos: { x: 0.4, y: 1.45, z: 0.9 },
    polarPattern: 'cardioid',
    micYawDeg: -18,
    layers: { direct: true, earlyReflections: true, lateReverb: true },
    camera: { pos: { x: 8.4, y: 5.2, z: 8.8 }, lookAt: { x: 0, y: 1.4, z: -0.5 } },
    lesson:
      'Classic 1950s live rooms paired reflective oak parquet floors and diaphragmatic plaster walls (absorbing excess 125 Hz boom) with perforated Celotex ceiling tiles. Drag the microphone beyond the Critical Distance (dc) to hear where the reverberant Sabine field overtakes the direct path.'
  },
  {
    id: 'comb_filtering',
    number: '02',
    title: 'Boundary Slapback & Comb Filtering',
    subtitle: 'Destructive phase cancellation between direct path and a hard boundary reflection',
    badge: 'Phase & Comb Notches',
    instrument: 'test_pulse',
    dimensions: { width: 6.4, height: 3.2, depth: 7.0 },
    surfaceMaterials: {
      floor: 'concrete',
      ceiling: 'acoustic_tile',
      left: 'concrete',
      right: 'heavy_velour',
      front: 'heavy_velour',
      back: 'heavy_velour'
    },
    sourcePos: { x: -2.45, y: 1.3, z: -0.9 },
    micPos: { x: -2.35, y: 1.3, z: 0.9 },
    polarPattern: 'omnidirectional',
    micYawDeg: 0,
    layers: { direct: true, earlyReflections: true, lateReverb: false },
    camera: { pos: { x: 3.6, y: 4.4, z: 4.8 }, lookAt: { x: -1.8, y: 1.2, z: 0 } },
    lesson:
      'With Late Reverb muted, the Omnidirectional mic sums the Direct path with a strong specular bounce off the Left Concrete Wall only ~1.8 ms later. Observe the deep periodic comb-filter notches f_n = (2n+1)/(2·Δt) in the Frequency Transfer Function graph—and drag the Source toward/away from the Left Wall to hear the comb pitch sweep!'
  },
  {
    id: 'corner_loading',
    number: '03',
    title: 'Eighth-Space Corner Bass Loading (+9 dB)',
    subtitle: 'Trihedral boundary radiation impedance boost & axial standing-wave excitation',
    badge: 'Boundary Loading',
    instrument: 'bass',
    dimensions: { width: 6.0, height: 3.0, depth: 7.2 },
    surfaceMaterials: {
      floor: 'concrete',
      ceiling: 'concrete',
      left: 'brick_unglazed',
      right: 'brick_unglazed',
      front: 'brick_unglazed',
      back: 'plaster'
    },
    sourcePos: { x: -2.68, y: 0.32, z: -3.28 },
    micPos: { x: 0.5, y: 1.4, z: 1.2 },
    polarPattern: 'omnidirectional',
    micYawDeg: -22,
    layers: { direct: true, earlyReflections: true, lateReverb: true },
    camera: { pos: { x: 5.5, y: 4.6, z: 5.6 }, lookAt: { x: -1.2, y: 1.0, z: -1.2 } },
    lesson:
      'Placing the Upright Bass within a quarter-wavelength of three rigid boundaries (Left Wall + Front Wall + Floor) confines acoustic radiation to Eighth-Space (π/2 steradians). Coherent in-phase reflections create up to +9–11 dB of low-frequency boundary boost while strongly driving the room’s fundamental axial modes.'
  },
  {
    id: 'figure8_null',
    number: '04',
    title: 'Figure-8 Ribbon Null Wall Rejection',
    subtitle: 'Using a 1950s velocity ribbon mic’s 90° cosine null to eliminate early wall slapback',
    badge: 'Polar Directivity',
    instrument: 'drums',
    dimensions: { width: 7.2, height: 3.6, depth: 8.0 },
    surfaceMaterials: {
      floor: 'wood_oak',
      ceiling: 'acoustic_tile',
      left: 'brick_unglazed',
      right: 'heavy_velour',
      front: 'wood_oak',
      back: 'bass_trap'
    },
    sourcePos: { x: -1.5, y: 1.15, z: -1.6 },
    micPos: { x: -1.5, y: 1.25, z: 0.8 },
    polarPattern: 'figure8',
    micYawDeg: 0,
    layers: { direct: true, earlyReflections: true, lateReverb: true },
    camera: { pos: { x: 4.8, y: 4.8, z: 4.8 }, lookAt: { x: -1.2, y: 1.2, z: -0.3 } },
    lesson:
      'A Figure-8 velocity ribbon microphone follows M(θ) = cos(θ), creating deep pickup nulls at ±90°. Here, the microphone faces the drum kit at 0° while aiming its 90° side null toward the reflective Left Brick Wall—attenuating lateral slapback and smoothing out comb filtering. Rotate the Mic Yaw slider to hear the brick wall slapback return!'
  }
];

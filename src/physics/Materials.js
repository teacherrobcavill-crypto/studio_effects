import * as THREE from 'three';

/**
 * Acoustic Material Database
 * Absorption coefficients alpha at 125 Hz, 1 kHz, and 4 kHz based on standard
 * architectural acoustics tables (Sabine / ISO 354 measurement data).
 */
export const MATERIALS = {
  concrete: {
    id: 'concrete',
    name: 'Poured Concrete (Unpainted)',
    category: 'Reflective / Rigid',
    absorption: {
      125: 0.01,
      1000: 0.02,
      4000: 0.03
    },
    scattering: 0.05,
    color: '#6b7078',
    roughness: 0.85,
    metalness: 0.05,
    description: 'Dense rigid masonry boundary. Reflects >97% of incident acoustic energy across all octaves, producing strong specular slapback and pronounced standing waves.'
  },
  brick_unglazed: {
    id: 'brick_unglazed',
    name: 'Raw Studio Brick',
    category: 'Reflective / Diffuse',
    absorption: {
      125: 0.03,
      1000: 0.04,
      4000: 0.05
    },
    scattering: 0.22,
    color: '#8c4638',
    roughness: 0.9,
    metalness: 0.02,
    description: 'Classic live studio masonry wall. Extremely low absorption with subtle high-frequency micro-scattering from mortar joints.'
  },
  wood_oak: {
    id: 'wood_oak',
    name: 'Hardwood Oak Flooring / Panel',
    category: 'Warm Reflective',
    absorption: {
      125: 0.15,
      1000: 0.10,
      4000: 0.07
    },
    scattering: 0.10,
    color: '#8f5e36',
    roughness: 0.45,
    metalness: 0.08,
    description: '1950s studio parquet wood surface on joists. Flexural panel resonance absorbs moderate low-frequency energy while preserving warm, lively mid and treble reflections.'
  },
  plaster: {
    id: 'plaster',
    name: 'Lath & Plaster on Studs',
    category: 'Diaphragmatic / Live',
    absorption: {
      125: 0.28,
      1000: 0.10,
      4000: 0.05
    },
    scattering: 0.06,
    color: '#7f868f',
    roughness: 0.65,
    metalness: 0.03,
    description: 'Hollow-cavity plaster wall acts as a diaphragmatic membrane at 125 Hz, preventing excessive bass boom while keeping upper frequencies bright and open.'
  },
  carpet_plush: {
    id: 'carpet_plush',
    name: 'Heavy Studio Carpet on Felt',
    category: 'High-Freq Absorber',
    absorption: {
      125: 0.08,
      1000: 0.37,
      4000: 0.65
    },
    scattering: 0.15,
    color: '#384b63',
    roughness: 0.95,
    metalness: 0.0,
    description: 'Porous woven pile over hair-felt underlayment. Tames floor bounce and flutter echo above 1 kHz while leaving low-frequency energy largely unattenuated.'
  },
  heavy_velour: {
    id: 'heavy_velour',
    name: 'Pleated Studio Velour Drapery',
    category: 'Mid/High Absorber',
    absorption: {
      125: 0.14,
      1000: 0.55,
      4000: 0.72
    },
    scattering: 0.25,
    color: '#6b2737',
    roughness: 0.92,
    metalness: 0.02,
    description: '18 oz/yd² heavy velour curtains hung 10 cm from wall boundary. Quarter-wavelength particle velocity maximum provides strong mid and treble damping.'
  },
  acoustic_tile: {
    id: 'acoustic_tile',
    name: 'Perforated Celotex Acoustic Tile',
    category: 'Broadband Studio Treatment',
    absorption: {
      125: 0.30,
      1000: 0.78,
      4000: 0.85
    },
    scattering: 0.18,
    color: '#9aa097',
    roughness: 0.80,
    metalness: 0.04,
    description: 'Authentic 1950s perforated cellulose & mineral fiber acoustic tile. Controls early reflections and dramatically shortens mid/high RT60.'
  },
  bass_trap: {
    id: 'bass_trap',
    name: 'Slotted Helmholtz / Rockwool Trap',
    category: 'Full-Band / Bass Absorber',
    absorption: {
      125: 0.68,
      1000: 0.82,
      4000: 0.78
    },
    scattering: 0.30,
    color: '#2e5948',
    roughness: 0.75,
    metalness: 0.05,
    description: 'Deep mineral wool cavity behind slotted wooden slats. Absorbs low-frequency pressure/velocity modes down to 125 Hz along with broadband reflections.'
  }
};

export const MATERIAL_LIST = Object.values(MATERIALS);

const textureCache = new Map();

/**
 * Procedurally synthesizes a high-resolution repeatable CanvasTexture for any material
 * so zero external image files are needed.
 */
export function createMaterialTexture(materialId, repeatX = 2, repeatY = 2) {
  const cacheKey = `${materialId}_${repeatX.toFixed(1)}_${repeatY.toFixed(1)}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const mat = MATERIALS[materialId] || MATERIALS.concrete;

  // Base fill
  ctx.fillStyle = mat.color;
  ctx.fillRect(0, 0, 256, 256);

  // Deterministic pseudo-random helper
  let seed = materialId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0) * 31, 1337);
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  if (materialId === 'wood_oak') {
    // Parquet planks & wood grain lines
    const plankH = 32;
    for (let y = 0; y < 256; y += plankH) {
      const offset = ((y / plankH) % 2) * 128;
      for (let x = -128; x < 256; x += 128) {
        const shade = (rand() - 0.5) * 18;
        ctx.fillStyle = adjustHexBrightness(mat.color, shade);
        ctx.fillRect(x + offset, y, 128, plankH);

        // Wood grain streaks
        ctx.strokeStyle = adjustHexBrightness(mat.color, shade - 14);
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          ctx.beginPath();
          const gy = y + 4 + g * 4.5 + rand() * 2;
          ctx.moveTo(x + offset, gy);
          ctx.bezierCurveTo(
            x + offset + 42, gy + (rand() - 0.5) * 4,
            x + offset + 84, gy + (rand() - 0.5) * 4,
            x + offset + 128, gy
          );
          ctx.stroke();
        }

        // Plank border
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + offset, y, 128, plankH);
      }
    }
  } else if (materialId === 'acoustic_tile') {
    // Classic 1950s perforated Celotex acoustic tiles
    const tileSize = 64;
    for (let ty = 0; ty < 256; ty += tileSize) {
      for (let tx = 0; tx < 256; tx += tileSize) {
        ctx.fillStyle = adjustHexBrightness(mat.color, (rand() - 0.5) * 8);
        ctx.fillRect(tx, ty, tileSize, tileSize);

        // Beveled tile edge
        ctx.strokeStyle = 'rgba(30, 35, 32, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx + 1, ty + 1, tileSize - 2, tileSize - 2);

        // Perforation holes in grid
        ctx.fillStyle = 'rgba(28, 32, 30, 0.65)';
        for (let py = 8; py < tileSize - 4; py += 8) {
          for (let px = 8; px < tileSize - 4; px += 8) {
            ctx.beginPath();
            const radius = ((px + py) % 16 === 0) ? 1.9 : 1.3;
            ctx.arc(tx + px, ty + py, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  } else if (materialId === 'brick_unglazed') {
    // Running-bond brickwork
    ctx.fillStyle = '#4a4542'; // Mortar base
    ctx.fillRect(0, 0, 256, 256);
    const brickH = 32;
    const brickW = 64;
    const mortar = 3;
    for (let row = 0; row < 8; row++) {
      const y = row * brickH;
      const offset = (row % 2) * (brickW / 2);
      for (let col = -1; col < 5; col++) {
        const x = col * brickW + offset;
        ctx.fillStyle = adjustHexBrightness(mat.color, (rand() - 0.5) * 24);
        ctx.fillRect(x + mortar, y + mortar, brickW - mortar * 2, brickH - mortar * 2);
      }
    }
  } else if (materialId === 'heavy_velour') {
    // Vertical drapery pleats
    for (let x = 0; x < 256; x++) {
      const pleatWave = Math.sin((x / 256) * Math.PI * 16) * 22;
      ctx.fillStyle = adjustHexBrightness(mat.color, pleatWave);
      ctx.fillRect(x, 0, 1, 256);
    }
  } else if (materialId === 'bass_trap') {
    // Dark mineral wool cavity + horizontal wooden Helmholtz slats
    ctx.fillStyle = '#18241f';
    ctx.fillRect(0, 0, 256, 256);
    const slatH = 16;
    for (let y = 0; y < 256; y += slatH) {
      ctx.fillStyle = adjustHexBrightness(mat.color, (rand() - 0.5) * 12);
      ctx.fillRect(0, y + 2, 256, slatH - 5);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, y + slatH - 3, 256, 3);
    }
  } else if (materialId === 'carpet_plush') {
    // Woven carpet tuft pattern
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const delta = (rand() - 0.5) * 22;
        ctx.fillStyle = adjustHexBrightness(mat.color, delta);
        ctx.fillRect(x, y, 4, 4);
      }
    }
  } else {
    // Concrete / Plaster mottled aggregate & subtle trowel lines
    for (let i = 0; i < 2400; i++) {
      const x = rand() * 256;
      const y = rand() * 256;
      const delta = (rand() - 0.5) * 24;
      ctx.fillStyle = adjustHexBrightness(mat.color, delta);
      ctx.fillRect(x, y, 3, 3);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, 254, 254);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  texture.needsUpdate = true;

  textureCache.set(cacheKey, texture);
  return texture;
}

function adjustHexBrightness(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

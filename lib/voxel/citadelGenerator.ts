import { clamp, fbm2D, hash3D, mulberry32, ridged2D, smoothstep } from './noise';
import type { VoxelBuffers } from './types';

// Color helper: packs 24-bit RGB into an integer and applies subtle deterministic weathering jitter
function rgb(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function jitterColor(
  baseHex: number,
  x: number,
  y: number,
  z: number,
  amount = 14,
  warmBias = 0,
): number {
  const n = hash3D(x, y, z, 7717) * 2 - 1; // [-1, 1]
  const n2 = hash3D(x + 17, y - 9, z + 31, 3137) * 2 - 1;
  const delta = Math.round(n * amount);
  const r = clamp(((baseHex >> 16) & 0xff) + delta + Math.round(n2 * warmBias), 0, 255);
  const g = clamp(((baseHex >> 8) & 0xff) + delta, 0, 255);
  const b = clamp((baseHex & 0xff) + delta - Math.round(n2 * warmBias * 0.6), 0, 255);
  return rgb(r, g, b);
}

// Spatial key for integer voxel coordinates: x,z in [-512, 511], y in [-32, 223]
const SHIFT_XZ = 512;
const SHIFT_Y = 32;
function packKey(x: number, y: number, z: number): number {
  return (x + SHIFT_XZ) * 262144 + (y + SHIFT_Y) * 1024 + (z + SHIFT_XZ);
}

function unpackX(key: number): number {
  return Math.floor(key / 262144) - SHIFT_XZ;
}

function unpackY(key: number): number {
  return (Math.floor(key / 1024) & 0xff) - SHIFT_Y;
}

function unpackZ(key: number): number {
  return (key & 0x3ff) - SHIFT_XZ;
}

// Curated medieval voxel palette
const PALETTE = {
  wetBasalt: [rgb(39, 44, 52), rgb(47, 53, 62), rgb(34, 39, 46)],
  cliffStone: [rgb(78, 84, 90), rgb(91, 96, 102), rgb(69, 75, 82)],
  mossyRock: [rgb(74, 88, 72), rgb(84, 97, 79), rgb(66, 79, 64)],
  castleStone: [rgb(132, 134, 138), rgb(146, 147, 150), rgb(118, 121, 126)],
  castleTrim: [rgb(164, 162, 156), rgb(152, 150, 145)],
  keepStone: [rgb(142, 143, 146), rgb(155, 154, 152), rgb(126, 128, 133)],
  courtyardCobble: [rgb(112, 114, 116), rgb(128, 127, 124), rgb(99, 102, 106)],
  grass: [rgb(76, 114, 58), rgb(90, 128, 66), rgb(64, 98, 49)],
  sandWet: [rgb(138, 126, 102), rgb(122, 112, 92)],
  woodDark: [rgb(78, 53, 36), rgb(66, 44, 30)],
  woodPlank: [rgb(116, 82, 52), rgb(132, 95, 62), rgb(101, 70, 44)],
  plaster: [rgb(218, 210, 194), rgb(206, 198, 182)],
  slateRoof: [rgb(44, 56, 74), rgb(52, 66, 86), rgb(37, 47, 63)],
  slateTrim: [rgb(68, 82, 102)],
  iron: [rgb(42, 46, 52)],
  goldTrim: [rgb(212, 166, 74)],
  crimson: [rgb(158, 32, 40), rgb(178, 40, 46)],
  pine: [rgb(35, 72, 46), rgb(44, 86, 54), rgb(28, 58, 38)],
  autumnOrange: [rgb(206, 98, 34), rgb(224, 122, 40)],
  autumnAmber: [rgb(228, 164, 48), rgb(210, 142, 38)],
  autumnCrimson: [rgb(168, 46, 38), rgb(188, 62, 42)],
  monolith: [rgb(56, 62, 72), rgb(66, 72, 82), rgb(48, 54, 64)],
  emissiveAmber: rgb(255, 198, 92),
  emissiveTorch: rgb(255, 164, 56),
  cloudTop: rgb(246, 240, 236),
  cloudMid: rgb(224, 218, 222),
  cloudBottom: rgb(186, 184, 198),
};

function pick(arr: number[], x: number, y: number, z: number): number {
  const idx = Math.floor(hash3D(x, y, z, 919) * arr.length) % arr.length;
  return arr[idx];
}

/**
 * Computes the continuous island elevation field at (x, z) before architectural leveling.
 * Used both by the voxel generator and camera ground-collision prevention.
 */
export function sampleIslandSurfaceHeight(x: number, z: number): number {
  // Subtle organic warp so the island coastline feels craggy & natural
  const warpX = fbm2D(x * 0.032, z * 0.032, 3, 2.0, 0.5, 101) * 7.5;
  const warpZ = fbm2D(x * 0.032 + 11.3, z * 0.032 - 5.7, 3, 2.0, 0.5, 202) * 7.5;
  const wx = x + warpX;
  const wz = z + warpZ;

  // Main island radial falloff (radius ~49)
  const dist = Math.sqrt(wx * wx * 0.92 + wz * wz * 1.04);
  const baseFalloff = 1 - smoothstep(18, 51, dist);

  // Secondary rocky headland to the NW and NE
  const ridge = ridged2D(wx * 0.045, wz * 0.045, 3, 404);
  const detail = fbm2D(wx * 0.08, wz * 0.08, 4, 2.1, 0.5, 505);

  let h =
    -3.2 +
    baseFalloff * 21.5 +
    ridge * baseFalloff * 8.0 +
    detail * (0.9 + baseFalloff * 3.4);

  // Carve a natural harbor cove on the SE shoreline (around x=22, z=32)
  const coveDx = x - 23;
  const coveDz = z - 33;
  const coveDist = Math.sqrt(coveDx * coveDx + coveDz * coveDz);
  if (coveDist < 14) {
    const coveMask = 1 - smoothstep(4, 14, coveDist);
    h -= coveMask * 9.5;
  }

  // Smoothly terrace the outer citadel bailey (dist from center <= 27)
  const rawDist = Math.sqrt(x * x + z * z);
  if (rawDist < 29) {
    const baileyMask = 1 - smoothstep(22, 29, rawDist);
    h = h * (1 - baileyMask) + 13.5 * baileyMask;
  }

  // Inner Keep raised plateau
  if (x >= -13 && x <= 13 && z >= -15 && z <= 6) {
    const kx = 1 - smoothstep(9, 13, Math.abs(x));
    const kz = 1 - smoothstep(6, 10.5, Math.abs(z + 4.5));
    const keepMask = kx * kz;
    h = h * (1 - keepMask) + 19.5 * keepMask;
  }

  // Approach ramp corridor from shoreline (x=4, z=43) to Gatehouse (x=0, z=27)
  if (Math.abs(x) < 6 && z >= 25 && z <= 44) {
    const t = clamp((43 - z) / 17, 0, 1);
    const targetRamp = 1 + t * 10;
    const rampWeight = 1 - smoothstep(3, 6, Math.abs(x));
    h = h * (1 - rampWeight * 0.85) + targetRamp * (rampWeight * 0.85);
  }

  return h;
}

class VoxelWorldBuilder {
  opaque = new Map<number, number>();
  emissive = new Map<number, number>();
  clouds = new Map<number, number>();
  flags = new Map<number, { color: number; phase: number; amp: number }>();

  setOpaque(x: number, y: number, z: number, color: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iz = Math.round(z);
    if (ix < -500 || ix > 500 || iz < -500 || iz > 500 || iy < -30 || iy > 210) return;
    const k = packKey(ix, iy, iz);
    this.emissive.delete(k);
    this.opaque.set(k, color);
  }

  setEmissive(x: number, y: number, z: number, color: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iz = Math.round(z);
    if (ix < -500 || ix > 500 || iz < -500 || iz > 500 || iy < -30 || iy > 210) return;
    const k = packKey(ix, iy, iz);
    this.opaque.delete(k);
    this.emissive.set(k, color);
  }

  carve(x: number, y: number, z: number): void {
    const k = packKey(Math.round(x), Math.round(y), Math.round(z));
    this.opaque.delete(k);
    this.emissive.delete(k);
  }

  setCloud(x: number, y: number, z: number, color: number): void {
    const k = packKey(Math.round(x), Math.round(y), Math.round(z));
    this.clouds.set(k, color);
  }

  setFlag(x: number, y: number, z: number, color: number, phase: number, amp: number): void {
    const k = packKey(Math.round(x), Math.round(y), Math.round(z));
    this.opaque.delete(k);
    this.flags.set(k, { color, phase, amp });
  }

  fillBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorFn: (x: number, y: number, z: number) => number,
    hollow = false,
  ): void {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (
            hollow &&
            x > minX &&
            x < maxX &&
            y > minY &&
            y < maxY &&
            z > minZ &&
            z < maxZ
          ) {
            continue;
          }
          this.setOpaque(x, y, z, colorFn(x, y, z));
        }
      }
    }
  }

  carveBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          this.carve(x, y, z);
        }
      }
    }
  }
}

function buildIslandTerrain(world: VoxelWorldBuilder, terrainTop: Int16Array): void {
  const GRID = 128; // [-64..63]
  const HALF = 64;

  for (let gx = 0; gx < GRID; gx++) {
    const x = gx - HALF;
    for (let gz = 0; gz < GRID; gz++) {
      const z = gz - HALF;
      const h = Math.round(sampleIslandSurfaceHeight(x, z));
      terrainTop[gx * GRID + gz] = h;
    }
  }

  // Build visible cliff shells + plateaus (at least 2 voxels thick or exposing neighbor cliffs)
  for (let gx = 1; gx < GRID - 1; gx++) {
    const x = gx - HALF;
    for (let gz = 1; gz < GRID - 1; gz++) {
      const z = gz - HALF;
      const topY = terrainTop[gx * GRID + gz];
      if (topY < -1) continue;

      const minNeighbor = Math.min(
        terrainTop[(gx - 1) * GRID + gz],
        terrainTop[(gx + 1) * GRID + gz],
        terrainTop[gx * GRID + (gz - 1)],
        terrainTop[gx * GRID + (gz + 1)],
      );
      const bottomY = Math.max(-1, Math.min(topY - 1, minNeighbor));

      for (let y = bottomY; y <= topY; y++) {
        let baseCol: number;
        if (y <= 2) {
          // Wet dark basalt at waterline, or sandy cove edge
          const nearCove = (x - 23) * (x - 23) + (z - 33) * (z - 33) < 15 * 15;
          if (nearCove && y >= 1 && topY <= 2) {
            baseCol = pick(PALETTE.sandWet, x, y, z);
          } else {
            baseCol = pick(PALETTE.wetBasalt, x, y, z);
          }
        } else if (y === topY) {
          const steepness = topY - minNeighbor;
          if (steepness >= 2 || y <= 4) {
            baseCol =
              hash3D(x, y, z, 303) > 0.45
                ? pick(PALETTE.mossyRock, x, y, z)
                : pick(PALETTE.cliffStone, x, y, z);
          } else if (y >= 11) {
            // Inside outer curtain wall radius -> cobblestone or mossy turf
            const r = Math.sqrt(x * x + z * z);
            if (r < 25) {
              baseCol =
                fbm2D(x * 0.14, z * 0.14, 2, 2, 0.5, 616) > 0.08
                  ? pick(PALETTE.courtyardCobble, x, y, z)
                  : pick(PALETTE.grass, x, y, z);
            } else {
              baseCol = pick(PALETTE.grass, x, y, z);
            }
          } else {
            baseCol =
              hash3D(x, y, z, 88) > 0.32
                ? pick(PALETTE.grass, x, y, z)
                : pick(PALETTE.mossyRock, x, y, z);
          }
        } else {
          // Cliff vertical faces: mossy stone patches + craggy granite
          const mossNoise = fbm2D(x * 0.16, y * 0.19 + z * 0.16, 2, 2, 0.5, 711);
          baseCol =
            mossNoise > 0.16
              ? pick(PALETTE.mossyRock, x, y, z)
              : pick(PALETTE.cliffStone, x, y, z);
        }

        world.setOpaque(x, y, z, jitterColor(baseCol, x, y, z, 12, 4));
      }
    }
  }
}

function buildTower(
  world: VoxelWorldBuilder,
  cx: number,
  cz: number,
  baseY: number,
  radius: number,
  height: number,
  roofHeight: number,
  shape: 'cylinder' | 'square',
  options?: {
    hasWindows?: boolean;
    windowStep?: number;
    hasBanners?: boolean;
    flagHeight?: number;
    openBelfry?: boolean;
  },
): void {
  const hasWindows = options?.hasWindows ?? true;
  const windowStep = options?.windowStep ?? 6;
  const flagHeight = options?.flagHeight ?? 5;

  // Foundation plinth (battered stone skirt)
  for (let y = baseY - 4; y <= baseY + 2; y++) {
    const extraR = y <= baseY ? 0.9 : 0.4;
    const r = radius + extraR;
    const rSq = r * r;
    const rInSq = Math.max(0, radius - 2.1) ** 2;
    const bound = Math.ceil(r);
    for (let dx = -bound; dx <= bound; dx++) {
      for (let dz = -bound; dz <= bound; dz++) {
        const inside =
          shape === 'cylinder'
            ? dx * dx + dz * dz <= rSq && (y < baseY + 1 || dx * dx + dz * dz >= rInSq)
            : Math.max(Math.abs(dx), Math.abs(dz)) <= r &&
              (y < baseY + 1 || Math.max(Math.abs(dx), Math.abs(dz)) >= radius - 1.5);
        if (inside) {
          const x = cx + dx;
          const z = cz + dz;
          world.setOpaque(x, y, z, jitterColor(pick(PALETTE.cliffStone, x, y, z), x, y, z, 12));
        }
      }
    }
  }

  // Main shaft (hollow interior shell for efficiency + recessed windows)
  const topY = baseY + height;
  const bound = Math.ceil(radius + 1.5);
  for (let y = baseY + 1; y <= topY; y++) {
    const isCornice = y === topY || y === topY - 1;
    const rOuter = isCornice ? radius + 0.75 : radius;
    const rInner = Math.max(1, radius - 1.7);

    for (let dx = -bound; dx <= bound; dx++) {
      for (let dz = -bound; dz <= bound; dz++) {
        const dist = shape === 'cylinder' ? Math.sqrt(dx * dx + dz * dz) : Math.max(Math.abs(dx), Math.abs(dz));
        if (dist > rOuter || dist < rInner) continue;

        const x = cx + dx;
        const z = cz + dz;

        // Crenellations on parapet level
        if (y === topY && ((Math.abs(dx) + Math.abs(dz)) % 2 === 1) && dist > radius - 0.6) {
          continue;
        }

        // Open belfry arches near top if requested
        if (options?.openBelfry && y >= topY - 5 && y <= topY - 2) {
          if (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) {
            if (Math.abs(dx) === 0 && Math.abs(dz) === 0) continue;
            if (Math.abs(dx) <= 1 && Math.abs(dz) >= radius - 1.8) continue;
            if (Math.abs(dz) <= 1 && Math.abs(dx) >= radius - 1.8) continue;
          }
        }

        const col = isCornice
          ? pick(PALETTE.castleTrim, x, y, z)
          : pick(PALETTE.castleStone, x, y, z);
        world.setOpaque(x, y, z, jitterColor(col, x, y, z, 13, 3));
      }
    }

    // Solid floor caps every 8 blocks + parapet deck
    if (y === topY - 1 || y === baseY + 2) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
        for (let dz = -Math.ceil(radius); dz <= Math.ceil(radius); dz++) {
          const dist = shape === 'cylinder' ? Math.sqrt(dx * dx + dz * dz) : Math.max(Math.abs(dx), Math.abs(dz));
          if (dist <= radius - 0.5) {
            const x = cx + dx;
            const z = cz + dz;
            world.setOpaque(x, y, z, jitterColor(pick(PALETTE.castleStone, x, y, z), x, y, z, 10));
          }
        }
      }
    }
  }

  // Illuminated recessed arched/slit windows on the 4 cardinal faces
  if (hasWindows) {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let wy = baseY + 5; wy <= topY - 5; wy += windowStep) {
      for (const [nx, nz] of dirs) {
        const edge = Math.round(radius);
        const wx = cx + nx * edge;
        const wz = cz + nz * edge;
        // Carve outer face recess and place recessed glowing amber voxel behind it
        for (let hOff = 0; hOff <= 2; hOff++) {
          world.carve(wx, wy + hOff, wz);
          world.setEmissive(
            wx - nx,
            wy + hOff,
            wz - nz,
            jitterColor(PALETTE.emissiveAmber, wx, wy + hOff, wz, 8, 12),
          );
        }
      }
    }
  }

  // Roof (steep slate-blue/charcoal conical or pyramidal roof with 1-voxel overhang)
  const roofBaseY = topY + 1;
  const roofMaxR = radius + 1.25;
  for (let ry = 0; ry <= roofHeight; ry++) {
    const t = ry / Math.max(1, roofHeight);
    const curR = roofMaxR * (1 - t);
    const b = Math.ceil(curR + 1);
    const y = roofBaseY + ry;
    for (let dx = -b; dx <= b; dx++) {
      for (let dz = -b; dz <= b; dz++) {
        const dist = shape === 'cylinder' ? Math.sqrt(dx * dx + dz * dz) : Math.max(Math.abs(dx), Math.abs(dz));
        if (dist <= curR && (ry === roofHeight || dist >= curR - 1.4)) {
          const x = cx + dx;
          const z = cz + dz;
          const isEave = ry === 0;
          const baseCol = isEave ? pick(PALETTE.slateTrim, x, y, z) : pick(PALETTE.slateRoof, x, y, z);
          world.setOpaque(x, y, z, jitterColor(baseCol, x, y, z, 10, 2));
        }
      }
    }
  }

  // Finial mast + fluttering crimson banner flag
  const spireTop = roofBaseY + roofHeight;
  for (let fy = 1; fy <= flagHeight; fy++) {
    world.setOpaque(cx, spireTop + fy, cz, pick(PALETTE.iron, cx, spireTop + fy, cz));
  }
  const flagLen = flagHeight >= 6 ? 5 : 4;
  for (let fx = 1; fx <= flagLen; fx++) {
    for (let fy = 0; fy < 2; fy++) {
      if (fx === flagLen && fy === 1) continue; // swallowtail pennant silhouette
      const col = fx === 1 ? pick(PALETTE.goldTrim, cx + fx, spireTop + flagHeight - fy, cz) : pick(PALETTE.crimson, cx + fx, spireTop + flagHeight - fy, cz);
      world.setFlag(
        cx + fx,
        spireTop + flagHeight - fy,
        cz,
        col,
        cx * 0.37 + cz * 0.23,
        fx * 0.14,
      );
    }
  }
}

function buildWallSegment(
  world: VoxelWorldBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  baseY: number,
  wallHeight: number,
  thickness = 3,
  withArchOpening = false,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.max(Math.abs(dx), Math.abs(dz), 1);
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const perpX = -dz / len;
  const perpZ = dx / len;
  const halfT = Math.floor(thickness / 2);

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x0 + dx * t);
    const cz = Math.round(z0 + dz * t);
    const isButtress = s > 2 && s < steps - 2 && s % 6 === 0;
    const isMidArch = withArchOpening && Math.abs(t - 0.5) < 0.14;

    for (let w = -halfT; w <= halfT; w++) {
      const px = Math.round(cx + perpX * w);
      const pz = Math.round(cz + perpZ * w);

      // Foundation down into slope
      for (let y = baseY - 5; y < baseY; y++) {
        world.setOpaque(px, y, pz, jitterColor(pick(PALETTE.cliffStone, px, y, pz), px, y, pz, 12));
      }

      // Wall body
      for (let h = 0; h <= wallHeight; h++) {
        const y = baseY + h;
        if (isMidArch && h >= 1 && h <= 5) continue;

        // Crenellations along outer & inner edges on top row
        if (h === wallHeight) {
          if (Math.abs(w) < halfT) continue;
          if (s % 2 === 1) continue;
        }
        // Parapet walk surface
        if (h === wallHeight - 1 && Math.abs(w) < halfT) {
          world.setOpaque(px, y, pz, jitterColor(pick(PALETTE.courtyardCobble, px, y, pz), px, y, pz, 10));
          continue;
        }

        world.setOpaque(px, y, pz, jitterColor(pick(PALETTE.castleStone, px, y, pz), px, y, pz, 13, 3));
      }

      // Wall-walk torch sconces every 8 steps along inner parapet
      if (w === -halfT && s > 3 && s < steps - 3 && s % 8 === 0) {
        world.setOpaque(px, baseY + wallHeight, pz, pick(PALETTE.iron, px, baseY + wallHeight, pz));
        world.setEmissive(px, baseY + wallHeight + 1, pz, PALETTE.emissiveTorch);
      }
    }

    // External stone buttresses for architectural silhouette depth
    if (isButtress) {
      const bx = Math.round(cx + perpX * (halfT + 1));
      const bz = Math.round(cz + perpZ * (halfT + 1));
      for (let y = baseY - 4; y <= baseY + wallHeight - 3; y++) {
        if (y > baseY + wallHeight - 5 && Math.abs(s % 2) === 1) continue;
        world.setOpaque(bx, y, bz, jitterColor(pick(PALETTE.castleTrim, bx, y, bz), bx, y, bz, 11));
      }
    }
  }
}

function buildGatehouseAndApproach(world: VoxelWorldBuilder): void {
  // Twin flanking gate towers at (-6, 27) and (6, 27)
  buildTower(world, -6, 27, 11, 3.6, 20, 9, 'square', {
    hasWindows: true,
    windowStep: 5,
    flagHeight: 5,
  });
  buildTower(world, 6, 27, 11, 3.6, 20, 9, 'square', {
    hasWindows: true,
    windowStep: 5,
    flagHeight: 5,
  });

  // Central Gatehouse bridge mass spanning x: -4..4, z: 24..30, y: 11..27
  world.fillBox(
    -4,
    11,
    24,
    4,
    26,
    30,
    (x, y, z) => jitterColor(pick(PALETTE.castleStone, x, y, z), x, y, z, 12, 3),
    true,
  );
  // Battlements on gatehouse bridge
  for (let x = -4; x <= 4; x++) {
    for (const z of [24, 30]) {
      if (Math.abs(x) % 2 === 0) {
        world.setOpaque(x, 27, z, jitterColor(pick(PALETTE.castleTrim, x, 27, z), x, 27, z, 10));
      }
    }
  }
  // Steep pitched slate roof crowning the gatehouse gallery
  for (let ry = 0; ry <= 4; ry++) {
    const zMin = 24 + Math.floor(ry * 0.6);
    const zMax = 30 - Math.floor(ry * 0.6);
    for (let x = -3; x <= 3; x++) {
      for (let z = zMin; z <= zMax; z++) {
        world.setOpaque(x, 27 + ry, z, jitterColor(pick(PALETTE.slateRoof, x, 27 + ry, z), x, 27 + ry, z, 9));
      }
    }
  }

  // Grand arched gateway passage (carved clean!)
  for (let z = 23; z <= 31; z++) {
    for (let x = -2; x <= 2; x++) {
      const archMaxY = Math.abs(x) === 2 ? 17 : Math.abs(x) === 1 ? 19 : 20;
      for (let y = 12; y <= archMaxY; y++) {
        world.carve(x, y, z);
      }
    }
  }
  // Iron portcullis teeth along top of arch at z = 29
  for (let x = -2; x <= 2; x++) {
    const toothY = Math.abs(x) === 2 ? 16 : 18;
    world.setOpaque(x, toothY, 29, pick(PALETTE.iron, x, toothY, 29));
    if (Math.abs(x) <= 1) {
      world.setOpaque(x, toothY - 1, 29, pick(PALETTE.iron, x, toothY - 1, 29));
    }
  }

  // Glowing golden chamber windows above the gate arch
  for (const wx of [-2, 0, 2]) {
    for (let wy = 22; wy <= 24; wy++) {
      world.carve(wx, wy, 30);
      world.setEmissive(wx, wy, 29, PALETTE.emissiveAmber);
    }
  }

  // Hanging crimson heraldic banners on both gate towers
  for (const bx of [-6, 6]) {
    for (let by = 18; by <= 24; by++) {
      const col = by === 21 ? pick(PALETTE.goldTrim, bx, by, 31) : pick(PALETTE.crimson, bx, by, 31);
      world.setOpaque(bx, by, 31, col);
      world.setOpaque(bx - Math.sign(bx), by, 31, col);
    }
  }

  // Wooden Drawbridge spanning z: 31..35 at y = 11, flanked by chains/posts
  for (let z = 31; z <= 35; z++) {
    for (let x = -2; x <= 2; x++) {
      world.setOpaque(x, 11, z, jitterColor(pick(PALETTE.woodPlank, x, 11, z), x, 11, z, 10));
    }
    for (const sx of [-3, 3]) {
      world.setOpaque(sx, 12, z, pick(PALETTE.woodDark, sx, 12, z));
    }
  }

  // Flanking glowing brazier torches at the drawbridge entrance (z = 35, x = +-4)
  for (const tx of [-4, 4]) {
    world.setOpaque(tx, 11, 35, pick(PALETTE.castleTrim, tx, 11, 35));
    world.setOpaque(tx, 12, 35, pick(PALETTE.iron, tx, 12, 35));
    world.setEmissive(tx, 13, 35, PALETTE.emissiveTorch);
    world.setFlag(tx, 14, 35, PALETTE.emissiveTorch, tx * 1.7, 0.2);
  }

  // Grand Stone Stairway descending from drawbridge (z=36, y=11) down to shoreline landing (z=48, y=1)
  for (let step = 0; step <= 12; step++) {
    const z = 36 + step;
    const y = Math.max(1, 11 - Math.floor(step * 0.85));
    for (let x = -3; x <= 3; x++) {
      const isRail = Math.abs(x) === 3;
      const top = isRail ? y + 1 : y;
      for (let fy = Math.max(0, y - 3); fy <= top; fy++) {
        const col = isRail
          ? pick(PALETTE.castleTrim, x, fy, z)
          : pick(PALETTE.courtyardCobble, x, fy, z);
        world.setOpaque(x, fy, z, jitterColor(col, x, fy, z, 11));
      }
      // Brazier lanterns along every 4th stair landing
      if (isRail && step % 4 === 2) {
        world.setEmissive(x, top + 1, z, PALETTE.emissiveTorch);
      }
    }
  }
}

function buildDocksAndBoathouse(world: VoxelWorldBuilder): void {
  // Wooden pier jutting into the SE harbor cove: x: 20..36, z: 33..37, y = 1
  for (let x = 18; x <= 37; x++) {
    for (let z = 33; z <= 37; z++) {
      world.setOpaque(x, 1, z, jitterColor(pick(PALETTE.woodPlank, x, 1, z), x, 1, z, 12));
    }
    // Timber support pilings plunging into deep water
    if (x % 4 === 0) {
      for (const pz of [33, 37]) {
        for (let py = -3; py <= 2; py++) {
          world.setOpaque(x, py, pz, pick(PALETTE.woodDark, x, py, pz));
        }
        if (x % 8 === 0) {
          world.setEmissive(x, 3, pz, PALETTE.emissiveTorch);
        }
      }
    }
  }

  // Boathouse at x: 16..23, z: 25..31, base y: 1
  for (let x = 16; x <= 23; x++) {
    for (let z = 25; z <= 31; z++) {
      // Stone foundation platform
      world.setOpaque(x, 1, z, jitterColor(pick(PALETTE.cliffStone, x, 1, z), x, 1, z, 10));
      const isEdge = x === 16 || x === 23 || z === 25 || z === 31;
      const isCorner = (x === 16 || x === 23) && (z === 25 || z === 31);
      if (isEdge) {
        for (let y = 2; y <= 5; y++) {
          // Open boat slip facing water (z=31, x:18..21)
          if (z === 31 && x >= 18 && x <= 21 && y <= 4) continue;
          const col = isCorner ? pick(PALETTE.woodDark, x, y, z) : pick(PALETTE.plaster, x, y, z);
          world.setOpaque(x, y, z, jitterColor(col, x, y, z, 9));
        }
      }
    }
  }
  // Boathouse pitched slate roof
  for (let ry = 0; ry <= 3; ry++) {
    for (let x = 15 + ry; x <= 24 - ry; x++) {
      for (let z = 24; z <= 32; z++) {
        world.setOpaque(x, 6 + ry, z, jitterColor(pick(PALETTE.slateRoof, x, 6 + ry, z), x, 6 + ry, z, 10));
      }
    }
  }
  // Boathouse warm glowing window + dockside lantern
  world.setEmissive(16, 4, 28, PALETTE.emissiveAmber);
  world.setEmissive(23, 4, 28, PALETTE.emissiveAmber);
  world.setEmissive(22, 4, 31, PALETTE.emissiveTorch);

  // Two moored voxel rowboats bobbing at water level near the pier
  const boats = [
    { bx: 31, bz: 40 },
    { bx: 26, bz: 41 },
  ];
  for (const { bx, bz } of boats) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 1) continue;
        world.setOpaque(bx + dx, 0, bz + dz, pick(PALETTE.woodDark, bx + dx, 0, bz + dz));
        if (Math.abs(dx) === 2 || Math.abs(dz) === 1) {
          world.setOpaque(bx + dx, 1, bz + dz, pick(PALETTE.woodPlank, bx + dx, 1, bz + dz));
        }
      }
    }
    // Small mast + lantern
    world.setOpaque(bx, 2, bz, pick(PALETTE.woodDark, bx, 2, bz));
    world.setOpaque(bx, 3, bz, pick(PALETTE.woodDark, bx, 3, bz));
    world.setEmissive(bx, 4, bz, PALETTE.emissiveTorch);
  }

  // Stacked dockside cargo crates & barrels
  for (const [cx, cy, cz] of [
    [24, 2, 34],
    [25, 2, 34],
    [24, 3, 34],
    [19, 2, 33],
  ]) {
    world.setOpaque(cx, cy, cz, jitterColor(pick(PALETTE.woodPlank, cx, cy, cz), cx, cy, cz, 12));
  }

  // Winding stone walkway connecting Boathouse/Docks (x=15, z=32, y=2) up to Stairway Plaza (x=4, z=38, y=7)
  for (let s = 0; s <= 14; s++) {
    const t = s / 14;
    const px = Math.round(16 * (1 - t) + 3 * t);
    const pz = Math.round(31 * (1 - t) + 39 * t);
    const py = Math.round(2 * (1 - t) + 8 * t);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let y = py - 2; y <= py; y++) {
          world.setOpaque(
            px + dx,
            y,
            pz + dz,
            jitterColor(pick(PALETTE.courtyardCobble, px + dx, y, pz + dz), px + dx, y, pz + dz, 10),
          );
        }
      }
    }
  }
}

function buildTimberOutbuilding(
  world: VoxelWorldBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  baseY: number,
  wallH: number,
  ridgeAlongZ: boolean,
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1);
  const maxZ = Math.max(z0, z1);

  // Stone foundation & floor
  world.fillBox(
    minX,
    baseY - 2,
    minZ,
    maxX,
    baseY,
    maxZ,
    (x, y, z) => jitterColor(pick(PALETTE.cliffStone, x, y, z), x, y, z, 11),
  );

  // Timber-framed plaster walls
  for (let y = baseY + 1; y <= baseY + wallH; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const onEdge = x === minX || x === maxX || z === minZ || z === maxZ;
        if (!onEdge) continue;
        const isCorner = (x === minX || x === maxX) && (z === minZ || z === maxZ);
        const isBeam = isCorner || y === baseY + 1 || y === baseY + wallH || (x - minX) % 4 === 0 || (z - minZ) % 4 === 0;
        const col = isBeam ? pick(PALETTE.woodDark, x, y, z) : pick(PALETTE.plaster, x, y, z);
        world.setOpaque(x, y, z, jitterColor(col, x, y, z, 9));
      }
    }
  }

  // Glowing windows along long facades
  const midY = baseY + Math.floor(wallH * 0.55);
  for (let x = minX + 2; x <= maxX - 2; x += 3) {
    world.setEmissive(x, midY, minZ, PALETTE.emissiveAmber);
    world.setEmissive(x, midY + 1, minZ, PALETTE.emissiveAmber);
    world.setEmissive(x, midY, maxZ, PALETTE.emissiveAmber);
    world.setEmissive(x, midY + 1, maxZ, PALETTE.emissiveAmber);
  }
  for (let z = minZ + 2; z <= maxZ - 2; z += 3) {
    world.setEmissive(minX, midY, z, PALETTE.emissiveAmber);
    world.setEmissive(maxX, midY, z, PALETTE.emissiveAmber);
  }

  // Steep pitched slate roof with 1-voxel overhang
  const span = ridgeAlongZ ? Math.ceil((maxX - minX) / 2) + 1 : Math.ceil((maxZ - minZ) / 2) + 1;
  for (let step = 0; step <= span; step++) {
    const y = baseY + wallH + 1 + step;
    if (ridgeAlongZ) {
      const lx = minX - 1 + step;
      const rx = maxX + 1 - step;
      if (lx > rx) break;
      for (let x = lx; x <= rx; x++) {
        for (let z = minZ - 1; z <= maxZ + 1; z++) {
          if (x === lx || x === rx || step === span) {
            world.setOpaque(x, y, z, jitterColor(pick(PALETTE.slateRoof, x, y, z), x, y, z, 9));
          } else if (z === minZ || z === maxZ) {
            // Gable fill
            world.setOpaque(x, y, z, jitterColor(pick(PALETTE.plaster, x, y, z), x, y, z, 8));
          }
        }
      }
    } else {
      const lz = minZ - 1 + step;
      const rz = maxZ + 1 - step;
      if (lz > rz) break;
      for (let z = lz; z <= rz; z++) {
        for (let x = minX - 1; x <= maxX + 1; x++) {
          if (z === lz || z === rz || step === span) {
            world.setOpaque(x, y, z, jitterColor(pick(PALETTE.slateRoof, x, y, z), x, y, z, 9));
          } else if (x === minX || x === maxX) {
            world.setOpaque(x, y, z, jitterColor(pick(PALETTE.plaster, x, y, z), x, y, z, 8));
          }
        }
      }
    }
  }

  // Stone chimney stack
  const chX = minX + 2;
  const chZ = minZ + 2;
  for (let y = baseY + wallH; y <= baseY + wallH + span + 3; y++) {
    world.setOpaque(chX, y, chZ, pick(PALETTE.castleStone, chX, y, chZ));
  }
}

function buildGrandKeep(world: VoxelWorldBuilder): void {
  // Raised Keep plinth (x: -11..11, z: -14..4, y: 17..20)
  world.fillBox(
    -11,
    16,
    -14,
    11,
    20,
    4,
    (x, y, z) => jitterColor(pick(PALETTE.cliffStone, x, y, z), x, y, z, 11),
    true,
  );
  // Top cobblestone terrace deck
  world.fillBox(
    -11,
    20,
    -14,
    11,
    20,
    4,
    (x, y, z) => jitterColor(pick(PALETTE.courtyardCobble, x, y, z), x, y, z, 10),
  );
  // Keep terrace parapet border
  for (let x = -11; x <= 11; x++) {
    for (const z of [-14, 4]) {
      if (z === 4 && Math.abs(x) <= 2) continue; // Grand stairway opening
      world.setOpaque(x, 21, z, pick(PALETTE.castleTrim, x, 21, z));
      if (Math.abs(x) % 2 === 0) world.setOpaque(x, 22, z, pick(PALETTE.castleTrim, x, 22, z));
    }
  }
  for (let z = -14; z <= 4; z++) {
    for (const x of [-11, 11]) {
      world.setOpaque(x, 21, z, pick(PALETTE.castleTrim, x, 21, z));
      if (Math.abs(z) % 2 === 0) world.setOpaque(x, 22, z, pick(PALETTE.castleTrim, x, 22, z));
    }
  }

  // Keep approach steps from Courtyard (y=14, z=10) up to Keep Terrace (y=20, z=4)
  for (let s = 0; s <= 6; s++) {
    const z = 10 - s;
    const y = 14 + s;
    for (let x = -3; x <= 3; x++) {
      const isRail = Math.abs(x) === 3;
      for (let fy = 13; fy <= (isRail ? y + 1 : y); fy++) {
        world.setOpaque(
          x,
          fy,
          z,
          jitterColor(pick(isRail ? PALETTE.castleTrim : PALETTE.courtyardCobble, x, fy, z), x, fy, z, 10),
        );
      }
      if (isRail && s === 0) {
        world.setEmissive(x, y + 2, z, PALETTE.emissiveTorch);
      }
    }
  }

  // Main Keep Fortress Mass: x: -8..8, z: -11..2, y: 21..43
  world.fillBox(
    -8,
    21,
    -11,
    8,
    43,
    2,
    (x, y, z) =>
      jitterColor(
        y === 43 || y === 32 ? pick(PALETTE.castleTrim, x, y, z) : pick(PALETTE.keepStone, x, y, z),
        x,
        y,
        z,
        13,
        4,
      ),
    true,
  );
  // Battlements on Keep main roof deck (y=44)
  for (let x = -8; x <= 8; x++) {
    for (const z of [-11, 2]) {
      if (Math.abs(x) % 2 === 0) world.setOpaque(x, 44, z, pick(PALETTE.castleTrim, x, 44, z));
    }
  }
  for (let z = -11; z <= 2; z++) {
    for (const x of [-8, 8]) {
      if (Math.abs(z) % 2 === 0) world.setOpaque(x, 44, z, pick(PALETTE.castleTrim, x, 44, z));
    }
  }

  // Keep Great Portal Arch facing South (z=2, x:-2..2, y:21..26)
  for (let x = -2; x <= 2; x++) {
    const maxY = Math.abs(x) === 2 ? 25 : 26;
    for (let y = 21; y <= maxY; y++) {
      world.carve(x, y, 2);
      world.setEmissive(x, y, 1, PALETTE.emissiveAmber);
    }
  }

  // Tall Gothic Arched Glowing Windows on all 4 Keep facades
  for (const wy of [28, 36]) {
    for (const wx of [-4, 0, 4]) {
      for (let h = 0; h <= 3; h++) {
        if (h === 3 && Math.abs(wx) === 4) continue;
        world.carve(wx, wy + h, 2);
        world.setEmissive(wx, wy + h, 1, PALETTE.emissiveAmber);
        world.carve(wx, wy + h, -11);
        world.setEmissive(wx, wy + h, -10, PALETTE.emissiveAmber);
      }
    }
    for (const wz of [-8, -4, 0]) {
      for (let h = 0; h <= 3; h++) {
        world.carve(-8, wy + h, wz);
        world.setEmissive(-7, wy + h, wz, PALETTE.emissiveAmber);
        world.carve(8, wy + h, wz);
        world.setEmissive(7, wy + h, wz, PALETTE.emissiveAmber);
      }
    }
  }

  // Keep Steep Hipped Roof (y=44..49)
  for (let ry = 0; ry <= 5; ry++) {
    const lx = -8 + ry;
    const rx = 8 - ry;
    const lz = -11 + ry;
    const rz = 2 - ry;
    for (let x = lx; x <= rx; x++) {
      for (let z = lz; z <= rz; z++) {
        world.setOpaque(x, 44 + ry, z, jitterColor(pick(PALETTE.slateRoof, x, 44 + ry, z), x, 44 + ry, z, 9));
      }
    }
  }

  // 4 Cylindrical Corner Turrets attached to the Keep
  const turretCoords: [number, number][] = [
    [-8, 2],
    [8, 2],
    [-8, -11],
    [8, -11],
  ];
  for (const [tx, tz] of turretCoords) {
    buildTower(world, tx, tz, 21, 3.2, 27, 9, 'cylinder', {
      hasWindows: true,
      windowStep: 6,
      flagHeight: 5,
    });
  }

  // Central High Belfry Spire rising out of the Keep up to y=74!
  buildTower(world, 0, -5, 44, 4.3, 18, 13, 'cylinder', {
    hasWindows: true,
    windowStep: 5,
    flagHeight: 7,
    openBelfry: true,
  });
  // Glowing golden beacon/belfry lantern suspended inside the High Spire's open belfry
  for (let y = 57; y <= 59; y++) {
    world.setEmissive(0, y, -5, PALETTE.emissiveAmber);
  }
}

function buildElevatedWalkways(world: VoxelWorldBuilder): void {
  // Elevated arched stone walkway connecting Keep Terrace (x=8, z=-4, y=24) to East Square Tower (x=26, z=0, y=24)
  const bridges: [number, number, number, number, number][] = [
    [9, -3, 24, 0, 24], // Keep -> East Curtain Tower
    [-9, -3, -24, 0, 24], // Keep -> West Curtain Tower
    [0, -12, 0, -24, 23], // Keep -> North Barbican Tower
  ];

  for (const [x0, z0, x1, z1, y] of bridges) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    const dx = x1 - x0;
    const dz = z1 - z0;
    const perpX = Math.abs(dx) >= Math.abs(dz) ? 0 : 1;
    const perpZ = Math.abs(dx) >= Math.abs(dz) ? 1 : 0;

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(x0 + dx * t);
      const cz = Math.round(z0 + dz * t);
      for (let w = -1; w <= 1; w++) {
        const px = cx + perpX * w;
        const pz = cz + perpZ * w;
        world.setOpaque(px, y, pz, jitterColor(pick(PALETTE.castleStone, px, y, pz), px, y, pz, 11));
        if (Math.abs(w) === 1 && s % 2 === 0) {
          world.setOpaque(px, y + 1, pz, pick(PALETTE.castleTrim, px, y + 1, pz));
        }
      }
      // Stone support piers every 5 blocks
      if (s > 1 && s < steps - 1 && s % 5 === 0) {
        for (let py = 13; py < y; py++) {
          world.setOpaque(cx, py, cz, jitterColor(pick(PALETTE.castleStone, cx, py, cz), cx, py, cz, 10));
        }
      }
    }
  }
}

function buildFoliage(world: VoxelWorldBuilder, terrainTop: Int16Array): void {
  const rng = mulberry32(84729);
  const GRID = 128;
  const HALF = 64;

  // Candidate positions across island slopes & courtyard edges
  for (let attempt = 0; attempt < 420; attempt++) {
    const angle = rng() * Math.PI * 2;
    const rad = 16 + rng() * 29;
    const tx = Math.round(Math.cos(angle) * rad);
    const tz = Math.round(Math.sin(angle) * rad);

    // Keep clear of Gatehouse stairway, harbor pier, and courtyard buildings
    if (Math.abs(tx) < 7 && tz > 20) continue;
    if (tx > 13 && tz > 21) continue;
    if (Math.sqrt(tx * tx + tz * tz) < 23 && Math.abs(tx) < 17) continue;

    const gx = tx + HALF;
    const gz = tz + HALF;
    if (gx < 2 || gx >= GRID - 2 || gz < 2 || gz >= GRID - 2) continue;

    const baseY = terrainTop[gx * GRID + gz];
    if (baseY < 3 || baseY > 18) continue;

    // Check slope isn't an extreme cliff edge
    const hDiff = Math.abs(baseY - terrainTop[(gx + 1) * GRID + gz]) + Math.abs(baseY - terrainTop[gx * GRID + (gz + 1)]);
    if (hDiff > 4) continue;

    // Avoid overlapping stone walls
    if (world.opaque.has(packKey(tx, baseY + 2, tz))) continue;

    const treeType = rng();
    if (treeType < 0.45) {
      // Multi-voxel Evergreen Pine Tree (layered dark green cones)
      const trunkH = 3 + Math.floor(rng() * 3);
      for (let y = 1; y <= trunkH; y++) {
        world.setOpaque(tx, baseY + y, tz, pick(PALETTE.woodDark, tx, baseY + y, tz));
      }
      const canopyStart = baseY + 2;
      const tiers = 4 + Math.floor(rng() * 2);
      for (let layer = 0; layer < tiers * 2; layer++) {
        const y = canopyStart + layer;
        const maxR = Math.max(0.5, (tiers * 2 - layer) * 0.45);
        const rCeil = Math.ceil(maxR);
        for (let dx = -rCeil; dx <= rCeil; dx++) {
          for (let dz = -rCeil; dz <= rCeil; dz++) {
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d <= maxR && (layer % 2 === 0 || d <= maxR * 0.72)) {
              world.setOpaque(
                tx + dx,
                y,
                tz + dz,
                jitterColor(pick(PALETTE.pine, tx + dx, y, tz + dz), tx + dx, y, tz + dz, 10),
              );
            }
          }
        }
      }
      world.setOpaque(tx, canopyStart + tiers * 2, tz, pick(PALETTE.pine, tx, canopyStart + tiers * 2, tz));
    } else if (treeType < 0.82) {
      // Autumn Deciduous Tree (warm orange, amber, crimson foliage blocks)
      const trunkH = 3 + Math.floor(rng() * 2);
      for (let y = 1; y <= trunkH; y++) {
        world.setOpaque(tx, baseY + y, tz, pick(PALETTE.woodDark, tx, baseY + y, tz));
      }
      const paletteChoice =
        rng() < 0.36 ? PALETTE.autumnOrange : rng() < 0.7 ? PALETTE.autumnAmber : PALETTE.autumnCrimson;
      const crownY = baseY + trunkH + 1;
      const rCrown = 2.4 + rng() * 0.9;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -1; dy <= 3; dy++) {
          for (let dz = -3; dz <= 3; dz++) {
            const d = Math.sqrt(dx * dx + dy * dy * 1.3 + dz * dz);
            if (d <= rCrown && hash3D(tx + dx, crownY + dy, tz + dz, 555) > 0.14) {
              world.setOpaque(
                tx + dx,
                crownY + dy,
                tz + dz,
                jitterColor(pick(paletteChoice, tx + dx, crownY + dy, tz + dz), tx + dx, crownY + dy, tz + dz, 14, 10),
              );
            }
          }
        }
      }
    } else {
      // Low mossy bush cluster
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > 1 && rng() > 0.5) continue;
          world.setOpaque(
            tx + dx,
            baseY + 1,
            tz + dz,
            jitterColor(pick(PALETTE.grass, tx + dx, baseY + 1, tz + dz), tx + dx, baseY + 1, tz + dz, 14),
          );
        }
      }
    }
  }
}

function buildDistantMonoliths(world: VoxelWorldBuilder): void {
  // 14 atmospheric voxel sea-stacks & mountain monoliths encircling the far horizon
  const monolithSpecs = [
    { angle: 0.18, dist: 148, r: 10, h: 46 },
    { angle: 0.62, dist: 170, r: 13, h: 62 },
    { angle: 1.14, dist: 145, r: 8, h: 36 },
    { angle: 1.56, dist: 182, r: 15, h: 70 },
    { angle: 2.02, dist: 155, r: 11, h: 50 },
    { angle: 2.48, dist: 188, r: 15, h: 74 },
    { angle: 2.94, dist: 146, r: 9, h: 40 },
    { angle: 3.36, dist: 168, r: 12, h: 56 },
    { angle: 3.82, dist: 150, r: 10, h: 44 },
    { angle: 4.24, dist: 184, r: 14, h: 66 },
    { angle: 4.68, dist: 158, r: 11, h: 50 },
    { angle: 5.12, dist: 176, r: 13, h: 58 },
    { angle: 5.56, dist: 144, r: 8, h: 38 },
    { angle: 5.98, dist: 172, r: 12, h: 54 },
  ];

  for (let idx = 0; idx < monolithSpecs.length; idx++) {
    const spec = monolithSpecs[idx];
    const cx = Math.round(Math.cos(spec.angle) * spec.dist);
    const cz = Math.round(Math.sin(spec.angle) * spec.dist);

    for (let y = -1; y <= spec.h; y++) {
      const t = Math.max(0, y) / spec.h;
      const stepShelf = Math.floor(t * 4) * 0.06;
      const taper = Math.max(0.12, 1 - Math.pow(t, 1.1) * 0.65 - stepShelf);
      const curR = Math.max(1.2, spec.r * taper);
      const b = Math.ceil(curR + 3);
      for (let dx = -b; dx <= b; dx++) {
        for (let dz = -b; dz <= b; dz++) {
          const d = Math.sqrt(dx * dx + dz * dz);
          const crag =
            fbm2D((cx + dx) * 0.11, (cz + dz) * 0.11 + y * 0.04, 2, 2, 0.5, 900 + idx * 17) *
            2.6 *
            (1 - t * 0.72);
          const outer = Math.max(1.0, curR + crag);
          const fillCore = curR < 3.2 || y >= spec.h - 2;
          if (d <= outer && (fillCore || d >= outer - 1.8)) {
            const x = cx + dx;
            const z = cz + dz;
            const col = y <= 2 ? pick(PALETTE.wetBasalt, x, y, z) : pick(PALETTE.monolith, x, y, z);
            world.setOpaque(x, y, z, jitterColor(col, x, y, z, 10));
          }
        }
      }
    }
  }
}

function buildVoxelClouds(world: VoxelWorldBuilder): void {
  const rng = mulberry32(314159);
  // 14 layered flat-bottomed voxel cloud clusters in the upper sky (y: 66..86)
  for (let c = 0; c < 14; c++) {
    const angle = (c / 14) * Math.PI * 2 + rng() * 0.35;
    const dist = 42 + rng() * 110;
    const cx = Math.round(Math.cos(angle) * dist);
    const cz = Math.round(Math.sin(angle) * dist);
    const baseY = 68 + Math.floor(rng() * 15);

    const lobes = 2 + Math.floor(rng() * 3);
    for (let l = 0; l < lobes; l++) {
      const ox = Math.round((rng() - 0.5) * 12);
      const oz = Math.round((rng() - 0.5) * 9);
      const rx = 4 + Math.floor(rng() * 4);
      const rz = 3 + Math.floor(rng() * 4);
      const height = 3 + Math.floor(rng() * 2);

      for (let dy = 0; dy < height; dy++) {
        const shrink = dy === 0 ? 1.0 : 1 - (dy / (height + 0.5)) * 0.55;
        const ex = rx * shrink;
        const ez = rz * shrink;
        for (let dx = -Math.ceil(ex); dx <= Math.ceil(ex); dx++) {
          for (let dz = -Math.ceil(ez); dz <= Math.ceil(ez); dz++) {
            const norm = (dx * dx) / (ex * ex) + (dz * dz) / (ez * ez);
            if (norm <= 1.0) {
              const col =
                dy === 0
                  ? PALETTE.cloudBottom
                  : dy === height - 1
                    ? PALETTE.cloudTop
                    : PALETTE.cloudMid;
              world.setCloud(cx + ox + dx, baseY + dy, cz + oz + dz, jitterColor(col, cx + dx, baseY + dy, cz + dz, 6));
            }
          }
        }
      }
    }
  }
}

function packColorFloats(
  entries: Iterable<[number, number]>,
  count: number,
): { positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let i = 0;
  for (const [key, hex] of entries) {
    const x = unpackX(key);
    const y = unpackY(key);
    const z = unpackZ(key);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Store sRGB -> linear float so InstancedMesh.setColorAt / instanceColor renders accurate tone-mapped hues
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    colors[i * 3] = Math.pow(r, 2.2);
    colors[i * 3 + 1] = Math.pow(g, 2.2);
    colors[i * 3 + 2] = Math.pow(b, 2.2);
    i++;
  }
  return { positions, colors };
}

let cachedCitadelWorld: VoxelBuffers | null = null;

export function generateCitadelWorld(): VoxelBuffers {
  if (cachedCitadelWorld) return cachedCitadelWorld;
  const world = new VoxelWorldBuilder();
  const terrainTop = new Int16Array(128 * 128);

  // 1. Craggy multi-tiered island terrain
  buildIslandTerrain(world, terrainTop);

  // 2. Outer Curtain Walls connecting 7 perimeter bastion towers + Gatehouse
  const wallSegments: [number, number, number, number, number, number, boolean][] = [
    [-6, 27, -21, 18, 11, 11, false],
    [-21, 18, -26, 0, 11, 11, false],
    [-26, 0, -20, -21, 12, 11, false],
    [-20, -21, 0, -26, 13, 11, false],
    [0, -26, 20, -21, 13, 11, false],
    [20, -21, 26, 0, 12, 11, false],
    [26, 0, 21, 20, 10, 11, true], // harbor side postern arch
    [21, 20, 6, 27, 10, 11, false],
  ];
  for (const [x0, z0, x1, z1, baseY, h, hasArch] of wallSegments) {
    buildWallSegment(world, x0, z0, x1, z1, baseY, h, 3, hasArch);
  }

  // 3. Perimeter Bastion Towers (7 towers + 2 Gate towers = 9 outer towers)
  buildTower(world, -21, 18, 11, 4.0, 20, 10, 'cylinder', { flagHeight: 5 });
  buildTower(world, 21, 20, 9, 4.0, 23, 11, 'cylinder', { flagHeight: 6 });
  buildTower(world, -26, 0, 12, 3.6, 22, 9, 'square', { flagHeight: 5 });
  buildTower(world, 26, 0, 12, 3.6, 22, 9, 'square', { flagHeight: 5 });
  buildTower(world, -20, -21, 13, 4.2, 24, 11, 'cylinder', { flagHeight: 5 });
  buildTower(world, 20, -21, 13, 4.2, 23, 11, 'cylinder', { flagHeight: 5 });
  buildTower(world, 0, -26, 14, 4.2, 25, 10, 'square', { flagHeight: 6 });

  // 4. Grand Gatehouse, Portcullis, Drawbridge, Braziers & Approach Stairway
  buildGatehouseAndApproach(world);

  // 5. Timber-framed Outbuildings & Courtyard Fountain
  // Great Hall (East Courtyard)
  buildTimberOutbuilding(world, 9, 3, 18, 15, 14, 7, true);
  // Garrison Armory & Chapel (West Courtyard)
  buildTimberOutbuilding(world, -19, -9, -11, 2, 14, 6, true);
  // Guard Barracks (South-West Bailey)
  buildTimberOutbuilding(world, -16, 11, -9, 17, 14, 5, false);

  // Courtyard Cobblestone Plaza & Stone Fountain at (-5, 14, 12)
  for (let x = -18; x <= 18; x++) {
    for (let z = -14; z <= 22; z++) {
      if (Math.sqrt(x * x + z * z) <= 23 && !world.opaque.has(packKey(x, 14, z))) {
        if (hash3D(x, 14, z, 222) > 0.22) {
          world.setOpaque(x, 14, z, jitterColor(pick(PALETTE.courtyardCobble, x, 14, z), x, 14, z, 10));
        }
      }
    }
  }
  // Fountain basin + central pillar + lantern
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
        world.setOpaque(-5 + dx, 15, 12 + dz, pick(PALETTE.castleTrim, -5 + dx, 15, 12 + dz));
      }
    }
  }
  world.setOpaque(-5, 15, 12, pick(PALETTE.castleTrim, -5, 15, 12));
  world.setOpaque(-5, 16, 12, pick(PALETTE.castleTrim, -5, 16, 12));
  world.setEmissive(-5, 17, 12, PALETTE.emissiveAmber);

  // 6. Grand Keep + 4 Corner Turrets + Central High Spire
  buildGrandKeep(world);

  // 7. Elevated Stone Walkways connecting Keep & Curtain Towers
  buildElevatedWalkways(world);

  // 8. Harbor Docks, Boathouse & Moored Rowboats
  buildDocksAndBoathouse(world);

  // 9. Foliage (Evergreen Pines, Autumn Deciduous Trees, Bushes)
  buildFoliage(world, terrainTop);

  // 10. Distant Sea-Stacks & Mountain Monoliths
  buildDistantMonoliths(world);

  // 11. Layered Flat-Bottomed Voxel Clouds
  buildVoxelClouds(world);

  // Pack all typed buffers
  const opaqueCount = world.opaque.size;
  const emissiveCount = world.emissive.size;
  const cloudCount = world.clouds.size;
  const flagCount = world.flags.size;

  const opaquePacked = packColorFloats(world.opaque.entries(), opaqueCount);
  const emissivePacked = packColorFloats(world.emissive.entries(), emissiveCount);
  const cloudPacked = packColorFloats(world.clouds.entries(), cloudCount);

  const flagPositions = new Float32Array(flagCount * 3);
  const flagColors = new Float32Array(flagCount * 3);
  const flagMeta = new Float32Array(flagCount * 2);
  let fi = 0;
  for (const [key, info] of world.flags.entries()) {
    flagPositions[fi * 3] = unpackX(key);
    flagPositions[fi * 3 + 1] = unpackY(key);
    flagPositions[fi * 3 + 2] = unpackZ(key);

    const r = ((info.color >> 16) & 0xff) / 255;
    const g = ((info.color >> 8) & 0xff) / 255;
    const b = (info.color & 0xff) / 255;
    flagColors[fi * 3] = Math.pow(r, 2.2);
    flagColors[fi * 3 + 1] = Math.pow(g, 2.2);
    flagColors[fi * 3 + 2] = Math.pow(b, 2.2);

    flagMeta[fi * 2] = info.phase;
    flagMeta[fi * 2 + 1] = info.amp;
    fi++;
  }

  cachedCitadelWorld = {
    opaqueCount,
    opaquePositions: opaquePacked.positions,
    opaqueColors: opaquePacked.colors,
    emissiveCount,
    emissivePositions: emissivePacked.positions,
    emissiveColors: emissivePacked.colors,
    cloudCount,
    cloudPositions: cloudPacked.positions,
    cloudColors: cloudPacked.colors,
    flagCount,
    flagPositions,
    flagColors,
    flagMeta,
    totalVoxels: opaqueCount + emissiveCount + cloudCount + flagCount,
  };
  return cachedCitadelWorld;
}

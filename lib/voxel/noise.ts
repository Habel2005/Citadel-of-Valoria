/**
 * Deterministic seeded PRNG (Mulberry32) and 2D/3D fractal noise utilities
 * for procedural island, cliff, cloud, and weathering generation.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2D(ix: number, iz: number, seed = 1337): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash3D(ix: number, iy: number, iz: number, seed = 4242): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1597334677) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise2D(x: number, z: number, seed = 1337): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const u = fade(fx);
  const v = fade(fz);

  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);

  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

export function fbm2D(
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2.05,
  gain = 0.5,
  seed = 1337,
): number {
  let amplitude = 0.5;
  let frequency = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise2D(x * frequency, z * frequency, seed + i * 97);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum / norm;
}

export function ridged2D(
  x: number,
  z: number,
  octaves = 4,
  seed = 9001,
): number {
  let amplitude = 0.5;
  let frequency = 1.0;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2D(x * frequency, z * frequency, seed + i * 131));
    sum += amplitude * n * n;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }

  return sum / norm;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

import type { LightingMode } from './types';

export interface AtmosphereState {
  zenithColor: [number, number, number];
  midSkyColor: [number, number, number];
  horizonColor: [number, number, number];
  fogColor: [number, number, number];
  fogDensity: number;
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  sunIntensity: number;
  hemiSkyColor: [number, number, number];
  hemiGroundColor: [number, number, number];
  hemiIntensity: number;
  rimColor: [number, number, number];
  rimIntensity: number;
  waterDeepColor: [number, number, number];
  waterShallowColor: [number, number, number];
  waterSpecColor: [number, number, number];
  emissiveIntensity: number;
  cloudTint: [number, number, number];
  starOpacity: number;
  sunDiscIntensity: number;
  exposure: number;
  bloomStrength: number;
}

export const ATMOSPHERE_PRESETS: Record<LightingMode, AtmosphereState> = {
  sunset: {
    zenithColor: [0.11, 0.08, 0.25],     // deep violet-indigo
    midSkyColor: [0.46, 0.20, 0.33],     // dusty rose-plum
    horizonColor: [0.95, 0.46, 0.18],    // burnt orange & warm gold
    fogColor: [0.68, 0.36, 0.25],
    fogDensity: 0.0029,
    sunDirection: [-0.62, 0.22, -0.75],
    sunColor: [1.0, 0.62, 0.32],
    sunIntensity: 2.95,
    hemiSkyColor: [0.45, 0.34, 0.62],
    hemiGroundColor: [0.22, 0.14, 0.12],
    hemiIntensity: 1.05,
    rimColor: [0.45, 0.52, 0.85],
    rimIntensity: 0.65,
    waterDeepColor: [0.03, 0.06, 0.15],
    waterShallowColor: [0.07, 0.14, 0.24],
    waterSpecColor: [1.0, 0.62, 0.30],
    emissiveIntensity: 2.25,
    cloudTint: [0.96, 0.72, 0.56],
    starOpacity: 0.24,
    sunDiscIntensity: 1.4,
    exposure: 1.08,
    bloomStrength: 0.46,
  },
  night: {
    zenithColor: [0.02, 0.03, 0.09],     // deep midnight blue
    midSkyColor: [0.05, 0.08, 0.18],
    horizonColor: [0.11, 0.17, 0.31],
    fogColor: [0.05, 0.08, 0.16],
    fogDensity: 0.0034,
    sunDirection: [0.55, 0.48, -0.68],   // silver-blue moonlight
    sunColor: [0.64, 0.78, 1.0],
    sunIntensity: 1.4,
    hemiSkyColor: [0.16, 0.23, 0.44],
    hemiGroundColor: [0.04, 0.05, 0.09],
    hemiIntensity: 0.72,
    rimColor: [0.35, 0.5, 0.85],
    rimIntensity: 0.55,
    waterDeepColor: [0.01, 0.02, 0.07],
    waterShallowColor: [0.03, 0.07, 0.14],
    waterSpecColor: [0.65, 0.80, 1.0],
    emissiveIntensity: 3.1,              // intensified golden castle glow
    cloudTint: [0.26, 0.33, 0.48],
    starOpacity: 1.0,
    sunDiscIntensity: 0.75,              // cool moon disc
    exposure: 1.02,
    bloomStrength: 0.62,
  },
  daylight: {
    zenithColor: [0.14, 0.42, 0.82],     // crisp azure
    midSkyColor: [0.38, 0.66, 0.94],
    horizonColor: [0.76, 0.88, 0.96],
    fogColor: [0.62, 0.78, 0.90],
    fogDensity: 0.0026,
    sunDirection: [0.46, 0.78, 0.42],    // high-elevation warm sun
    sunColor: [1.0, 0.96, 0.88],
    sunIntensity: 3.1,
    hemiSkyColor: [0.62, 0.8, 1.0],
    hemiGroundColor: [0.24, 0.27, 0.22],
    hemiIntensity: 1.25,
    rimColor: [0.72, 0.86, 1.0],
    rimIntensity: 0.5,
    waterDeepColor: [0.03, 0.17, 0.34],
    waterShallowColor: [0.08, 0.34, 0.50],
    waterSpecColor: [1.0, 0.98, 0.92],
    emissiveIntensity: 1.65,
    cloudTint: [1.0, 0.99, 0.97],
    starOpacity: 0.0,
    sunDiscIntensity: 1.15,
    exposure: 1.04,
    bloomStrength: 0.26,
  },
};

function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(
  out: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

export function cloneAtmosphereState(src: AtmosphereState): AtmosphereState {
  return {
    zenithColor: [...src.zenithColor],
    midSkyColor: [...src.midSkyColor],
    horizonColor: [...src.horizonColor],
    fogColor: [...src.fogColor],
    fogDensity: src.fogDensity,
    sunDirection: [...src.sunDirection],
    sunColor: [...src.sunColor],
    sunIntensity: src.sunIntensity,
    hemiSkyColor: [...src.hemiSkyColor],
    hemiGroundColor: [...src.hemiGroundColor],
    hemiIntensity: src.hemiIntensity,
    rimColor: [...src.rimColor],
    rimIntensity: src.rimIntensity,
    waterDeepColor: [...src.waterDeepColor],
    waterShallowColor: [...src.waterShallowColor],
    waterSpecColor: [...src.waterSpecColor],
    emissiveIntensity: src.emissiveIntensity,
    cloudTint: [...src.cloudTint],
    starOpacity: src.starOpacity,
    sunDiscIntensity: src.sunDiscIntensity,
    exposure: src.exposure,
    bloomStrength: src.bloomStrength,
  };
}

export function dampAtmosphereState(
  current: AtmosphereState,
  target: AtmosphereState,
  alpha: number,
): void {
  lerpVec3(current.zenithColor, current.zenithColor, target.zenithColor, alpha);
  lerpVec3(current.midSkyColor, current.midSkyColor, target.midSkyColor, alpha);
  lerpVec3(current.horizonColor, current.horizonColor, target.horizonColor, alpha);
  lerpVec3(current.fogColor, current.fogColor, target.fogColor, alpha);
  current.fogDensity = lerpScalar(current.fogDensity, target.fogDensity, alpha);

  lerpVec3(current.sunDirection, current.sunDirection, target.sunDirection, alpha);
  // Normalize interpolated sun vector
  const len = Math.hypot(
    current.sunDirection[0],
    current.sunDirection[1],
    current.sunDirection[2],
  );
  if (len > 1e-5) {
    current.sunDirection[0] /= len;
    current.sunDirection[1] /= len;
    current.sunDirection[2] /= len;
  }

  lerpVec3(current.sunColor, current.sunColor, target.sunColor, alpha);
  current.sunIntensity = lerpScalar(current.sunIntensity, target.sunIntensity, alpha);
  lerpVec3(current.hemiSkyColor, current.hemiSkyColor, target.hemiSkyColor, alpha);
  lerpVec3(current.hemiGroundColor, current.hemiGroundColor, target.hemiGroundColor, alpha);
  current.hemiIntensity = lerpScalar(current.hemiIntensity, target.hemiIntensity, alpha);
  lerpVec3(current.rimColor, current.rimColor, target.rimColor, alpha);
  current.rimIntensity = lerpScalar(current.rimIntensity, target.rimIntensity, alpha);

  lerpVec3(current.waterDeepColor, current.waterDeepColor, target.waterDeepColor, alpha);
  lerpVec3(current.waterShallowColor, current.waterShallowColor, target.waterShallowColor, alpha);
  lerpVec3(current.waterSpecColor, current.waterSpecColor, target.waterSpecColor, alpha);

  current.emissiveIntensity = lerpScalar(current.emissiveIntensity, target.emissiveIntensity, alpha);
  lerpVec3(current.cloudTint, current.cloudTint, target.cloudTint, alpha);
  current.starOpacity = lerpScalar(current.starOpacity, target.starOpacity, alpha);
  current.sunDiscIntensity = lerpScalar(current.sunDiscIntensity, target.sunDiscIntensity, alpha);
  current.exposure = lerpScalar(current.exposure, target.exposure, alpha);
  current.bloomStrength = lerpScalar(current.bloomStrength, target.bloomStrength, alpha);
}

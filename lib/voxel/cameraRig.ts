import { sampleIslandSurfaceHeight } from './citadelGenerator';
import { clamp } from './noise';
import type { CameraPreset, CameraPresetId } from './types';
import { CAMERA_PRESETS } from './types';

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function getCameraPreset(id: CameraPresetId): CameraPreset {
  return CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS[0];
}

/**
 * Prevents the camera from dipping below the ocean surface (y = 0) or clipping
 * into the island's craggy terrain slopes.
 */
export function clampCameraAboveSurface(
  x: number,
  y: number,
  z: number,
  waterClearance = 3.2,
  groundClearance = 3.5,
): number {
  const terrainH = sampleIslandSurfaceHeight(x, z);
  const minSurfaceY = Math.max(waterClearance, terrainH + groundClearance);
  return y < minSurfaceY ? minSurfaceY : y;
}

export interface CameraFlightState {
  active: boolean;
  elapsed: number;
  duration: number;
  startPos: [number, number, number];
  endPos: [number, number, number];
  startTarget: [number, number, number];
  endTarget: [number, number, number];
}

export function createCameraFlight(
  fromPos: [number, number, number],
  fromTarget: [number, number, number],
  preset: CameraPreset,
  duration = 1.65,
): CameraFlightState {
  return {
    active: true,
    elapsed: 0,
    duration,
    startPos: [...fromPos],
    endPos: [...preset.position],
    startTarget: [...fromTarget],
    endTarget: [...preset.target],
  };
}

export function stepCameraFlight(
  flight: CameraFlightState,
  dt: number,
): {
  pos: [number, number, number];
  target: [number, number, number];
  done: boolean;
} {
  flight.elapsed = Math.min(flight.duration, flight.elapsed + dt);
  const t = flight.duration > 0 ? easeInOutCubic(flight.elapsed / flight.duration) : 1;

  const px = flight.startPos[0] + (flight.endPos[0] - flight.startPos[0]) * t;
  const py = flight.startPos[1] + (flight.endPos[1] - flight.startPos[1]) * t;
  const pz = flight.startPos[2] + (flight.endPos[2] - flight.startPos[2]) * t;

  const tx = flight.startTarget[0] + (flight.endTarget[0] - flight.startTarget[0]) * t;
  const ty = flight.startTarget[1] + (flight.endTarget[1] - flight.startTarget[1]) * t;
  const tz = flight.startTarget[2] + (flight.endTarget[2] - flight.startTarget[2]) * t;

  const safeY = clampCameraAboveSurface(px, py, pz);
  const done = flight.elapsed >= flight.duration;
  if (done) flight.active = false;

  return {
    pos: [px, safeY, pz],
    target: [tx, ty, tz],
    done,
  };
}

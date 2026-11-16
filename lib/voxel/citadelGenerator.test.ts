import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCitadelWorld, sampleIslandSurfaceHeight } from './citadelGenerator';
import {
  clampCameraAboveSurface,
  createCameraFlight,
  easeInOutCubic,
  getCameraPreset,
  stepCameraFlight,
} from './cameraRig';
import {
  ATMOSPHERE_PRESETS,
  cloneAtmosphereState,
  dampAtmosphereState,
} from './atmosphere';
import { CAMERA_PRESETS } from './types';

test('procedural island elevation rises cleanly at citadel plateau and drops below water at far ocean', () => {
  const centerH = sampleIslandSurfaceHeight(0, 0);
  const plateauH = sampleIslandSurfaceHeight(-6, 12);
  const oceanH = sampleIslandSurfaceHeight(95, 95);

  assert.ok(centerH > 16, `expected keep plateau > 16, got ${centerH}`);
  assert.ok(plateauH > 11, `expected bailey plateau > 11, got ${plateauH}`);
  assert.ok(oceanH < -1, `expected far ocean < -1, got ${oceanH}`);
});

test('generateCitadelWorld produces 80,000+ voxels across all architectural categories', () => {
  const world = generateCitadelWorld();
  console.log('Generated voxel counts:', {
    opaque: world.opaqueCount,
    emissive: world.emissiveCount,
    clouds: world.cloudCount,
    flags: world.flagCount,
    total: world.totalVoxels,
  });

  assert.ok(
    world.totalVoxels >= 80_000,
    `expected >= 80,000 rendered voxels, got ${world.totalVoxels}`,
  );
  assert.ok(world.emissiveCount >= 200, 'expected abundant illuminated windows and braziers');
  assert.ok(world.cloudCount >= 1_500, 'expected layered voxel cloud clusters');
  assert.ok(world.flagCount >= 60, 'expected fluttering crimson flags');
  assert.equal(world.opaquePositions.length, world.opaqueCount * 3);
  assert.equal(world.opaqueColors.length, world.opaqueCount * 3);
});

test('camera preset flight uses cubic easing and stays above terrain and ocean', () => {
  assert.equal(CAMERA_PRESETS.length, 5);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);

  const start = getCameraPreset('panoramic');
  const end = getCameraPreset('gatehouse');
  const flight = createCameraFlight(start.position, start.target, end, 1.5);

  const mid = stepCameraFlight(flight, 0.75);
  assert.equal(mid.done, false);
  assert.ok(mid.pos[1] >= 3.2, 'mid-flight camera must stay above water');

  const final = stepCameraFlight(flight, 0.8);
  assert.equal(final.done, true);
  assert.deepEqual(final.target, end.target);
  assert.ok(
    clampCameraAboveSurface(0, -5, 0) > 15,
    'ground collision prevention must keep camera above citadel keep plateau',
  );
});

test('atmosphere state smoothly interpolates from sunset to night and daylight', () => {
  const current = cloneAtmosphereState(ATMOSPHERE_PRESETS.sunset);
  for (let i = 0; i < 120; i++) {
    dampAtmosphereState(current, ATMOSPHERE_PRESETS.night, 0.08);
  }
  assert.ok(current.starOpacity > 0.95, 'stars should fade in for starry night');
  assert.ok(
    current.emissiveIntensity > 2.9,
    'window emissive glow should intensify at night',
  );

  for (let i = 0; i < 120; i++) {
    dampAtmosphereState(current, ATMOSPHERE_PRESETS.daylight, 0.08);
  }
  assert.ok(current.starOpacity < 0.05, 'stars should fade out in crisp daylight');
  assert.ok(current.sunDirection[1] > 0.7, 'daylight sun should rise to high elevation');
});

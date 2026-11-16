export type LightingMode = 'sunset' | 'night' | 'daylight';

export type CameraPresetId =
  | 'panoramic'
  | 'gatehouse'
  | 'courtyard'
  | 'docks'
  | 'spire';

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  shortLabel: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface HudStats {
  fps: number;
  gpuMemoryMb: number;
  drawCalls: number;
  triangles: number;
}

export interface VoxelBuffers {
  /** Total count of opaque structural/terrain/foliage/monolith voxels */
  opaqueCount: number;
  /** Packed [x, y, z, ...] positions for opaque voxels */
  opaquePositions: Float32Array;
  /** Packed [r, g, b, ...] linear/sRGB-converted float colors for opaque voxels */
  opaqueColors: Float32Array;

  /** Total count of glowing window/torch/lantern voxels */
  emissiveCount: number;
  emissivePositions: Float32Array;
  emissiveColors: Float32Array;

  /** Total count of drifting cloud voxels */
  cloudCount: number;
  cloudPositions: Float32Array;
  cloudColors: Float32Array;

  /** Total count of fluttering flag/flame accent voxels */
  flagCount: number;
  flagPositions: Float32Array;
  flagColors: Float32Array;
  /** Phase offset & flutter amplitude per flag voxel */
  flagMeta: Float32Array;

  /** Combined rendered voxel count */
  totalVoxels: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'panoramic',
    label: 'Panoramic Overview',
    shortLabel: 'Overview',
    position: [92, 56, 112],
    target: [0, 24, 2],
  },
  {
    id: 'gatehouse',
    label: 'Grand Gatehouse',
    shortLabel: 'Gatehouse',
    position: [14, 15, 58],
    target: [0, 20, 20],
  },
  {
    id: 'courtyard',
    label: 'Courtyard & Keep',
    shortLabel: 'Courtyard',
    position: [-14, 24, 20],
    target: [2, 27, -4],
  },
  {
    id: 'docks',
    label: 'Cliffside & Docks',
    shortLabel: 'Cliff & Docks',
    position: [58, 16, 48],
    target: [15, 11, 20],
  },
  {
    id: 'spire',
    label: 'Tower Spire',
    shortLabel: 'Tower Spire',
    position: [-38, 76, -34],
    target: [0, 25, 2],
  },
];

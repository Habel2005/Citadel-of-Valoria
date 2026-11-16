'use client';

import { useCallback, useState } from 'react';
import { CitadelCanvas } from '@/components/CitadelCanvas';
import { CitadelHud } from '@/components/CitadelHud';
import type { CameraPresetId, HudStats, LightingMode } from '@/lib/voxel/types';

export default function CitadelPage() {
  const [lightingMode, setLightingMode] = useState<LightingMode>('sunset');
  const [activePreset, setActivePreset] = useState<CameraPresetId>('panoramic');
  const [presetTrigger, setPresetTrigger] = useState(0);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [voxelCount, setVoxelCount] = useState(0);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [contextError, setContextError] = useState('');
  const [stats, setStats] = useState<HudStats>({
    fps: 60,
    gpuMemoryMb: 28.4,
    drawCalls: 7,
    triangles: 0,
  });

  const handlePresetSelect = useCallback((presetId: CameraPresetId) => {
    setActivePreset(presetId);
    setPresetTrigger((n) => n + 1);
  }, []);

  const handleToggleAutoOrbit = useCallback(() => {
    setAutoOrbit((prev) => !prev);
  }, []);

  const handleToggleDock = useCallback(() => {
    setDockCollapsed((prev) => !prev);
  }, []);

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[#0c101a]"
      data-lighting-mode={lightingMode}
      data-camera-preset={activePreset}
    >
      <CitadelCanvas
        lightingMode={lightingMode}
        activePreset={activePreset}
        presetTrigger={presetTrigger}
        autoOrbit={autoOrbit}
        onVoxelCountReady={setVoxelCount}
        onStatsUpdate={setStats}
        onContextError={setContextError}
      />

      <CitadelHud
        voxelCount={voxelCount}
        lightingMode={lightingMode}
        onLightingChange={setLightingMode}
        activePreset={activePreset}
        onPresetSelect={handlePresetSelect}
        autoOrbit={autoOrbit}
        onToggleAutoOrbit={handleToggleAutoOrbit}
        stats={stats}
        dockCollapsed={dockCollapsed}
        onToggleDock={handleToggleDock}
        contextError={contextError}
      />
    </main>
  );
}

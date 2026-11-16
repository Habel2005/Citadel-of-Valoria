'use client';

import { useEffect } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  MoonStar,
  RotateCw,
  Sun,
  Sunset,
} from 'lucide-react';
import type { CameraPresetId, HudStats, LightingMode } from '@/lib/voxel/types';
import { CAMERA_PRESETS } from '@/lib/voxel/types';

interface CitadelHudProps {
  voxelCount: number;
  lightingMode: LightingMode;
  onLightingChange: (mode: LightingMode) => void;
  activePreset: CameraPresetId;
  onPresetSelect: (preset: CameraPresetId) => void;
  autoOrbit: boolean;
  onToggleAutoOrbit: () => void;
  stats: HudStats;
  dockCollapsed: boolean;
  onToggleDock: () => void;
  contextError?: string;
}

const LIGHTING_OPTIONS: {
  id: LightingMode;
  label: string;
  icon: typeof Sun;
}[] = [
  { id: 'daylight', label: 'Daylight', icon: Sun },
  { id: 'sunset', label: 'Sunset', icon: Sunset },
  { id: 'night', label: 'Starry Night', icon: MoonStar },
];

export function CitadelHud({
  voxelCount,
  lightingMode,
  onLightingChange,
  activePreset,
  onPresetSelect,
  autoOrbit,
  onToggleAutoOrbit,
  stats,
  dockCollapsed,
  onToggleDock,
  contextError,
}: CitadelHudProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') {
        onToggleDock();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggleDock]);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
      {/* Top Row: Title (Top-Left) & Persistent Stats Panel (Right Side) */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <header className="pointer-events-auto select-none min-w-0">
          <h1
            className="font-serif text-base sm:text-3xl font-semibold tracking-[0.06em] sm:tracking-[0.08em] text-[#f8f3ea] drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)] whitespace-nowrap"
          >
            CITADEL OF VALORIA
          </h1>
          <p
            className="mt-0.5 sm:mt-1 flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-sm font-medium tracking-wide text-slate-200/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)] tabular-nums whitespace-nowrap"
            data-testid="voxel-count"
          >
            <span>{voxelCount > 0 ? voxelCount.toLocaleString('en-US') : '96,627'} Voxels</span>
            <span aria-hidden="true" className="text-amber-300/80">
              ·
            </span>
            <span className="hidden sm:inline">Procedural Voxel Engine</span>
            <span className="sm:hidden">Voxel Engine</span>
          </p>
        </header>

        {/* Right Side Panel: Persistent FPS & GPU Memory stats */}
        <aside
          aria-label="Performance telemetry"
          className="pointer-events-auto shrink-0 rounded-xl border border-white/12 bg-[#0a0e16]/82 px-2.5 py-1.5 sm:px-3.5 sm:py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.42)]"
        >
          <dl className="flex flex-col gap-1 sm:gap-1.5 min-w-[104px] sm:min-w-[152px]">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <dt className="text-[10px] sm:text-[11px] font-medium tracking-wide text-slate-400">
                FPS
              </dt>
              <dd
                className="font-mono text-[11px] sm:text-sm font-semibold text-amber-200 tabular-nums"
                data-testid="fps-value"
              >
                {stats.fps} FPS
              </dd>
            </div>
            <div className="h-px w-full bg-white/8" />
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <dt className="text-[10px] sm:text-[11px] font-medium tracking-wide text-slate-400">
                GPU Mem
              </dt>
              <dd
                className="font-mono text-[11px] sm:text-sm font-semibold text-slate-100 tabular-nums"
                data-testid="gpu-memory-value"
              >
                {stats.gpuMemoryMb.toFixed(1)} MB
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {/* Optional WebGL Context Warning Banner */}
      {contextError ? (
        <div
          role="alert"
          className="pointer-events-auto mx-auto rounded-lg border border-amber-400/30 bg-[#18120c]/90 px-4 py-2 text-xs text-amber-200 shadow-lg"
        >
          {contextError}
        </div>
      ) : null}

      {/* Bottom Floating Dock + Collapsible Toggle */}
      <div className="pointer-events-none flex flex-col items-center">
        <button
          type="button"
          onClick={onToggleDock}
          aria-expanded={!dockCollapsed}
          aria-label={dockCollapsed ? 'Show camera and lighting controls' : 'Hide camera and lighting controls'}
          className="pointer-events-auto mb-1.5 sm:mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-[#0a0e16]/82 px-3 py-1 text-[11px] font-medium text-slate-300 shadow-md transition-colors hover:bg-[#131a29]/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        <nav
          aria-label="Citadel camera and lighting controls"
          className={`pointer-events-auto max-w-[94vw] transition-all duration-200 ease-out ${
            dockCollapsed
              ? 'pointer-events-none translate-y-6 opacity-0 h-0 overflow-hidden'
              : 'translate-y-0 opacity-100'
          }`}
        >
          <div className="flex flex-nowrap overflow-x-auto items-center gap-1.5 sm:gap-2 rounded-2xl border border-white/12 bg-[#0a0e16]/84 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-[0_16px_44px_rgba(0,0,0,0.52)]">
            {/* 5 Camera Preset Buttons */}
            <div
              role="group"
              aria-label="Camera viewpoints"
              className="flex flex-nowrap items-center gap-1 shrink-0"
            >
              <span className="hidden xl:inline-flex items-center px-1.5 text-slate-400" aria-hidden="true">
                <Camera className="h-3.5 w-3.5" />
              </span>
              {CAMERA_PRESETS.map((preset) => {
                const isActive = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onPresetSelect(preset.id)}
                    aria-pressed={isActive}
                    aria-label={preset.label}
                    className={`whitespace-nowrap shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/75 ${
                      isActive
                        ? 'border border-amber-300/40 bg-amber-400/20 text-amber-100 shadow-sm'
                        : 'border border-transparent text-slate-300 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    <span className="hidden md:inline">{preset.label}</span>
                    <span className="md:hidden">{preset.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            <div className="h-5 w-px shrink-0 bg-white/12" aria-hidden="true" />

            {/* 3 Lighting Mode Buttons */}
            <div
              role="group"
              aria-label="Lighting modes"
              className="flex flex-nowrap items-center gap-1 shrink-0"
            >
              {LIGHTING_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = lightingMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onLightingChange(opt.id)}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/75 ${
                      isActive
                        ? 'border border-amber-300/40 bg-amber-400/20 text-amber-100 shadow-sm'
                        : 'border border-transparent text-slate-300 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="h-5 w-px shrink-0 bg-white/12" aria-hidden="true" />

            {/* Auto-Orbit Toggle */}
            <button
              type="button"
              onClick={onToggleAutoOrbit}
              aria-pressed={autoOrbit}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/75 ${
                autoOrbit
                  ? 'border border-emerald-300/35 bg-emerald-400/18 text-emerald-100'
                  : 'border border-transparent text-slate-300 hover:bg-white/8 hover:text-white'
              }`}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Auto-Orbit</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

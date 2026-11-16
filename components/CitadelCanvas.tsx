'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  ATMOSPHERE_PRESETS,
  cloneAtmosphereState,
  dampAtmosphereState,
} from '@/lib/voxel/atmosphere';
import {
  clampCameraAboveSurface,
  createCameraFlight,
  getCameraPreset,
  stepCameraFlight,
  type CameraFlightState,
} from '@/lib/voxel/cameraRig';
import { generateCitadelWorld } from '@/lib/voxel/citadelGenerator';
import {
  createOceanMaterial,
  createSkyDomeMaterial,
  createStarfield,
  createVoxelBlockTexture,
} from '@/lib/voxel/shaders';
import type { CameraPresetId, HudStats, LightingMode } from '@/lib/voxel/types';

// Pre-allocated scratch math objects (zero GC allocations in animation loop)
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();
const _sunPos = new THREE.Vector3();
const _fogColor = new THREE.Color();

interface CitadelCanvasProps {
  lightingMode: LightingMode;
  activePreset: CameraPresetId;
  presetTrigger: number;
  autoOrbit: boolean;
  onVoxelCountReady: (count: number) => void;
  onStatsUpdate: (stats: HudStats) => void;
  onManualOrbitStart?: () => void;
  onContextError?: (message: string) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function CitadelCanvas({
  lightingMode,
  activePreset,
  presetTrigger,
  autoOrbit,
  onVoxelCountReady,
  onStatsUpdate,
  onManualOrbitStart,
  onContextError,
}: CitadelCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Store latest React props/callbacks in refs so WebGL lifecycle mounts once
  const lightingModeRef = useRef<LightingMode>(lightingMode);
  const autoOrbitRef = useRef<boolean>(autoOrbit);
  const callbacksRef = useRef({
    onVoxelCountReady,
    onStatsUpdate,
    onManualOrbitStart,
    onContextError,
  });

  useEffect(() => {
    lightingModeRef.current = lightingMode;
    autoOrbitRef.current = autoOrbit;
    callbacksRef.current = {
      onVoxelCountReady,
      onStatsUpdate,
      onManualOrbitStart,
      onContextError,
    };
  }, [
    lightingMode,
    autoOrbit,
    onVoxelCountReady,
    onStatsUpdate,
    onManualOrbitStart,
    onContextError,
  ]);

  const triggerFlightRef = useRef<((presetId: CameraPresetId) => void) | null>(null);

  useEffect(() => {
    if (presetTrigger > 0) {
      triggerFlightRef.current?.(activePreset);
    }
  }, [activePreset, presetTrigger]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: isSoftwareGl,
      });
    } catch {
      callbacksRef.current.onContextError?.('WebGL rendering is unavailable in this browser.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ATMOSPHERE_PRESETS[lightingModeRef.current].exposure;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('data-testid', 'citadel-canvas');
    container.appendChild(canvas);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      callbacksRef.current.onContextError?.('WebGL context was lost. Attempting recovery...');
    };
    const handleContextRestored = () => {
      callbacksRef.current.onContextError?.('');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    // Scene & Fog
    const scene = new THREE.Scene();
    const currentAtmo = cloneAtmosphereState(ATMOSPHERE_PRESETS[lightingModeRef.current]);
    _fogColor.setRGB(...currentAtmo.fogColor);
    const fog = new THREE.FogExp2(_fogColor.getHex(), currentAtmo.fogDensity);
    scene.fog = fog;
    scene.background = _fogColor.clone();

    // Studio environment reflection for ocean & metallic accents
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // Camera & OrbitControls
    const initialPreset = getCameraPreset('panoramic');
    const camera = new THREE.PerspectiveCamera(48, width / height, 0.5, 950);
    camera.position.set(...initialPreset.position);

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(...initialPreset.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.055;
    controls.minDistance = 14;
    controls.maxDistance = 165;
    controls.maxPolarAngle = Math.PI * 0.482;
    controls.minPolarAngle = 0.14;
    controls.autoRotate = autoOrbitRef.current;
    controls.autoRotateSpeed = 0.45;
    controls.update();

    const flightState: CameraFlightState = {
      active: false,
      elapsed: 0,
      duration: 1.65,
      startPos: [...initialPreset.position],
      endPos: [...initialPreset.position],
      startTarget: [...initialPreset.target],
      endTarget: [...initialPreset.target],
    };

    const handleControlStart = () => {
      if (flightState.active) {
        flightState.active = false;
      }
      callbacksRef.current.onManualOrbitStart?.();
    };
    controls.addEventListener('start', handleControlStart);

    triggerFlightRef.current = (presetId: CameraPresetId) => {
      const targetPreset = getCameraPreset(presetId);
      const next = createCameraFlight(
        [camera.position.x, camera.position.y, camera.position.z],
        [controls.target.x, controls.target.y, controls.target.z],
        targetPreset,
        1.65,
      );
      flightState.active = next.active;
      flightState.elapsed = next.elapsed;
      flightState.duration = next.duration;
      flightState.startPos = next.startPos;
      flightState.endPos = next.endPos;
      flightState.startTarget = next.startTarget;
      flightState.endTarget = next.endTarget;
    };

    // Sky Dome & Starfield
    const skyGeo = new THREE.SphereGeometry(460, 32, 20);
    const { material: skyMat, uniforms: skyUniforms } = createSkyDomeMaterial();
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);

    const starfield = createStarfield(950);
    scene.add(starfield.points);

    // 3-Point Warm/Cool Atmospheric Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x73579e, 0x38241e, currentAtmo.hemiIntensity);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xff9e52, currentAtmo.sunIntensity);
    keyLight.position.set(
      currentAtmo.sunDirection[0] * 120,
      currentAtmo.sunDirection[1] * 120,
      currentAtmo.sunDirection[2] * 120,
    );
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 15;
    keyLight.shadow.camera.far = 260;
    const shadowBound = 68;
    keyLight.shadow.camera.left = -shadowBound;
    keyLight.shadow.camera.right = shadowBound;
    keyLight.shadow.camera.top = shadowBound;
    keyLight.shadow.camera.bottom = -shadowBound;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.03;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7385d9, currentAtmo.rimIntensity);
    rimLight.position.set(70, 45, 75);
    scene.add(rimLight);

    // Warm golden-amber torch point lights (unshadowed, <= 2 lights for performance)
    const gateTorchLight = new THREE.PointLight(0xffa438, 18, 42, 1.4);
    gateTorchLight.position.set(0, 16, 33);
    scene.add(gateTorchLight);

    const courtyardTorchLight = new THREE.PointLight(0xffb44c, 22, 46, 1.4);
    courtyardTorchLight.position.set(0, 26, 4);
    scene.add(courtyardTorchLight);

    // Reflective Animated Ocean Water
    const oceanGeo = new THREE.PlaneGeometry(920, 920, 1, 1);
    oceanGeo.rotateX(-Math.PI / 2);
    const { material: oceanMat, uniforms: oceanUniforms } = createOceanMaterial();
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.position.y = 0;
    oceanMesh.receiveShadow = !isSoftwareGl;
    scene.add(oceanMesh);

    // Procedural Voxel World Generation
    const voxelWorld = generateCitadelWorld();
    callbacksRef.current.onVoxelCountReady(voxelWorld.totalVoxels);

    const voxelGeo = new THREE.BoxGeometry(1, 1, 1);
    const blockTex = createVoxelBlockTexture(renderer.capabilities.getMaxAnisotropy());

    // 1. Opaque Citadel, Island, Foliage, Docks & Monoliths InstancedMesh
    const opaqueMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: blockTex,
      roughness: 0.86,
      metalness: 0.06,
      envMapIntensity: 0.55,
    });
    const opaqueMesh = new THREE.InstancedMesh(voxelGeo, opaqueMat, voxelWorld.opaqueCount);
    opaqueMesh.castShadow = !isSoftwareGl;
    opaqueMesh.receiveShadow = !isSoftwareGl;

    for (let i = 0; i < voxelWorld.opaqueCount; i++) {
      _mat4.makeTranslation(
        voxelWorld.opaquePositions[i * 3],
        voxelWorld.opaquePositions[i * 3 + 1],
        voxelWorld.opaquePositions[i * 3 + 2],
      );
      opaqueMesh.setMatrixAt(i, _mat4);
      _color.setRGB(
        voxelWorld.opaqueColors[i * 3],
        voxelWorld.opaqueColors[i * 3 + 1],
        voxelWorld.opaqueColors[i * 3 + 2],
      );
      opaqueMesh.setColorAt(i, _color);
    }
    opaqueMesh.instanceMatrix.needsUpdate = true;
    if (opaqueMesh.instanceColor) opaqueMesh.instanceColor.needsUpdate = true;
    opaqueMesh.computeBoundingSphere();
    scene.add(opaqueMesh);

    // 2. Emissive Windows, Braziers & Lanterns InstancedMesh
    const emissiveMat = new THREE.MeshStandardMaterial({
      color: 0xffcf78,
      emissive: new THREE.Color(0xffa93a),
      emissiveIntensity: currentAtmo.emissiveIntensity,
      roughness: 0.25,
      metalness: 0.0,
    });
    const emissiveMesh = new THREE.InstancedMesh(voxelGeo, emissiveMat, voxelWorld.emissiveCount);
    for (let i = 0; i < voxelWorld.emissiveCount; i++) {
      _mat4.makeTranslation(
        voxelWorld.emissivePositions[i * 3],
        voxelWorld.emissivePositions[i * 3 + 1],
        voxelWorld.emissivePositions[i * 3 + 2],
      );
      emissiveMesh.setMatrixAt(i, _mat4);
      _color.setRGB(
        voxelWorld.emissiveColors[i * 3],
        voxelWorld.emissiveColors[i * 3 + 1],
        voxelWorld.emissiveColors[i * 3 + 2],
      );
      emissiveMesh.setColorAt(i, _color);
    }
    emissiveMesh.instanceMatrix.needsUpdate = true;
    if (emissiveMesh.instanceColor) emissiveMesh.instanceColor.needsUpdate = true;
    emissiveMesh.computeBoundingSphere();
    scene.add(emissiveMesh);

    // 3. Layered Flat-Bottomed Drifting Voxel Clouds
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.35,
    });
    const cloudMesh = new THREE.InstancedMesh(voxelGeo, cloudMat, voxelWorld.cloudCount);
    cloudMesh.frustumCulled = false;
    for (let i = 0; i < voxelWorld.cloudCount; i++) {
      _mat4.makeTranslation(
        voxelWorld.cloudPositions[i * 3],
        voxelWorld.cloudPositions[i * 3 + 1],
        voxelWorld.cloudPositions[i * 3 + 2],
      );
      cloudMesh.setMatrixAt(i, _mat4);
      _color.setRGB(
        voxelWorld.cloudColors[i * 3],
        voxelWorld.cloudColors[i * 3 + 1],
        voxelWorld.cloudColors[i * 3 + 2],
      );
      cloudMesh.setColorAt(i, _color);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
    if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
    scene.add(cloudMesh);

    // 4. Fluttering Crimson Flags & Torch Flame Tips
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.05,
    });
    const flagMesh = new THREE.InstancedMesh(voxelGeo, flagMat, voxelWorld.flagCount);
    flagMesh.frustumCulled = false;
    for (let i = 0; i < voxelWorld.flagCount; i++) {
      _mat4.makeTranslation(
        voxelWorld.flagPositions[i * 3],
        voxelWorld.flagPositions[i * 3 + 1],
        voxelWorld.flagPositions[i * 3 + 2],
      );
      flagMesh.setMatrixAt(i, _mat4);
      _color.setRGB(
        voxelWorld.flagColors[i * 3],
        voxelWorld.flagColors[i * 3 + 1],
        voxelWorld.flagColors[i * 3 + 2],
      );
      flagMesh.setColorAt(i, _color);
    }
    flagMesh.instanceMatrix.needsUpdate = true;
    if (flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
    scene.add(flagMesh);

    // Post-processing Composer (Hardware GPU only; Software WebGL uses direct render)
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        currentAtmo.bloomStrength,
        0.35,
        0.92,
      );
      composer.addPass(bloomPass);

      const outputPass = new OutputPass();
      composer.addPass(outputPass);

      renderer.compile(scene, camera);
    }

    // Estimate static GPU memory footprint (MB) from instance buffers, geometries, textures & render targets
    const instanceBufferBytes =
      voxelWorld.totalVoxels * (16 * 4 + 3 * 4); // matrix4 + instanceColor
    const staticGeoBytes = 128 * 1024;
    const shadowMapBytes = isSoftwareGl ? 0 : 2048 * 2048 * 4;
    const getGpuMemoryMb = (w: number, h: number, pr: number): number => {
      const fbPixels = w * pr * (h * pr);
      const renderTargetBytes = isSoftwareGl ? fbPixels * 8 : fbPixels * 8 * 5;
      return (instanceBufferBytes + staticGeoBytes + shadowMapBytes + renderTargetBytes) / (1024 * 1024);
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
      if (bloomPass) bloomPass.resolution.set(w, h);
      if (isSoftwareGl && !disposed) {
        clearTimeout(frameId);
        frameId = window.setTimeout(tick, 16);
      }
    };
    window.addEventListener('resize', handleResize);

    // Animation loop state
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let elapsed = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let displayedFps = isSoftwareGl ? 12 : 60;
    let lastStatsEmit = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function applyAtmosphereToScene(dt: number, timeSec: number) {
      const targetAtmo = ATMOSPHERE_PRESETS[lightingModeRef.current];
      const alpha = 1 - Math.exp(-3.2 * dt);
      dampAtmosphereState(currentAtmo, targetAtmo, alpha);

      // Sky dome uniforms
      skyUniforms.uZenithColor.value.setRGB(...currentAtmo.zenithColor);
      skyUniforms.uMidColor.value.setRGB(...currentAtmo.midSkyColor);
      skyUniforms.uHorizonColor.value.setRGB(...currentAtmo.horizonColor);
      skyUniforms.uFogColor.value.setRGB(...currentAtmo.fogColor);
      skyUniforms.uSunDirection.value.set(...currentAtmo.sunDirection).normalize();
      skyUniforms.uSunColor.value.setRGB(...currentAtmo.sunColor);
      skyUniforms.uSunDiscIntensity.value = currentAtmo.sunDiscIntensity;

      // Scene fog & background
      _fogColor.setRGB(...currentAtmo.fogColor);
      fog.color.copy(_fogColor);
      fog.density = currentAtmo.fogDensity;
      if (scene.background instanceof THREE.Color) {
        scene.background.copy(_fogColor);
      }

      // Lights
      _sunPos.set(
        currentAtmo.sunDirection[0] * 120,
        currentAtmo.sunDirection[1] * 120,
        currentAtmo.sunDirection[2] * 120,
      );
      keyLight.position.copy(_sunPos);
      keyLight.color.setRGB(...currentAtmo.sunColor);
      keyLight.intensity = currentAtmo.sunIntensity;

      hemiLight.color.setRGB(...currentAtmo.hemiSkyColor);
      hemiLight.groundColor.setRGB(...currentAtmo.hemiGroundColor);
      hemiLight.intensity = currentAtmo.hemiIntensity;

      rimLight.color.setRGB(...currentAtmo.rimColor);
      rimLight.intensity = currentAtmo.rimIntensity;

      // Ocean uniforms
      oceanUniforms.uTime.value = timeSec;
      oceanUniforms.uWaterDeep.value.setRGB(...currentAtmo.waterDeepColor);
      oceanUniforms.uWaterShallow.value.setRGB(...currentAtmo.waterShallowColor);
      oceanUniforms.uSunDir.value.copy(skyUniforms.uSunDirection.value);
      oceanUniforms.uSunSpecColor.value.setRGB(...currentAtmo.waterSpecColor);

      // Stars, clouds & emissive window glow (subtle torch warmth shimmer)
      starfield.uniforms.uTime.value = timeSec;
      starfield.uniforms.uOpacity.value = currentAtmo.starOpacity;

      cloudMat.color.setRGB(...currentAtmo.cloudTint);
      const torchShimmer = 1 + Math.sin(timeSec * 3.1) * 0.05;
      emissiveMat.emissiveIntensity = currentAtmo.emissiveIntensity * torchShimmer;

      // Scale warm gatehouse & courtyard torch lights across Daylight / Sunset / Night
      const nightBoost = Math.max(0, currentAtmo.emissiveIntensity - 1.4);
      gateTorchLight.intensity = (6 + nightBoost * 28) * torchShimmer;
      courtyardTorchLight.intensity = (8 + nightBoost * 32) * torchShimmer;

      renderer.toneMappingExposure = currentAtmo.exposure;
      if (bloomPass) {
        bloomPass.strength = currentAtmo.bloomStrength;
      }
    }

    function tick() {
      if (disposed) return;

      const now = performance.now();
      const rawDt = Math.max(0.001, (now - lastTime) / 1000);
      const dt = Math.min(0.1, rawDt);
      const transitionDt = Math.min(1.2, rawDt);
      lastTime = now;
      elapsed += dt;

      // Smooth cubic-eased camera flight (wall-clock paced)
      if (flightState.active) {
        const step = stepCameraFlight(flightState, transitionDt);
        camera.position.set(step.pos[0], step.pos[1], step.pos[2]);
        controls.target.set(step.target[0], step.target[1], step.target[2]);
      }

      controls.autoRotate = autoOrbitRef.current && !flightState.active;
      controls.update();

      // Prevent camera from clipping below terrain or ocean surface
      const clampedY = clampCameraAboveSurface(
        camera.position.x,
        camera.position.y,
        camera.position.z,
      );
      if (camera.position.y < clampedY) {
        camera.position.y = clampedY;
      }

      // Drift layered voxel clouds lazily around the sky
      cloudMesh.rotation.y = elapsed * 0.012;

      // Flutter crimson flags & flame tips
      for (let i = 0; i < voxelWorld.flagCount; i++) {
        const fx = voxelWorld.flagPositions[i * 3];
        const fy = voxelWorld.flagPositions[i * 3 + 1];
        const fz = voxelWorld.flagPositions[i * 3 + 2];
        const phase = voxelWorld.flagMeta[i * 2];
        const amp = voxelWorld.flagMeta[i * 2 + 1];
        const swayZ = Math.sin(elapsed * 4.2 + phase) * amp;
        const swayY = Math.cos(elapsed * 3.4 + phase) * (amp * 0.35);
        _mat4.makeTranslation(fx, fy + swayY, fz + swayZ);
        flagMesh.setMatrixAt(i, _mat4);
      }
      flagMesh.instanceMatrix.needsUpdate = true;

      // Update atmosphere & lighting interpolation (wall-clock paced)
      applyAtmosphereToScene(transitionDt, elapsed);

      // Render
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      // FPS & GPU memory telemetry (true wall-clock FPS, throttled to ~4Hz)
      fpsAccumulator += rawDt;
      fpsFrames += 1;
      if (fpsAccumulator >= 0.4) {
        displayedFps = Math.max(1, Math.round(fpsFrames / fpsAccumulator));
        fpsAccumulator = 0;
        fpsFrames = 0;
      }
      if (now - lastStatsEmit >= 250) {
        lastStatsEmit = now;
        const w = container?.clientWidth || window.innerWidth;
        const h = container?.clientHeight || window.innerHeight;
        callbacksRef.current.onStatsUpdate({
          fps: displayedFps,
          gpuMemoryMb: Number(getGpuMemoryMb(w, h, renderer.getPixelRatio()).toFixed(1)),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', handleControlStart);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      controls.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      starfield.dispose();
      oceanGeo.dispose();
      oceanMat.dispose();
      voxelGeo.dispose();
      blockTex.dispose();
      opaqueMat.dispose();
      emissiveMat.dispose();
      cloudMat.dispose();
      flagMat.dispose();
      envTarget.dispose();
      composer?.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 w-full h-full overflow-hidden bg-[#0c101a]"
      aria-label="3D Voxel Viewport of Citadel of Valoria"
    />
  );
}

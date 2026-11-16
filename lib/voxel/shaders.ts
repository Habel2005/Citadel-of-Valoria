import * as THREE from 'three';
import { mulberry32 } from './noise';

/**
 * Generates a crisp 32x32 tileable block bevel + subtle micro-grain CanvasTexture
 * so every 1x1x1 voxel has sharp architectural edge definition while preserving
 * per-instance color tinting.
 */
export function createVoxelBlockTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const rng = mulberry32(4049);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(0, 0, size, size);

  // Subtle surface micro-grain
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const v = Math.floor(242 + (rng() - 0.5) * 14);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Subtle 1px outer bevel frame for clean voxel block separation
  ctx.strokeStyle = 'rgba(205, 205, 212, 0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface SkyDomeUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uZenithColor: THREE.IUniform<THREE.Color>;
  uMidColor: THREE.IUniform<THREE.Color>;
  uHorizonColor: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSunDiscIntensity: THREE.IUniform<number>;
}

export function createSkyDomeMaterial(): {
  material: THREE.ShaderMaterial;
  uniforms: SkyDomeUniforms;
} {
  const uniforms: SkyDomeUniforms = {
    uZenithColor: { value: new THREE.Color(0x1b143d) },
    uMidColor: { value: new THREE.Color(0x753552) },
    uHorizonColor: { value: new THREE.Color(0xf27a30) },
    uFogColor: { value: new THREE.Color(0xc26b42) },
    uSunDirection: { value: new THREE.Vector3(-0.62, 0.22, -0.75).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.68, 0.36) },
    uSunDiscIntensity: { value: 1.4 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uFogColor;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uSunDiscIntensity;
      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, -0.2, 1.0);

        // Multi-stop vertical atmospheric sky gradient
        float midT = smoothstep(0.0, 0.28, max(h, 0.0));
        float zenT = smoothstep(0.22, 0.88, max(h, 0.0));
        vec3 sky = mix(uHorizonColor, uMidColor, midT);
        sky = mix(sky, uZenithColor, zenT);

        // Atmospheric sun/moon glow + crisp disc
        float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
        float halo = pow(sunDot, 7.0) * 0.42 + pow(sunDot, 42.0) * 0.55;
        float disc = smoothstep(0.9972, 0.9991, sunDot) * 1.45;
        sky += uSunColor * (halo + disc) * uSunDiscIntensity;

        // Blend seamlessly into horizon fog near and below the waterline
        float horizonBlend = 1.0 - smoothstep(-0.04, 0.11, h);
        sky = mix(sky, uFogColor, horizonBlend * 0.92);

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  return { material, uniforms };
}

export interface StarfieldRig {
  points: THREE.Points;
  uniforms: {
    [uniform: string]: THREE.IUniform<unknown>;
    uTime: THREE.IUniform<number>;
    uOpacity: THREE.IUniform<number>;
  };
  dispose: () => void;
}

export function createStarfield(count = 950): StarfieldRig {
  const rng = mulberry32(99173);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const starTints = [
    new THREE.Color(0xfff6e5),
    new THREE.Color(0xdbe8ff),
    new THREE.Color(0xffdfc2),
    new THREE.Color(0xffffff),
  ];

  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(0.08 + rng() * 0.92); // upper sky hemisphere above horizon
    const r = 415;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const tint = starTints[Math.floor(rng() * starTints.length)];
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;

    sizes[i] = 1.5 + rng() * 2.8;
    phases[i] = rng() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0.22 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        vColor = aColor;
        vTwinkle = 0.55 + 0.45 * sin(uTime * (1.4 + aSize * 0.35) + aPhase);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (340.0 / max(-mvPosition.z, 1.0));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.06, d);
        gl_FragColor = vec4(vColor, core * vTwinkle * uOpacity);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    uniforms,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface OceanUniforms {
  uTime: { value: number };
  uWaterDeep: { value: THREE.Color };
  uWaterShallow: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunSpecColor: { value: THREE.Color };
}

export function createOceanMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: OceanUniforms;
} {
  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uWaterDeep: { value: new THREE.Color(0x0f1c38) },
    uWaterShallow: { value: new THREE.Color(0x243852) },
    uSunDir: { value: new THREE.Vector3(-0.62, 0.22, -0.75).normalize() },
    uSunSpecColor: { value: new THREE.Color(1.0, 0.64, 0.34) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0.22,
    envMapIntensity: 0.35,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaterDeep = uniforms.uWaterDeep;
    shader.uniforms.uWaterShallow = uniforms.uWaterShallow;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uSunSpecColor = uniforms.uSunSpecColor;

    shader.vertexShader =
      `varying vec3 vWaterWorldPos;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

    shader.fragmentShader =
      /* glsl */ `
      uniform float uTime;
      uniform vec3 uWaterDeep;
      uniform vec3 uWaterShallow;
      uniform vec3 uSunDir;
      uniform vec3 uSunSpecColor;
      varying vec3 vWaterWorldPos;
      ` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          float radialDist = length(vWaterWorldPos.xz);
          float shallowMask = 1.0 - smoothstep(32.0, 70.0, radialDist);
          vec3 baseWater = mix(uWaterDeep, uWaterShallow, shallowMask);

          // Fresnel sky-reflection tint on grazing ocean angles
          vec3 viewVec = normalize(cameraPosition - vWaterWorldPos);
          float fresnel = pow(1.0 - max(dot(viewVec, vec3(0.0, 1.0, 0.0)), 0.0), 3.2);
          baseWater = mix(baseWater, uSunSpecColor * 0.38 + uWaterShallow * 0.65, fresnel * 0.45);

          // Subtle coastal ripple foam bands near shoreline
          float coastRing = smoothstep(54.0, 44.0, radialDist) * smoothstep(32.0, 41.0, radialDist);
          float foamWave = sin(radialDist * 0.68 - uTime * 1.9 + sin(vWaterWorldPos.x * 0.14) * 2.0);
          float foam = coastRing * smoothstep(0.78, 0.98, foamWave) * 0.28;
          diffuseColor.rgb = baseWater + vec3(foam);
          `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #include <normal_fragment_maps>
          vec2 wp = vWaterWorldPos.xz;
          float w1 = cos(wp.x * 0.26 + wp.y * 0.18 + uTime * 1.35) * 0.075;
          float w2 = sin(wp.x * 0.16 - wp.y * 0.31 + uTime * 1.05) * 0.065;
          float w3 = cos(wp.x * 0.48 + wp.y * 0.44 - uTime * 2.15) * 0.032;
          vec3 worldWaveN = normalize(vec3(-(w1 + w3), 1.0, -(w2 - w3)));
          normal = normalize((viewMatrix * vec4(worldWaveN, 0.0)).xyz);
          `,
        );
  };

  return { material, uniforms };
}

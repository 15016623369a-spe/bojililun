'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, labelAtBarycentric, SCULPTURE_GROUPS, SCULPTURE_VARIANTS, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { buildGeometryBVH, enableFastSculptureRaycast, labeledGeometry, validateLabelData } from '@/lib/sculpture-geometry';

const BY_BYTE = new Map(SCULPTURE_GROUPS.map((g) => [g.byteValue, g.id]));
const BYTE_OF = new Map(SCULPTURE_GROUPS.map((g) => [g.id, g.byteValue]));

type CachedMeshEntry = {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

type PreparedSculpture = {
  meshes: CachedMeshEntry[];
  centerOffset: THREE.Vector3;
  groupScale: number;
};

const preparedCache = new Map<SculptureVariant, Promise<PreparedSculpture>>();
const centroidCache = new Map<string, { p: THREE.Vector3; n: THREE.Vector3 }>();

/**
 * 计划首屏的点阵后处理：先把中性灰雕塑渲染进纹理，再在屏幕空间按格采样亮度画圆点。
 * 参数对应 docs/design/2026-11-21/visual-handoff.md 里原静态稿的算法（5px 格 → uCell）。
 */
const HALFTONE_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HALFTONE_FRAG = `
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform float uCell;
  uniform float uAA;
  uniform float uDark;
  varying vec2 vUv;
  vec3 toDisplay(vec3 c) {
    c = max(c * 1.05, 0.0);
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  }
  vec4 lit(vec2 uv) {
    vec4 s = texture2D(tScene, uv);
    if (s.a < 0.002) return vec4(0.0);
    return vec4(toDisplay(s.rgb / s.a), s.a);
  }
  // 雕塑本身是中性灰，没有色度；悬停 / 按下的肌群染成偏红、选中的染成偏绿，
  // 这里把这两种色度识别出来，翻成「墨底亮点」的反相点阵。
  vec2 marks(vec3 c) {
    float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    return vec2(smoothstep(0.07, 0.2, chroma), step(c.r, c.g));
  }
  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 m = lit(px / uRes);
    float l = dot(m.rgb, vec3(0.299, 0.587, 0.114));
    float g = clamp((l - 0.5) * 1.18 + 0.5, 0.0, 1.0) * 0.91;
    // 夜间：人体底色压暗，点改成浅色；悬停的反相块改成浅底
    vec4 col = vec4(vec3(mix(g, g * 0.2, uDark)), 1.0) * (m.a * 0.66);
    vec3 ink = mix(vec3(21.0, 22.0, 19.0), vec3(226.0, 228.0, 222.0), uDark) / 255.0;
    col = mix(col, vec4(ink, 1.0) * m.a, marks(m.rgb).x);
    vec2 c = (floor(px / uCell) + 0.5) * uCell;
    vec4 s = lit(c / uRes);
    if (s.a > 0.35) {
      vec2 sm = marks(s.rgb);
      if (sm.x > 0.5) {
        // 反相：受光越多点越大，肌肉的起伏仍然读得出来
        float v = clamp(sm.y > 0.5 ? s.g : s.r, 0.0, 1.0);
        float r = (0.3 + v * 1.7) * uCell / 5.0;
        float cov = 1.0 - smoothstep(r - uAA, r + uAA, length(px - c));
        vec3 dotc = sm.y > 0.5 ? vec3(242.0, 237.0, 33.0) / 255.0 : mix(vec3(236.0, 237.0, 232.0), vec3(21.0, 22.0, 19.0), uDark) / 255.0;
        if (sm.y > 0.5 && uDark > 0.5) col = mix(col, vec4(vec3(21.0, 22.0, 19.0) / 255.0, 1.0) * s.a, 1.0);
        float a = cov * s.a;
        col = vec4(dotc * a, a) + col * (1.0 - a);
      } else {
        float tone = max(0.0, (252.0 / 255.0 - s.r) / (128.0 / 255.0));
        // 夜间反过来：受光越多点越大
        float lift = clamp((s.r - 0.3) / 0.62, 0.0, 1.2);
        float t = mix(tone, lift, uDark);
        float r = (0.46 + min(1.22, t) * 1.78) * uCell / 5.0;
        float cov = 1.0 - smoothstep(r - uAA, r + uAA, length(px - c));
        float a = (0.4 + min(1.0, t) * 0.6) * cov * s.a;
        vec3 dotInk = mix(vec3(20.0, 26.0, 20.0), vec3(214.0, 217.0, 210.0), uDark) / 255.0;
        col = vec4(dotInk * a, a) + col * (1.0 - a);
      }
    }
    gl_FragColor = col;
  }
`;

export type SculptureAnchor = { muscle: MuscleId; label: string } | null;

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
  material.dispose();
}
function disposeSubject(subject: THREE.Object3D) {
  subject.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) disposeMaterial(material);
  });
}
async function checkedFetch(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`人体资源加载失败 (${response.status})`);
  return response;
}
async function verifyHash(bytes: ArrayBuffer, expected: string) {
  // Secure contexts verify asset identity in addition to counts/IDs on every host.
  if (!globalThis.crypto?.subtle) return;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('人体资源版本不匹配');
}

function loadPreparedSculpture(variant: SculptureVariant): Promise<PreparedSculpture> {
  const existing = preparedCache.get(variant);
  if (existing) return existing;

  const task = (async (): Promise<PreparedSculpture> => {
    const spec = SCULPTURE_VARIANTS[variant];
    const META = spec.metadata;
    const version = META.binarySha256;
    const [modelBytes, labelBytes, metadata] = await Promise.all([
      checkedFetch(`${spec.model}?v=${META.modelSha256}`).then((r) => r.arrayBuffer()),
      checkedFetch(`${spec.labels}.bin?v=${version}`).then((r) => r.arrayBuffer()),
      checkedFetch(`${spec.labels}.json?v=${version}`).then((r) => r.json()),
    ]);
    const labels = new Uint8Array(labelBytes);
    validateLabelData(labels, metadata, META);
    await Promise.all([verifyHash(labelBytes, META.binarySha256), verifyHash(modelBytes, META.modelSha256)]);

    const gltf = await new GLTFLoader().parseAsync(modelBytes, '/models/sculpture/');
    const meshes: CachedMeshEntry[] = [];
    try {
      gltf.scene.updateMatrixWorld(true);
      const sourceMeshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) sourceMeshes.push(o); });
      if (sourceMeshes.length !== META.meshOrder.length) throw new Error('模型网格顺序不匹配');
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const height = box.max.y - box.min.y;
      const centerOffset = box.getCenter(new THREE.Vector3());

      for (let i = 0; i < sourceMeshes.length; i++) {
        const mesh = sourceMeshes[i];
        const entry = META.meshOrder[i];
        if (mesh.geometry.getAttribute('position').count !== entry.vertexCount) throw new Error('模型顶点数量不匹配');
        const geometry = labeledGeometry(mesh, labels.subarray(entry.vertexOffset, entry.vertexOffset + entry.vertexCount), height);
        buildGeometryBVH(geometry);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        mesh.matrixWorld.decompose(position, quaternion, scale);
        meshes.push({ geometry, position, quaternion, scale });
        mesh.geometry.dispose();
        for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) disposeMaterial(old);
      }
      return { meshes, centerOffset, groupScale: 2.05 / height };
    } catch (error) {
      for (const m of meshes) m.geometry.dispose();
      disposeSubject(gltf.scene);
      throw error;
    }
  })().catch((error) => {
    preparedCache.delete(variant);
    throw error;
  });

  preparedCache.set(variant, task);
  return task;
}

/** Preload and prepare the 3D sculpture geometry and BVH in the background so entering /body is instant. */
export function preloadSculpture(variant: SculptureVariant = 'male'): void {
  if (typeof window === 'undefined') return;
  void loadPreparedSculpture(variant).catch(() => {});
}

export default function SculptureBody({ recorded = [], selected = null, side = 'front', onPick, onHover, spin = false, variant = 'male', heatLevels, heatTint, heatPalette, look = 'sculpture', anchor = null }: {
  recorded?: MuscleId[];
  selected?: MuscleId | null;
  side?: 'front' | 'back';
  onPick?: (id: MuscleId) => void;
  /** 悬停（鼠标）或按住（触屏）的肌群，松开或拖动时回到 null */
  onHover?: (id: MuscleId | null) => void;
  spin?: boolean;
  variant?: SculptureVariant;
  heatLevels?: ReadonlyMap<MuscleId, number>;
  /** 着色的目标色：回顾频次用雾蓝、容量用珊瑚；不传时为选中色 */
  heatTint?: string;
  /** 手账回顾用的固定色板：ink 墨黑、lemon 柠檬黄、sage 旧绿；heatTint 优先 */
  heatPalette?: 'sage' | 'lemon' | 'ink';
  /** halftone：计划首屏的点阵人体；sculpture：回顾等页面的石膏 + 热力着色 */
  look?: 'sculpture' | 'halftone';
  /** 跟随模型转动的柠檬黄锚点；转到背面被遮挡时隐藏 */
  anchor?: SculptureAnchor;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const anchorEl = useRef<HTMLDivElement>(null);
  const latest = useRef({ recorded, selected, side, onPick, spin, heatLevels, heatTint, anchor, variant });
  latest.current = { recorded, selected, side, onPick, spin, heatLevels, heatTint, anchor, variant };
  const api = useRef<{ refresh: () => void; setSide: (side: 'front' | 'back') => void; anchor: () => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  const hoverCallback = useRef(onHover);
  hoverCallback.current = onHover;
  useEffect(() => { hoverCallback.current?.(hovered); }, [hovered]);
  useEffect(() => { api.current?.refresh(); }, [recorded, selected, heatLevels, heatTint]);
  useEffect(() => { api.current?.setSide(side); }, [side]);
  useEffect(() => { api.current?.anchor(); }, [anchor?.muscle]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('error');
      return;
    }
    setStatus('loading');
    const halftone = look === 'halftone';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    renderer.domElement.setAttribute('aria-label', '3D 肌群模型，可拖动旋转、点击肌群');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, .01, 100);
    camera.position.set(0, .02, 4.3);
    if (halftone) {
      // 中性灰、侧光偏强：点阵靠明暗读出肩、胸、腰腹和腿的厚度
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9b97, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 3.1);
      key.position.set(-3.2, 3.6, 4.2); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 1.1);
      rim.position.set(3.5, 1.5, -3); scene.add(rim);
    } else {
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bab4, 1.05));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-3, 4, 5); scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 1.0);
      fill.position.set(3, 2, -4); scene.add(fill);
    }
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = .08;
    controls.minDistance = 2; controls.maxDistance = 8;
    if (halftone) {
      // 首屏只绕竖轴转，停手后构图稳定
      controls.enableZoom = false;
      controls.minPolarAngle = controls.maxPolarAngle = Math.PI / 2 - .005;
      controls.rotateSpeed = .75;
    }
    controls.target.set(0, 0, 0); controls.update();

    let post: { target: THREE.WebGLRenderTarget; scene: THREE.Scene; camera: THREE.OrthographicCamera; material: THREE.ShaderMaterial } | null = null;
    if (halftone) {
      const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
      const postMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: target.texture },
          uRes: { value: new THREE.Vector2(1, 1) },
          uCell: { value: 3 * dpr },
          uAA: { value: .55 * dpr },
          uDark: { value: document.documentElement.dataset.theme === 'dark' ? 1 : 0 },
        },
        vertexShader: HALFTONE_VERT,
        fragmentShader: HALFTONE_FRAG,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
      });
      const postScene = new THREE.Scene();
      postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));
      post = { target, scene: postScene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material: postMaterial };
    }

    const heatData = new Uint8Array(32 * 4);
    const heat = new THREE.DataTexture(heatData, 32, 1, THREE.RGBAFormat);
    heat.magFilter = heat.minFilter = THREE.NearestFilter;
    heat.generateMipmaps = false;
    let hover: MuscleId | null = null;
    let subject: THREE.Group | null = null;
    let dirty = true;
    const PALETTE = { sage: { heat: '#2f6a45', hover: '#8fae94' }, lemon: { heat: '#f2ed21', hover: '#91bce8' }, ink: { heat: '#151613', hover: '#8d8f89' } };
    const palette = heatPalette ? PALETTE[heatPalette] : null;
    // 点阵模式下这两种颜色只是给后处理的标记（绿 = 选中、红 = 悬停 / 按下），屏幕上看到的是反相点阵
    const DEFAULT_TINT = halftone ? '#2fe62f' : palette?.heat ?? '#D9503C';
    const HOVER = halftone ? '#e62f2f' : palette?.hover ?? '#b6b7b1';
    // 墨黑 / 柠檬黄色板下悬停在已着色的肌群上时，画一圈浅色边，中间仍能看出热度
    const rimOnHover = !halftone && Boolean(heatPalette) && heatPalette !== 'sage';
    const tint = { value: new THREE.Color(DEFAULT_TINT) };
    const refresh = () => {
      tint.value.set(latest.current.heatTint ?? DEFAULT_TINT);
      const active = new Set(latest.current.recorded.map(canonicalMuscle));
      const selectedId = canonicalMuscle(latest.current.selected);
      heatData.fill(0);
      for (const g of SCULPTURE_GROUPS) {
        const i = g.byteValue * 4;
        const levels = latest.current.heatLevels;
        heatData[i] = levels ? Math.round((levels.get(g.id) ?? 0) * 255)
          : selectedId === g.id || active.has(g.id) ? 255 : 0;
        heatData[i + 1] = hover === g.id ? 255 : 0;
        heatData[i + 3] = 255;
      }
      heat.needsUpdate = true;
      dirty = true;
    };
    const updateHover = (next: MuscleId | null) => {
      if (hover === next) return;
      hover = next; setHovered(next); refresh();
      renderer.domElement.style.cursor = next ? 'pointer' : 'grab';
    };
    refresh();
    const material = new THREE.MeshStandardMaterial({ color: halftone ? 0xe4e4e1 : 0xe9e8e3, roughness: .88, metalness: 0, side: THREE.DoubleSide });
    material.customProgramCacheKey = () => halftone ? 'sculpture-halftone-v2' : `sculpture-ortho-feather-v2-${rimOnHover ? 'rim' : 'plain'}`;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMuscleHeat = { value: heat };
      // 点阵模式下选中/悬停只把该区压暗，圆点随之变大变深，不另上色
      shader.uniforms.uMuscleGreen = tint;
      shader.uniforms.uMuscleHover = { value: new THREE.Color(HOVER) };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute vec3 muscleIds;
        attribute vec2 muscleBary;
        attribute float muscleEdge;
        varying vec3 vMuscleIds;
        varying vec2 vMuscleBary;
        varying float vMuscleEdge;
      `).replace('#include <begin_vertex>', `#include <begin_vertex>
        vMuscleIds = muscleIds;
        vMuscleBary = muscleBary;
        vMuscleEdge = muscleEdge;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D uMuscleHeat;
        uniform vec3 uMuscleGreen;
        uniform vec3 uMuscleHover;
        varying vec3 vMuscleIds;
        varying vec2 vMuscleBary;
        varying float vMuscleEdge;
        float sameId(float a, float b) { return 1.0 - step(0.5, abs(a-b)); }
      `).replace('#include <color_fragment>', `#include <color_fragment>
        vec3 ids = floor(vMuscleIds + 0.5);
        vec3 bary = vec3(vMuscleBary, 1.0-vMuscleBary.x-vMuscleBary.y);
        vec3 score = vec3(
          dot(bary, vec3(1.0, sameId(ids.x, ids.y), sameId(ids.x, ids.z))),
          dot(bary, vec3(sameId(ids.y, ids.x), 1.0, sameId(ids.y, ids.z))),
          dot(bary, vec3(sameId(ids.z, ids.x), sameId(ids.z, ids.y), 1.0)));
        float id = ids.x;
        float best = score.x;
        if (score.y > best) { id = ids.y; best = score.y; }
        if (score.z > best) { id = ids.z; }
        // Background always occludes picks and receives zero highlight, including
        // the background portion of triangles crossing a muscle boundary.
        if (id < 32.0) {
          vec2 state = texture2D(uMuscleHeat, vec2((id+0.5)/32.0, 0.5)).rg;
          float feather = smoothstep(0.0, 1.0, vMuscleEdge);
          vec3 tint = state.r > 0.0 ? uMuscleGreen : uMuscleHover;
          float intensity = state.r > 0.0 ? state.r : state.g;
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, intensity * feather);
          if (${rimOnHover ? 'true' : 'false'} && state.r > 0.0 && state.g > 0.0) {
            float rim = 4.0 * feather * (1.0 - feather);
            diffuseColor.rgb = mix(diffuseColor.rgb, uMuscleHover, 0.55 * rim);
          }
        }
      `);
    };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), bary = new THREE.Vector3();
    type Pick = { id: MuscleId; point: THREE.Vector3; normal: THREE.Vector3 };
    const pickHit = (x: number, y: number): Pick | null => {
      if (!subject) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      ndc.set((x-rect.left)/rect.width*2-1, -(y-rect.top)/rect.height*2+1);
      subject.updateMatrixWorld(true); camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      // Test only the front-most surface: a hand must not click a glute behind it.
      const hit = raycaster.intersectObject(subject, true)[0];
      if (!hit?.face || !(hit.object instanceof THREE.Mesh)) return null;
      const geometry = hit.object.geometry;
      const pos = geometry.getAttribute('position'), ids = geometry.getAttribute('muscleIds');
      point.copy(hit.point); hit.object.worldToLocal(point);
      a.fromBufferAttribute(pos, hit.face.a); b.fromBufferAttribute(pos, hit.face.b); c.fromBufferAttribute(pos, hit.face.c);
      if (!THREE.Triangle.getBarycoord(point, a, b, c, bary)) return null;
      const v = hit.face.a;
      const id = BY_BYTE.get(labelAtBarycentric([ids.getX(v), ids.getY(v), ids.getZ(v)], [bary.x, bary.y, bary.z]));
      if (!id) return null;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      return { id, point: hit.point.clone(), normal };
    };
    const pickAt = (x: number, y: number): MuscleId | null => pickHit(x, y)?.id ?? null;

    // 锚点存成模型自身坐标，转身时跟着肌肉走
    let anchorLocal: { muscle: MuscleId; p: THREE.Vector3; n: THREE.Vector3 } | null = null;
    const toSubject = (p: THREE.Vector3, n: THREE.Vector3) => {
      const inv = new THREE.Matrix4().copy(subject!.matrixWorld).invert();
      return { p: p.clone().applyMatrix4(inv), n: n.clone().transformDirection(inv) };
    };
    const centroidAnchor = (muscle: MuscleId) => {
      const byte = BYTE_OF.get(muscle);
      if (!subject || byte === undefined) return null;
      const cacheKey = `${latest.current.variant}:${latest.current.side}:${muscle}`;
      const cached = centroidCache.get(cacheKey);
      if (cached) return { muscle, p: cached.p.clone(), n: cached.n.clone() };

      subject.updateMatrixWorld(true);
      let sx = 0, sy = 0, sz = 0, nx = 0, ny = 0, nz = 0, count = 0;
      subject.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const pos = obj.geometry.getAttribute('position');
        const ids = obj.geometry.getAttribute('muscleIds');
        const nor = obj.geometry.getAttribute('normal');
        if (!pos || !ids) return;
        const posArr = pos.array;
        const idsArr = ids.array;
        const norArr = nor?.array;
        const m = obj.matrixWorld.elements;
        const m0 = m[0], m1 = m[1], m2 = m[2], m4 = m[4], m5 = m[5], m6 = m[6];
        const m8 = m[8], m9 = m[9], m10 = m[10], m12 = m[12], m13 = m[13], m14 = m[14];
        for (let i = 0; i < pos.count; i += 3) {
          const o = i * 3;
          if (Math.round(idsArr[o]) !== byte) continue;
          const x = posArr[o], y = posArr[o + 1], z = posArr[o + 2];
          const wx = m0 * x + m4 * y + m8 * z + m12;
          // 双侧肌群取观者右侧那一块，和参考图里胸部锚点的位置一致
          if (wx < 0.015) continue;
          sx += wx;
          sy += m1 * x + m5 * y + m9 * z + m13;
          sz += m2 * x + m6 * y + m10 * z + m14;
          count++;
          if (norArr) {
            const lx = norArr[o], ly = norArr[o + 1], lz = norArr[o + 2];
            nx += m0 * lx + m4 * ly + m8 * lz;
            ny += m1 * lx + m5 * ly + m9 * lz;
            nz += m2 * lx + m6 * ly + m10 * lz;
          }
        }
      });
      if (!count) return null;
      const sum = new THREE.Vector3(sx / count, sy / count, sz / count);
      const nsum = new THREE.Vector3(nx, ny, nz);
      // 把重心吸附到相机看得见的表面上
      const dir = sum.clone().sub(camera.position).normalize();
      raycaster.set(camera.position, dir);
      const hit = raycaster.intersectObject(subject, true)[0];
      const p = hit ? hit.point : sum;
      const n = hit?.face && hit.object instanceof THREE.Mesh
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : nsum.lengthSq() ? nsum.normalize() : new THREE.Vector3(0, 0, 1);
      const local = toSubject(p, n);
      centroidCache.set(cacheKey, { p: local.p.clone(), n: local.n.clone() });
      return { muscle, ...local };
    };
    const syncAnchor = () => {
      const want = latest.current.anchor;
      if (!want) { anchorLocal = null; dirty = true; return; }
      if (anchorLocal?.muscle !== want.muscle) anchorLocal = centroidAnchor(want.muscle);
      dirty = true;
    };
    const placeAnchor = () => {
      const el = anchorEl.current;
      if (!el) return;
      if (!anchorLocal || !subject || !latest.current.anchor) { el.dataset.visible = '0'; return; }
      const w = anchorLocal.p.clone().applyMatrix4(subject.matrixWorld);
      const n = anchorLocal.n.clone().transformDirection(subject.matrixWorld);
      const facing = n.dot(camera.position.clone().sub(w).normalize());
      const v = w.clone().project(camera);
      const width = host.clientWidth, height = host.clientHeight;
      el.style.transform = `translate3d(${((v.x+1)/2*width).toFixed(1)}px, ${((1-v.y)/2*height).toFixed(1)}px, 0)`;
      el.dataset.visible = facing > .08 ? '1' : '0';
    };
    let pointer: { x: number; y: number } | null = null;
    let down: { x: number; y: number; id: number } | null = null;
    let dragged = false, needsHover = false;
    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) { dragged = true; updateHover(null); return; }
      down = { x: event.clientX, y: event.clientY, id: event.pointerId }; dragged = false;
      // 触屏没有悬停：按下就先把手指下的肌群翻成反相，松手才算选中，拖动则取消
      if (halftone && event.pointerType !== 'mouse') updateHover(pickAt(event.clientX, event.clientY));
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (down && Math.hypot(event.clientX-down.x, event.clientY-down.y) > 5) dragged = true;
      if (down && (dragged || !halftone || event.pointerType === 'mouse')) updateHover(null);
      else needsHover = event.pointerType !== 'touch';
    };
    const onUp = (event: PointerEvent) => {
      if (down?.id === event.pointerId && !dragged && Math.hypot(event.clientX-down.x, event.clientY-down.y) <= 5) {
        const hit = pickHit(event.clientX, event.clientY);
        if (hit) {
          const muscle = canonicalMuscle(hit.id) ?? hit.id;
          anchorLocal = { muscle, ...toSubject(hit.point, hit.normal) };
          dirty = true;
          latest.current.onPick?.(hit.id);
        }
      }
      down = null; pointer = null; needsHover = false; updateHover(null);
    };
    const onLeave = () => { pointer = null; needsHover = false; updateHover(null); };
    const onCancel = () => { down = null; dragged = true; onLeave(); };
    const onControlsChange = () => {
      dirty = true;
      if (pointer && !down) needsHover = true;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointercancel', onCancel);
    controls.addEventListener('change', onControlsChange);

    // 点阵首屏转身用缓动，石膏视图保持原来的瞬时切换
    let turn: { from: number; to: number; cam: THREE.Vector3; start: number } | null = null;
    api.current = {
      refresh,
      anchor: syncAnchor,
      setSide: (view) => {
        const to = view === 'front' ? -Math.PI/2 : Math.PI/2;
        const distance = camera.position.distanceTo(controls.target);
        if (halftone && subject) {
          const azimuth = Math.atan2(camera.position.x, camera.position.z);
          turn = { from: subject.rotation.y - azimuth, to, cam: new THREE.Vector3(0, .02, distance), start: performance.now() };
          subject.rotation.y = turn.from;
          camera.position.set(0, .02, distance); controls.target.set(0, 0, 0); controls.update();
        } else {
          if (subject) subject.rotation.y = to;
          // Reset orbit azimuth too, so front/back buttons work after manual rotation.
          camera.position.set(0, .02, distance); controls.target.set(0, 0, 0); controls.update();
        }
        dirty = true;
        onLeave();
      },
    };
    void loadPreparedSculpture(variant).then((prepared) => {
      if (disposed) return;
      const inner = new THREE.Group();
      inner.position.copy(prepared.centerOffset).negate();
      for (const entry of prepared.meshes) {
        const mesh = new THREE.Mesh(entry.geometry, material);
        mesh.position.copy(entry.position);
        mesh.quaternion.copy(entry.quaternion);
        mesh.scale.copy(entry.scale);
        enableFastSculptureRaycast(mesh);
        inner.add(mesh);
      }
      subject = new THREE.Group();
      subject.add(inner);
      subject.scale.setScalar(prepared.groupScale);
      subject.rotation.y = latest.current.side === 'front' ? -Math.PI / 2 : Math.PI / 2;
      scene.add(subject);
      refresh();
      syncAnchor();
      setStatus('ready');
    }).catch((error: Error) => {
      if (disposed || error.name === 'AbortError') return;
      console.error('Sculpture labels:', error);
      setStatus('error');
    });

    const resize = () => {
      const w = host.clientWidth || 360, h = host.clientHeight || 620;
      camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
      if (post) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        post.target.setSize(size.x, size.y);
        post.material.uniforms.uRes.value.copy(size);
      }
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(host);
    let raf = 0, lastHover = 0, lastFrame = 0;
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (subject && latest.current.spin && !down) {
        subject.rotation.y += Math.min(time-lastFrame, 50)*.00024;
        dirty = true;
        if (pointer) needsHover = true;
      }
      lastFrame = time;
      if (turn && subject) {
        const t = Math.min(1, (time - turn.start) / 720);
        const e = 1 - Math.pow(1 - t, 3);
        let delta = turn.to - turn.from;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        subject.rotation.y = turn.from + delta * e;
        dirty = true;
        if (t >= 1) turn = null;
      }
      controls.update();
      if (needsHover && pointer && !down && time - lastHover > 32) {
        updateHover(pickAt(pointer.x, pointer.y)); needsHover = false; lastHover = time;
      }
      if (dirty) {
        if (post) {
          renderer.setRenderTarget(post.target);
          renderer.clear();
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(post.scene, post.camera);
        } else {
          renderer.render(scene, camera);
        }
        placeAnchor();
        dirty = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true; api.current = null;
      cancelAnimationFrame(raf); observer.disconnect();
      controls.removeEventListener('change', onControlsChange); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      // Do NOT dispose shared cached BufferGeometry instances on unmount; only dispose per-mount resources.
      subject = null;
      if (post) {
        post.target.dispose(); post.material.dispose();
        post.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
      }
      heat.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [heatPalette, variant]);

  return <div className={`sculpture-viewer${look === 'halftone' ? ' is-halftone' : ''}`} data-status={status} data-selected={canonicalMuscle(selected) ?? ''} data-hovered={hovered ?? ''}
    data-recorded={[...new Set(recorded.map(canonicalMuscle).filter(Boolean))].join(',')}>
    <div ref={mount} style={{ width: '100%', height: '100%' }} />
    {anchor && <div ref={anchorEl} className="sculpture-anchor" data-visible="0" aria-hidden="true">
      <i key={anchor.muscle} /><span>{anchor.label}</span>
    </div>}
    {status !== 'ready' && <div className="sculpture-status" role="status">{status === 'error' ? '人体暂时无法加载，请刷新重试' : '正在加载人体…'}</div>}
    {hovered && <span className="sculpture-hover" aria-live="polite">{sculptureGroup(hovered)?.label}</span>}
  </div>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, labelAtBarycentric, SCULPTURE_GROUPS, SCULPTURE_VARIANTS, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { labeledGeometry, validateLabelData } from '@/lib/sculpture-geometry';

const BY_BYTE = new Map(SCULPTURE_GROUPS.map((g) => [g.byteValue, g.id]));
const BYTE_OF = new Map(SCULPTURE_GROUPS.map((g) => [g.id, g.byteValue]));

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
  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 m = lit(px / uRes);
    float l = dot(m.rgb, vec3(0.299, 0.587, 0.114));
    float g = clamp((l - 0.5) * 1.18 + 0.5, 0.0, 1.0) * 0.91;
    vec4 col = vec4(vec3(g), 1.0) * (m.a * 0.66);
    vec2 c = (floor(px / uCell) + 0.5) * uCell;
    vec4 s = lit(c / uRes);
    if (s.a > 0.35) {
      float tone = max(0.0, (252.0 / 255.0 - s.r) / (128.0 / 255.0));
      float r = (0.46 + min(1.22, tone) * 1.78) * uCell / 5.0;
      float cov = 1.0 - smoothstep(r - uAA, r + uAA, length(px - c));
      float a = (0.4 + min(1.0, tone) * 0.6) * cov * s.a;
      float planned = smoothstep(0.19, 0.36, min(s.r, s.g) - s.b);
      vec3 dotColor = mix(vec3(20.0, 26.0, 20.0), vec3(229.0, 218.0, 25.0), planned) / 255.0;
      a = mix(a, cov * s.a, planned);
      col = vec4(dotColor * a, a) + col * (1.0 - a);
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
async function checkedFetch(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
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

export default function SculptureBody({ recorded = [], planned, selected = null, side = 'front', onPick, spin = false, variant = 'male', heatLevels, heatTint, heatPalette, look = 'sculpture', anchor = null }: {
  planned?: readonly MuscleId[];
  recorded?: MuscleId[];
  selected?: MuscleId | null;
  side?: 'front' | 'back';
  onPick?: (id: MuscleId) => void;
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
  const latest = useRef({ recorded, planned, selected, side, onPick, spin, heatLevels, heatTint, anchor });
  latest.current = { recorded, planned, selected, side, onPick, spin, heatLevels, heatTint, anchor };
  const api = useRef<{ refresh: () => void; setSide: (side: 'front' | 'back') => void; anchor: () => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  useEffect(() => { api.current?.refresh(); }, [recorded, planned, selected, heatLevels, heatTint]);
  useEffect(() => { api.current?.setSide(side); }, [side]);
  useEffect(() => { api.current?.anchor(); }, [anchor?.muscle]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    const abort = new AbortController();
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
    const DEFAULT_TINT = halftone ? '#8c8d88' : palette?.heat ?? '#D9503C';
    const HOVER = halftone ? '#b3b4af' : palette?.hover ?? '#b6b7b1';
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
        heatData[i + 2] = latest.current.planned?.includes(g.id) && !active.has(g.id) ? 255 : 0;
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
    material.customProgramCacheKey = () => halftone ? 'sculpture-halftone-v1' : `sculpture-ortho-feather-v2-${rimOnHover ? 'rim' : 'plain'}`;
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
          vec3 state = texture2D(uMuscleHeat, vec2((id+0.5)/32.0, 0.5)).rgb;
          float feather = smoothstep(0.0, 1.0, vMuscleEdge);
          vec3 tint = state.r > 0.0 ? uMuscleGreen : uMuscleHover;
          float intensity = state.r > 0.0 ? state.r : state.g;
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, intensity * feather);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.59, 0.006), state.b);
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
      subject.updateMatrixWorld(true);
      const sum = new THREE.Vector3(), nsum = new THREE.Vector3(), tmp = new THREE.Vector3(), ntmp = new THREE.Vector3();
      let count = 0;
      subject.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const pos = obj.geometry.getAttribute('position'), ids = obj.geometry.getAttribute('muscleIds'), nor = obj.geometry.getAttribute('normal');
        if (!pos || !ids) return;
        for (let i = 0; i < pos.count; i += 3) {
          if (Math.round(ids.getX(i)) !== byte) continue;
          tmp.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
          // 双侧肌群取观者右侧那一块，和参考图里胸部锚点的位置一致
          if (tmp.x < .015) continue;
          sum.add(tmp); count++;
          if (nor) nsum.add(ntmp.fromBufferAttribute(nor, i).transformDirection(obj.matrixWorld));
        }
      });
      if (!count) return null;
      sum.divideScalar(count);
      // 把重心吸附到相机看得见的表面上
      const dir = sum.clone().sub(camera.position).normalize();
      raycaster.set(camera.position, dir);
      const hit = raycaster.intersectObject(subject, true)[0];
      const p = hit ? hit.point : sum;
      const n = hit?.face && hit.object instanceof THREE.Mesh
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : nsum.lengthSq() ? nsum.normalize() : new THREE.Vector3(0, 0, 1);
      return { muscle, ...toSubject(p, n) };
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
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (down && Math.hypot(event.clientX-down.x, event.clientY-down.y) > 5) dragged = true;
      if (down) updateHover(null);
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
    void (async () => {
      const spec = SCULPTURE_VARIANTS[variant];
      const MODEL = spec.model;
      const LABELS = spec.labels;
      const META = spec.metadata;
      const version = META.binarySha256;
      const [modelBytes, labelBytes, metadata] = await Promise.all([
        checkedFetch(`${MODEL}?v=${META.modelSha256}`, abort.signal).then((r) => r.arrayBuffer()),
        checkedFetch(`${LABELS}.bin?v=${version}`, abort.signal).then((r) => r.arrayBuffer()),
        checkedFetch(`${LABELS}.json?v=${version}`, abort.signal).then((r) => r.json()),
      ]);
      const labels = new Uint8Array(labelBytes);
      validateLabelData(labels, metadata, META);
      await Promise.all([verifyHash(labelBytes, META.binarySha256), verifyHash(modelBytes, META.modelSha256)]);
      if (disposed) return;
      const gltf = await new GLTFLoader().parseAsync(modelBytes, '/models/sculpture/');
      if (disposed) { disposeSubject(gltf.scene); return; }
      try {
        gltf.scene.updateMatrixWorld(true);
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
        if (meshes.length !== META.meshOrder.length) throw new Error('模型网格顺序不匹配');
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const height = box.max.y-box.min.y;
        for (let i = 0; i < meshes.length; i++) {
          const mesh = meshes[i], entry = META.meshOrder[i];
          if (mesh.geometry.getAttribute('position').count !== entry.vertexCount) throw new Error('模型顶点数量不匹配');
          const geometry = labeledGeometry(mesh, labels.subarray(entry.vertexOffset, entry.vertexOffset+entry.vertexCount), height);
          mesh.geometry.dispose();
          for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) disposeMaterial(old);
          mesh.geometry = geometry; mesh.material = material;
        }
        gltf.scene.position.sub(box.getCenter(new THREE.Vector3()));
        subject = new THREE.Group(); subject.add(gltf.scene);
        subject.scale.setScalar(2.05/height);
        subject.rotation.y = latest.current.side === 'front' ? -Math.PI/2 : Math.PI/2;
        scene.add(subject); refresh(); syncAnchor(); setStatus('ready');
      } catch (error) { disposeSubject(gltf.scene); throw error; }
    })().catch((error: Error) => {
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
      if (needsHover && pointer && !down && time-lastHover > 70) {
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
      disposed = true; abort.abort(); api.current = null;
      cancelAnimationFrame(raf); observer.disconnect();
      controls.removeEventListener('change', onControlsChange); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      if (subject) disposeSubject(subject);
      if (post) {
        post.target.dispose(); post.material.dispose();
        post.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
      }
      heat.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [heatPalette]);

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

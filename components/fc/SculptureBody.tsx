'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, labelAtBarycentric, SCULPTURE_GROUPS, SCULPTURE_VARIANTS, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { labeledGeometry, validateLabelData } from '@/lib/sculpture-geometry';

const BY_BYTE = new Map(SCULPTURE_GROUPS.map((g) => [g.byteValue, g.id]));

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

export default function SculptureBody({ recorded = [], selected = null, side = 'front', onPick, spin = false, variant = 'male' }: {
  recorded?: MuscleId[];
  selected?: MuscleId | null;
  side?: 'front' | 'back';
  onPick?: (id: MuscleId) => void;
  spin?: boolean;
  variant?: SculptureVariant;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef({ recorded, selected, side, onPick, spin });
  latest.current = { recorded, selected, side, onPick, spin };
  const api = useRef<{ refresh: () => void; setSide: (side: 'front' | 'back') => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  useEffect(() => { api.current?.refresh(); }, [recorded, selected]);
  useEffect(() => { api.current?.setSide(side); }, [side]);

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
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    renderer.domElement.setAttribute('aria-label', '3D 肌群模型，可拖动旋转、点击肌群');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, .01, 100);
    camera.position.set(0, .02, 4.3);
    scene.add(new THREE.HemisphereLight(0xfffaf4, 0xc9beb2, 1.1));
    const key = new THREE.DirectionalLight(0xfff7ed, 2.4);
    key.position.set(-3, 4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.0);
    fill.position.set(3, 2, -4); scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = .08;
    controls.minDistance = 2; controls.maxDistance = 8;
    controls.target.set(0, 0, 0); controls.update();

    const heatData = new Uint8Array(32 * 4);
    const heat = new THREE.DataTexture(heatData, 32, 1, THREE.RGBAFormat);
    heat.magFilter = heat.minFilter = THREE.NearestFilter;
    heat.generateMipmaps = false;
    let hover: MuscleId | null = null;
    let subject: THREE.Group | null = null;
    let dirty = true;
    const refresh = () => {
      const active = new Set(latest.current.recorded.map(canonicalMuscle));
      const selectedId = canonicalMuscle(latest.current.selected);
      heatData.fill(0);
      for (const g of SCULPTURE_GROUPS) {
        const i = g.byteValue * 4;
        heatData[i] = selectedId === g.id || active.has(g.id) ? 255 : 0;
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
    const material = new THREE.MeshStandardMaterial({ color: 0xf3ede4, roughness: .88, metalness: 0, side: THREE.DoubleSide });
    material.customProgramCacheKey = () => 'sculpture-ortho-feather-v1';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMuscleHeat = { value: heat };
      shader.uniforms.uMuscleGreen = { value: new THREE.Color('#2F6A45') };
      shader.uniforms.uMuscleHover = { value: new THREE.Color('#8FAE94') };
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
          vec3 tint = state.r > 0.5 ? uMuscleGreen : uMuscleHover;
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, max(state.r, state.g)*feather);
        }
      `);
    };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), bary = new THREE.Vector3();
    const pickAt = (x: number, y: number): MuscleId | null => {
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
      const id = labelAtBarycentric([ids.getX(v), ids.getY(v), ids.getZ(v)], [bary.x, bary.y, bary.z]);
      return BY_BYTE.get(id) ?? null;
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
        const id = pickAt(event.clientX, event.clientY);
        if (id) latest.current.onPick?.(id);
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

    api.current = {
      refresh,
      setSide: (view) => {
        if (subject) subject.rotation.y = view === 'front' ? -Math.PI/2 : Math.PI/2;
        dirty = true;
        // Reset orbit azimuth too, so front/back buttons work after manual rotation.
        const distance = camera.position.distanceTo(controls.target);
        camera.position.set(0, .02, distance); controls.target.set(0, 0, 0); controls.update();
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
        scene.add(subject); refresh(); setStatus('ready');
      } catch (error) { disposeSubject(gltf.scene); throw error; }
    })().catch((error: Error) => {
      if (disposed || error.name === 'AbortError') return;
      console.error('Sculpture labels:', error);
      setStatus('error');
    });

    const resize = () => {
      const w = host.clientWidth || 360, h = host.clientHeight || 620;
      camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
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
      controls.update();
      if (needsHover && pointer && !down && time-lastHover > 70) {
        updateHover(pickAt(pointer.x, pointer.y)); needsHover = false; lastHover = time;
      }
      if (dirty) {
        renderer.render(scene, camera);
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
      heat.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div className="sculpture-viewer" data-status={status} data-selected={canonicalMuscle(selected) ?? ''} data-hovered={hovered ?? ''}
    data-recorded={[...new Set(recorded.map(canonicalMuscle).filter(Boolean))].join(',')}>
    <div ref={mount} style={{ width: '100%', height: '100%' }} />
    {status !== 'ready' && <div className="sculpture-status" role="status">{status === 'error' ? '人体暂时无法加载，请刷新重试' : '正在加载人体…'}</div>}
    {hovered && <span className="sculpture-hover" aria-live="polite">{sculptureGroup(hovered)?.label}</span>}
  </div>;
}

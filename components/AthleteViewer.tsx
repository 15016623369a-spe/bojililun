'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import regions from '@/lib/athlete-regions.json';

const byId = new Map(regions.map((region) => [region.id, region]));
type Sex = 'male' | 'female';
type ViewerProps = { planModel?: Sex; selected: string | null; highlighted?: string[]; onPick: (id: string) => void };
type Surface = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
// Every vertex stores fixed material weights. Orbiting moves the camera only.
function applyPorcelainAtlas(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 _atlasweights;
      attribute vec2 uv1;
      attribute vec2 uv2;
      varying vec2 rearUv;
      varying vec2 profileUv;
      varying vec3 atlasWeights;`).replace('#include <uv_vertex>', `#include <uv_vertex>
      rearUv = uv1;
      profileUv = uv2;
      atlasWeights = _atlasweights;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 rearUv;
      varying vec2 profileUv;
      varying vec3 atlasWeights;`).replace('#include <map_fragment>', `
      diffuseColor.rgb *= texture2D(map, vMapUv).rgb * atlasWeights.x
                        + texture2D(map, rearUv).rgb * atlasWeights.y
                        + texture2D(map, profileUv).rgb * atlasWeights.z;`);
  };
}
function disposeModel(group: THREE.Object3D) {
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

export default function AthleteViewer(props: ViewerProps) {
  const mount = useRef<HTMLDivElement>(null);
  const actions = useRef<{ rotate: (value: boolean) => void; paint: () => void } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [reviewSex, setSex] = useState<Sex>('male');
  const sex = props.planModel ?? reviewSex;
  const plan = props.planModel !== undefined;
  const marker = useRef<HTMLButtonElement>(null);
  const [rotating, setRotating] = useState(false);
  const [status, setStatus] = useState('加载人体模型…');
  const [hover, setHover] = useState('');

  useEffect(() => {
    const parent = mount.current;
    if (!parent) return;
    setStatus('加载人体模型…');
    setRotating(false);
    setHover('');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setStatus('无法显示 3D 模型，可通过视图菜单按部位选择。');
      return;
    }
    const canvas = renderer.domElement;
    parent.appendChild(canvas);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = plan ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    if (plan) {
      // The porcelain atlas already contains the studio lighting.
      scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
    } else {
      scene.add(new THREE.HemisphereLight(0xfff8ea, 0xa99f90, 1.35));
      const sun = new THREE.DirectionalLight(0xfff3df, 2.3);
      sun.position.set(-3, 4, 4);
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0xfff7ed, 1.4);
      rim.position.set(3, 2, -2);
      scene.add(rim);
    }
    const camera = plan ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 30)
      : new THREE.PerspectiveCamera(30, 1, 0.01, 30);
    const modelSize = new THREE.Vector3(1, 1.8, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotateSpeed = 0.8;
    controls.addEventListener('start', () => { controls.autoRotate = false; setRotating(false); });
    let showShoulder = plan;
    let shoulder: Surface | undefined;
    let demoSide: string | undefined;
    const anchor = new THREE.Vector3();
    const projected = new THREE.Vector3();
    function dismissMarker() {
      showShoulder = false;
      if (marker.current) marker.current.hidden = true;
      paint();
    }
    controls.addEventListener('start', dismissMarker);
    function resize() {
      if (!parent) return;
      const { clientWidth: w, clientHeight: h } = parent;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      if (camera instanceof THREE.OrthographicCamera) {
        const halfHeight = 0.53 * Math.max(modelSize.y, modelSize.x * h / w);
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.right = halfHeight * w / h;
        camera.left = -camera.right;
      } else camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    let disposed = false;
    const models = new THREE.Group();
    scene.add(models);
    const selectable: Surface[] = [];
    const bases = new Map<Surface, THREE.Color>();
    let hovered: string | undefined;
    const normalGreen = new THREE.Color(plan ? 0x91a27c : 0x45866b);
    const hoverGreen = new THREE.Color(0x9cb9a1);
    function paint() {
      for (const mesh of selectable) {
        const id: string = mesh.userData.muscle_id;
        const region = byId.get(id);
        const active = id === latest.current.selected || latest.current.highlighted?.includes(region?.group ?? '');
        const demo = showShoulder && shoulder && mesh.userData.side === demoSide && id.startsWith('deltoid_');
        mesh.material.color.copy(active || demo ? normalGreen : id === hovered ? hoverGreen : bases.get(mesh)!);
      }
    }
    function loadModel(group: THREE.Group) {
      if (disposed) { disposeModel(group); return; }
      models.add(group);
      group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const mesh = node as Surface;
        // glTF nodes can share a material. Each selectable surface needs its own highlight.
        if (byId.has(mesh.userData.muscle_id)) mesh.material = mesh.material.clone();
        if (plan) applyPorcelainAtlas(mesh.material);
        if (!byId.has(mesh.userData.muscle_id)) return;
        bases.set(mesh, mesh.material.color.clone());
        selectable.push(mesh);
      });
      if (plan) {
        group.updateMatrixWorld(true);
        let rightmost = -Infinity;
        for (const mesh of selectable) {
          if (mesh.userData.muscle_id !== 'deltoid_anterior') continue;
          const bounds = new THREE.Box3().setFromObject(mesh);
          const point = bounds.getCenter(new THREE.Vector3());
          if (point.x <= rightmost) continue;
          rightmost = point.x;
          point.z = bounds.max.z;
          shoulder = mesh;
          demoSide = mesh.userData.side;
          anchor.copy(point);
        }
      }
      paint();
    }
    const loader = new GLTFLoader();
    const asset = plan ? `/models/porcelain/${sex}-fixed.glb` : `/models/athletes/${sex}/FitCheck-Muscles.glb`;
    loader.loadAsync(asset).then(({scene: model}) => {
      loadModel(model);
      if (disposed) return;
      const box = new THREE.Box3().setFromObject(model);
      box.getSize(modelSize);
      resize();
      const center = box.getCenter(new THREE.Vector3());
      const distance = camera instanceof THREE.PerspectiveCamera
        ? Math.max(modelSize.y, modelSize.x / camera.aspect) * 0.57 / Math.tan(Math.PI / 12)
        : modelSize.y * 2;
      controls.minZoom = 0.5;
      controls.maxZoom = 2.6;
      controls.target.copy(center);
      camera.position.copy(center);
      camera.position.z += latest.current.highlighted ? -distance : distance;
      controls.minDistance = distance * 0.38;
      controls.maxDistance = distance * 2;
      controls.update();
      setStatus('');
    }).catch(() => { if (!disposed) setStatus('人体模型加载失败，可切换体型重试或通过视图菜单按部位选择。'); });
    actions.current = {
      rotate(value) { controls.autoRotate = value; setRotating(value); },
      paint,
    };
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    function pick(event: PointerEvent): string | undefined {
      const r = canvas.getBoundingClientRect();
      pointer.set(2 * (event.clientX - r.left) / r.width - 1, 1 - 2 * (event.clientY - r.top) / r.height);
      ray.setFromCamera(pointer, camera);
      // Include the blank body and portrait so clicks cannot select a muscle on the far side.
      return ray.intersectObjects(models.children, true)[0]?.object.userData.muscle_id;
    }
    let start: {x: number; y: number} | null = null;
    let dragged = false;
    canvas.onpointerdown = (event) => {
      if (!event.isPrimary) { dragged = true; return; }
      start = { x: event.clientX, y: event.clientY }; dragged = false;
    };
    canvas.onpointermove = (event) => {
      if (start) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) dragged = true;
        return;
      }
      if (event.pointerType !== 'mouse') return;
      const id = pick(event);
      if (id === hovered) return;
      hovered = id;
      setHover(byId.get(id ?? '')?.label ?? '');
      canvas.style.cursor = id ? 'pointer' : 'grab';
      paint();
    };
    canvas.onpointerup = (event) => {
      if (start && !dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7) {
        const id = pick(event);
        if (id) latest.current.onPick(id);
      }
      start = null;
    };
    canvas.onpointercancel = () => { start = null; };
    canvas.onpointerleave = () => { hovered = undefined; setHover(''); paint(); };
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      if (marker.current && shoulder && showShoulder) {
        projected.copy(anchor).project(camera);
        marker.current.style.left = ((projected.x + 1) * 50) + '%';
        marker.current.style.top = ((1 - projected.y) * 50) + '%';
        marker.current.hidden = false;
      }
    });
    return () => {
      if (marker.current) marker.current.hidden = true;
      disposed = true; actions.current = null;
      observer.disconnect(); controls.dispose(); renderer.setAnimationLoop(null);
      disposeModel(models); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, [sex, plan]);
  useEffect(() => { actions.current?.paint(); }, [props.selected, props.highlighted]);

  return <div className="body-canvas">
    <div ref={mount} className="athlete-stage" />
    {plan && <button type="button" ref={marker} hidden className="shoulder-guide" aria-label="查看肩部动作" onClick={() => props.onPick('deltoid_anterior')}><span>肩部</span></button>}
    {!plan && <><div className="body-hint">{hover || '拖动旋转 · 点肌肉看动作'}</div>
    <button type="button" className="body-rotate" aria-pressed={rotating} disabled={!!status} onClick={() => actions.current?.rotate(!rotating)}>{rotating ? '暂停旋转' : '自动旋转'}</button>
    <div className="athlete-switch" aria-label="模型设置">
      {(['male', 'female'] as const).map((id) => <button type="button" key={id} aria-pressed={sex === id} onClick={() => setSex(id)}>{id === 'male' ? '男款' : '女款'}</button>)}
    </div>
    </>}
    {status && <div className="body-loading" role="status">{status}</div>}
  </div>;
}

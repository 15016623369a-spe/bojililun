'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import regions from '@/lib/athlete-regions.json';

const byId = new Map(regions.map((region) => [region.id, region]));
type Sex = 'male' | 'female';
type ViewerProps = { selected: string | null; highlighted?: string[]; onPick: (id: string) => void };
type Surface = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
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
  const [sex, setSex] = useState<Sex>('male');
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
      setStatus('无法显示 3D 模型，可在下方按部位选择。');
      return;
    }
    const canvas = renderer.domElement;
    parent.appendChild(canvas);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff8ea, 0xa99f90, 1.35));
    const sun = new THREE.DirectionalLight(0xfff3df, 2.3);
    sun.position.set(-3, 4, 4);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xfff7ed, 1.4);
    rim.position.set(3, 2, -2);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 30);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotateSpeed = 0.8;
    controls.addEventListener('start', () => { controls.autoRotate = false; setRotating(false); });
    function resize() {
      if (!parent) return;
      const { clientWidth: w, clientHeight: h } = parent;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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
    const normalGreen = new THREE.Color(0x45866b);
    const hoverGreen = new THREE.Color(0x9cb9a1);
    function paint() {
      for (const mesh of selectable) {
        const id: string = mesh.userData.muscle_id;
        const region = byId.get(id);
        const active = id === latest.current.selected || latest.current.highlighted?.includes(region?.group ?? '');
        mesh.material.color.copy(active ? normalGreen : id === hovered ? hoverGreen : bases.get(mesh)!);
      }
    }
    function loadModel(group: THREE.Group) {
      if (disposed) { disposeModel(group); return; }
      models.add(group);
      group.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !byId.has(node.userData.muscle_id)) return;
        const mesh = node as Surface;
        // glTF nodes can share a material. Each selectable surface needs its own highlight.
        mesh.material = mesh.material.clone();
        bases.set(mesh, mesh.material.color.clone());
        selectable.push(mesh);
      });
      paint();
    }
    const loader = new GLTFLoader();
    const base = '/models/athletes/' + sex + '/';
    loader.loadAsync(base + 'FitCheck-Muscles.glb').then(({scene: model}) => {
      loadModel(model);
      if (disposed) return;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const distance = Math.max(size.y, size.x / camera.aspect) * 0.57 / Math.tan(Math.PI / 12);
      controls.target.copy(center);
      camera.position.copy(center);
      camera.position.z += latest.current.highlighted ? -distance : distance;
      controls.minDistance = distance * 0.38;
      controls.maxDistance = distance * 2;
      controls.update();
      setStatus('');
    }).catch(() => { if (!disposed) setStatus('人体模型加载失败，可切换体型重试或在下方按部位选择。'); });
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
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => {
      disposed = true; actions.current = null;
      observer.disconnect(); controls.dispose(); renderer.setAnimationLoop(null);
      disposeModel(models); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, [sex]);
  useEffect(() => { actions.current?.paint(); }, [props.selected, props.highlighted]);

  return <div className="body-canvas">
    <div ref={mount} className="athlete-stage" />
    <div className="body-hint">{hover || '拖动旋转 · 点肌肉看动作'}</div>
    <button type="button" className="body-rotate" aria-pressed={rotating} disabled={!!status} onClick={() => actions.current?.rotate(!rotating)}>{rotating ? '暂停旋转' : '自动旋转'}</button>
    <div className="athlete-switch" aria-label="模型设置">
      {(['male', 'female'] as const).map((id) => <button type="button" key={id} aria-pressed={sex === id} onClick={() => setSex(id)}>{id === 'male' ? '男款' : '女款'}</button>)}
    </div>
    {status && <div className="body-loading" role="status">{status}</div>}
  </div>;
}

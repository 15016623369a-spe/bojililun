'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { muscleById, type MuscleId } from '@/lib/muscles';
import ExerciseSheet from '@/components/fc/ExerciseSheet';
import type { HeatItem } from '@/components/fc/MuscleDict';

function muscleAt(x: number, y: number, z: number, front: boolean): MuscleId | null {
  const side = Math.abs(x);
  const h = y;
  if (h > 0.86) return 'neck';
  if (h < 0.075) return 'calves';
  if (h < 0.29) return front ? 'quads' : 'calves';
  if (h < 0.43) return front ? (side < 0.16 ? 'adductors' : 'quads') : (side < 0.16 ? 'glutes' : 'hamstrings');
  if (side > 0.29 && h < 0.72) return h > 0.58 ? (front ? 'biceps' : 'triceps') : 'forearms';
  if (front) {
    if (h > 0.72) return side > 0.2 ? 'delt_front' : 'chest_upper';
    if (h > 0.62) return side > 0.22 ? 'delt_side' : 'chest_mid';
    if (h > 0.51) return side > 0.19 ? 'obliques' : 'abs';
    return side > 0.2 ? 'serratus' : 'abs';
  }
  if (h > 0.74) return side > 0.2 ? 'delt_rear' : 'traps';
  if (h > 0.62) return side > 0.22 ? 'lats' : 'upperback';
  if (h > 0.49) return side > 0.2 ? 'lats' : 'lowerback';
  return side > 0.16 ? 'glutes' : 'lowerback';
}

export default function SculptureAtlas({ heat: _heat }: { heat: HeatItem[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [error, setError] = useState('');
  const [back, setBack] = useState(false);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError('当前浏览器不支持 WebGL');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.01, 100);
    scene.add(new THREE.HemisphereLight(0xfffaf4, 0xc9beb2, 1.1));
    const key = new THREE.DirectionalLight(0xfff7ed, 2.4);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.0);
    fill.position.set(3, 2, -4);
    scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 8;

    let subject: THREE.Group | null = null;
    let disposed = false;
    let raf = 0;
    new GLTFLoader().load('/models/sculpture/fitcheck-sculpture-tripo-v1.glb', (gltf) => {
      if (disposed) return;
      subject = gltf.scene;
      subject.rotation.y = back ? Math.PI : 0;
      const box = new THREE.Box3().setFromObject(subject);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      subject.position.sub(center);
      subject.scale.setScalar(2.45 / size.y);
      subject.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.material = new THREE.MeshStandardMaterial({
          color: 0xf3ede4,
          roughness: 0.88,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        obj.castShadow = true;
      });
      scene.add(subject);
      camera.position.set(0, 0.02, 4.25);
      controls.target.set(0, 0, 0);
      controls.update();
    }, undefined, () => setError('新雕塑模型加载失败'));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (event: PointerEvent) => {
      if (!subject) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(subject, true)[0];
      if (!hit) return;
      const p = subject.worldToLocal(hit.point.clone());
      const box = new THREE.Box3().setFromObject(subject);
      const y = (p.y - box.min.y) / Math.max(0.001, box.max.y - box.min.y);
      const id = muscleAt(p.x, y, p.z, Math.cos(subject.rotation.y) > 0);
      if (id && muscleById(id)) setSelected(id);
    };
    renderer.domElement.addEventListener('click', onClick);
    const resize = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    resize.observe(mount);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (subject && spinning) subject.rotation.y += 0.003;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [back, spinning]);

  return <>
    <div className="fc-dict-body" ref={mountRef}>
      <div className="fc-dict-tabs">
        <button type="button" className={!back ? 'on' : ''} onClick={() => { setBack(false); }}>正面</button>
        <button type="button" className={back ? 'on' : ''} onClick={() => { setBack(true); }}>背面</button>
        <button type="button" className={spinning ? 'on' : ''} onClick={() => setSpinning((v) => !v)}>自转</button>
      </div>
      {error && <div className="fc-loading">{error}</div>}
    </div>
    <p className="fc-dict-hintline">拖动旋转 · 点击肌肉查看对应训练动作</p>
    <ExerciseSheet muscle={selected} onClose={() => setSelected(null)} />
  </>;
}

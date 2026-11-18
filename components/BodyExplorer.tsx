'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import AddToPlanButton from './AddToPlanButton';

interface ExerciseLite {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
}

interface ApiResult {
  counts: Record<string, number>;
  label?: string;
  total?: number;
  items: ExerciseLite[];
}

const MUSCLE_COLOR = 0x9c4a41;
const SELECT_COLOR = 0x35d3a0;

function capsule(radius: number, length: number) {
  return new THREE.CapsuleGeometry(radius, length, 6, 16);
}

function sphere(radius: number) {
  return new THREE.SphereGeometry(radius, 24, 18);
}

function makeMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rot?: [number, number, number],
  scale?: [number, number, number],
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

export default function BodyExplorer() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    muscles: Map<MuscleId, THREE.MeshStandardMaterial[]>;
  } | null>(null);

  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<ApiResult | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const selectedRef = useRef<MuscleId | null>(null);
  selectedRef.current = selected;

  /* ------------------------------ three.js ------------------------------ */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }

    const width = mount.clientWidth || 360;
    const height = mount.clientHeight || 460;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 1.12, 3.12);

    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x1a2230, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.5, 4, 3.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ea8ff, 0.9);
    rim.position.set(-3, 2, -2.5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd7c2, 0.35);
    fill.position.set(0, -2, 3);
    scene.add(fill);

    /* ---- 建模 ---- */
    const root = new THREE.Group();
    scene.add(root);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x27303f, roughness: 0.92, metalness: 0.06 });
    const muscles = new Map<MuscleId, THREE.MeshStandardMaterial[]>();

    const addBase = (
      geo: THREE.BufferGeometry,
      pos: [number, number, number],
      rot?: [number, number, number],
      scale?: [number, number, number],
    ) => {
      const m = makeMesh(geo, bodyMat, pos, rot, scale);
      root.add(m);
      return m;
    };

    const addMuscle = (
      id: MuscleId,
      geo: THREE.BufferGeometry,
      pos: [number, number, number],
      rot?: [number, number, number],
      scale?: [number, number, number],
      parent: THREE.Object3D = root,
    ) => {
      const mat = new THREE.MeshStandardMaterial({
        color: MUSCLE_COLOR,
        roughness: 0.55,
        metalness: 0.12,
        emissive: 0x000000,
      });
      const m = makeMesh(geo, mat, pos, rot, scale);
      m.userData.muscle = id;
      parent.add(m);
      const arr = muscles.get(id) ?? [];
      arr.push(mat);
      muscles.set(id, arr);
      return m;
    };

    // 基础身体
    addBase(sphere(0.115), [0, 1.60, 0], [0.06, 0, 0], [1, 1.1, 1]); // 头
    addBase(new THREE.CylinderGeometry(0.052, 0.062, 0.12, 16), [0, 1.475, 0]); // 颈
    addBase(capsule(0.14, 0.30), [0, 1.18, 0], undefined, [1.26, 1, 0.72]); // 躯干
    addBase(capsule(0.13, 0.06), [0, 0.86, 0], undefined, [1.3, 1, 0.78]); // 骨盆

    // 四肢
    for (const sign of [-1, 1] as const) {
      addBase(capsule(0.075, 0.26), [sign * 0.085, 0.68, 0]); // 大腿
      addBase(capsule(0.055, 0.28), [sign * 0.085, 0.28, 0]); // 小腿
      addBase(new THREE.BoxGeometry(0.09, 0.055, 0.20), [sign * 0.085, 0.045, 0.05]); // 脚

      const arm = new THREE.Group();
      arm.position.set(sign * 0.205, 1.375, 0);
      arm.rotation.z = sign * -0.16;
      root.add(arm);
      arm.add(makeMesh(capsule(0.05, 0.24), bodyMat, [0, -0.19, 0])); // 上臂
      arm.add(makeMesh(capsule(0.034, 0.24), bodyMat, [0, -0.55, 0])); // 前臂

      addMuscle('biceps', capsule(0.046, 0.14), [0, -0.17, 0.042], undefined, undefined, arm);
      addMuscle('triceps', capsule(0.043, 0.16), [0, -0.19, -0.044], undefined, undefined, arm);
      addMuscle('forearms', capsule(0.056, 0.17), [0, -0.55, 0.018], undefined, undefined, arm);

      // 侧面肌肉
      addMuscle('delts', sphere(0.075), [sign * 0.192, 1.375, 0], undefined, [1.05, 0.85, 0.95]);
      addMuscle('traps', capsule(0.028, 0.085), [sign * 0.072, 1.398, -0.052], [0, 0, sign * -0.5]);
      addMuscle('quads', capsule(0.048, 0.18), [sign * 0.088, 0.68, 0.048]);
      addMuscle('hamstrings', capsule(0.045, 0.17), [sign * 0.088, 0.69, -0.048]);
      addMuscle('calves', capsule(0.038, 0.15), [sign * 0.085, 0.33, -0.042]);
      addMuscle('glutes', sphere(0.082), [sign * 0.075, 0.88, -0.072], undefined, [1, 0.92, 0.7]);
      addMuscle('lats', sphere(0.075), [sign * 0.10, 1.17, -0.088], undefined, [1, 1.45, 0.42]);
    }

    // 正面/背面
    addMuscle('chest', sphere(0.075), [0.085, 1.30, 0.092], undefined, [1.25, 0.95, 0.45]);
    addMuscle('chest', sphere(0.075), [-0.085, 1.30, 0.092], undefined, [1.25, 0.95, 0.45]);
    for (let row = 0; row < 3; row++) {
      for (const sign of [-1, 1] as const) {
        addMuscle('abs', new THREE.BoxGeometry(0.052, 0.04, 0.026), [sign * 0.032, 1.23 - row * 0.055, 0.098]);
      }
    }
    addMuscle('upperback', sphere(0.085), [0, 1.31, -0.092], undefined, [1.45, 0.8, 0.4]);
    addMuscle('lowerback', sphere(0.07), [0, 1.02, -0.095], undefined, [1.35, 0.85, 0.4]);
    addMuscle('neck', new THREE.CylinderGeometry(0.056, 0.06, 0.11, 16), [0, 1.475, 0]);

    /* ---- 交互 ---- */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.9;
    controls.maxDistance = 4.2;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.9;
    controls.addEventListener('start', () => setAutoRotate(false));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clickable: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.muscle) clickable.push(o);
    });

    function pick(e: PointerEvent): MuscleId | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickable, false);
      return hits.length ? ((hits[0].object.userData.muscle as MuscleId) ?? null) : null;
    }

    let downAt: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      const quick = Date.now() - downAt.t < 600;
      downAt = null;
      if (moved > 8 || !quick) return;
      const id = pick(e);
      if (id) setSelected(id);
    };
    const onMove = (e: PointerEvent) => {
      if (downAt) return;
      const id = pick(e);
      setHovered(id);
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    /* ---- resize ---- */
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    /* ---- 渲染循环 ---- */
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    apiRef.current = { controls, renderer, muscles };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  /* ------------------------------ 高亮同步 ------------------------------ */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const [id, mats] of api.muscles) {
      const isSel = id === selected;
      const isHover = id === hovered && !isSel;
      for (const m of mats) {
        m.color.setHex(isSel ? SELECT_COLOR : MUSCLE_COLOR);
        m.emissive.setHex(isSel ? 0x0d3b2b : isHover ? 0x24423a : 0x000000);
      }
    }
  }, [selected, hovered, failed]);

  /* ------------------------------ 各肌肉动作数 ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/exercises?limit=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ApiResult) => {
        if (!cancelled && d.counts) setCounts(d.counts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------ 取动作 ------------------------------ */
  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/exercises?muscle=${selected}&limit=40`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ApiResult) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ counts: {}, items: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const toggleRotate = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.controls.autoRotate = !api.controls.autoRotate;
    setAutoRotate(api.controls.autoRotate);
  }, []);

  const label = selected ? MUSCLES.find((m) => m.id === selected)?.label : null;

  return (
    <>
      <div className="body-explorer">
        <div className="body-canvas" ref={mountRef}>
          {failed ? (
            <div className="body-fallback">
              <p>当前浏览器不支持 WebGL，3D 人体无法显示。</p>
              <p className="hint">下面仍然可以按肌肉挑选动作。</p>
            </div>
          ) : (
            <>
              <div className="body-hint">
                {label
                  ? `已选中 · ${label}`
                  : hovered
                    ? MUSCLES.find((m) => m.id === hovered)?.label
                    : '拖动旋转 · 点击肌肉'}
              </div>
              <button className="body-rotate" onClick={toggleRotate} type="button">
                {autoRotate ? '暂停旋转' : '自动旋转'}
              </button>
            </>
          )}
        </div>

        <div className="muscle-chips">
          {MUSCLES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`muscle-chip ${selected === m.id ? 'on' : ''} ${m.side}`}
              onClick={() => setSelected((cur) => (cur === m.id ? null : m.id))}
            >
              {m.label}
              <em>{counts[m.id] ?? ''}</em>
            </button>
          ))}
        </div>
        <p className="body-tip">正面 / 背面靠拖动旋转查看 · 点名字也能切换</p>
      </div>

      {selected && (
        <div className="ms-backdrop" onClick={() => setSelected(null)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-head">
              <div>
                <b>{label}</b>
                <span>{loading ? '加载中…' : `${data?.total ?? 0} 个动作`}</span>
              </div>
              <button className="ms-close" onClick={() => setSelected(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="ms-list">
              {(data?.items ?? []).map((x) => (
                <div className="ms-row" key={x.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(x.image)} alt={x.zh_name} loading="lazy" />
                  <div className="ms-info">
                    <b>{x.zh_name || x.name}</b>
                    <span>
                      {TARGET_LABEL[x.target] ?? x.target} · {EQUIPMENT_LABEL[x.equipment] ?? x.equipment}
                    </span>
                  </div>
                  <AddToPlanButton exerciseId={x.id} variant="mini" />
                </div>
              ))}
              {!loading && (data?.items?.length ?? 0) === 0 && <p className="hint">这个部位暂时没有动作数据。</p>}
            </div>
            <a className="ms-more" href={`/exercises?body=${muscleBodyPart(selected)}`}>
              去动作库看这个部位的全部动作 →
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function muscleBodyPart(id: MuscleId): string {
  const map: Record<MuscleId, string> = {
    chest: 'chest',
    abs: 'waist',
    delts: 'shoulders',
    biceps: 'upper arms',
    forearms: 'lower arms',
    quads: 'upper legs',
    traps: 'back',
    lats: 'back',
    upperback: 'back',
    lowerback: 'waist',
    triceps: 'upper arms',
    glutes: 'upper legs',
    hamstrings: 'upper legs',
    calves: 'lower legs',
    neck: 'neck',
  };
  return map[id] ?? 'chest';
}

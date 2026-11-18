'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MUSCLES, REGIONS, groupForMeshName, muscleById, type MuscleId } from '@/lib/muscles';
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
  label?: string | null;
  total?: number;
  items: ExerciseLite[];
}

interface SceneApi {
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  meshes: THREE.Mesh[];
  matBase: THREE.MeshStandardMaterial;
  matDim: THREE.MeshStandardMaterial;
  matHover: THREE.MeshStandardMaterial;
  matSel: THREE.MeshStandardMaterial;
}

export default function BodyAtlas() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<SceneApi | null>(null);

  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [data, setData] = useState<ApiResult | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  /* ------------------------------ three.js ------------------------------ */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed('当前浏览器不支持 WebGL');
      setLoading(false);
      return;
    }

    const width = mount.clientWidth || 360;
    const height = mount.clientHeight || 470;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 100);

    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x1a2230, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.5, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ea8ff, 1.4);
    rim.position.set(-3, 1.5, -3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd7c2, 0.6);
    fill.position.set(-1, -2, 3);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.75;
    controls.addEventListener('start', () => setAutoRotate(false));

    const matBase = new THREE.MeshStandardMaterial({ color: 0x9c4a41, roughness: 0.62, metalness: 0.06 });
    const matDim = new THREE.MeshStandardMaterial({ color: 0x6b3a34, roughness: 0.88, metalness: 0.03 });
    const matHover = new THREE.MeshStandardMaterial({
      color: 0xb86055,
      roughness: 0.45,
      metalness: 0.1,
      emissive: 0x2a0f0c,
    });
    const matSel = new THREE.MeshStandardMaterial({
      color: 0x35d3a0,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x0d3b2b,
      emissiveIntensity: 1.2,
    });

    const meshes: THREE.Mesh[] = [];

    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    let disposed = false;
    let raf = 0;

    loader.load(
      '/models/body.glb',
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;

        // 只保留肌肉，骨骼和其它结构隐藏
        root.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const ud = obj.userData as Record<string, unknown>;
          if (ud.type !== 'muscle') {
            obj.visible = false;
            return;
          }
          const nameDetail = String(ud.nameDetail ?? ud.name ?? '');
          const group = groupForMeshName(nameDetail);
          obj.userData.groupId = group?.id ?? null;
          obj.userData.label = group?.label ?? null;
          obj.material = group ? matBase : matDim;
          obj.castShadow = false;
          meshes.push(obj);
        });

        // 居中 + 适配相机
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const wrapper = new THREE.Group();
        root.position.sub(center);
        wrapper.add(root);
        scene.add(wrapper);

        const fitDist = (size.y / 2 / Math.tan(((camera.fov * Math.PI) / 360))) * 1.16;
        camera.position.set(0, 0, fitDist);
        controls.target.set(0, 0, 0);
        controls.minDistance = fitDist * 0.55;
        controls.maxDistance = fitDist * 2.2;
        controls.update();

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let downAt: { x: number; y: number; t: number } | null = null;

        const pick = (e: PointerEvent): MuscleId | null => {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hits = raycaster.intersectObjects(meshes, false);
          for (const h of hits) {
            const gid = (h.object.userData as Record<string, unknown>).groupId as MuscleId | null;
            if (gid) return gid;
          }
          return null;
        };

        const onDown = (e: PointerEvent) => {
          downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
        };
        const onUp = (e: PointerEvent) => {
          if (!downAt) return;
          const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
          const quick = Date.now() - downAt.t < 700;
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

        apiRef.current = { renderer, controls, meshes, matBase, matDim, matHover, matSel };
        setLoading(false);
      },
      undefined,
      (err) => {
        if (disposed) return;
        console.error('加载人体模型失败', err);
        setFailed('人体模型加载失败（检查 /models/body.glb 是否存在）');
        setLoading(false);
      },
    );

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      matBase.dispose();
      matDim.dispose();
      matHover.dispose();
      matSel.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  /* ------------------------------ 高亮 ------------------------------ */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const m of api.meshes) {
      const gid = m.userData.groupId as MuscleId | null;
      if (!gid) {
        m.material = api.matDim;
      } else if (selected && gid === selected) {
        m.material = api.matSel;
      } else if (!selected && hovered && gid === hovered) {
        m.material = api.matHover;
      } else {
        m.material = api.matBase;
      }
    }
  }, [selected, hovered, loading]);

  /* ------------------------------ 计数 & 动作 ------------------------------ */
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

  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    fetch(`/api/exercises?muscle=${selected}&limit=50`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ApiResult) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ counts: {}, items: [] });
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
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

  const selectedDef = selected ? muscleById(selected) : null;

  return (
    <>
      <div className="body-explorer">
        <div className="body-canvas" ref={mountRef}>
          {loading && !failed && <div className="body-loading">正在加载 440 块肌肉…</div>}
          {failed && (
            <div className="body-fallback">
              <p>{failed}</p>
              <p className="hint">下面的肌肉列表仍然可以点，动作数据照常可用。</p>
            </div>
          )}
          {!failed && (
            <>
              <div className="body-hint">
                {selectedDef
                  ? `已选中 · ${selectedDef.region}·${selectedDef.label}`
                  : hovered
                    ? (muscleById(hovered)?.label ?? '')
                    : '拖动旋转 · 点肌肉看动作'}
              </div>
              <button className="body-rotate" onClick={toggleRotate} type="button">
                {autoRotate ? '暂停旋转' : '自动旋转'}
              </button>
            </>
          )}
        </div>

        <div className="muscle-regions">
          {REGIONS.map((region) => {
            const list = MUSCLES.filter((m) => m.region === region);
            if (!list.length) return null;
            return (
              <div className="region-row" key={region}>
                <span className="region-label">{region}</span>
                <div className="region-chips">
                  {list.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`muscle-chip ${selected === m.id ? 'on' : ''}`}
                      onClick={() => setSelected((cur) => (cur === m.id ? null : m.id))}
                    >
                      {m.label}
                      <em>{counts[m.id] ?? ''}</em>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="body-tip">胸 / 肩已细分到肌束 · 数据来自 Z-Anatomy 解剖模型</p>
      </div>

      {selected && (
        <div className="ms-backdrop" onClick={() => setSelected(null)}>
          <div className="ms-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ms-head">
              <div>
                <b>{selectedDef ? `${selectedDef.region}·${selectedDef.label}` : ''}</b>
                <span>{loadingList ? '加载中…' : `${data?.total ?? 0} 个动作`}</span>
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
              {!loadingList && (data?.items?.length ?? 0) === 0 && <p className="hint">这块肌肉暂时没有动作数据。</p>}
            </div>
            <a className="ms-more" href="/exercises">
              去动作库看全部 1,324 个动作 →
            </a>
          </div>
        </div>
      )}
    </>
  );
}

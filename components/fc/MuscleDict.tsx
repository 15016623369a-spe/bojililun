'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import { muscleById, type MuscleId } from '@/lib/muscles';
import { groupForEcorcheName, isExtremity, SHOW_LAYER } from '@/lib/ecorche';

interface DictItem {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
  steps: string[];
  desc: string;
}

interface DictResult {
  label: string | null;
  total: number;
  items: DictItem[];
}

export interface HeatItem {
  id: string;
  level: number;
}

interface ViewGoal {
  goalTarget: THREE.Vector3 | null;
  goalPos: THREE.Vector3 | null;
}

interface SceneApi {
  meshes: THREE.Mesh[];
  base: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
  hover: THREE.MeshStandardMaterial;
  sel: THREE.MeshStandardMaterial;
  groupMats: Map<string, THREE.MeshStandardMaterial>;
  centroids: Map<string, THREE.Vector3>;
  controls: OrbitControls;
  camera: THREE.PerspectiveCamera;
  fitDist: number;
  focusY: number;
  view: ViewGoal;
}

const COLD = new THREE.Color('#cfdcc9');
const HOT = new THREE.Color('#2f6b47');

function heatColor(level: number): THREE.Color {
  return COLD.clone().lerp(HOT, Math.max(0, Math.min(1, level)));
}

const FILTERS: Array<{ key: string; label: string; equip: string[] }> = [
  { key: 'all', label: '全部', equip: [] },
  { key: 'machine', label: '固定器械', equip: ['leverage machine', 'smith machine', 'sled machine', 'cable'] },
  { key: 'dumbbell', label: '哑铃', equip: ['dumbbell'] },
  { key: 'barbell', label: '杠铃', equip: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'kettlebell'] },
  { key: 'body', label: '自重', equip: ['body weight', 'band', 'stability ball', 'medicine ball'] },
];

function ExerciseGif({
  id,
  image,
  alt,
  big,
  still,
}: {
  id: string;
  image: string;
  alt: string;
  big?: boolean;
  still?: boolean;
}) {
  const [src, setSrc] = useState(still ? imageUrl(image) : `/api/gif/${id}`);
  const [failed, setFailed] = useState(false);
  return (
    <div className={big ? 'fc-dict-gif big' : 'fc-dict-gif'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={failed ? imageUrl(image) : src}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (!failed) setFailed(true);
        }}
      />
    </div>
  );
}

/** 身体页：全屏解剖图 + 点肌肉看标准动作；今天练过的肌肉实时亮着 */
export default function MuscleDict({ heat, showControls = true }: { heat: HeatItem[]; showControls?: boolean }) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const nearestRef = useRef<((nx: number, ny: number) => MuscleId | null) | null>(null);

  const [side, setSide] = useState<'back' | 'front'>('back');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [hinted, setHinted] = useState(false);
  const [spin, setSpin] = useState(false);

  const [data, setData] = useState<DictResult | null>(null);
  const [busyList, setBusyList] = useState(false);
  const [active, setActive] = useState<DictItem | null>(null);
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState<Record<string, 'busy' | 'done' | 'err'>>({});
  const [toast, setToast] = useState('');

  const heatKey = heat.map((h) => `${h.id}:${h.level.toFixed(2)}`).join(',');

  /* ------------------------------ 3D ------------------------------ */

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed('当前浏览器不支持 WebGL');
      setLoading(false);
      return;
    }

    const width = mount.clientWidth || 380;
    const height = mount.clientHeight || 520;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, width / height, 0.01, 100);

    // 石膏打光：半球光铺底 + 一盏主光带柔和阴影 + 侧逆光勾边
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.add(new THREE.HemisphereLight(0xfffaf4, 0xcfc4b8, 0.85));
    const front = new THREE.DirectionalLight(0xfff8ef, 2.3);
    front.position.set(-2.7, 2.1, 2.6);
    front.castShadow = true;
    front.shadow.mapSize.set(2048, 2048);
    front.shadow.radius = 6;
    front.shadow.bias = -0.0012;
    front.shadow.normalBias = 0.02;
    front.shadow.camera.left = -1.2;
    front.shadow.camera.right = 1.2;
    front.shadow.camera.top = 1.4;
    front.shadow.camera.bottom = -1.2;
    front.shadow.camera.near = 0.1;
    front.shadow.camera.far = 12;
    scene.add(front);
    const back = new THREE.DirectionalLight(0xffffff, 0.7);
    back.position.set(2.2, 2.4, -3.6);
    scene.add(back);
    const fill = new THREE.DirectionalLight(0xf6ece2, 0.35);
    fill.position.set(2.6, -0.6, 1.6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfff4e8, 0.9);
    rim.position.set(1.8, 1.2, 2.6);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.autoRotate = false;

    const base = new THREE.MeshStandardMaterial({
      color: 0xf3ede4,
      roughness: 0.86,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const dim = new THREE.MeshStandardMaterial({
      color: 0xe7e0d6,
      roughness: 0.9,
      metalness: 0.01,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const hover = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: 0x8fae94,
      roughness: 0.62,
      metalness: 0.02,
      emissive: 0x22412c,
      emissiveIntensity: 0.18,
    });
    const sel = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: 0x2f6a45,
      roughness: 0.5,
      metalness: 0.04,
      emissive: 0x1f3b2a,
      emissiveIntensity: 0.6,
    });
    const groupMats = new Map<string, THREE.MeshStandardMaterial>();

    const meshes: THREE.Mesh[] = [];
    const view = { goalTarget: null as THREE.Vector3 | null, goalPos: null as THREE.Vector3 | null };
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    let disposed = false;
    let raf = 0;

    loader.load(
      '/models/ecorche/ecorche.glb',
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const headCut = box.max.y - size.y * 0.132;
        const headBox = new THREE.Box3();
        root.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const ud = obj.userData as Record<string, unknown>;
          // ecorche 用 layer 分骨、深层肌、浅层肌；默认只留浅层
          const layer = String(ud.layer ?? '');
          const name = String(ud.name ?? obj.name ?? '');
          const mb = new THREE.Box3().setFromObject(obj);
          const cy = mb.getCenter(new THREE.Vector3()).y;

          // 头部保留原模型的解剖头：颅骨、牙、眼球 + 面部肌，不可点选
          if (cy > headCut) {
            headBox.union(mb);
            const keepHead = layer === SHOW_LAYER || layer === 'skeleton';
            obj.visible = keepHead;
            if (keepHead) {
              obj.userData.groupId = null;
              obj.material = dim;
            }
            return;
          }

          if (layer !== SHOW_LAYER) {
            obj.visible = false;
            return;
          }
          // 手/脚内部只剩肌腱丝，接真手真脚后整体隐藏
          if (isExtremity(name)) {
            obj.visible = false;
            return;
          }
          const group = groupForEcorcheName(name);
          if (!group) {
            obj.visible = false;
            return;
          }
          obj.userData.groupId = group;
          obj.material = base;
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (!groupMats.has(group)) {
            groupMats.set(
              group,
              new THREE.MeshStandardMaterial({
                color: 0xf3ede4,
                roughness: 0.86,
                metalness: 0.02,
                side: THREE.DoubleSide,
              }),
            );
          }
          meshes.push(obj);
        });
        const wrapper = new THREE.Group();
        root.position.sub(center);
        wrapper.add(root);
        scene.add(wrapper);

        // ---- 手 / 脚：浅层肌在那只剩肌腱丝，按解剖比例在腕、踝处截断，改用 skeleton 层的手骨脚骨 ----
        {
          // 实测：桡骨末端 ≈ 51.5% 身高，踝 ≈ 6%（ecorche 实测而非教科书比例）
          const wristY = box.min.y + size.y * 0.515;
          const ankleY = box.min.y + size.y * 0.062;

          // 顶点是量化后的整数坐标，必须走 matrixWorld 才能拿到真实米制高度
          const clipBelow = (ids: string[], cutY: number) => {
            const v = new THREE.Vector3();
            for (const m of meshes) {
              if (!m.visible || !ids.includes(String(m.userData.groupId))) continue;
              const g = m.geometry as THREE.BufferGeometry;
              const pos = g.attributes.position;
              // 非索引几何先补一个顺序索引，否则裁不了
              let idx = g.index;
              if (!idx) {
                const seq = new Uint32Array(pos.count);
                for (let i = 0; i < pos.count; i++) seq[i] = i;
                idx = new THREE.BufferAttribute(seq, 1);
              }
              const above = new Uint8Array(pos.count);
              for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
                above[i] = v.y > cutY ? 1 : 0;
              }
              const keep: number[] = [];
              for (let t = 0; t < idx.count; t += 3) {
                const a = idx.getX(t);
                const b2 = idx.getX(t + 1);
                const c2 = idx.getX(t + 2);
                if (above[a] && above[b2] && above[c2]) keep.push(a, b2, c2);
              }
              const ng = new THREE.BufferGeometry();
              for (const k of Object.keys(g.attributes)) ng.setAttribute(k, g.attributes[k]);
              ng.setIndex(keep);
              m.geometry = ng;
            }
          };
          clipBelow(['forearms'], wristY);
          clipBelow(['calves', 'quads', 'hamstrings', 'adductors'], ankleY);

          const bb = new THREE.Box3();
          root.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            const ud = obj.userData as Record<string, unknown>;
            if (String(ud.layer ?? '') !== 'skeleton') return;
            bb.setFromObject(obj);
            const cy = (bb.min.y + bb.max.y) / 2;
            const hand = cy < wristY + size.y * 0.005 && cy > ankleY;
            const foot = cy < ankleY + size.y * 0.005;
            if (!hand && !foot) return;
            obj.visible = true;
            obj.userData.groupId = null;
            obj.material = dim;
            obj.castShadow = true;
            obj.receiveShadow = true;
          });
        }

        // 全身取景：头顶到脚踝都在一屏里
        const visibleH = size.y * 0.99;
        const fitDist = (visibleH / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.0;
        const focusY = size.y * 0.01;
        camera.position.set(0, focusY, -fitDist);
        controls.target.set(0, focusY, 0);
        controls.update();

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let downAt: { x: number; y: number; t: number } | null = null;

        const pick = (e: PointerEvent): MuscleId | null => {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          for (const h of raycaster.intersectObjects(meshes, false)) {
            const gid = (h.object.userData as Record<string, unknown>).groupId as MuscleId | null;
            if (gid) return gid;
          }
          return null;
        };

        renderer.domElement.addEventListener('pointerdown', (e) => {
          downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
        });
        renderer.domElement.addEventListener('pointerup', (e) => {
          if (!downAt) return;
          const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
          const quick = Date.now() - downAt.t < 700;
          downAt = null;
          if (moved > 8 || !quick) return;
          const rect = renderer.domElement.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          const id = pick(e) ?? nearestRef.current?.(nx, ny) ?? null;
          if (id) {
            setSelected(id);
            setHinted(true);
            setSpin(false);
          }
        });
        renderer.domElement.addEventListener('pointermove', (e) => {
          if (downAt) return;
          const id = pick(e);
          setHovered(id);
          if (id) setHinted(true);
          renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
        });

        const sum = new Map<string, { v: THREE.Vector3; n: number }>();
        const tmpBox = new THREE.Box3();
        for (const m of meshes) {
          const gid = m.userData.groupId as string | null;
          if (!gid) continue;
          tmpBox.setFromObject(m);
          const c = tmpBox.getCenter(new THREE.Vector3());
          const cur = sum.get(gid);
          if (cur) {
            cur.v.add(c);
            cur.n += 1;
          } else sum.set(gid, { v: c.clone(), n: 1 });
        }
        const centroids = new Map<string, THREE.Vector3>();
        for (const [gid, s2] of sum) centroids.set(gid, s2.v.multiplyScalar(1 / s2.n));

        // 手指点偏时的就近兜底：屏幕距离最近的肌肉
        const pickNearest = (nx: number, ny: number): MuscleId | null => {
          let best: MuscleId | null = null;
          let bestD = 34; // 像素
          const v = new THREE.Vector3();
          const rect = renderer.domElement.getBoundingClientRect();
          for (const [gid, c] of centroids) {
            v.copy(c).project(camera);
            if (v.z > 1) continue;
            const dx = ((v.x - nx) * rect.width) / 2;
            const dy = ((v.y - ny) * rect.height) / 2;
            const d = Math.hypot(dx, dy);
            if (d < bestD) {
              bestD = d;
              best = gid as MuscleId;
            }
          }
          return best;
        };
        nearestRef.current = pickNearest;

        apiRef.current = { meshes, base, dim, hover, sel, groupMats, centroids, controls, camera, fitDist, focusY, view };
        setLoading(false);
      },
      undefined,
      () => {
        if (disposed) return;
        setFailed('人体模型没加载出来');
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
      const v = apiRef.current?.view;
      if (v?.goalTarget && v?.goalPos) {
        controls.target.lerp(v.goalTarget, 0.14);
        camera.position.lerp(v.goalPos, 0.14);
        if (controls.target.distanceTo(v.goalTarget) < 0.002) {
          v.goalTarget = null;
          v.goalPos = null;
        }
      }
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
      base.dispose();
      dim.dispose();
      hover.dispose();
      sel.dispose();
      groupMats.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  /* 颜色：今天练过的亮鼠尾草绿，悬停变浅绿，选中变深绿 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const levels = new Map<string, number>();
    for (const h of heat) levels.set(h.id, h.level);

    for (const m of api.meshes) {
      const gid = m.userData.groupId as string | null;
      if (!gid) {
        m.material = api.dim;
        continue;
      }
      const mat = api.groupMats.get(gid);
      const level = levels.get(gid) ?? 0;
      if (mat) {
        if (level > 0.01) {
          mat.color.copy(heatColor(level));
          mat.emissive.copy(heatColor(level)).multiplyScalar(0.22);
          mat.emissiveIntensity = 0.55;
        } else {
          mat.color.set(0xdcd2c7);
          mat.emissive.set(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
      if (selected && gid === selected) m.material = api.sel;
      else if (!selected && hovered && gid === hovered) m.material = api.hover;
      else if (level > 0.01 && mat) m.material = mat;
      else m.material = api.base;
    }
  }, [heatKey, heat, selected, hovered, loading]);

  /* 自转开关 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.controls.autoRotate = spin;
  }, [spin, loading]);

  /* 正 / 背面：回到全身视角 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.camera.position.set(0, api.focusY, side === 'back' ? -api.fitDist : api.fitDist);
    api.controls.target.set(0, api.focusY, 0);
    api.controls.update();
  }, [side, loading]);

  /* 选中一块肌肉：镜头推近到局部（丝滑 lerp），关掉浮层回到全身 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api || loading) return;

    // 用相机当前朝向决定「正面 / 背面」，这样用户拖到哪一面，推近就停在哪一面
    const sign = api.camera.position.z >= api.controls.target.z ? 1 : -1;

    if (!selected) {
      const t = new THREE.Vector3(0, api.focusY, 0);
      api.view.goalTarget = t;
      api.view.goalPos = new THREE.Vector3(0, api.focusY, sign * api.fitDist);
      return;
    }

    const box = new THREE.Box3();
    let found = false;
    for (const m of api.meshes) {
      if (m.visible && m.userData.groupId === selected) {
        box.expandByObject(m);
        found = true;
      }
    }
    if (!found) return;

    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.y, size.x * (api.camera.aspect || 0.8), 0.05) * 2.6;
    const dist = span / 2 / Math.tan((api.camera.fov * Math.PI) / 360);
    const z = sign * dist;
    const target = new THREE.Vector3(c.x, c.y - span * 0.22, c.z);
    api.view.goalTarget = target;
    api.view.goalPos = new THREE.Vector3(target.x, target.y, z);
  }, [selected, side, loading]);

  /* 选中 → 拉这一块的标准动作 */
  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let cancelled = false;
    setBusyList(true);
    setActive(null);
    setFilter('all');
    fetch(`/api/exercises?muscle=${selected}&limit=100&steps=1`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: DictResult) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ label: null, total: 0, items: [] });
      })
      .finally(() => {
        if (!cancelled) setBusyList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  /* 深链 /atlas?muscle=lats */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'front' || view === 'back') setSide(view);
    const m = params.get('muscle');
    if (m && muscleById(m)) {
      setSelected(m as MuscleId);
      setHinted(true);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const items = useMemo(() => {
    const rank: Record<string, number> = {
      barbell: 0,
      'olympic barbell': 0,
      'ez barbell': 1,
      dumbbell: 2,
      kettlebell: 3,
      cable: 4,
      'smith machine': 5,
      'leverage machine': 6,
      'sled machine': 6,
      'body weight': 7,
      band: 8,
    };
    const CLASSIC = ['高位下拉', '引体', '划船', '硬拉', '深蹲', '卧推', '推举', '飞鸟', '侧平举', '弯举', '腿举', '下拉'];
    const classicScore = (name: string) => {
      const i = CLASSIC.findIndex((k) => name.includes(k));
      return i === -1 ? 99 : i;
    };
    const eq = FILTERS.find((f) => f.key === filter)?.equip ?? [];

    return (data?.items ?? [])
      .filter((it) => !/stretch|mobility|yoga|foam roll/i.test(it.name))
      .filter((it) => (eq.length ? eq.includes(it.equipment) : true))
      .sort((a, b) => {
        const ca = classicScore(a.zh_name);
        const cb = classicScore(b.zh_name);
        if (ca !== cb) return ca - cb;
        const ra = rank[a.equipment] ?? 9;
        const rb = rank[b.equipment] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.zh_name || a.name).localeCompare(b.zh_name || b.name, 'zh-CN');
      });
  }, [data, filter]);

  const markDone = useCallback(
    async (it: DictItem) => {
      setState((prev) => ({ ...prev, [it.id]: 'busy' }));
      try {
        const res = await fetch('/api/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `练了${it.zh_name || it.name}` }),
        });
        if (!res.ok) throw new Error('记录失败');
        setState((prev) => ({ ...prev, [it.id]: 'done' }));
        setToast('已记入今天，肌肉点亮了');
        router.refresh();
      } catch {
        setState((prev) => ({ ...prev, [it.id]: 'err' }));
        setToast('没记上，再试一次');
      }
    },
    [router],
  );

  const addToPlan = useCallback(async (it: DictItem) => {
    setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'busy' }));
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseId: it.id }),
      });
      if (!res.ok) throw new Error('加入失败');
      setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'done' }));
      setToast('已加入今日训练清单');
      router.refresh();
    } catch {
      setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'err' }));
      setToast('加入失败');
    }
  }, [router]);

  const def = selected ? muscleById(selected) : null;
  const hoverDef = hovered ? muscleById(hovered) : null;
  const lit = heat.length;

  return (
    <>
      <div className="fc-dict-body" ref={mountRef}>
        {loading && !failed && <div className="fc-loading">加载人体模型…</div>}
        {failed && <div className="fc-loading">{failed}</div>}
        {!failed && (
          <>
            {showControls && (
            <div className="fc-dict-tabs">
              <button type="button" className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>
                正面
              </button>
              <button type="button" className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>
                背面
              </button>
              <button type="button" className={spin ? 'on' : ''} onClick={() => setSpin((v) => !v)}>
                自转
              </button>
            </div>
            )}
          </>
        )}
      </div>

      <p className="fc-dict-hintline">
        {selected
          ? '已推近到这一块 · 关掉浮层回到全身'
          : hoverDef
            ? `${hoverDef.region}·${hoverDef.label}`
            : !hinted && lit > 0
              ? `今天点亮了 ${lit} 块肌肉 · 点一下看动作`
              : '拖动旋转 · 点一块肌肉看动作'}
      </p>

      {selected && (
        <div className="fc-mask dict" onClick={() => setSelected(null)}>
          <div className="fc-sheet fc-dict-sheet" onClick={(e) => e.stopPropagation()}>
            {active ? (
              <>
                <div className="fc-dict-detail-top">
                  <button type="button" className="fc-dict-back" onClick={() => setActive(null)}>
                    ‹ 动作列表
                  </button>
                  <button type="button" className="fc-dict-close" onClick={() => setSelected(null)}>
                    关闭
                  </button>
                </div>
                <div className="fc-dict-hero">
                  <ExerciseGif id={active.id} image={active.image} alt={active.zh_name || active.name} big />
                  <div>
                    <div className="fc-dict-name">{active.zh_name || active.name}</div>
                    <div className="fc-dict-en">{active.name}</div>
                    <div className="fc-dict-chips">
                      <span>{EQUIPMENT_LABEL[active.equipment] ?? active.equipment}</span>
                      <span>{TARGET_LABEL[active.target] ?? active.target}</span>
                    </div>
                  </div>
                </div>

                <h4 className="fc-dict-sub">要点</h4>
                {active.steps.length > 0 ? (
                  <ol className="fc-dict-steps">
                    {active.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="fc-note">这个动作暂时没有分步说明。</p>
                )}

                <div className="fc-dict-actions">
                  <button
                    type="button"
                    className="fc-btn primary"
                    onClick={() => void markDone(active)}
                    disabled={state[active.id] === 'busy'}
                  >
                    {state[active.id] === 'done' ? '✓ 已记入今天' : state[active.id] === 'busy' ? '记录中…' : '✓ 记入今天'}
                  </button>
                  <button
                    type="button"
                    className="fc-btn ghost"
                    onClick={() => void addToPlan(active)}
                    disabled={state[`plan-${active.id}`] === 'busy'}
                  >
                    {state[`plan-${active.id}`] === 'done' ? '✓ 已在清单' : '+ 加入训练'}
                  </button>
                </div>
                <p className="fc-dict-src">
                  <a href={`/exercises/${active.id}`}>看完整详情与步骤 →</a>
                </p>
              </>
            ) : (
              <>
                <div className="fc-dict-head">
                  <div>
                    <div className="fc-dict-title">
                      {def ? `${def.region}·${def.label}` : '这块肌肉'}
                      <span className="fc-dict-count">{busyList ? '…' : `${data?.total ?? 0} 个动作`}</span>
                    </div>
                    <div className="fc-dict-note">点动作看动图与要点</div>
                  </div>
                  <button type="button" className="fc-dict-close" onClick={() => setSelected(null)}>
                    关闭
                  </button>
                </div>

                <div className="fc-dict-filters">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={filter === f.key ? 'on' : ''}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="fc-dict-list">
                  {busyList && <p className="fc-note">正在取这一块的动作…</p>}
                  {!busyList &&
                    items.map((it) => (
                      <button type="button" key={it.id} className="fc-dict-item" onClick={() => setActive(it)}>
                        <ExerciseGif id={it.id} image={it.image} alt={it.zh_name || it.name} still />
                        <span className="fc-dict-item-body">
                          <b>{it.zh_name || it.name}</b>
                          <em>
                            {EQUIPMENT_LABEL[it.equipment] ?? it.equipment} · {TARGET_LABEL[it.target] ?? it.target}
                          </em>
                        </span>
                        <span className="fc-dict-arrow">›</span>
                      </button>
                    ))}
                  {!busyList && items.length === 0 && (
                    <p className="fc-note">这个筛选下没有动作，换个器械试试。</p>
                  )}
                </div>
                <p className="fc-dict-src">动作数据：hasaneyldrm/exercises-dataset（MIT）· 动图版权 Gym visual</p>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}

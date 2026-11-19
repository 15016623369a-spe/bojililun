'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import { groupForMeshName, muscleById, type MuscleId } from '@/lib/muscles';

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
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, width / height, 0.01, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc5bb, 1.5));
    const front = new THREE.DirectionalLight(0xffffff, 1.9);
    front.position.set(-2.4, 3.2, 4.2);
    scene.add(front);
    const back = new THREE.DirectionalLight(0xffffff, 1.9);
    back.position.set(2.4, 3.2, -4.2);
    scene.add(back);
    const fill = new THREE.DirectionalLight(0xf6ece2, 0.9);
    fill.position.set(3, -1, 0);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.autoRotate = false;

    const base = new THREE.MeshStandardMaterial({
      color: 0xdcd2c7,
      roughness: 0.8,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const dim = new THREE.MeshStandardMaterial({
      color: 0xd8cec2,
      roughness: 0.94,
      metalness: 0.01,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const hover = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: 0xa6bfa4,
      roughness: 0.6,
      metalness: 0.03,
      emissive: 0x2f4a35,
      emissiveIntensity: 0.25,
    });
    const sel = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: 0x5f8b6a,
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

    let disposed = false;
    let raf = 0;

    loader.load(
      '/models/body.glb',
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const headCut = box.max.y - size.y * 0.132;
        const headBox = new THREE.Box3();
        // 手指、手掌、面部肌群：这些细碎网格在浅色纸感界面里只会添乱
        const HANDS =
          /(finger|thumb|palm|wrist|thenar|hypothenar|pollicis|digiti|of hand|digitorum|tendon|aponeurosis|retinaculum|membrane|septum|fascia|interosseous|nipple|areola|skin|subcutaneous|bursa|palmaris|plantaris|carpi|neck)/i;

        root.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const ud = obj.userData as Record<string, unknown>;
          if (ud.type !== 'muscle') {
            obj.visible = false;
            return;
          }
          const nameDetail = String(ud.nameDetail ?? ud.name ?? '');
          const mb = new THREE.Box3().setFromObject(obj);
          const cy = mb.getCenter(new THREE.Vector3()).y;

          if (cy > headCut) {
            headBox.union(mb);
            obj.visible = false;
            return;
          }
          // 细长条（肌腱/血管残片）在全身取景下会变成几根「刺」，一并藏掉
          const ms = mb.getSize(new THREE.Vector3());
          const spike = Math.min(ms.x, ms.z) < size.y * 0.012 && Math.max(ms.x, ms.y, ms.z) > size.y * 0.07;
          if (HANDS.test(nameDetail) || spike) {
            obj.visible = false;
            return;
          }

          const group = groupForMeshName(nameDetail);
          obj.userData.groupId = group?.id ?? null;
          obj.material = group ? base : dim;
          if (group && !groupMats.has(group.id)) {
            groupMats.set(
              group.id,
              new THREE.MeshStandardMaterial({
                color: 0xdcd2c7,
                roughness: 0.7,
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

        const H = size.y;
        const skinMat = new THREE.MeshStandardMaterial({
          color: 0xdcd2c7,
          roughness: 0.95,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });

        // ---- 手：腕部以下全收掉（指骨/肌腱在解剖模型里是碎丝），补一颗圆润的腕端 ----
        const sideInfo = (ids: string[]) => {
          const out = new Map<number, { minY: number; x: number; z: number; n: number }>();
          const tmp = new THREE.Box3();
          for (const m of meshes) {
            if (!ids.includes(String(m.userData.groupId))) continue;
            tmp.setFromObject(m);
            const c = tmp.getCenter(new THREE.Vector3());
            const side = c.x >= 0 ? 1 : -1;
            const cur = out.get(side);
            if (!cur || c.y < cur.minY) out.set(side, { minY: c.y, x: c.x, z: c.z, n: 1 });
            else if (cur) cur.n += 1;
          }
          return out;
        };

        // 手臂外侧的细杆（肌腱/血管残丝）在缩略尺寸下只会变成毛刺
        {
          const tmp = new THREE.Box3();
          for (const m of meshes) {
            tmp.setFromObject(m);
            const cx = (tmp.min.x + tmp.max.x) / 2;
            const sx = tmp.max.x - tmp.min.x;
            const sz = tmp.max.z - tmp.min.z;
            if (Math.abs(cx) > H * 0.06 && Math.max(sx, sz) < H * 0.03 && (tmp.max.y - tmp.min.y) > H * 0.05) {
              m.visible = false;
            }
          }
        }

        const wrists = sideInfo(['forearms']);
        const ankle = sideInfo(['calves', 'quads', 'hamstrings', 'adductors']);
        // 只收掉整体位于阈值以下的小件（手指/脚趾/肌腱丝），不动前臂和小腿本身
        const hideEntirelyBelow = (limit: number, minX: number) => {
          const tmp = new THREE.Box3();
          for (const m of meshes) {
            tmp.setFromObject(m);
            const cx = (tmp.min.x + tmp.max.x) / 2;
            if (tmp.max.y < limit && Math.abs(cx) > minX) m.visible = false;
          }
        };

        // 按左右两侧取「手臂 / 腿」的最低可见点，先把该点以下的碎丝收掉，再补一只手/脚
        const limbEnds = (ids: string[]) => {
          const tmp = new THREE.Box3();
          const out = new Map<number, { y: number; x: number; z: number }>();
          for (const m of meshes) {
            if (!m.visible || !ids.includes(String(m.userData.groupId))) continue;
            tmp.setFromObject(m);
            const cx = (tmp.min.x + tmp.max.x) / 2;
            const sign = cx >= 0 ? 1 : -1;
            const cur = out.get(sign);
            if (!cur || tmp.min.y < cur.y) {
              out.set(sign, { y: tmp.min.y, x: cx, z: (tmp.min.z + tmp.max.z) / 2 });
            }
          }
          return out;
        };

        const armEnds = limbEnds(['forearms', 'biceps', 'triceps']);
        const legEnds = limbEnds(['calves', 'quads', 'hamstrings', 'adductors']);
        const cutBelow = (limit: number, minX: number) => {
          const tmp = new THREE.Box3();
          for (const m of meshes) {
            if (!m.visible) continue;
            tmp.setFromObject(m);
            const cx = (tmp.min.x + tmp.max.x) / 2;
            if (tmp.min.y < limit && Math.abs(cx) > minX) m.visible = false;
          }
        };
        const armCut = Math.min(...[...armEnds.values()].map((v) => v.y));
        cutBelow(armCut + H * 0.012, H * 0.07);
        const armEnds2 = limbEnds(['forearms', 'biceps', 'triceps']);

        for (const [, p2] of armEnds2) {
          const mitt = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinMat);
          mitt.position.set(p2.x, p2.y + H * 0.028 - center.y, p2.z);
          mitt.scale.set(H * 0.022, H * 0.04, H * 0.023);
          scene.add(mitt);
        }

        const legCut = Math.min(...[...legEnds.values()].map((v) => v.y));
        cutBelow(legCut + H * 0.02, H * 0.015);
        const legEnds2 = limbEnds(['calves', 'quads', 'hamstrings', 'adductors']);

        for (const [, p2] of legEnds2) {
          const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), skinMat);
          foot.position.set(p2.x, p2.y + H * 0.016 - center.y, p2.z + size.z * 0.022);
          foot.scale.set(H * 0.030, H * 0.017, H * 0.070);
          scene.add(foot);
        }

        // ---- 头：下颌略收的石膏头像 + 一小段颈，避免「气球头悬空」 ----
        if (!headBox.isEmpty()) {
          const headCY = box.max.y - H * 0.070;
          const headScale = new THREE.Vector3(H * 0.050, H * 0.064, H * 0.056);
          const headGeo = new THREE.SphereGeometry(1, 48, 32);
          const hp = headGeo.attributes.position;
          for (let i = 0; i < hp.count; i++) {
            const y = hp.getY(i);
            if (y < 0) {
              const t = Math.min(1, -y);
              const f = 1 - 0.42 * Math.pow(t, 1.4);
              hp.setX(i, hp.getX(i) * f);
              hp.setZ(i, hp.getZ(i) * (1.0 - 0.16 * t) + 0.06 * t);
            }
          }
          headGeo.computeVertexNormals();
          const head = new THREE.Mesh(headGeo, skinMat);
          head.position.set(0, headCY - center.y, -size.z * 0.008);
          head.scale.copy(headScale);
          scene.add(head);

          const neckTop = headCY - headScale.y * 0.72;
          const neckBottom = box.max.y - H * 0.150;
          const neckH = Math.max(H * 0.02, neckTop - neckBottom);
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.028, H * 0.034, neckH, 28), skinMat);
          neck.position.set(0, (neckTop + neckBottom) / 2 - center.y, -size.z * 0.006);
          scene.add(neck);
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
    const m = new URLSearchParams(window.location.search).get('muscle');
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

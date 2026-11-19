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

        // ---- 头 / 手 / 脚：换成 porcelain 的平滑部件，统一石膏材质 ----
        {
          // ecorche 实测：腕 51.5% 身高、踝 6.2%、颈根 ≈ 84%
          const wristY = box.min.y + size.y * 0.515;
          const ankleY = box.min.y + size.y * 0.062;
          const neckY = box.min.y + size.y * 0.845;

          // 1) 裁掉腕、踝以下的肌腱尾巴
          const v3 = new THREE.Vector3();
          const clipBelow = (ids: string[], cutY: number) => {
            for (const m of meshes) {
              if (!m.visible || !ids.includes(String(m.userData.groupId))) continue;
              const g = m.geometry as THREE.BufferGeometry;
              const pos = g.attributes.position;
              let idx = g.index;
              if (!idx) {
                const seq = new Uint32Array(pos.count);
                for (let i = 0; i < pos.count; i++) seq[i] = i;
                idx = new THREE.BufferAttribute(seq, 1);
              }
              const above = new Uint8Array(pos.count);
              for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
                above[i] = v3.y > cutY ? 1 : 0;
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
          clipBelow(['forearms'], wristY + size.y * 0.035);
          clipBelow(['calves', 'quads', 'hamstrings', 'adductors'], ankleY);

          // 2) 藏掉头骨与颈部肌、以及手骨脚骨（都要被平滑部件替换）
          const bb = new THREE.Box3();
          root.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            const ud = obj.userData as Record<string, unknown>;
            const layer = String(ud.layer ?? '');
            bb.setFromObject(obj);
            const cy = (bb.min.y + bb.max.y) / 2;
            const isSkeleton = layer === 'skeleton';
            const isNeck = String(ud.groupId ?? '') === 'neck' || /sternocleidomastoid|scalenus|splenius|longus|omohyoid|sternohyoid|sternothyroid|thyrohyoid/i.test(String(ud.name ?? ''));
            if (cy > neckY || isNeck) {
              obj.visible = false;
              return;
            }
            if (isSkeleton && cy < wristY) {
              obj.visible = false;
            }
          });

          // 3) 取 ecorche 的腕心 / 踝心，用于对齐
          const anchorOf = (ids: string[], cutY: number) => {
            const out = new Map<number, { x: number; z: number; r: number }>();
            const acc = new Map<number, { sx: number; sz: number; n: number; pts: { x: number; z: number }[] }>();
            for (const m of meshes) {
              if (!m.visible || !ids.includes(String(m.userData.groupId))) continue;
              const pos = m.geometry.getAttribute('position');
              for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
                if (Math.abs(v3.y - cutY) > size.y * 0.012) continue;
                const sign = v3.x >= 0 ? 1 : -1;
                const rec = acc.get(sign) ?? { sx: 0, sz: 0, n: 0, pts: [] };
                rec.sx += v3.x;
                rec.sz += v3.z;
                rec.n += 1;
                rec.pts.push({ x: v3.x, z: v3.z });
                acc.set(sign, rec);
              }
            }
            for (const [sign, rec] of acc) {
              if (!rec.n) continue;
              const cx = rec.sx / rec.n;
              const cz = rec.sz / rec.n;
              let r = 0;
              for (const q of rec.pts) r += Math.hypot(q.x - cx, q.z - cz);
              out.set(sign, { x: cx, z: cz, r: r / rec.n });
            }
            return out;
          };
          const ecoWrists = anchorOf(['forearms'], wristY);
          const ecoAnkles = anchorOf(['calves', 'quads', 'hamstrings', 'adductors'], ankleY);

          // 末端收细：离断口越近收得越多，避免断面比手/脚还粗
          const taperEnd = (
            ids: string[],
            cutY: number,
            span: number,
            centers: Map<number, { x: number; z: number }>,
            amount: number,
          ) => {
            const v = new THREE.Vector3();
            const mi = new THREE.Matrix4();
            for (const m of meshes) {
              if (!m.visible || !ids.includes(String(m.userData.groupId))) continue;
              const g = m.geometry as THREE.BufferGeometry;
              const pos = g.attributes.position;
              const mw = m.matrixWorld.clone();
              mi.copy(mw).invert();
              const arr = new Float32Array(pos.count * 3);
              for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mw);
                const c = centers.get(v.x >= 0 ? 1 : -1);
                if (c && v.y < cutY + span) {
                  const t = Math.min(1, Math.max(0, (cutY + span - v.y) / span));
                  const f = 1 - amount * t;
                  v.x = c.x + (v.x - c.x) * f;
                  v.z = c.z + (v.z - c.z) * f;
                }
                v.applyMatrix4(mi);
                arr[i * 3] = v.x;
                arr[i * 3 + 1] = v.y;
                arr[i * 3 + 2] = v.z;
              }
              const ng = new THREE.BufferGeometry();
              for (const key of Object.keys(g.attributes)) {
                if (key === 'position') ng.setAttribute('position', new THREE.BufferAttribute(arr, 3));
                else ng.setAttribute(key, g.attributes[key]);
              }
              ng.setIndex(g.index);
              m.geometry = ng;
            }
          };
          taperEnd(['forearms'], wristY + size.y * 0.035, size.y * 0.05, ecoWrists, 0.42);
          taperEnd(['calves', 'quads', 'hamstrings', 'adductors'], ankleY, size.y * 0.05, ecoAnkles, 0.42);

          const plaster = new THREE.MeshStandardMaterial({
            color: 0xf3ede4,
            roughness: 0.86,
            metalness: 0,
            side: THREE.DoubleSide,
          });
          const parts = new THREE.Group();
          parts.position.copy(center).negate();
          wrapper.add(parts);

          loader.load('/models/porcelain/male-fixed.glb', (pg) => {
            if (disposed) return;
            pg.scene.updateMatrixWorld(true);

            // 把 porcelain 的所有网格合并成「顶点 + 三角形」的池子，按条件裁剪
            type Tri = [number, number, number];
            const P: number[] = [];
            const tris: Tri[] = [];
            const pushMesh = (mesh: THREE.Mesh, filter?: (x: number, y: number, z: number) => boolean) => {
              const g = mesh.geometry as THREE.BufferGeometry;
              const pos = g.attributes.position;
              const idx = g.index;
              const base = P.length / 3;
              for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
                P.push(v3.x, v3.y, v3.z);
              }
              const n = idx ? idx.count : pos.count;
              for (let t = 0; t < n; t += 3) {
                const a = (idx ? idx.getX(t) : t) + base;
                const b2 = (idx ? idx.getX(t + 1) : t + 1) + base;
                const c2 = (idx ? idx.getX(t + 2) : t + 2) + base;
                if (filter) {
                  const ok =
                    filter(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]) &&
                    filter(P[b2 * 3], P[b2 * 3 + 1], P[b2 * 3 + 2]) &&
                    filter(P[c2 * 3], P[c2 * 3 + 1], P[c2 * 3 + 2]);
                  if (!ok) continue;
                }
                tris.push([a, b2, c2]);
              }
            };
            pg.scene.traverse((o) => {
              if (o instanceof THREE.Mesh) pushMesh(o);
            });
            const porcHeight = (() => {
              let min = Infinity;
              let max = -Infinity;
              for (let i = 0; i < P.length; i += 3) {
                min = Math.min(min, P[i + 1]);
                max = Math.max(max, P[i + 1]);
              }
              return max - min;
            })();

            const build = (filter: (x: number, y: number, z: number) => boolean) => {
              const keepTris = tris.filter(
                ([a, b2, c2]) =>
                  filter(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]) &&
                  filter(P[b2 * 3], P[b2 * 3 + 1], P[b2 * 3 + 2]) &&
                  filter(P[c2 * 3], P[c2 * 3 + 1], P[c2 * 3 + 2]),
              );
              const geo = new THREE.BufferGeometry();
              const own = new Float32Array(P);
              geo.setAttribute('position', new THREE.BufferAttribute(own, 3));
              geo.setIndex(keepTris.flat());
              geo.computeVertexNormals();
              const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
              const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
              for (const [a, b2, c2] of keepTris) {
                for (const i of [a, b2, c2]) {
                  lo.x = Math.min(lo.x, P[i * 3]);
                  lo.y = Math.min(lo.y, P[i * 3 + 1]);
                  lo.z = Math.min(lo.z, P[i * 3 + 2]);
                  hi.x = Math.max(hi.x, P[i * 3]);
                  hi.y = Math.max(hi.y, P[i * 3 + 1]);
                  hi.z = Math.max(hi.z, P[i * 3 + 2]);
                }
              }
              const used = new Set<number>();
              for (const [a, b2, c2] of keepTris) {
                used.add(a);
                used.add(b2);
                used.add(c2);
              }
              return { geo, own, lo, hi, tri: keepTris.length, used: [...used] };
            };

            const k = size.y / porcHeight; // 全身等比缩放

            // 把某个高度附近的顶点向 (cx, cz) 收拢，消除空心套筒边缘
            const pinchRim = (
              part: { own: Float32Array; used: number[]; geo: THREE.BufferGeometry },
              yRef: number,
              cx: number,
              cz: number,
              span: number,
              factor: number,
            ) => {
              for (const i of part.used) {
                const y = part.own[i * 3 + 1];
                if (Math.abs(y - yRef) > span) continue;
                part.own[i * 3] = cx + (part.own[i * 3] - cx) * factor;
                part.own[i * 3 + 2] = cz + (part.own[i * 3 + 2] - cz) * factor;
              }
              part.geo.attributes.position.needsUpdate = true;
              part.geo.computeVertexNormals();
            };

            // ---- 头 + 颈 ----
            const HEAD_CUT = 1.42;
            const head = build((x, y) => y > HEAD_CUT && Math.abs(x) < 0.13);
            const headMesh = new THREE.Mesh(head.geo, plaster);
            headMesh.scale.setScalar(k);
            // 让平的切面埋到颈根以下 3cm，避免断层
            headMesh.position.set(0, neckY - size.y * 0.062 - head.lo.y * k, -size.z * 0.004);
            // 颈根切口往里收成塞子，封住锁骨上方的空洞
            pinchRim(head, head.lo.y, 0, -size.z * 0.004, 0.075, 0.82);
            parts.add(headMesh);

            // ---- 手 ----
            const POR_WRIST = 0.885;
            for (const [sign, w] of ecoWrists) {
              const hand = build((x, y) => y < POR_WRIST && y > 0.6 && x * sign > 0.2);
              if (!hand.tri) continue;
              const m = new THREE.Mesh(hand.geo, plaster);
              // 手比按身高算的略大一点，腕口才能包住前臂断口
              const kHand = k * 1.02;
              m.scale.setScalar(kHand);
              // 用这块手自身顶部开口环的中心去对腕心
              let sx = 0;
              let sz = 0;
              let n = 0;
              for (const i of hand.used) {
                if (P[i * 3 + 1] < hand.hi.y - 0.012) continue;
                sx += P[i * 3];
                sz += P[i * 3 + 2];
                n += 1;
              }
              const cx = n ? sx / n : 0;
              const cz = n ? sz / n : 0;
              m.position.set(w.x - cx * kHand, wristY + size.y * 0.062 - hand.hi.y * kHand, w.z - cz * kHand);
              // 腕口向轴心收拢，贴住前臂
              pinchRim(hand, hand.hi.y, cx, cz, 0.04, 0.74);
              parts.add(m);


              // 腕口封个盖，避免从袖口看进去
              const rim: { x: number; z: number }[] = [];
              for (const i of hand.used) {
                if (P[i * 3 + 1] < hand.hi.y - 0.012) continue;
                rim.push({ x: P[i * 3] - cx, z: P[i * 3 + 2] - cz });
              }
              if (rim.length > 4) {
                rim.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
                const capGeo = new THREE.BufferGeometry();
                const verts: number[] = [];
                const idx2: number[] = [];
                verts.push(0, 0, 0);
                for (const q of rim) verts.push(q.x, 0, q.z);
                for (let i = 1; i <= rim.length; i++) {
                  idx2.push(0, i, i === rim.length ? 1 : i + 1);
                }
                capGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
                capGeo.setIndex(idx2);
                capGeo.computeVertexNormals();
                const cap = new THREE.Mesh(capGeo, plaster);
                cap.scale.setScalar(kHand);
                cap.position.set(m.position.x, m.position.y + hand.hi.y * kHand, m.position.z);
                parts.add(cap);
              }
            }

            // ---- 脚 ----
            const POR_ANKLE = 0.11;
            for (const [sign, a] of ecoAnkles) {
              const foot = build((x, y) => y < POR_ANKLE && x * sign > 0.01);
              if (!foot.tri) continue;
              const m = new THREE.Mesh(foot.geo, plaster);
              m.scale.setScalar(k);
              let sx = 0;
              let sz = 0;
              let n = 0;
              for (const i of foot.used) {
                if (P[i * 3 + 1] < foot.hi.y - 0.012) continue;
                sx += P[i * 3];
                sz += P[i * 3 + 2];
                n += 1;
              }
              const cx = n ? sx / n : 0;
              const cz = n ? sz / n : 0;
              m.position.set(a.x - cx * k, ankleY + size.y * 0.03 - foot.hi.y * k, a.z - cz * k);
              pinchRim(foot, foot.hi.y, cx, cz, 0.035, 0.64);
              parts.add(m);
            }

            parts.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.castShadow = true;
                o.receiveShadow = true;
              }
            });
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
      setToast('已加入今日训练');
      router.refresh();
    } catch {
      setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'err' }));
      setToast('加入失败');
    }
  }, [router]);

  const planState = active ? state[`plan-${active.id}`] : undefined;

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
          <div
            className={active ? 'fc-sheet fc-dict-sheet detail' : 'fc-sheet fc-dict-sheet'}
            onClick={(e) => e.stopPropagation()}
          >
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

                <div className="fc-dict-detail-body">
                  <div className="fc-dict-hero">
                    <ExerciseGif
                      id={active.id}
                      image={active.image}
                      alt={active.zh_name || active.name}
                      big
                    />
                    <div className="fc-dict-meta">
                      <h3 className="fc-dict-name">{active.zh_name || active.name}</h3>
                      <p className="fc-dict-en">{active.name}</p>
                      <div className="fc-dict-chips">
                        <span>{EQUIPMENT_LABEL[active.equipment] ?? active.equipment}</span>
                        <span>{TARGET_LABEL[active.target] ?? active.target}</span>
                      </div>
                    </div>
                  </div>

                  <h4 className="fc-dict-sub">动作要点 / 步骤</h4>
                  {active.steps.length > 0 ? (
                    <ol className="fc-dict-steps">
                      {active.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="fc-note">这个动作暂时没有分步说明。</p>
                  )}
                </div>

                <div className="fc-dict-actions">
                  <button
                    type="button"
                    className={planState === 'done' ? 'fc-btn primary done' : 'fc-btn primary'}
                    onClick={() => void addToPlan(active)}
                    disabled={planState === 'busy' || planState === 'done'}
                    aria-live="polite"
                  >
                    {planState === 'done'
                      ? '✓ 已加入今日训练'
                      : planState === 'busy'
                        ? '加入中…'
                        : planState === 'err'
                          ? '加入失败 · 再试一次'
                          : '+ 加入训练安排'}
                  </button>
                </div>
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

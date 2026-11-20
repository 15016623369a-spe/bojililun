'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import { SCULPTURE_ORDER } from '@/lib/sculpture';

type Seed = { label: number; idx: number };
const BG = 254;

// 粗颗粒度：把没有明显解剖分界的亚区合并
const COARSE: { id: string; label: string; members: MuscleId[] }[] = [
  { id: 'neck', label: '颈部', members: ['neck'] },
  { id: 'traps', label: '斜方肌', members: ['traps'] },
  { id: 'chest', label: '胸部', members: ['chest_upper', 'chest_mid', 'chest_lower'] },
  { id: 'delt', label: '肩部（三角肌）', members: ['delt_front', 'delt_side', 'delt_rear'] },
  { id: 'biceps', label: '肱二头肌', members: ['biceps'] },
  { id: 'triceps', label: '肱三头肌', members: ['triceps'] },
  { id: 'forearms', label: '前臂', members: ['forearms'] },
  { id: 'abs', label: '腹直肌', members: ['abs'] },
  { id: 'obliques', label: '腹斜肌', members: ['obliques', 'serratus'] },
  { id: 'upperback', label: '上背', members: ['upperback'] },
  { id: 'lats', label: '背阔肌', members: ['lats'] },
  { id: 'lowerback', label: '下背', members: ['lowerback'] },
  { id: 'glutes', label: '臀部', members: ['glutes'] },
  { id: 'quads', label: '股四头', members: ['quads'] },
  { id: 'hamstrings', label: '腘绳肌', members: ['hamstrings'] },
  { id: 'adductors', label: '内收肌', members: ['adductors'] },
  { id: 'calves', label: '小腿', members: ['calves'] },
];

export default function SeedEditor() {
  const host = useRef<HTMLDivElement>(null);
  const [coarse, setCoarse] = useState(true);
  const [mode, setMode] = useState<number>(-1);
  const [tool, setTool] = useState<'seed' | 'brush'>('seed');
  const [brush, setBrush] = useState(0.35);
  const [showConc, setShowConc] = useState(false);
  const [status, setStatus] = useState('加载模型…');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [seedCounts, setSeedCounts] = useState<Record<number, number>>({});

  const groups = coarse ? COARSE.map((c) => ({ key: c.id, label: c.label })) : SCULPTURE_ORDER.map((id) => ({
    key: id,
    label: MUSCLES.find((m) => m.id === id)?.label ?? id,
  }));
  const fineToGroup = useRef<(i: number) => number>((i) => i);

  const api = useRef<null | {
    count: number;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    pick: (e: PointerEvent) => number;
    redrawSeeds: (seeds: Seed[]) => void;
    paintAt: (idx: number, label: number, erase: boolean) => void;
    paintMirrorAt: (idx: number, label: number, erase: boolean) => void;
    generate: (seeds: Seed[]) => { hist: Record<number, number> };
    showConc: (on: boolean) => void;
    debugSides: () => void;
    labels: () => Int16Array;
    clearAll: () => void;
    recolor: () => void;
  }>(null);

  const seedsRef = useRef<Seed[]>([]);
  const modeRef = useRef(-1);
  const toolRef = useRef<'seed' | 'brush'>('seed');
  const brushRef = useRef(0.018);
  const fineRef = useRef<(i: number) => number>((i) => i);
  seedsRef.current = seedsRef.current;
  modeRef.current = mode;
  toolRef.current = tool;
  brushRef.current = brush;
  fineRef.current = fineToGroup.current;

  useEffect(() => {
    if (coarse) {
      const map = new Map<number, number>();
      COARSE.forEach((c, gi) => {
        for (const m of c.members) {
          const fi = SCULPTURE_ORDER.indexOf(m);
          if (fi >= 0) map.set(fi, gi);
        }
      });
      fineToGroup.current = (i) => map.get(i) ?? 0;
    } else {
      fineToGroup.current = (i) => i;
    }
  }, [coarse]);

  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    let disposed = false;

    (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync('/models/sculpture/fitcheck-sculpture-tripo-v1.glb');
      if (disposed) return;
      gltf.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });

      const position: number[] = [];
      const normal: number[] = [];
      const index: number[] = [];
      for (const m of meshes) {
        const g = m.geometry as THREE.BufferGeometry;
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        const base = position.length / 3;
        for (let i = 0; i < pos.count; i++) {
          position.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) index.push(g.index.getX(i) + base);
        else for (let i = 0; i < pos.count; i++) index.push(i + base);
      }
      const count = position.length / 3;
      const box = new THREE.Box3();
      for (let i = 0; i < position.length; i += 3) box.expandByPoint(new THREE.Vector3(position[i], position[i + 1], position[i + 2]));
      const H = box.max.y - box.min.y;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;

      const X = new Float32Array(count);
      const Y = new Float32Array(count);
      const Z = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        X[i] = (position[i * 3] - cx) / H;
        Y[i] = (position[i * 3 + 1] - box.min.y) / H;
        Z[i] = (position[i * 3 + 2] - cz) / H;
      }

      // 对称轴：按身高切片取 (minX+maxX)/2 的中位数，比整体包围盒稳
      const slabCenter: number[] = [];
      const BINS = 60;
      const minB = new Array(BINS).fill(Infinity);
      const maxB = new Array(BINS).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        const b = Math.min(BINS - 1, Math.max(0, Math.floor(Y[i] * BINS)));
        minB[b] = Math.min(minB[b], X[i]);
        maxB[b] = Math.max(maxB[b], X[i]);
      }
      for (let b = 0; b < BINS; b++) {
        if (!Number.isFinite(minB[b])) continue;
        slabCenter.push((minB[b] + maxB[b]) / 2);
      }
      slabCenter.sort((a, b) => a - b);
      const axisX = slabCenter[Math.floor(slabCenter.length / 2)] ?? 0;

      // 焊接
      const WELD = 1e-4;
      const weldMap = new Map<string, number>();
      const canon = new Int32Array(count);
      let canonCount = 0;
      for (let i = 0; i < count; i++) {
        const k = `${Math.round(X[i] / WELD)},${Math.round(Y[i] / WELD)},${Math.round(Z[i] / WELD)}`;
        const hit = weldMap.get(k);
        if (hit === undefined) { weldMap.set(k, canonCount); canon[i] = canonCount; canonCount++; }
        else canon[i] = hit;
      }
      const CX = new Float32Array(canonCount);
      const CY = new Float32Array(canonCount);
      const CZ = new Float32Array(canonCount);
      const CNX = new Float32Array(canonCount);
      const CNY = new Float32Array(canonCount);
      const CNZ = new Float32Array(canonCount);
      for (let i = 0; i < count; i++) {
        const ci = canon[i];
        CX[ci] = X[i]; CY[ci] = Y[i]; CZ[ci] = Z[i];
        CNX[ci] = normal[i * 3]; CNY[ci] = normal[i * 3 + 1]; CNZ[ci] = normal[i * 3 + 2];
      }

      // 邻接 + 折痕权重
      const deg = new Int32Array(canonCount);
      const pairs: number[] = [];
      for (let t = 0; t < index.length; t += 3) {
        const a = canon[index[t]];
        const b = canon[index[t + 1]];
        const c = canon[index[t + 2]];
        if (a !== b) { pairs.push(a, b); deg[a]++; }
        if (b !== c) { pairs.push(b, c); deg[b]++; }
        if (c !== a) { pairs.push(c, a); deg[c]++; }
      }
      const adjOffset = new Int32Array(canonCount + 1);
      for (let i = 0; i < canonCount; i++) adjOffset[i + 1] = adjOffset[i] + deg[i];
      const adjTo = new Int32Array(pairs.length / 2);
      const adjW = new Float32Array(pairs.length / 2);
      const cursor = adjOffset.slice(0, canonCount);
      for (let k = 0; k < pairs.length; k += 2) {
        const u = pairs[k];
        const v = pairs[k + 1];
        adjTo[slotOf(cursor, u)] = v;
      }
      function slotOf(cur: Int32Array, u: number) { return cur[u]++; }

      // ---------- 凹陷度（多环邻域） ----------
      const conc = new Float32Array(canonCount);
      for (let i = 0; i < canonCount; i++) {
        let sum = 0;
        let n = 0;
        for (let k = adjOffset[i]; k < adjOffset[i + 1]; k++) {
          const j = adjTo[k];
          const dx = CX[j] - CX[i];
          const dy = CY[j] - CY[i];
          const dz = CZ[j] - CZ[i];
          const len = Math.hypot(dx, dy, dz);
          if (len < 1e-9) continue;
          sum += (dx * CNX[i] + dy * CNY[i] + dz * CNZ[i]) / len;
          n++;
        }
        conc[i] = n ? sum / n : 0;
      }
      // 两轮邻域平滑，把沟壑连成带
      for (let round = 0; round < 2; round++) {
        const next = new Float32Array(conc);
        for (let i = 0; i < canonCount; i++) {
          let sum = conc[i] * 2;
          let n = 2;
          for (let k = adjOffset[i]; k < adjOffset[i + 1]; k++) {
            sum += conc[adjTo[k]];
            n++;
          }
          next[i] = sum / n;
        }
        conc.set(next);
      }
      const sorted = Float32Array.from(conc).sort();
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
      const concN = new Float32Array(canonCount);
      for (let i = 0; i < canonCount; i++) {
        concN[i] = Math.min(1, Math.max(0, conc[i] / Math.max(1e-6, p95)));
      }

      // 指数阻力：深沟的通行代价暴增（按 CSR 槽位逐条算）
      for (let u = 0; u < canonCount; u++) {
        for (let k = adjOffset[u]; k < adjOffset[u + 1]; k++) {
          const v = adjTo[k];
          const len = Math.hypot(CX[u] - CX[v], CY[u] - CY[v], CZ[u] - CZ[v]);
          const c = Math.max(concN[u], concN[v]);
          adjW[k] = len * Math.exp(9 * c);
        }
      }

      // 渲染：保留光照
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.setSize(hostEl.clientWidth, hostEl.clientHeight, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      hostEl.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfffaf4, 0xc9beb2, 1.05));
      const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.1);
      keyLight.position.set(-3, 4, 5);
      scene.add(keyLight);
      const fill = new THREE.DirectionalLight(0xffffff, 0.85);
      fill.position.set(3, 2, -4);
      scene.add(fill);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
      const colors = new Float32Array(count * 3);
      const PLATE = new THREE.Color(0xf3ede4);
      for (let i = 0; i < count; i++) { colors[i * 3] = PLATE.r; colors[i * 3 + 1] = PLATE.g; colors[i * 3 + 2] = PLATE.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(index);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      const holder = new THREE.Group();
      holder.add(mesh);
      holder.rotation.y = -Math.PI / 2;
      mesh.position.set(-cx, -(box.min.y + H / 2), -cz);
      scene.add(holder);
      const camera = new THREE.PerspectiveCamera(30, hostEl.clientWidth / hostEl.clientHeight, 0.01, 50);
      camera.position.set(0, 0, 2.3);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.minDistance = 1.5;
      controls.maxDistance = 6;

      // 种子点
      const seedGeo = new THREE.BufferGeometry();
      const seedPos = new Float32Array(4096 * 3);
      const seedCol = new Float32Array(4096 * 3);
      seedGeo.setAttribute('position', new THREE.BufferAttribute(seedPos, 3));
      seedGeo.setAttribute('color', new THREE.BufferAttribute(seedCol, 3));
      const seedPoints = new THREE.Points(seedGeo, new THREE.PointsMaterial({
        size: 0.02, vertexColors: true, sizeAttenuation: true, depthTest: false,
      }));
      seedPoints.frustumCulled = false;
      holder.add(seedPoints);

      // 顶点网格
      const CELL = 0.008;
      const grid = new Map<string, number[]>();
      const cellKey = (a: number, b: number, c: number) => `${Math.floor(a / CELL)},${Math.floor(b / CELL)},${Math.floor(c / CELL)}`;
      for (let i = 0; i < count; i++) {
        const k = cellKey(X[i], Y[i], Z[i]);
        const arr = grid.get(k);
        if (arr) arr.push(i); else grid.set(k, [i]);
      }
      const nearVertices = (x: number, y: number, z: number, r: number) => {
        const out: number[] = [];
        const r2 = r * r;
        const c = Math.ceil(r / CELL);
        const bx = Math.floor(x / CELL);
        const by = Math.floor(y / CELL);
        const bz = Math.floor(z / CELL);
        for (let dx = -c; dx <= c; dx++) for (let dy = -c; dy <= c; dy++) for (let dz = -c; dz <= c; dz++) {
          const arr = grid.get(`${bx + dx},${by + dy},${bz + dz}`);
          if (!arr) continue;
          for (const i of arr) {
            if ((X[i] - x) ** 2 + (Y[i] - y) ** 2 + (Z[i] - z) ** 2 <= r2) out.push(i);
          }
        }
        return out;
      };
      const cLabels = new Int16Array(canonCount).fill(-1);
      const cPainted = new Int16Array(canonCount).fill(-1);
      const cLocked = new Uint8Array(canonCount);

      // 规范顶点 → 原始顶点列表
      const cdeg = new Int32Array(canonCount);
      for (let i = 0; i < count; i++) cdeg[canon[i]]++;
      const cOff = new Int32Array(canonCount + 1);
      for (let i = 0; i < canonCount; i++) cOff[i + 1] = cOff[i] + cdeg[i];
      const cList = new Int32Array(count);
      const ccur = cOff.slice(0, canonCount);
      for (let i = 0; i < count; i++) cList[ccur[canon[i]]++] = i;

      // 右半边网格，用于左侧取镜像标签
      const rGrid = new Map<string, number[]>();
      for (let i = 0; i < canonCount; i++) {
        if (CX[i] < axisX + 0.002) continue;
        const k = cellKey(CX[i], CY[i], CZ[i]);
        const arr = rGrid.get(k);
        if (arr) arr.push(i); else rGrid.set(k, [i]);
      }
      const pairR = new Int32Array(canonCount).fill(-1);
      console.log('[axis]', axisX.toFixed(4), 'slabs', slabCenter.length);
      for (let i = 0; i < canonCount; i++) {
        if (CX[i] >= axisX - 0.002) continue;
        const mx = 2 * axisX - CX[i];
        const bx = Math.floor(mx / CELL);
        const by = Math.floor(CY[i] / CELL);
        const bz = Math.floor(CZ[i] / CELL);
        let best = -1;
        let bd = Infinity;
        for (let r = 0; r <= 6 && best < 0; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const arr = rGrid.get(`${bx + dx},${by + dy},${bz + dz}`);
            if (!arr) continue;
            for (const j of arr) {
              const d = (CX[j] - mx) ** 2 + (CY[j] - CY[i]) ** 2 + (CZ[j] - CZ[i]) ** 2;
              if (d < bd) { bd = d; best = j; }
            }
          }
        }
        pairR[i] = best;
      }

      const mirrorOf = (idx: number) => {
        const mx = 2 * axisX - X[idx];
        const near = nearVertices(mx, Y[idx], Z[idx], 0.02);
        let best = -1;
        let bd = Infinity;
        for (const j of near) {
          const d = (X[j] - mx) ** 2 + (Y[j] - Y[idx]) ** 2 + (Z[j] - Z[idx]) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        return best;
      };

      const raycaster = new THREE.Raycaster();
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const tmpV = new THREE.Vector3();
      const pick = (e: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hit = raycaster.intersectObject(mesh, false)[0];
        if (!hit || !hit.face) return -1;
        const cand = [hit.face.a, hit.face.b, hit.face.c];
        let best = cand[0];
        let bd = Infinity;
        for (const i of cand) {
          tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
          const d = tmpV.distanceToSquared(hit.point);
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };

      const palette = (n: number) => new Array(n).fill(0).map((_, i) =>
        new THREE.Color().setHSL(((i * 0.61803398875) % 1) * 0.97, 0.62, 0.52));
      let PAL = palette(SCULPTURE_ORDER.length);

      console.log('[pair] found', pairR.filter((v) => v >= 0).length, 'of', canonCount);
      // 没配对的左顶点，从最近的已配对左邻居借标签
      const leftUnmatched = new Int32Array(canonCount).fill(0);
      for (let i = 0; i < canonCount; i++) {
        if (pairR[i] >= 0 || CX[i] >= axisX) continue;
        leftUnmatched[i] = 1;
      }
      console.log('[pair] left unmatched', Array.from(leftUnmatched).filter(Boolean).length);
      const applyColors = () => {
        const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          const l = cLabels[canon[i]];
          let c: THREE.Color;
          if (l === BG) c = new THREE.Color(0xa8a29a);
          else if (l < 0) c = PLATE;
          else {
            const gi = fineRef.current(l);
            c = PAL[gi] ?? PLATE;
          }
          colAttr.setXYZ(i, c.r, c.g, c.b);
        }
        colAttr.needsUpdate = true;
      };

      const debugSides = () => {
        const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          const l = cLabels[canon[i]];
          if (l < 0) continue;
          const left = X[i] < axisX;
          colAttr.setXYZ(i, left ? 0.9 : 0.1, 0.1, left ? 0.1 : 0.9);
        }
        colAttr.needsUpdate = true;
      };

      const recolor = () => {
        PAL = palette(coarseRef.current ? COARSE.length : SCULPTURE_ORDER.length);
        applyColors();
      };
      const coarseRef = { current: false };

      const redrawSeeds = (list: Seed[]) => {
        const pos = seedPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        const col = seedPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
        const max = Math.min(list.length, pos.count);
        for (let i = 0; i < max; i++) {
          const s = list[i];
          pos.setXYZ(i, position[s.idx * 3], position[s.idx * 3 + 1], position[s.idx * 3 + 2]);
          const c = s.label === BG ? new THREE.Color(0x6b675f) : PAL[fineRef.current(s.label)] ?? new THREE.Color(0xffffff);
          col.setXYZ(i, c.r, c.g, c.b);
        }
        seedPoints.geometry.setDrawRange(0, max);
        pos.needsUpdate = true;
        col.needsUpdate = true;
      };

      // 有界漫水：从命中点沿网格扩散，遇到凹陷度高的边代价指数上升 → 自然停在沟壑
      const floodFill = (idx: number, label: number, erase: boolean) => {
        const limit = Math.max(0.004, brushRef.current);
        const ci = canon[idx];
        const dist = new Float32Array(canonCount).fill(Infinity);
        const heap = new MinHeap();
        dist[ci] = 0;
        heap.push(0, ci);
        const hitCanon: number[] = [];
        while (!heap.empty()) {
          const [d, u] = heap.pop() as [number, number];
          if (d > dist[u] + 1e-9) continue;
          if (d > limit) break;
          hitCanon.push(u);
          for (let k = adjOffset[u]; k < adjOffset[u + 1]; k++) {
            const v = adjTo[k];
            const nd = d + adjW[k];
            if (nd < dist[v] && nd <= limit) { dist[v] = nd; heap.push(nd, v); }
          }
        }
        for (const c of hitCanon) {
          if (erase) {
            cPainted[c] = -1;
            cLocked[c] = 0;
            cLabels[c] = -1;
          } else {
            cPainted[c] = label;
            cLocked[c] = label === BG ? 1 : 0;
            cLabels[c] = label;
          }
        }
        return hitCanon.length;
      };

      // 左侧标签直接抄右侧镜像顶点
      const enforceSymmetry = () => {
        for (let i = 0; i < canonCount; i++) {
          const j = pairR[i];
          if (j < 0) continue;
          cLabels[i] = cLabels[j];
          cPainted[i] = cPainted[j];
          cLocked[i] = cLocked[j];
        }
      };

      const paintAt = (idx: number, label: number, erase: boolean) => {
        // 只在右半身操作，然后整体镜像
        const x = X[idx];
        const start = x < axisX - 0.002 ? mirrorOf(idx) : idx;
        if (start < 0) return 0;
        const n = floodFill(start, label, erase);
        enforceSymmetry();
        applyColors();
        let lc = 0;
        let rc = 0;
        for (let c = 0; c < canonCount; c++) {
          if (cLabels[c] < 0) continue;
          if (CX[c] < axisX) lc++; else rc++;
        }
        console.log('[paint] flooded', n, 'left', lc, 'right', rc, 'axis', axisX.toFixed(3), 'startX', X[start].toFixed(3));
        return n;
      };

      const paintMirrorAt = (idx: number, label: number, erase: boolean) => {
        const m = mirrorOf(idx);
        if (m >= 0) paintAt(m, label, erase);
      };

      const generate = (seedList: Seed[]) => {
        const dist = new Float32Array(canonCount).fill(Infinity);
        const clab = new Int16Array(canonCount).fill(-1);
        const heap = new MinHeap();
        for (let c = 0; c < canonCount; c++) {
          if (cPainted[c] >= 0) {
            if (dist[c] > 0) { dist[c] = 0; clab[c] = cPainted[c]; heap.push(0, c); }
          } else if (cLocked[c]) {
            if (dist[c] > 0) { dist[c] = 0; clab[c] = BG; heap.push(0, c); }
          }
        }
        for (const s of seedList) {
          const ci = canon[s.idx];
          if (dist[ci] > 0) { dist[ci] = 0; clab[ci] = s.label; heap.push(0, ci); }
        }
        while (!heap.empty()) {
          const [d, u] = heap.pop() as [number, number];
          if (d > dist[u] + 1e-9) continue;
          for (let k = adjOffset[u]; k < adjOffset[u + 1]; k++) {
            const v = adjTo[k];
            const nd = d + adjW[k];
            if (nd < dist[v] - 1e-9) { dist[v] = nd; clab[v] = clab[u]; heap.push(nd, v); }
          }
        }
        for (let round = 0; round < 2; round++) {
          const next = new Int16Array(clab);
          for (let i = 0; i < canonCount; i++) {
            if (clab[i] === BG) continue;
            const votes = new Map<number, number>();
            votes.set(clab[i], 2);
            for (let k = adjOffset[i]; k < adjOffset[i + 1]; k++) {
              const l = clab[adjTo[k]];
              votes.set(l, (votes.get(l) ?? 0) + 1);
            }
            let bl = clab[i];
            let bc = -1;
            for (const [l, c] of votes) if (c > bc) { bc = c; bl = l; }
            next[i] = bl;
          }
          clab.set(next);
        }
        // 孤立壳补色
        const FCELL = 0.02;
        const fgrid = new Map<string, number[]>();
        for (let i = 0; i < canonCount; i++) {
          if (clab[i] < 0) continue;
          const k = `${Math.floor(CX[i] / FCELL)},${Math.floor(CY[i] / FCELL)},${Math.floor(CZ[i] / FCELL)}`;
          const arr = fgrid.get(k);
          if (arr) arr.push(i); else fgrid.set(k, [i]);
        }
        for (let i = 0; i < canonCount; i++) {
          if (clab[i] >= 0) continue;
          const bx = Math.floor(CX[i] / FCELL);
          const by = Math.floor(CY[i] / FCELL);
          const bz = Math.floor(CZ[i] / FCELL);
          let best = -1;
          let bd = Infinity;
          for (let r = 0; r <= 4 && best < 0; r++) {
            for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
              const arr = fgrid.get(`${bx + dx},${by + dy},${bz + dz}`);
              if (!arr) continue;
              for (const j of arr) {
                const d = (CX[j] - CX[i]) ** 2 + (CY[j] - CY[i]) ** 2 + (CZ[j] - CZ[i]) ** 2;
                if (d < bd) { bd = d; best = j; }
              }
            }
          }
          if (best >= 0) clab[i] = clab[best];
        }
        const next = new Int16Array(canonCount);
        for (let c = 0; c < canonCount; c++) {
          next[c] = cPainted[c] >= 0 ? cPainted[c] : cLocked[c] ? BG : clab[c];
        }
        // 左半身照抄右半身
        for (let c = 0; c < canonCount; c++) {
          const j = pairR[c];
          if (j >= 0) next[c] = next[j];
        }
        cLabels.set(next);
        const hist: Record<number, number> = {};
        for (let i = 0; i < count; i++) {
          const l = cLabels[canon[i]];
          hist[l] = (hist[l] ?? 0) + 1;
        }
        applyColors();
        return { hist };
      };

      const showConc = (on: boolean) => {
        const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
        if (!on) { applyColors(); return; }
        for (let i = 0; i < count; i++) {
          const c = concN[canon[i]];
          const v = 1 - Math.min(1, c * 1.15);
          const g = 0.35 + 0.65 * v;
          colAttr.setXYZ(i, g, g, g);
        }
        colAttr.needsUpdate = true;
      };

      const clearAll = () => {
        cLabels.fill(-1);
        cPainted.fill(-1);
        cLocked.fill(0);
        applyColors();
        redrawSeeds([]);
      };

      api.current = {
        count, renderer, camera, controls, pick, redrawSeeds, paintAt, paintMirrorAt, generate,
        labels: () => {
          const out = new Int16Array(count);
          for (let i = 0; i < count; i++) out[i] = cLabels[canon[i]];
          return out;
        },
        clearAll, recolor, showConc, debugSides,
      };
      (window as unknown as { __dbgSides?: () => void }).__dbgSides = debugSides;
      (window as unknown as { __seed: unknown }).__seed = {
        generate, paintAt, paintMirrorAt, clearAll, redrawSeeds,
        labels: () => {
          const out = new Int16Array(count);
          for (let i = 0; i < count; i++) out[i] = cLabels[canon[i]];
          return out;
        },
      };
      setStatus('就绪：左侧选肌群 → 点/涂');

      // 交互
      let dragging = false;
      let lastPaint = 0;
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const idx = pick(e);
        if (idx < 0) return;
        const m = modeRef.current;
        const erase = e.shiftKey;
        if (m < 0) return;
        if (toolRef.current === 'seed' && m !== BG) {
          const dup = seedsRef.current.findIndex((s) => s.idx === idx && s.label === m);
          if (dup >= 0) {
            const next = seedsRef.current.filter((_, i) => i !== dup);
            seedsRef.current = next;
            setSeedCounts(countBy(next));
            redrawSeeds(next);
            return;
          }
          const add: Seed[] = [{ label: m, idx }];
          const mm = mirrorOf(idx);
          if (mm >= 0 && mm !== idx) add.push({ label: m, idx: mm });
          const next = [...seedsRef.current, ...add];
          seedsRef.current = next;
          setSeedCounts(countBy(next));
          redrawSeeds(next);
          return;
        }
        dragging = true;
        paintAt(idx, m, erase);
        paintMirrorAt(idx, m, erase);
        lastPaint = performance.now();
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        if (performance.now() - lastPaint < 16) return;
        lastPaint = performance.now();
        const idx = pick(e);
        if (idx < 0) return;
        const m = modeRef.current;
        if (m < 0) return;
        paintAt(idx, m, e.shiftKey);
        paintMirrorAt(idx, m, e.shiftKey);
      };
      const onUp = () => { dragging = false; };

      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);

      const animate = () => {
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      };
      animate();
    })().catch((e: Error) => setStatus(`出错：${e.message}`));

    return () => {
      disposed = true;
      const a = api.current;
      a?.renderer.dispose();
      a?.renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (api.current) api.current.recolor();
  }, [coarse]);

  const running = useRef(false);
  const generate = useCallback(() => {
    const a = api.current;
    if (!a || running.current) return;
    running.current = true;
    setStatus('计算中…');
    setTimeout(() => {
      const res = a.generate(seedsRef.current);
      setCounts(res.hist);
      const assigned = Object.entries(res.hist).filter(([k]) => Number(k) >= 0).length;
      setStatus(`完成：${assigned} 个区域`);
      running.current = false;
    }, 30);
  }, []);

  const doExport = useCallback(() => {
    const a = api.current;
    if (!a) return;
    const labels = a.labels();
    const bytes = new Uint8Array(labels.length);
    for (let i = 0; i < labels.length; i++) bytes[i] = labels[i] < 0 ? 255 : labels[i];
    const groups = coarse ? COARSE.map((c) => c.id) : SCULPTURE_ORDER;
    const json = JSON.stringify({
      coarse,
      groups,
      seeds: seedsRef.current.map((s) => ({ group: groups[fineToGroup.current(s.label)] ?? String(s.label), idx: s.idx })),
      count: a.count,
    }, null, 2);
    download('sculpture-seeds.json', new Blob([json], { type: 'application/json' }));
    download('sculpture-muscle.bin', new Blob([bytes], { type: 'application/octet-stream' }));
  }, [coarse]);

  const clearAll = useCallback(() => {
    seedsRef.current = [];
    setSeedCounts({});
    setCounts({});
    api.current?.clearAll();
    setStatus('已清空种子与颜色');
  }, []);

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, fontFamily: 'system-ui' }}>
      <div style={{ width: 196, maxHeight: 780, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{status}</div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <button type="button" onClick={() => setTool('seed')} style={{ ...btn(tool === 'seed'), textAlign: 'center' }}>点种子</button>
          <button type="button" onClick={() => setTool('brush')} style={{ ...btn(tool === 'brush'), textAlign: 'center' }}>涂抹</button>
        </div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
          <input type="checkbox" checked={coarse} onChange={(e) => setCoarse(e.target.checked)} /> 合并亚区（胸/肩）
        </label>

        <button type="button" onClick={() => setMode(BG)} style={btn(mode === BG)}>背景 / 不可点</button>
        {groups.map((g, i) => (
          <button key={g.key} type="button" onClick={() => setMode(i)} style={btn(mode === i)}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: `#${new THREE.Color().setHSL(((i * 0.61803398875) % 1) * 0.97, 0.62, 0.52).getHexString()}`, marginRight: 6 }} />
            {g.label}
          </button>
        ))}

        <label style={{ display: 'block', fontSize: 12, margin: '8px 0 2px' }}>
          <input
            type="checkbox"
            checked={showConc}
            onChange={(e) => { setShowConc(e.target.checked); api.current?.showConc(e.target.checked); }}
          /> 显示凹陷度
        </label>
        <div style={{ marginTop: 8, fontSize: 12 }}>填充范围（越大越能吃进整块肌肉）</div>
        <input type="range" min={0.02} max={0.9} step={0.01} value={brush} onChange={(e) => setBrush(Number(e.target.value))} style={{ width: '100%' }} />

        <button type="button" onClick={generate} style={{ ...btn(false), background: '#2f6b45', color: '#fff', marginTop: 8 }}>生成分区</button>
        <button type="button" onClick={doExport} style={{ ...btn(false), background: '#1e1e1e', color: '#fff' }}>导出 JSON + BIN</button>
        <button type="button" onClick={clearAll} style={btn(false)}>清空全部</button>

        <div style={{ fontSize: 11, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
          点种子：左键放（自动镜像）<br />
          涂抹：按住拖 → 直接刷该肌群<br />
          Shift + 拖：擦掉画笔<br />
          右键点种子：删除
        </div>
      </div>

      <div ref={host} style={{ width: 430, height: 780, background: '#f7f3ee', borderRadius: 8 }} />

      <div style={{ width: 180, fontSize: 11, color: '#555' }}>
        <div style={{ margin: '0 0 6px', color: '#999' }}>种子</div>
        {Object.entries(seedCounts).map(([l, n]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{Number(l) === BG ? '背景' : groups[Number(l)]?.label ?? l}</span><b>{n}</b>
          </div>
        ))}
        <div style={{ margin: '10px 0 4px', color: '#999' }}>面积</div>
        {Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 26).map(([l, n]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{Number(l) === BG ? '背景' : Number(l) < 0 ? '未分配' : groups[Number(l)]?.label ?? l}</span>
            <span>{((n / Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0))) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function countBy(list: Seed[]) {
  const out: Record<number, number> = {};
  for (const s of list) out[s.label] = (out[s.label] ?? 0) + 1;
  return out;
}

function btn(active: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', marginBottom: 2,
    fontSize: 12, borderRadius: 6, border: '1px solid #ddd',
    background: active ? '#2f6b45' : '#fff', color: active ? '#fff' : '#333', cursor: 'pointer',
  };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

class MinHeap {
  private d: number[] = [];
  private v: number[] = [];
  empty() { return this.d.length === 0; }
  push(dist: number, vert: number) {
    this.d.push(dist); this.v.push(vert);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): [number, number] | null {
    if (!this.d.length) return null;
    const top: [number, number] = [this.d[0], this.v[0]];
    const lastD = this.d.pop() as number;
    const lastV = this.v.pop() as number;
    if (this.d.length) {
      this.d[0] = lastD; this.v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1; const r = l + 1; let s = i;
        if (l < this.d.length && this.d[l] < this.d[s]) s = l;
        if (r < this.d.length && this.d[r] < this.d[s]) s = r;
        if (s === i) break;
        this.swap(i, s); i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.d[a], this.d[b]] = [this.d[b], this.d[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

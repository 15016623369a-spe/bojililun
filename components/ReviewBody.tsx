'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { groupForMeshName, type MuscleId } from '@/lib/muscles';

interface SceneApi {
  meshes: THREE.Mesh[];
  base: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
  lit: THREE.MeshStandardMaterial;
  sel: THREE.MeshStandardMaterial;
  controls: OrbitControls;
  camera: THREE.PerspectiveCamera;
  fitDist: number;
}

// 与 2D 图集一致的口径：记录过的部位绿、没记录的瓷白、非训练部位再浅一点。
const PORCELAIN = 0xe2dbd0;
const DIM = 0xefe9e2;
const GREEN = 0x56765f;
const GREEN_DARK = 0x2f6b47;
// 只留颅骨/下颌/面骨当脑袋，其余骨头（脊柱、肋骨…）不画
const SKULL = /(cranium|parietal|frontal|occipital|sphenoid|temporal bone|maxilla|zygomatic|mandible|nasal|ethmoid|lacrimal|vomer|palatine)/i;

/** 回顾页的 3D 人体：可拖动旋转、双指缩放，记录过的部位染绿，点一下筛选时间线 */
export default function ReviewBody({ recorded, selected, initialSide, onInspect }: {
  recorded: MuscleId[];
  selected: MuscleId | null;
  initialSide: 'front' | 'back';
  onInspect: (muscle: MuscleId) => void;
}) {
  const mount = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const inspect = useRef(onInspect);
  const lit = useRef(recorded);
  inspect.current = onInspect;
  lit.current = recorded;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const recordedKey = recorded.join(',');
  const side = useRef(initialSide);
  const selectedRef = useRef(selected);
  const colors = useRef<(() => void) | null>(null);
  side.current = initialSide;
  selectedRef.current = selected;

  useEffect(() => {
    const mountNode = mount.current;
    if (!mountNode) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed('当前浏览器不支持 WebGL');
      setLoading(false);
      return;
    }

    const width = mountNode.clientWidth || 254;
    const height = mountNode.clientHeight || 323;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mountNode.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, width / height, 0.01, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc5bb, 1.55));
    const front = new THREE.DirectionalLight(0xffffff, 1.5);
    front.position.set(-2.4, 3.2, 4.2);
    scene.add(front);
    const back = new THREE.DirectionalLight(0xffffff, 1.5);
    back.position.set(2.4, 3.2, -4.2);
    scene.add(back);
    const fill = new THREE.DirectionalLight(0xf6ece2, 0.8);
    fill.position.set(3, -1, 0);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.autoRotate = false;
    // 只允许上下转半圈多一点，别转到脚底
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.88;

    const base = new THREE.MeshStandardMaterial({ color: PORCELAIN, roughness: 0.86, metalness: 0.02 });
    const skull = new THREE.MeshStandardMaterial({ color: 0xe7ded3, roughness: 0.92, metalness: 0.01 });
    const dim = new THREE.MeshStandardMaterial({ color: DIM, roughness: 0.94, metalness: 0.01 });
    const litMat = new THREE.MeshStandardMaterial({
      color: GREEN, roughness: 0.7, metalness: 0.02, emissive: new THREE.Color(GREEN).multiplyScalar(0.16),
    });
    const selMat = new THREE.MeshStandardMaterial({
      color: GREEN_DARK, roughness: 0.6, metalness: 0.02, emissive: new THREE.Color(GREEN_DARK).multiplyScalar(0.3),
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
        const totalBox = new THREE.Box3().setFromObject(root);
        const totalSize = totalBox.getSize(new THREE.Vector3());
        const headCut = totalBox.max.y - totalSize.y * 0.132;
        const HIDE =
          /(finger|thumb|palm|wrist|thenar|hypothenar|pollicis|digiti|of hand|digitorum|tendon|aponeurosis|retinaculum|membrane|septum|fascia|interosseous|nipple|areola|skin|subcutaneous|bursa|palmaris|plantaris)/i;

        root.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const ud = obj.userData as Record<string, unknown>;
          const nameDetail = String(ud.nameDetail ?? ud.name ?? '');
          if (ud.type !== 'muscle') {
            // 头面部的骨头留着当脑袋（否则会是个怪球），其余骨骼全部隐藏
            if (ud.type === 'bone' && SKULL.test(nameDetail)) {
              obj.userData.groupId = null;
              obj.material = skull;
              return;
            }
            obj.visible = false;
            return;
          }
          const mb = new THREE.Box3().setFromObject(obj);
          if (mb.getCenter(new THREE.Vector3()).y > headCut) {
            // 头面部肌肉太碎，小图里看不清，只留骨头
            obj.visible = false;
            return;
          }
          if (HIDE.test(nameDetail)) {
            obj.visible = false;
            return;
          }
          const group = groupForMeshName(nameDetail);
          obj.userData.groupId = group?.id ?? null;
          obj.material = group ? base : dim;
          meshes.push(obj);
        });

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const wrapper = new THREE.Group();
        root.position.sub(center);
        wrapper.add(root);
        scene.add(wrapper);

        // 整身入镜：竖着的取景框按高度定机位
        const visibleH = size.y * 0.92;
        const fitDist = (visibleH / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.02;
        camera.position.set(0, 0, side.current === 'back' ? -fitDist : fitDist);
        controls.target.set(0, 0, 0);
        // 模型本身的精度有限，最近只放到「上半身特写」，再近就是一片大三角面
        controls.minDistance = fitDist * 0.55;
        controls.maxDistance = fitDist * 1.4;
        controls.update();

        apiRef.current = { meshes, base, dim, lit: litMat, sel: selMat, controls, camera, fitDist };
        setLoading(false);

        // 记录部位 / 选中部位变了只换材质
        applyColors();
      },
      undefined,
      () => {
        if (disposed) return;
        setFailed('人体模型没加载出来');
        setLoading(false);
      },
    );

    function applyColors() {
      const api = apiRef.current;
      if (!api) return;
      const on = new Set(lit.current);
      for (const m of api.meshes) {
        const gid = m.userData.groupId as MuscleId | null;
        if (!gid) m.material = api.dim;
        else if (gid === selectedRef.current) m.material = api.sel;
        else if (on.has(gid)) m.material = api.lit;
        else m.material = api.base;
      }
    }
    colors.current = applyColors;

    // 点一下（不是拖动）选中一块记录过的肌肉
    let down: { x: number; y: number; at: number } | null = null;
    const pick = (event: PointerEvent) => {
      const api = apiRef.current;
      if (!api) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx, ny), api.camera);
      const hit = ray.intersectObjects(api.meshes, false).find((item) => item.object.visible);
      const gid = hit ? (hit.object.userData.groupId as MuscleId | null) : null;
      return gid ?? null;
    };

    renderer.domElement.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY, at: Date.now() };
    });
    renderer.domElement.addEventListener('pointerup', (event) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const quick = Date.now() - down.at < 700;
      down = null;
      if (moved > 8 || !quick) return;
      const gid = pick(event);
      if (gid && lit.current.includes(gid)) inspect.current(gid);
    });
    renderer.domElement.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || down) return;
      renderer.domElement.style.cursor = pick(event) ? 'pointer' : 'grab';
    });

    const ro = new ResizeObserver(() => {
      const w = mountNode.clientWidth;
      const h = mountNode.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mountNode);

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
      base.dispose();
      dim.dispose();
      skull.dispose();
      litMat.dispose();
      selMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountNode) mountNode.removeChild(renderer.domElement);
      apiRef.current = null;
      colors.current = null;
    };
  }, []);

  useEffect(() => {
    colors.current?.();
  }, [recordedKey, selected, loading]);

  // 记录主要落在哪一面，就先把那一面转过来
  useEffect(() => {
    const api = apiRef.current;
    if (!api || loading) return;
    api.camera.position.set(0, 0, initialSide === 'back' ? -api.fitDist : api.fitDist);
    api.controls.target.set(0, 0, 0);
    api.controls.update();
  }, [initialSide, loading]);

  return (
    <div className="review-body" ref={mount}>
      {loading && !failed && <span className="review-body-loading" role="status">加载人体模型…</span>}
      {failed && <span className="review-body-loading" role="status">{failed}</span>}
    </div>
  );
}

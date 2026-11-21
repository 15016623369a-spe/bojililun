'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { groupForMeshName } from '@/lib/muscles';

export interface HeatItem {
  id: string;
  level: number;
}

const COLD = new THREE.Color('#c3d6e9');
const HOT = new THREE.Color('#47759e');

function heatColor(level: number): THREE.Color {
  return COLD.clone().lerp(HOT, Math.max(0, Math.min(1, level)));
}

interface SceneApi {
  meshes: THREE.Mesh[];
  groupMats: Map<string, THREE.MeshStandardMaterial>;
  base: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
  controls: OrbitControls;
  camera: THREE.PerspectiveCamera;
  fitDist: number;
  focusY: number;
}

/** 训练详情的「解剖图 + 热区」：按肌群努力量上色，可拖拽旋转、切正/背面 */
export default function BodyHeat({ heat }: { heat: HeatItem[] }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const [side, setSide] = useState<'back' | 'front'>('back');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const heatKey = heat.map((h) => `${h.id}:${h.level.toFixed(2)}`).join(',');

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
    const height = mount.clientHeight || 320;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, width / height, 0.01, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc5bb, 1.5));
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
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;
    controls.autoRotate = false;

    const base = new THREE.MeshStandardMaterial({ color: 0xdaddd8, roughness: 0.86, metalness: 0.02 });
    const dim = new THREE.MeshStandardMaterial({ color: 0xecede9, roughness: 0.94, metalness: 0.01 });
    const groupMats = new Map<string, THREE.MeshStandardMaterial>();

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

        const headBox = new THREE.Box3();
        const totalBox = new THREE.Box3().setFromObject(root);
        const totalSize = totalBox.getSize(new THREE.Vector3());
        const headCut = totalBox.max.y - totalSize.y * 0.132;
        const HIDE =
          /(finger|thumb|palm|wrist|thenar|hypothenar|pollicis|digiti|of hand|digitorum|tendon|aponeurosis|retinaculum|membrane|septum|fascia|interosseous|nipple|areola|skin|subcutaneous|bursa|palmaris|plantaris)/i;

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
          if (HIDE.test(nameDetail)) {
            obj.visible = false;
            return;
          }
          const group = groupForMeshName(nameDetail);
          obj.userData.groupId = group?.id ?? null;
          obj.material = group ? base : dim;
          if (group && !groupMats.has(group.id)) {
            groupMats.set(group.id, new THREE.MeshStandardMaterial({ color: 0xdaddd8, roughness: 0.72, metalness: 0.02 }));
          }
          meshes.push(obj);
        });

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const wrapper = new THREE.Group();
        root.position.sub(center);
        wrapper.add(root);
        scene.add(wrapper);

        if (!headBox.isEmpty()) {
          const headMat = new THREE.MeshStandardMaterial({ color: 0xd8d9d5, roughness: 0.97, metalness: 0.01 });
          const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), headMat);
          head.position.set(0, totalBox.max.y - totalSize.y * 0.072 - center.y, -totalSize.z * 0.012);
          head.scale.set(totalSize.y * 0.054, totalSize.y * 0.066, totalSize.y * 0.058);
          scene.add(head);
        }

        const visibleH = size.y * 0.78;
        const fitDist = (visibleH / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.0;
        const focusY = size.y * 0.13;
        camera.position.set(0, focusY, -fitDist);
        controls.target.set(0, focusY, 0);
        controls.update();

        apiRef.current = { meshes, groupMats, base, dim, controls, camera, fitDist, focusY };
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
      groupMats.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 热区变化：只换材质颜色 */
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
      const level = levels.get(gid) ?? 0;
      const mat = api.groupMats.get(gid);
      if (!mat) {
        m.material = api.base;
        continue;
      }
      if (level <= 0.01) {
        mat.color.set(0xdaddd8);
        mat.emissive.set(0x000000);
        mat.emissiveIntensity = 0;
      } else {
        mat.color.copy(heatColor(level));
        mat.emissive.copy(heatColor(level)).multiplyScalar(0.25);
        mat.emissiveIntensity = 0.6;
      }
      m.material = mat;
    }
  }, [heatKey, loading, heat]);

  /* 正面 / 背面 */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.camera.position.set(0, api.focusY, side === 'back' ? -api.fitDist : api.fitDist);
    api.controls.target.set(0, api.focusY, 0);
    api.controls.update();
  }, [side, loading]);

  return (
    <div className="fc-heat" ref={mountRef}>
      {loading && !failed && <div className="fc-loading">加载人体模型…</div>}
      {failed && <div className="fc-loading">{failed}</div>}
      {!failed && (
        <div className="fc-heat-tabs">
          <button type="button" className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>
            正面
          </button>
          <button type="button" className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>
            背面
          </button>
        </div>
      )}
    </div>
  );
}

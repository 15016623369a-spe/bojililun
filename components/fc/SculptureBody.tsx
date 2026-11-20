'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import { SCULPTURE_BLOBS, SCULPTURE_ORDER, muscleAt } from '@/lib/sculpture';

const PLATE = new THREE.Color(0xf3ede4);
const GREEN = new THREE.Color(0x5d8468);
const GREEN_SEL = new THREE.Color(0x2f6b45);

/** 记录/选中 → 32×1 的热力贴图，着色器按区域下标取样 */
function heatTexture(recorded: MuscleId[], selected: MuscleId | null) {
  const W = 32;
  const data = new Uint8Array(W * 4);
  for (let i = 0; i < W; i++) {
    const id = SCULPTURE_ORDER[i];
    const on = id ? recorded.includes(id) : false;
    const sel = selected && id === selected;
    data[i * 4] = sel ? 255 : on ? 200 : 0;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export default function SculptureBody({
  recorded = [],
  selected = null,
  side = 'front',
  onPick,
  spin = false,
}: {
  recorded?: MuscleId[];
  selected?: MuscleId | null;
  side?: 'front' | 'back';
  onPick?: (id: MuscleId) => void;
  spin?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<{
    subject: THREE.Object3D;
    materials: THREE.MeshStandardMaterial[];
    heat: THREE.DataTexture;
    spin: boolean;
  } | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // 记录 / 选中变化 → 更新热力贴图
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const next = heatTexture(recorded, selected);
    a.materials.forEach((m) => {
      const u = (m.userData.heatUniform as { value: THREE.Texture } | undefined)?.value;
      if (u) u.dispose();
      if (m.userData.heatUniform) {
        m.userData.heatUniform.value = next;
      }
    });
    a.heat.dispose();
    a.heat = next;
  }, [recorded, selected]);

  // 正/背面
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.subject.rotation.y = (side === 'back' ? Math.PI : 0) - Math.PI / 2;
  }, [side]);

  useEffect(() => {
    const a = api.current;
    if (a) a.spin = spin;
  }, [spin]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.style.overflow = 'hidden';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
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

    const segA: THREE.Vector3[] = [];
    const segB: THREE.Vector3[] = [];
    const segR: number[] = [];
    for (const id of SCULPTURE_ORDER) {
      const blob = SCULPTURE_BLOBS[id];
      segA.push(new THREE.Vector3(...blob[0]));
      segB.push(new THREE.Vector3(...blob[1]));
      segR.push(blob[2]);
    }
    const initialHeat = heatTexture(recorded, selected);
    const materials: THREE.MeshStandardMaterial[] = [];
    const bounds = { minY: 0, invH: 1 };

    new GLTFLoader().load('/models/sculpture/fitcheck-sculpture-tripo-v1.glb', (gltf) => {
      if (disposed) return;
      const subject = gltf.scene;
      subject.rotation.y = (side === 'back' ? Math.PI : 0) - Math.PI / 2;
      const box = new THREE.Box3().setFromObject(subject);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      bounds.minY = box.min.y;
      bounds.invH = 1 / Math.max(0.001, size.y);
      subject.position.sub(center);
      subject.scale.setScalar(2.05 / size.y);
      subject.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = new THREE.MeshStandardMaterial({
          color: PLATE.clone(),
          roughness: 0.88,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        const uniform = { value: initialHeat as THREE.Texture };
        mat.userData.heatUniform = uniform;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uHeat = uniform;
          shader.uniforms.uGreen = { value: GREEN.clone() };
          shader.uniforms.uGreenSel = { value: GREEN_SEL.clone() };
          shader.uniforms.uBounds = { value: new THREE.Vector3(bounds.minY, bounds.invH, 0) };
          shader.uniforms.uSegA = { value: segA };
          shader.uniforms.uSegB = { value: segB };
          shader.uniforms.uSegR = { value: segR };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
              varying vec3 vLocalPos;
              varying vec3 vLocalNrm;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vLocalPos = position;
              vLocalNrm = normal;`);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
              uniform sampler2D uHeat;
              uniform vec3 uGreen;
              uniform vec3 uGreenSel;
              uniform vec3 uBounds;
              uniform vec3 uSegA[22];
              uniform vec3 uSegB[22];
              uniform float uSegR[22];
              varying vec3 vLocalPos;
              varying vec3 vLocalNrm;

              float segDist(vec3 p, vec3 a, vec3 b) {
                vec3 ab = b - a;
                float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
                return length(p - (a + ab * t));
              }
              `)
            .replace('#include <color_fragment>', `#include <color_fragment>
              {
                vec3 np = vec3(vLocalPos.x * uBounds.y, (vLocalPos.y - uBounds.x) * uBounds.y, vLocalPos.z * uBounds.y);
                vec3 npMirror = vec3(-np.x, np.y, np.z);
                float mask = 0.0;
                float selMask = 0.0;
                for (int i = 0; i < 22; i++) {
                  vec4 h = texture2D(uHeat, vec2((float(i) + 0.5) / 32.0, 0.5));
                  if (h.r < 0.05) continue;
                  float d = min(segDist(np, uSegA[i], uSegB[i]), segDist(npMirror, uSegA[i], uSegB[i]));
                  float r = uSegR[i];
                  float m = 1.0 - smoothstep(r * 0.55, r, d);
                  mask = max(mask, m * min(h.r, 0.85));
                  selMask = max(selMask, (1.0 - smoothstep(r * 0.5, r * 0.95, d)) * step(0.95, h.r));
                }
                if (selMask > 0.01) diffuseColor.rgb = mix(diffuseColor.rgb, uGreenSel, selMask);
                else if (mask > 0.01) diffuseColor.rgb = mix(diffuseColor.rgb, uGreen, mask);
              }`);
        };
        materials.push(mat);
        obj.material = mat;
        obj.castShadow = true;
      });
      scene.add(subject);
      camera.position.set(0, 0.02, 4.3);
      controls.target.set(0, 0, 0);
      controls.update();
      api.current = { subject, materials, heat: initialHeat, spin };
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (event: PointerEvent) => {
      const a = api.current;
      if (!a) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(a.subject, true)[0];
      if (!hit) return;
      const p = a.subject.worldToLocal(hit.point.clone());
      const nx = p.x * bounds.invH;
      const ny = (p.y - bounds.minY) * bounds.invH;
      const nz = p.z * bounds.invH;
      const front = Math.sin(a.subject.rotation.y) < 0;
      const id = muscleAt(nx, ny, nz, front);
      if (id && MUSCLES.some((m) => m.id === id)) pick.current?.(id);
    };
    renderer.domElement.addEventListener('click', onClick);

    const resize = () => {
      const w = host.clientWidth || 360;
      const h = host.clientHeight || 620;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = api.current;
      if (a && a.spin) a.subject.rotation.y += 0.004;
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      initialHeat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mount} style={{ width: '100%', height: '100%' }} />;
}

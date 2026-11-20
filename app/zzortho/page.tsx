'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const W = 1400;
const H = 2100;

// 模型原生面向 +X：yaw = -90° 为正脸
const VIEWS: Record<string, number> = {
  front: -Math.PI / 2,
  back: Math.PI / 2,
  left: Math.PI,
  right: 0,
};

export default function OrthoViews() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('加载…');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const view = new URLSearchParams(window.location.search).get('view') ?? 'front';
    const yaw = VIEWS[view] ?? 0;

    (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync('/models/sculpture/fitcheck-sculpture-tripo-v1.glb');
      gltf.scene.updateMatrixWorld(true);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      renderer.setClearColor(0xffffff, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      // 石膏材质 + 能读清肌肉的光照
      const mat = new THREE.MeshStandardMaterial({ color: 0xf3ede4, roughness: 0.86, metalness: 0 });
      const subject = gltf.scene;
      subject.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = mat;
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(subject);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      subject.position.sub(center);
      holder.add(subject);
      holder.rotation.y = yaw;
      scene.add(holder);

      const height = size.y;
      const halfH = height * 0.56;
      const aspect = W / H;
      const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 20);
      cam.position.set(0, 0, 6);
      cam.lookAt(0, 0, 0);

      scene.add(new THREE.HemisphereLight(0xfffdf8, 0xcfc6ba, 1.0));
      const key = new THREE.DirectionalLight(0xfff8ee, 2.35);
      key.position.set(-3.2, 4.2, 5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.85);
      fill.position.set(3.4, 1.6, 3.6);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xfff6e8, 0.9);
      rim.position.set(2.2, 3.2, -5);
      scene.add(rim);

      renderer.render(scene, cam);
      // 二次渲染确保贴图/阴影就绪
      renderer.render(scene, cam);
      setStatus(`ok ${view}`);

      const meta = {
        view,
        width: W,
        height: H,
        orthoHalfHeight: halfH,
        aspect,
        modelHeight: height,
        modelCenter: [center.x, center.y, center.z],
        yaw,
        note: '正交相机沿 +Z 看向原点；像素↔模型坐标换算见 ortho-meta.json',
      };
      (window as unknown as { __orthoMeta: unknown }).__orthoMeta = meta;
    })().catch((e: Error) => setStatus(`错误：${e.message}`));
  }, []);

  return (
    <div style={{ background: '#fff' }}>
      <div ref={host} style={{ width: W, height: H }} />
      <div style={{ position: 'fixed', left: -9999, top: 0, fontSize: 12, color: '#999' }}>{status}</div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 实验：把 ecorche 烘焙的三向世界空间法线图，按物体坐标投影到 porcelain 皮肤上
 * —— 不改 UV、不改几何，只在着色器里替换法线。
 */
export default function PorcelainNormalProbe({ mode }: { mode: 'skin' | 'muscle' }) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('加载…');

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.style.overflow = 'hidden';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff8ea, 0xa99f90, 1.1));
    const key = new THREE.DirectionalLight(0xfff3df, 2.1);
    key.position.set(-2.4, 2.6, 3.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(2.2, 1.6, -3);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 40);
    camera.position.set(0, 1.0, 3.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enableDamping = true;
    controls.enablePan = false;

    const resize = () => {
      const w = host.clientWidth || 360;
      const h = host.clientHeight || 620;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();

    Promise.all([
      loader.loadAsync('/models/porcelain/male-fixed.glb'),
      ...['front', 'back', 'right', 'left'].map((n) => texLoader.loadAsync(`/models/porcelain/nrm-${n}.png`)),
    ])
      .then(([gltf, front, back, right, left]) => {
        if (disposed) return;
        for (const t of [front, back, right, left] as THREE.Texture[]) {
          t.colorSpace = THREE.NoColorSpace;
          t.wrapS = THREE.ClampToEdgeWrapping;
          t.wrapT = THREE.ClampToEdgeWrapping;
        }
        const model = gltf.scene;
        scene.add(model);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        controls.target.set(0, box.min.y + size.y * 0.55, 0);
        camera.position.set(0, box.min.y + size.y * 0.55, size.y * 2.1);
        controls.update();

        const invH = 1 / size.y;
        const minY = box.min.y;

        if (mode === 'muscle') {
          // 参考：直接把 atlas 关掉，只用纯色 + 法线，看肌肉起伏是否来自法线
          model.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              const m = (o.material as THREE.MeshStandardMaterial).clone();
              m.map = null;
              m.color = new THREE.Color(0xded4c9);
              m.needsUpdate = true;
              o.material = m;
            }
          });
        }

        const skip = new URLSearchParams(window.location.search).has('nonormal');
        if (skip) setStatus(`plain ${status}`);
        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          if (skip) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats as THREE.MeshStandardMaterial[]) {
            mat.onBeforeCompile = (shader) => {
              shader.uniforms.nrmFront = { value: front };
              shader.uniforms.nrmBack = { value: back };
              shader.uniforms.nrmRight = { value: right };
              shader.uniforms.nrmLeft = { value: left };
              shader.uniforms.uModelY = { value: new THREE.Vector2(minY, invH) };

              shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>
                  varying vec3 vObjPos;
                  varying vec3 vObjNrm;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                  vObjPos = position;
                  vObjNrm = normal;`);

              shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                  uniform sampler2D nrmFront;
                  uniform sampler2D nrmBack;
                  uniform sampler2D nrmRight;
                  uniform sampler2D nrmLeft;
                  uniform vec2 uModelY;
                  varying vec3 vObjPos;
                  varying vec3 vObjNrm;
                  vec3 sampleNrm(sampler2D t, vec2 uv, float w) {
                    vec4 c = texture2D(t, uv);
                    return (c.rgb * 2.0 - 1.0) * w * c.a;
                  }`)
                .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
                  {
                    float yN = (vObjPos.y - uModelY.x) * uModelY.y;
                    float xN = vObjPos.x * uModelY.y;
                    float zN = vObjPos.z * uModelY.y;
                    vec2 uvF = vec2(xN / 0.5 + 0.5, yN);
                    vec2 uvS = vec2(zN / 0.5 + 0.5, yN);
                    vec3 n = normalize(vObjNrm);
                    float wF = max(0.0, n.z);
                    float wB = max(0.0, -n.z);
                    float wR = max(0.0, n.x);
                    float wL = max(0.0, -n.x);
                    vec3 acc = sampleNrm(nrmFront, uvF, wF) + sampleNrm(nrmBack, uvF, wB)
                             + sampleNrm(nrmRight, uvS, wR) + sampleNrm(nrmLeft, uvS, wL);
                    float wsum = wF + wB + wR + wL;
                    if (wsum > 0.001 && length(acc) > 0.001) {
                      vec3 wn = normalize(acc / wsum);
                      normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
                    } else {
                      normal = normalize((viewMatrix * vec4(normalize(vObjNrm), 0.0)).xyz);
                    }
                  }`);
            };
            mat.needsUpdate = true;
          }
        });

        let meshCount = 0;
        model.traverse((o) => { if (o instanceof THREE.Mesh) meshCount++; });
        setStatus(`ok size=${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)} meshes=${meshCount} cam=${camera.position.toArray().map((v) => v.toFixed(2))}`);
      })
      .catch((e: Error) => setStatus(`失败：${e.message}`));

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mount} style={{ width: '100%', height: '100%' }} />
      {status && <p style={{ position: 'absolute', left: 12, top: 12, fontSize: 12 }}>{status}</p>}
    </div>
  );
}

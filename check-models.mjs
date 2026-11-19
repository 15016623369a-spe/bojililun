import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Raycaster, Vector3 } from '../FitCheck/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../FitCheck/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const regions = JSON.parse(fs.readFileSync('FitCheck/lib/athlete-regions.json'));
for (const sex of ['male','female']) {
  const bytes = fs.readFileSync('FitCheck/public/models/athletes/'+sex+'/FitCheck-Muscles.glb');
  const {scene} = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  scene.updateMatrixWorld(true);
  const meshes = scene.children.filter(n=>n.isMesh);
  assert.deepEqual(new Set(meshes.map(n=>n.userData.muscle_id).filter(Boolean)),new Set(regions.map(r=>r.id)));
  for(const region of regions.filter(r=>r.deep)) {
    for (const mesh of meshes.filter(m=>m.userData.muscle_id===region.id)) {
      const p=mesh.geometry.getAttribute('position'), ix=mesh.geometry.index.array;
      let canPick=false;
      for(let i=0;i<ix.length && !canPick;i+=3){
        const v=new Vector3();
        for(const j of ix.slice(i,i+3)) v.add(new Vector3().fromBufferAttribute(p,j));
        v.divideScalar(3).applyMatrix4(mesh.matrixWorld);
        const ray=new Raycaster(new Vector3(v.x,v.y,v.z-3),new Vector3(0,0,1));
        canPick=ray.intersectObjects(meshes,false)[0]?.object===mesh;
      }
      assert.ok(canPick,sex+' '+mesh.name);
    }
  }
  console.log(sex,regions.length,'regions loaded and all eight deep back meshes are pickable from behind');
}

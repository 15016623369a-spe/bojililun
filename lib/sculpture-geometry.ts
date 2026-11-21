import * as THREE from 'three';
import { SCULPTURE_METADATA } from './sculpture-groups';

/** Bounded geodesic distance from a label boundary, in world model coordinates.
 * No smoothing of IDs, no crossing to another label or disconnected body surface.
 */
export function boundaryDistances(positions: Float32Array, indices: Uint32Array, labels: Uint8Array, width: number) {
  const count = labels.length;
  const degree = new Uint32Array(count);
  const boundary = new Uint8Array(count);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + (k + 1) % 3];
      degree[a]++; degree[b]++;
      if (labels[a] !== labels[b]) boundary[a] = boundary[b] = 1;
    }
  }
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + degree[i];
  const neighbors = new Uint32Array(offsets[count]);
  const cursor = offsets.slice();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + (k + 1) % 3];
    neighbors[cursor[a]++] = b; neighbors[cursor[b]++] = a;
  }
  const distance = new Float64Array(count).fill(width);
  const heap: { v: number; d: number }[] = [];
  const push = (v: number, d: number) => {
    let i = heap.length;
    heap.push({ v, d });
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].d <= d) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = { v, d };
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].d < heap[child].d) child++;
        if (heap[child].d >= last.d) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return top;
  };
  for (let i = 0; i < count; i++) if (boundary[i]) { distance[i] = 0; push(i, 0); }
  while (heap.length) {
    const { v, d } = pop();
    if (d > distance[v]) continue;
    for (let j = offsets[v]; j < offsets[v + 1]; j++) {
      const next = neighbors[j];
      if (labels[v] !== labels[next]) continue;
      const length = Math.hypot(positions[v*3]-positions[next*3], positions[v*3+1]-positions[next*3+1], positions[v*3+2]-positions[next*3+2]);
      if (d + length < distance[next]) { distance[next] = d + length; push(next, d + length); }
    }
  }
  return Float32Array.from(distance, (d) => d / width);
}

/** Expand only the render geometry so each triangle carries three categorical IDs.
 * Source accessor ordering and the .bin remain untouched. Raycasting uses the
 * same per-corner labels and barycentric rule as the fragment shader.
 */
export function labeledGeometry(mesh: THREE.Mesh, labels: Uint8Array, height: number) {
  const source = mesh.geometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  if (position.count !== labels.length || !normal) throw new Error('模型与肌群标签不匹配');
  const index = source.index ? Uint32Array.from(source.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
  const world = new Float32Array(labels.length * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(world, i*3);
  }
  const edge = boundaryDistances(world, index, labels, height * .0045);
  const positions = new Float32Array(index.length * 3), normals = new Float32Array(index.length * 3);
  const ids = new Float32Array(index.length * 3), bary = new Float32Array(index.length * 2);
  const feather = new Float32Array(index.length);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = index[t+k], target = t+k;
      point.fromBufferAttribute(position, v).toArray(positions, target*3);
      point.fromBufferAttribute(normal, v).toArray(normals, target*3);
      for (let j = 0; j < 3; j++) ids[target*3+j] = labels[index[t+j]];
      bary[target*2] = k === 0 ? 1 : 0;
      bary[target*2+1] = k === 1 ? 1 : 0;
      feather[target] = edge[v];
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('muscleIds', new THREE.BufferAttribute(ids, 3));
  geometry.setAttribute('muscleBary', new THREE.BufferAttribute(bary, 2));
  geometry.setAttribute('muscleEdge', new THREE.BufferAttribute(feather, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function validateLabelData(labels: Uint8Array, metadata: unknown, expected: typeof SCULPTURE_METADATA = SCULPTURE_METADATA) {
  const actual = metadata as typeof SCULPTURE_METADATA;
  if (!actual || actual.binarySha256 !== expected.binarySha256
    || actual.modelSha256 !== expected.modelSha256
    || JSON.stringify(actual.sculptureOrder) !== JSON.stringify(expected.sculptureOrder)
    || JSON.stringify(actual.meshOrder) !== JSON.stringify(expected.meshOrder)
    || actual.vertexCount !== labels.length || labels.length !== expected.vertexCount
    || actual.backgroundValue !== 254) throw new Error('分区版本不匹配');
  // fine-v2 的 byteValue = sculptureOrder 下标，counts 为 0 的肌群不会出现在标签里。
  const counts = expected.counts as Record<string, number>;
  const allowed = new Set<number>([254]);
  expected.sculptureOrder.forEach((id, byteValue) => { if ((counts[id] ?? 0) > 0) allowed.add(byteValue); });
  if (labels.some((id) => !allowed.has(id))) throw new Error('分区含有无效标签');
}

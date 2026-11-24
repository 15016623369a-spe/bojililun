import * as THREE from 'three';
import { SCULPTURE_METADATA } from './sculpture-groups';

/** Bounded geodesic distance from a label boundary, in world model coordinates.
 * No smoothing of IDs, no crossing to another label or disconnected body surface.
 */
export function boundaryDistances(positions: Float32Array, indices: Uint32Array | Uint16Array, labels: Uint8Array, width: number) {
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
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + (k + 1) % 3];
      neighbors[cursor[a]++] = b;
      neighbors[cursor[b]++] = a;
    }
  }

  const distance = new Float64Array(count).fill(width);
  let heapSize = 0;
  let heapV = new Uint32Array(Math.max(64, count));
  let heapD = new Float64Array(Math.max(64, count));

  const push = (v: number, d: number) => {
    if (heapSize >= heapV.length) {
      const nextCap = heapV.length * 2;
      const nextV = new Uint32Array(nextCap);
      const nextD = new Float64Array(nextCap);
      nextV.set(heapV);
      nextD.set(heapD);
      heapV = nextV;
      heapD = nextD;
    }
    let i = heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapD[parent] <= d) break;
      heapV[i] = heapV[parent];
      heapD[i] = heapD[parent];
      i = parent;
    }
    heapV[i] = v;
    heapD[i] = d;
  };

  for (let i = 0; i < count; i++) {
    if (boundary[i]) {
      distance[i] = 0;
      push(i, 0);
    }
  }

  while (heapSize > 0) {
    const v = heapV[0];
    const d = heapD[0];
    const lastIdx = --heapSize;
    if (lastIdx > 0) {
      const lv = heapV[lastIdx];
      const ld = heapD[lastIdx];
      let i = 0;
      while (i * 2 + 1 < heapSize) {
        let child = i * 2 + 1;
        if (child + 1 < heapSize && heapD[child + 1] < heapD[child]) child++;
        if (heapD[child] >= ld) break;
        heapV[i] = heapV[child];
        heapD[i] = heapD[child];
        i = child;
      }
      heapV[i] = lv;
      heapD[i] = ld;
    }
    if (d > distance[v]) continue;
    const vx = positions[v * 3], vy = positions[v * 3 + 1], vz = positions[v * 3 + 2];
    for (let j = offsets[v]; j < offsets[v + 1]; j++) {
      const next = neighbors[j];
      if (labels[v] !== labels[next]) continue;
      const dx = vx - positions[next * 3];
      const dy = vy - positions[next * 3 + 1];
      const dz = vz - positions[next * 3 + 2];
      const nd = d + Math.hypot(dx, dy, dz);
      if (nd < distance[next]) {
        distance[next] = nd;
        push(next, nd);
      }
    }
  }

  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = distance[i] / width;
  return out;
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
  const index = source.index
    ? (source.index.array instanceof Uint32Array || source.index.array instanceof Uint16Array
      ? source.index.array
      : Uint32Array.from(source.index.array))
    : Uint32Array.from({ length: position.count }, (_, i) => i);

  const count = labels.length;
  const world = new Float32Array(count * 3);
  const m = mesh.matrixWorld.elements;
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
  const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
  const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
  const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];
  const hasPersp = m3 !== 0 || m7 !== 0 || m11 !== 0 || m15 !== 1;

  const isInterleavedPos = Boolean((position as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) || position.itemSize !== 3;
  const isInterleavedNorm = Boolean((normal as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) || normal.itemSize !== 3;
  const posArr = isInterleavedPos ? null : position.array;
  const normArr = isInterleavedNorm ? null : normal.array;

  if (posArr) {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const x = posArr[o], y = posArr[o + 1], z = posArr[o + 2];
      const w = hasPersp ? 1 / (m3 * x + m7 * y + m11 * z + m15) : 1;
      world[o]     = (m0 * x + m4 * y + m8  * z + m12) * w;
      world[o + 1] = (m1 * x + m5 * y + m9  * z + m13) * w;
      world[o + 2] = (m2 * x + m6 * y + m10 * z + m14) * w;
    }
  } else {
    for (let i = 0; i < count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const o = i * 3;
      const w = hasPersp ? 1 / (m3 * x + m7 * y + m11 * z + m15) : 1;
      world[o]     = (m0 * x + m4 * y + m8  * z + m12) * w;
      world[o + 1] = (m1 * x + m5 * y + m9  * z + m13) * w;
      world[o + 2] = (m2 * x + m6 * y + m10 * z + m14) * w;
    }
  }

  const edge = boundaryDistances(world, index, labels, height * 0.0045);
  const indexLen = index.length;
  const positions = new Float32Array(indexLen * 3);
  const normals = new Float32Array(indexLen * 3);
  const ids = new Float32Array(indexLen * 3);
  const bary = new Float32Array(indexLen * 2);
  const feather = new Float32Array(indexLen);

  if (posArr && normArr) {
    for (let t = 0; t < indexLen; t += 3) {
      const v0 = index[t], v1 = index[t + 1], v2 = index[t + 2];
      const l0 = labels[v0], l1 = labels[v1], l2 = labels[v2];
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? v0 : k === 1 ? v1 : v2;
        const target = t + k;
        const dst3 = target * 3;
        const src3 = v * 3;
        positions[dst3]     = posArr[src3];
        positions[dst3 + 1] = posArr[src3 + 1];
        positions[dst3 + 2] = posArr[src3 + 2];
        normals[dst3]       = normArr[src3];
        normals[dst3 + 1]   = normArr[src3 + 1];
        normals[dst3 + 2]   = normArr[src3 + 2];
        ids[dst3]     = l0;
        ids[dst3 + 1] = l1;
        ids[dst3 + 2] = l2;
        bary[target * 2]     = k === 0 ? 1 : 0;
        bary[target * 2 + 1] = k === 1 ? 1 : 0;
        feather[target] = edge[v];
      }
    }
  } else {
    for (let t = 0; t < indexLen; t += 3) {
      const v0 = index[t], v1 = index[t + 1], v2 = index[t + 2];
      const l0 = labels[v0], l1 = labels[v1], l2 = labels[v2];
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? v0 : k === 1 ? v1 : v2;
        const target = t + k;
        const dst3 = target * 3;
        positions[dst3]     = position.getX(v);
        positions[dst3 + 1] = position.getY(v);
        positions[dst3 + 2] = position.getZ(v);
        normals[dst3]       = normal.getX(v);
        normals[dst3 + 1]   = normal.getY(v);
        normals[dst3 + 2]   = normal.getZ(v);
        ids[dst3]     = l0;
        ids[dst3 + 1] = l1;
        ids[dst3 + 2] = l2;
        bary[target * 2]     = k === 0 ? 1 : 0;
        bary[target * 2 + 1] = k === 1 ? 1 : 0;
        feather[target] = edge[v];
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('muscleIds', new THREE.BufferAttribute(ids, 3));
  geometry.setAttribute('muscleBary', new THREE.BufferAttribute(bary, 2));
  geometry.setAttribute('muscleEdge', new THREE.BufferAttribute(feather, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
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

export type SculptureBVH = {
  triIndices: Uint32Array;
  bounds: Float32Array;
  leftOrStart: Int32Array;
  rightChild: Int32Array;
  count: Int32Array;
  posArray: Float32Array;
};

/** Build a flat-array BVH over a non-indexed BufferGeometry and cache it on geometry.userData.bvh. */
export function buildGeometryBVH(geometry: THREE.BufferGeometry): SculptureBVH | null {
  const existing = geometry.userData.bvh as SculptureBVH | undefined;
  if (existing) return existing;
  if (geometry.index) return null;

  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.itemSize !== 3) return null;
  const triCount = Math.floor(posAttr.count / 3);
  if (triCount <= 0) return null;

  const posArray = posAttr.array instanceof Float32Array ? posAttr.array : Float32Array.from(posAttr.array);
  const triIndices = new Uint32Array(triCount);
  const triBounds = new Float32Array(triCount * 6);
  const triCentroids = new Float32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    triIndices[t] = t;
    const o = t * 9;
    const ax = posArray[o],     ay = posArray[o + 1], az = posArray[o + 2];
    const bx = posArray[o + 3], by = posArray[o + 4], bz = posArray[o + 5];
    const cx = posArray[o + 6], cy = posArray[o + 7], cz = posArray[o + 8];
    const tb = t * 6;
    triBounds[tb]     = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
    triBounds[tb + 1] = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
    triBounds[tb + 2] = az < bz ? (az < cz ? az : cz) : (bz < cz ? bz : cz);
    triBounds[tb + 3] = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
    triBounds[tb + 4] = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
    triBounds[tb + 5] = az > bz ? (az > cz ? az : cz) : (bz > cz ? bz : cz);
    const tc = t * 3;
    triCentroids[tc]     = (ax + bx + cx) * (1 / 3);
    triCentroids[tc + 1] = (ay + by + cy) * (1 / 3);
    triCentroids[tc + 2] = (az + bz + cz) * (1 / 3);
  }

  let cap = Math.max(16, Math.ceil(triCount / 2));
  let nodeCount = 0;
  let bounds = new Float32Array(cap * 6);
  let leftOrStart = new Int32Array(cap);
  let rightChild = new Int32Array(cap);
  let countArr = new Int32Array(cap);

  function allocNode(): number {
    if (nodeCount >= cap) {
      const nextCap = cap * 2;
      const nb = new Float32Array(nextCap * 6);
      const nl = new Int32Array(nextCap);
      const nr = new Int32Array(nextCap);
      const nc = new Int32Array(nextCap);
      nb.set(bounds);
      nl.set(leftOrStart);
      nr.set(rightChild);
      nc.set(countArr);
      bounds = nb;
      leftOrStart = nl;
      rightChild = nr;
      countArr = nc;
      cap = nextCap;
    }
    return nodeCount++;
  }

  function buildNode(start: number, end: number, depth: number): number {
    const nodeIdx = allocNode();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
    let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;

    for (let i = start; i < end; i++) {
      const t = triIndices[i];
      const tb = t * 6;
      if (triBounds[tb] < minX) minX = triBounds[tb];
      if (triBounds[tb + 1] < minY) minY = triBounds[tb + 1];
      if (triBounds[tb + 2] < minZ) minZ = triBounds[tb + 2];
      if (triBounds[tb + 3] > maxX) maxX = triBounds[tb + 3];
      if (triBounds[tb + 4] > maxY) maxY = triBounds[tb + 4];
      if (triBounds[tb + 5] > maxZ) maxZ = triBounds[tb + 5];

      const tc = t * 3;
      const cx = triCentroids[tc], cy = triCentroids[tc + 1], cz = triCentroids[tc + 2];
      if (cx < cMinX) cMinX = cx; if (cx > cMaxX) cMaxX = cx;
      if (cy < cMinY) cMinY = cy; if (cy > cMaxY) cMaxY = cy;
      if (cz < cMinZ) cMinZ = cz; if (cz > cMaxZ) cMaxZ = cz;
    }

    const bOff = nodeIdx * 6;
    bounds[bOff] = minX; bounds[bOff + 1] = minY; bounds[bOff + 2] = minZ;
    bounds[bOff + 3] = maxX; bounds[bOff + 4] = maxY; bounds[bOff + 5] = maxZ;

    const cnt = end - start;
    if (cnt <= 8 || depth >= 48) {
      leftOrStart[nodeIdx] = start;
      rightChild[nodeIdx] = -1;
      countArr[nodeIdx] = cnt;
      return nodeIdx;
    }

    const dx = cMaxX - cMinX, dy = cMaxY - cMinY, dz = cMaxZ - cMinZ;
    let axis = 0;
    if (dy > dx && dy >= dz) axis = 1;
    else if (dz > dx && dz >= dy) axis = 2;

    const span = axis === 0 ? dx : axis === 1 ? dy : dz;
    let mid = (start + end) >> 1;
    if (span > 1e-6) {
      const splitPos = axis === 0 ? (cMinX + cMaxX) * 0.5 : axis === 1 ? (cMinY + cMaxY) * 0.5 : (cMinZ + cMaxZ) * 0.5;
      let l = start, r = end - 1;
      while (l <= r) {
        if (triCentroids[triIndices[l] * 3 + axis] < splitPos) {
          l++;
        } else {
          const tmp = triIndices[l];
          triIndices[l] = triIndices[r];
          triIndices[r] = tmp;
          r--;
        }
      }
      if (l > start && l < end) mid = l;
    }

    const left = buildNode(start, mid, depth + 1);
    const right = buildNode(mid, end, depth + 1);
    leftOrStart[nodeIdx] = left;
    rightChild[nodeIdx] = right;
    countArr[nodeIdx] = 0;
    return nodeIdx;
  }

  buildNode(0, triCount, 0);

  const bvh: SculptureBVH = {
    triIndices,
    bounds: bounds.subarray(0, nodeCount * 6),
    leftOrStart: leftOrStart.subarray(0, nodeCount),
    rightChild: rightChild.subarray(0, nodeCount),
    count: countArr.subarray(0, nodeCount),
    posArray,
  };
  geometry.userData.bvh = bvh;
  return bvh;
}

const _sphere = new THREE.Sphere();
const _invMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _hitLocal = new THREE.Vector3();
const _hitWorld = new THREE.Vector3();
const _faceNormal = new THREE.Vector3();
const _stack = new Int32Array(128);

/** Attach a BVH-accelerated raycast handler onto a sculpture mesh for sub-millisecond hover/click picking. */
export function enableFastSculptureRaycast(mesh: THREE.Mesh): void {
  const bvh = buildGeometryBVH(mesh.geometry);
  if (!bvh) return;
  const { triIndices, bounds, leftOrStart, rightChild, count: countArr, posArray } = bvh;

  mesh.raycast = (raycaster, intersects) => {
    const geometry = mesh.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    if (!geometry.boundingSphere) return;

    _sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (!raycaster.ray.intersectsSphere(_sphere)) return;

    _invMatrix.copy(mesh.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_invMatrix);

    const ox = _localRay.origin.x, oy = _localRay.origin.y, oz = _localRay.origin.z;
    const dx = _localRay.direction.x, dy = _localRay.direction.y, dz = _localRay.direction.z;
    const invX = dx === 0 ? 1e30 : 1 / dx;
    const invY = dy === 0 ? 1e30 : 1 / dy;
    const invZ = dz === 0 ? 1e30 : 1 / dz;

    let sp = 0;
    _stack[sp++] = 0;

    while (sp > 0) {
      const nodeIdx = _stack[--sp];
      const b = nodeIdx * 6;

      let tmin = 0, tmax = Infinity;
      const tx1 = (bounds[b] - ox) * invX, tx2 = (bounds[b + 3] - ox) * invX;
      const txmin = tx1 < tx2 ? tx1 : tx2, txmax = tx1 > tx2 ? tx1 : tx2;
      if (txmin > tmin) tmin = txmin;
      if (txmax < tmax) tmax = txmax;
      if (tmax < tmin) continue;

      const ty1 = (bounds[b + 1] - oy) * invY, ty2 = (bounds[b + 4] - oy) * invY;
      const tymin = ty1 < ty2 ? ty1 : ty2, tymax = ty1 > ty2 ? ty1 : ty2;
      if (tymin > tmin) tmin = tymin;
      if (tymax < tmax) tmax = tymax;
      if (tmax < tmin) continue;

      const tz1 = (bounds[b + 2] - oz) * invZ, tz2 = (bounds[b + 5] - oz) * invZ;
      const tzmin = tz1 < tz2 ? tz1 : tz2, tzmax = tz1 > tz2 ? tz1 : tz2;
      if (tzmin > tmin) tmin = tzmin;
      if (tzmax < tmax) tmax = tzmax;
      if (tmax < tmin) continue;

      const cnt = countArr[nodeIdx];
      if (cnt > 0) {
        const start = leftOrStart[nodeIdx];
        const end = start + cnt;
        for (let i = start; i < end; i++) {
          const triIdx = triIndices[i];
          const o = triIdx * 9;
          _vA.set(posArray[o], posArray[o + 1], posArray[o + 2]);
          _vB.set(posArray[o + 3], posArray[o + 4], posArray[o + 5]);
          _vC.set(posArray[o + 6], posArray[o + 7], posArray[o + 8]);

          if (_localRay.intersectTriangle(_vA, _vB, _vC, false, _hitLocal) === null) continue;
          _hitWorld.copy(_hitLocal).applyMatrix4(mesh.matrixWorld);
          const dist = raycaster.ray.origin.distanceTo(_hitWorld);
          if (dist < raycaster.near || dist > raycaster.far) continue;

          THREE.Triangle.getNormal(_vA, _vB, _vC, _faceNormal);
          const i0 = triIdx * 3;
          intersects.push({
            distance: dist,
            point: _hitWorld.clone(),
            object: mesh,
            face: { a: i0, b: i0 + 1, c: i0 + 2, normal: _faceNormal.clone(), materialIndex: 0 },
            faceIndex: triIdx,
          });
        }
      } else {
        const left = leftOrStart[nodeIdx];
        const right = rightChild[nodeIdx];
        if (sp + 2 <= _stack.length) {
          _stack[sp++] = right;
          _stack[sp++] = left;
        }
      }
    }
  };
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const THREE = require('three');

// Compile only local TS modules for Node's built-in test runner; no browser needed.
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(code, filename);
};
const { SCULPTURE_METADATA: meta, SCULPTURE_GROUPS, canonicalMuscle, sculptureGroupMatches, recordedInGroup, labelAtBarycentric } = require('../lib/sculpture-groups.ts');
const { boundaryDistances, labeledGeometry, validateLabelData } = require('../lib/sculpture-geometry.ts');
const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '../public/models/sculpture/sculpture-muscle-male-fine-v2.bin')));

test('fine-v2 asset matches its metadata, covers every labelled region and rejects tampering', () => {
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), meta.binarySha256);
  assert.equal(bytes.length, meta.vertexCount);
  assert.doesNotThrow(() => validateLabelData(bytes, meta));
  const counts = meta.counts;
  const labelled = meta.sculptureOrder.filter((id) => counts[id] > 0);
  assert.equal(SCULPTURE_GROUPS.length, labelled.length);
  const present = new Set(bytes);
  for (const id of labelled) assert.equal(present.has(meta.sculptureOrder.indexOf(id)), true, id);
  assert.equal(present.has(meta.sculptureOrder.indexOf('neck')), false);
  assert.equal(bytes.includes(255), false);
  assert.throws(() => validateLabelData(bytes.slice(1), meta));
  const bad = bytes.slice(); bad[0] = 255;
  assert.throws(() => validateLabelData(bad, meta));
  assert.throws(() => validateLabelData(bytes, { ...meta, binarySha256: 'stale' }));
});

test('fine labels resolve to their own region instead of a coarse parent', () => {
  for (const id of ['chest_upper', 'chest_mid', 'chest_lower', 'delt_front', 'delt_side', 'delt_rear', 'serratus', 'adductors', 'traps']) {
    assert.equal(canonicalMuscle(id), id);
  }
  assert.equal(canonicalMuscle('neck'), null);
  assert.equal(canonicalMuscle('chest'), 'chest_mid');
  assert.equal(recordedInGroup(['chest_upper'], 'chest_upper'), true);
  assert.equal(recordedInGroup(['chest_upper'], 'chest_lower'), false);
  assert.equal(recordedInGroup(['delt_rear'], 'delt_side'), false);
  assert.equal(recordedInGroup(['glutes'], 'quads'), false);
});

test('coarse chest and shoulder lists include their fine variants', () => {
  for (const name of ['incline bench press', 'bench press', 'decline bench press']) {
    assert.equal(sculptureGroupMatches('chest', { name, target: 'pectorals', body_part: 'chest' }), true);
  }
  for (const name of ['overhead press', 'lateral raise', 'rear delt fly']) {
    assert.equal(sculptureGroupMatches('shoulders', { name, target: 'delts', body_part: 'shoulders' }), true);
  }
  assert.equal(sculptureGroupMatches('chest', { name: 'curl', target: 'biceps', body_part: 'upper arms' }), false);
});

test('fine region lists stay scoped to their own band', () => {
  const bench = { name: 'bench press', target: 'pectorals', body_part: 'chest' };
  assert.equal(sculptureGroupMatches('chest_mid', bench), true);
  assert.equal(sculptureGroupMatches('chest_upper', { ...bench, name: 'incline bench press' }), true);
  assert.equal(sculptureGroupMatches('chest_upper', bench), false);
  assert.equal(sculptureGroupMatches('chest_lower', { ...bench, name: 'decline bench press' }), true);
  assert.equal(sculptureGroupMatches('delt_rear', { name: 'rear delt fly', target: 'delts', body_part: 'shoulders' }), true);
});

test('categorical picking sums repeated labels and lets foreground background occlude', () => {
  assert.equal(labelAtBarycentric([3, 3, 254], [.3, .3, .4]), 3);
  assert.equal(labelAtBarycentric([3, 254, 254], [.4, .3, .3]), 254);
  assert.equal(labelAtBarycentric([3, 6, 254], [.1, .2, .7]), 254);
  assert.equal(labelAtBarycentric([17, 17, 17], [.2, .3, .5]), 17);
});

test('feather distance stays on connected surface and never crosses a label', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, 2,0,0, 0,0,.01, 1,0,.01, 0,1,.01]);
  const indices = new Uint32Array([0,1,2, 1,3,2, 4,5,6]);
  const labels = new Uint8Array([3,3,6,3,17,17,17]);
  const distance = boundaryDistances(positions, indices, labels, 2);
  assert.equal(distance[0], 0);
  assert.equal(distance[1], 0);
  assert.equal(distance[2], 0);
  // The spatially adjacent but disconnected glute surface retains a full mask.
  for (const i of [4,5,6]) assert.equal(distance[i], 1);
});

test('render expansion preserves triangle order, IDs and non-muscle blockers', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 1,1,0], 3));
  geometry.setIndex([0,1,2, 1,3,2]); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry); mesh.updateMatrixWorld(true);
  const render = labeledGeometry(mesh, new Uint8Array([3,3,254,254]), 1);
  assert.equal(render.getAttribute('position').count, 6);
  assert.deepEqual(Array.from(render.getAttribute('muscleIds').array.slice(0,3)), [3,3,254]);
  assert.deepEqual(Array.from(render.getAttribute('muscleIds').array.slice(9,12)), [3,254,254]);
  assert.deepEqual(Array.from(geometry.index.array), [0,1,2,1,3,2]);
  render.dispose(); geometry.dispose(); mesh.material.dispose();
});

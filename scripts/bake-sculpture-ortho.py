#!/usr/bin/env python3
"""Offline, reproducible orthographic label bake. Never modifies application code.

Install scripts/requirements-sculpture.txt, then run this file from any directory.
Labels are uint8 SCULPTURE_ORDER indices in GLTFLoader traversal/accessor order.
254 = intentionally unpainted; 255 is forbidden in a completed bake.
"""
from pathlib import Path
import argparse
import hashlib
import heapq
import json
import math
import re
import struct

import numpy as np
from numba import njit
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage, sparse
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
BG = 254
PALETTE = [
    ('chest_mid', 'Chest', '#FF0000', ['chest_upper', 'chest_mid', 'chest_lower']),
    ('delt_side', 'Shoulders', '#0000FF', ['delt_front', 'delt_side', 'delt_rear']),
    ('abs', 'Abs', '#FFFF00', ['abs']),
    ('obliques', 'Obliques', '#00FFFF', ['obliques']),
    ('biceps', 'Biceps', '#FF00FF', ['biceps']),
    ('triceps', 'Triceps', '#FF8000', ['triceps']),
    ('forearms', 'Forearms', '#8000FF', ['forearms']),
    ('lats', 'Lats', '#00FF00', ['lats']),
    ('upperback', 'Traps / upper back', '#008080', ['traps', 'upperback']),
    ('lowerback', 'Lower back', '#804000', ['lowerback']),
    ('glutes', 'Glutes', '#FF0080', ['glutes']),
    ('quads', 'Quads', '#80FF00', ['quads']),
    ('hamstrings', 'Hamstrings', '#0080FF', ['hamstrings']),
    ('calves', 'Calves', '#800000', ['calves']),
]
RGB = np.array([[int(c[i:i+2], 16) for i in (1, 3, 5)] for _, _, c, _ in PALETTE])


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_glb(path):
    """Read uncompressed indexed triangles; fail on unsupported features explicitly."""
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and total == len(raw)
    jlen, jtype = struct.unpack_from('<II', raw, 12)
    assert jtype == 0x4E4F534A
    gltf = json.loads(raw[20:20+jlen])
    blen, btype = struct.unpack_from('<II', raw, 20+jlen)
    assert btype == 0x004E4942
    binary = raw[28+jlen:28+jlen+blen]

    def accessor(idx):
        a = gltf['accessors'][idx]
        assert 'sparse' not in a and not a.get('normalized', False)
        b = gltf['bufferViews'][a['bufferView']]
        assert not b.get('extensions') and b.get('buffer', 0) == 0
        dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']])
        size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        offset = b.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = b.get('byteStride', dtype.itemsize * size)
        return np.ndarray((a['count'], size), dtype=dtype, buffer=binary,
                          offset=offset, strides=(stride, dtype.itemsize)).copy()

    positions, normals, faces, records, local_positions = [], [], [], [], []
    transforms = []
    offset = 0

    def visit(node_id, parent):
        nonlocal offset
        node = gltf['nodes'][node_id]
        if 'matrix' in node:
            m = np.array(node['matrix'], dtype=float).reshape(4, 4).T
        else:
            from scipy.spatial.transform import Rotation
            m = np.eye(4)
            r = Rotation.from_quat(node.get('rotation', [0, 0, 0, 1])).as_matrix()
            m[:3, :3] = r * np.array(node.get('scale', [1, 1, 1]))
            m[:3, 3] = node.get('translation', [0, 0, 0])
        world = np.einsum('ij,jk->ik', parent, m)
        assert 'skin' not in node, 'Skinned models need an explicit posed bake.'
        if 'mesh' in node:
            for pi, primitive in enumerate(gltf['meshes'][node['mesh']]['primitives']):
                assert primitive.get('mode', 4) == 4 and not primitive.get('targets')
                assert not primitive.get('extensions')
                p = accessor(primitive['attributes']['POSITION']).astype(float)
                n = accessor(primitive['attributes']['NORMAL']).astype(float)
                wp = np.einsum('ij,kj->ki', world[:3, :3], p) + world[:3, 3]
                wn = np.einsum('ij,kj->ki', np.linalg.inv(world[:3, :3]).T, n)
                wn /= np.maximum(np.linalg.norm(wn, axis=1)[:, None], 1e-15)
                idx = accessor(primitive['indices']).ravel() if 'indices' in primitive else np.arange(len(p))
                faces.append(idx.astype(np.int64).reshape(-1, 3) + offset)
                positions.append(wp)
                local_positions.append(p)
                normals.append(wn)
                transforms.append(world)
                records.append(dict(node=node_id, mesh=node['mesh'], primitive=pi,
                                    positionAccessor=primitive['attributes']['POSITION'],
                                    vertexOffset=offset, vertexCount=len(p)))
                offset += len(p)
        for child in node.get('children', []):
            visit(child, world)

    for node in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        visit(node, np.eye(4))
    # This model's native +X is anterior, local Z is left/right. No guessed world-X mirror.
    assert len(records) == 1, 'Specify a shared anatomical frame before baking a multi-mesh model.'
    return (np.concatenate(positions), np.concatenate(normals), np.concatenate(faces),
            np.concatenate(local_positions), records, transforms[0])


def project(p, n, meta, width, height):
    c, s = math.cos(meta['yaw']), math.sin(meta['yaw'])
    r = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    q = np.einsum('ij,kj->ki', r, p - np.array(meta['modelCenter']))
    normal = np.einsum('ij,kj->ki', r, n)
    hh = meta['orthoHalfHeight']
    x = (q[:, 0] / (2 * hh * meta['aspect']) + .5) * width - .5
    y = (.5 - q[:, 1] / (2 * hh)) * height - .5
    return np.column_stack((x, y, q[:, 2])), normal


@njit(cache=True)
def rasterize(projected, triangles, colors, width, height):
    """Orthographic z-buffer and barycentric vertex-color render at pixel centers."""
    depth = np.full((height, width), -np.inf)
    canvas = np.ones((height, width, 3), dtype=np.float32)
    for t in triangles:
        a, b, c = t
        x0, y0, z0 = projected[a]
        x1, y1, z1 = projected[b]
        x2, y2, z2 = projected[c]
        det = (y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(det) < 1e-15:
            continue
        for y in range(max(0, int(math.ceil(min(y0, y1, y2)))),
                       min(height-1, int(math.floor(max(y0, y1, y2))))+1):
            for x in range(max(0, int(math.ceil(min(x0, x1, x2)))),
                           min(width-1, int(math.floor(max(x0, x1, x2))))+1):
                u = ((y1-y2)*(x-x2)+(x2-x1)*(y-y2))/det
                v = ((y2-y0)*(x-x2)+(x0-x2)*(y-y2))/det
                w = 1-u-v
                if min(u, v, w) < -1e-8:
                    continue
                z = u*z0+v*z1+w*z2
                if z > depth[y, x]:
                    depth[y, x] = z
                    for channel in range(3):
                        canvas[y, x, channel] = u*colors[a, channel]+v*colors[b, channel]+w*colors[c, channel]
    return depth, canvas


def quantize(rgb):
    # RGB Euclidean matching. White is removed before nearest-palette lookup.
    white = np.all(rgb > 240, axis=-1)
    # image_gen left faint neutral outline ink in white hands/feet/shorts. None of
    # the 14 palette entries has chroma below 128. Neutral ink is not a muscle
    # sample; remove it before the requested nearest-color matching, otherwise
    # gray matches yellow/cyan and floods intentional background during filling.
    white |= np.ptp(rgb.astype(np.int16), axis=-1) < 64
    flat = rgb.reshape(-1, 3).astype(np.int32)
    labels = np.full(len(flat), BG, dtype=np.uint8)
    active = np.flatnonzero(~white.ravel())
    for start in range(0, len(active), 100000):
        ids = active[start:start+100000]
        labels[ids] = np.argmin(((flat[ids, None] - RGB[None]) ** 2).sum(2), axis=1)
    return labels.reshape(white.shape)


@njit(cache=True)
def symmetry_groups(local, mirror, weld_inverse):
    parent = np.arange(len(local))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    first = np.full(weld_inverse.max()+1, -1, dtype=np.int64)
    for i in range(len(local)):
        a, b = root(i), root(mirror[i])
        parent[max(a, b)] = min(a, b)
        wi = weld_inverse[i]
        if first[wi] < 0:
            first[wi] = i
        else:
            a, b = root(i), root(first[wi])
            parent[max(a, b)] = min(a, b)
    for i in range(len(local)):
        parent[i] = root(i)
    return parent


def make_graph(p, faces, groups, count):
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    lengths = np.linalg.norm(p[edges[:, 0]]-p[edges[:, 1]], axis=1)
    ge = groups[edges]
    valid = ge[:, 0] != ge[:, 1]
    ge = np.sort(ge[valid], axis=1)
    lengths = lengths[valid]
    unique, inverse = np.unique(ge, axis=0, return_inverse=True)
    weights = np.full(len(unique), np.inf)
    np.minimum.at(weights, inverse, lengths)
    a, b = unique.T
    return sparse.csr_matrix((np.tile(np.maximum(weights, 1e-12), 2),
                              (np.r_[a, b], np.r_[b, a])), shape=(count, count))


def fill_surface(graph, labels):
    # Multi-source Dijkstra uses mesh-edge distance, never spatial distance across a gap.
    distance = np.full(len(labels), np.inf)
    seeds = np.flatnonzero(labels != 255)
    distance[seeds] = 0
    heap = [(0., int(i)) for i in seeds]
    heapq.heapify(heap)
    out = labels.copy()
    while heap:
        d, u = heapq.heappop(heap)
        if d > distance[u]:
            continue
        for k in range(graph.indptr[u], graph.indptr[u+1]):
            v = graph.indices[k]
            nd = d + graph.data[k]
            if nd < distance[v]:
                distance[v] = nd
                out[v] = out[u]
                heapq.heappush(heap, (nd, int(v)))
    if np.any(out == 255):
        raise RuntimeError('A disconnected component has no visible seed; inspect it rather than guessing.')
    return out, distance


def smooth(graph, labels):
    adjacency = graph.copy()
    adjacency.data[:] = 1
    changes = []
    for _ in range(2):
        counts = np.column_stack([adjacency @ (labels == k).astype(float) for k in range(14)])
        muscle = labels < 14
        counts[np.flatnonzero(muscle), labels[muscle]] += 1  # retain self and break ties in its favor
        winner = counts.argmax(axis=1).astype(np.uint8)
        current = np.zeros(len(labels))
        current[muscle] = counts[np.flatnonzero(muscle), labels[muscle]]
        replace = muscle & (counts.max(axis=1) > current)
        changes.append(int(replace.sum()))
        labels = labels.copy()
        labels[replace] = winner[replace]
    return labels, changes


def preview(p, n, faces, labels, meta, out):
    w, h = 620, 930
    colors = np.ones((256, 3)) * .88
    colors[:14] = RGB / 255.
    colors[BG] = [0.90, 0.88, 0.84]
    # Lighting comes only from surface normals. No original PNG is composited into this render.
    sheet = Image.new('RGB', (w*4, h+250), '#F6F5F2')
    draw = ImageDraw.Draw(sheet)
    font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
    font = ImageFont.truetype(font_path, 22) if Path(font_path).exists() else ImageFont.load_default()
    small = ImageFont.truetype(font_path, 17) if Path(font_path).exists() else font
    draw.text((28, 16), '3D VERTEX LABEL VALIDATION  /  ORTHOGRAPHIC PROJECTION', font=font, fill='#262B33')
    for i, view in enumerate(['front', 'back', 'left', 'right']):
        xyz, normal = project(p, n, meta[view], w, h)
        light = np.array([-.3, .5, 1.])
        light /= np.linalg.norm(light)
        intensity = .68 + .32*np.clip(np.einsum('ij,j->i', normal, light), 0, 1)
        shaded = colors[labels] * intensity[:, None]
        depth, rgb = rasterize(xyz, faces, shaded, w, h)
        rgb[~np.isfinite(depth)] = [246/255, 245/255, 242/255]
        image = Image.fromarray(np.uint8(np.clip(rgb, 0, 1)*255))
        image.save(out / f'3d-{view}.png')
        sheet.paste(image, (i*w, 70))
        draw.text((i*w+26, 52), view.upper(), font=small, fill='#525965')
    for i, (_, name, color, _) in enumerate(PALETTE):
        col, row = i % 7, i // 7
        x, y = 28+col*350, h+100+row*40
        draw.rectangle((x, y, x+22, y+22), fill=color)
        draw.text((x+32, y), name, font=small, fill='#333B47')
    draw.text((28, h+195), 'Beige = intentionally unpainted. Glutes are indicated on the shorts. Colors shaded only to reveal 3D relief.', font=small, fill='#525965')
    sheet.save(out / 'sculpture-muscle-ortho-review.png')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, default=ROOT/'docs/sculpture/ortho/colored')
    parser.add_argument('--meta', type=Path, default=ROOT/'docs/sculpture/ortho/ortho-meta.json')
    parser.add_argument('--model', type=Path, default=ROOT/'public/models/sculpture/fitcheck-sculpture-tripo-v1.glb')
    parser.add_argument('--out', type=Path, default=ROOT/'docs/sculpture/ortho/validation')
    parser.add_argument('--bin', type=Path, default=ROOT/'public/models/sculpture/sculpture-muscle-ortho-v1.bin')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    meta = json.loads(args.meta.read_text())
    p, n, faces, local, records, transform = load_glb(args.model)
    vertex_count = len(p)
    H = np.ptp(p[:, 1])
    assert abs(H-meta['front']['modelHeight']) < 1e-6, 'Wrong model / metadata pair.'
    print(f'Model: {vertex_count} vertices, {len(faces)} triangles', flush=True)
    votes = np.zeros((vertex_count, 14))
    fallback = np.zeros_like(votes)
    background = np.zeros(vertex_count)
    views = {}
    for view in ['front', 'back', 'left', 'right']:
        path = args.input/f'{view}.png'
        rgb = np.asarray(Image.open(path).convert('RGB'))
        height, width = rgb.shape[:2]
        assert abs(width/height-meta[view]['aspect']) < 1e-6, 'Image aspect does not match metadata.'
        assert np.count_nonzero(np.ptp(rgb.astype(int), axis=2) > 80) > width*height*.005, 'Input is not a colored segmentation map.'
        seg = quantize(rgb)
        white = seg == BG
        distance, nearest = ndimage.distance_transform_edt(white, return_indices=True)
        xyz, normal = project(p, n, meta[view], width, height)
        depth, _ = rasterize(xyz, faces, np.ones((vertex_count, 3)), width, height)
        xi, yi = np.rint(xyz[:, 0]).astype(int), np.rint(xyz[:, 1]).astype(int)
        inside = (xi >= 0) & (xi < width) & (yi >= 0) & (yi < height)
        xi = np.clip(xi, 0, width-1)
        yi = np.clip(yi, 0, height-1)
        # 3x3 conservative depth support handles raster coverage at silhouette vertices.
        local_depth = ndimage.maximum_filter(depth, size=3)
        visible = inside & (normal[:, 2] > 0) & (xyz[:, 2] >= local_depth[yi, xi] - H*.003)
        weight = np.maximum(normal[:, 2], 0)*visible
        sample = seg[yi, xi]
        direct = visible & (sample != BG)
        ids = np.flatnonzero(direct)
        votes[ids, sample[ids]] += weight[ids]
        radius = 6 * width/1024
        near = visible & (sample == BG) & (distance[yi, xi] <= radius)
        ni = np.flatnonzero(near)
        recovered = seg[nearest[0, yi[ni], xi[ni]], nearest[1, yi[ni], xi[ni]]]
        fallback[ni, recovered] += weight[ni]*.5
        deep_white = visible & (sample == BG) & (distance[yi, xi] > radius)
        background[deep_white] += weight[deep_white]
        # Registration QA: colored pixels should lie inside the original projected silhouette.
        silhouette = np.isfinite(depth)
        spill = (~white) & (~silhouette)
        outside_dist = ndimage.distance_transform_edt(~silhouette)
        color_count = int((~white).sum())
        info = dict(width=width, height=height, sha256=digest(path), visibleVertices=int(visible.sum()),
                    directlyColoredVertices=int(direct.sum()), edgeRecoveryCandidates=int(near.sum()),
                    colorPixels=color_count, colorOutsideSilhouette=int(spill.sum()),
                    colorOutsideSilhouettePercent=round(100*spill.sum()/max(1, color_count), 3),
                    outsideSilhouetteDistanceP95=float(np.percentile(outside_dist[spill], 95)) if spill.any() else 0)
        views[view] = info
        qa = rgb.copy()
        outline = silhouette ^ ndimage.binary_erosion(silhouette, iterations=1)
        qa[outline] = [40, 40, 40]
        qa[spill] = [255, 70, 70]
        Image.fromarray(qa).save(args.out/f'alignment-{view}.png')
        print(view, json.dumps(info), flush=True)

    # Share votes BEFORE choosing labels. Union includes ALL nearest mirror links in both
    # directions and coincident UV seam vertices, so smoothing cannot break symmetry.
    center = (local.min(0)+local.max(0))/2
    reflected = local.copy()
    reflected[:, 2] = 2*center[2]-reflected[:, 2]
    mirror_distance, mirror = cKDTree(local).query(reflected)
    _, weld_inverse = np.unique(np.round(local/H, 7), axis=0, return_inverse=True)
    roots = symmetry_groups(local, mirror, weld_inverse)
    _, groups = np.unique(roots, return_inverse=True)
    count = int(groups.max()+1)
    sizes = np.bincount(groups)
    gv = np.zeros((count, 14))
    gf = np.zeros_like(gv)
    gb = np.zeros(count)
    np.add.at(gv, groups, votes)
    np.add.at(gf, groups, fallback)
    np.add.at(gb, groups, background)
    need = gv.sum(1) == 0
    gv[need] = gf[need]
    labels = np.full(count, 255, dtype=np.uint8)
    colored = gv.sum(1) > 0
    labels[colored] = gv[colored].argmax(1)
    labels[(~colored) & (gb > 0)] = BG
    # Deep interior white is an intentional non-muscle mask, unlike white within
    # the six-pixel edge tolerance (always ignored / recovered). This prevents a
    # side-view glute boundary from coloring a hand whose frontal visible surface
    # is clearly white. Use the same normal weights and require a clear majority.
    background_consensus = (gb > gv.sum(1)*1.35) & (gb > 0)
    labels[background_consensus] = BG
    # Never allow tiny residual lines in white head/neck to become palette labels.
    # A conservative upper-neck/head guard is explicitly recorded, in normalized height.
    normalized_y = (local[:, 1]-local[:, 1].min())/H
    head_neck = (normalized_y > .855) & (np.abs(local[:, 2]-center[2])/H < .065)
    protected = np.zeros(count, dtype=bool)
    np.logical_or.at(protected, groups, head_neck)
    labels[protected] = BG
    unknown_before = int(sizes[labels == 255].sum())
    graph = make_graph(p, faces, groups, count)
    labels, fill_distance = fill_surface(graph, labels)
    labels, changes = smooth(graph, labels)
    result = labels[groups]
    assert np.all(result == result[mirror]), 'Mirror agreement failed.'
    assert not np.any(result == 255), 'Unassigned vertex found.'
    assert np.all(result[head_neck] == BG)
    text = (ROOT/'lib/sculpture.ts').read_text()
    order = re.findall(r"'([^']+)'", re.search(r'SCULPTURE_ORDER: MuscleId\[\] = \[(.*?)\];', text, re.S).group(1))
    lookup = np.full(256, BG, dtype=np.uint8)
    for i, (key, _, _, _) in enumerate(PALETTE):
        lookup[i] = order.index(key)
    output = lookup[result]
    assert len(output) == vertex_count and set(output.tolist()) <= set(lookup.tolist())
    args.bin.parent.mkdir(parents=True, exist_ok=True)
    args.bin.write_bytes(output.tobytes())
    assert np.array_equal(np.fromfile(args.bin, dtype=np.uint8), output)
    palette = [dict(canonicalId=key, byteValue=order.index(key), color=color, linkedIds=linked,
                    vertexCount=int((result == i).sum())) for i, (key, _, color, linked) in enumerate(PALETTE)]
    report = dict(format='uint8, one byte per original vertex; no header', vertexCount=vertex_count,
                  triangleCount=len(faces), backgroundValue=BG, unassignedValue=255, unassignedVertices=0,
                  model=str(args.model.relative_to(ROOT)), modelSha256=digest(args.model),
                  metadataSha256=digest(args.meta), binarySha256=digest(args.bin),
                  meshOrder=records, sculptureOrder=order, palette=palette,
                  fineToCanonical={fine: key for key, _, _, linked in PALETTE for fine in linked},
                  unmappedFineIds=['neck', 'serratus', 'adductors'],
                  views=views, symmetry=dict(anatomicalPlane='native local Z = bounding-box midpoint',
                  localPlaneZ=float(center[2]), worldTransform=transform.tolist(),
                  method='union of every nearest mirrored vertex pair plus UV seam welds; votes and smoothing on quotient mesh',
                  mirroredVertexChecks=vertex_count, mirroredVertexMismatches=0, groupCount=count,
                  maximumGroupSize=int(sizes.max()), mirrorDistanceP95=float(np.percentile(mirror_distance, 95)),
                  mirrorDistanceMax=float(mirror_distance.max())),
                  fill=dict(method='multi-source shortest mesh-edge distance', filledVertices=unknown_before,
                            maxDistance=float(fill_distance.max())),
                  smoothing=dict(rounds=2, changedGroupsPerRound=changes, backgroundLocked=True),
                  backgroundConsensus='Only deep interior white (> 6 px at 1024-wide) can override color, at > 1.35x total normal-weighted color evidence. Silhouette/region edge white never votes.',
                  backgroundVertices=int((result == BG).sum()),
                  inputCleanup='Near white RGB > 240, plus achromatic outline ink with max(RGB)-min(RGB) < 64, is background; all remaining pixels use nearest RGB palette color',
                  explicitGuard='Head / upper neck: normalized native Y > 0.855 and abs(native Z-centerZ)/height < 0.065',
                  glutesOnShorts=True, pageIntegration=False)
    (args.bin.with_suffix('.json')).write_text(json.dumps(report, indent=2)+'\n')
    (args.out/'bake-report.json').write_text(json.dumps(report, indent=2)+'\n')
    preview(p, n, faces, result, meta, args.out)
    print(json.dumps({k: report[k] for k in ['vertexCount', 'backgroundVertices', 'unassignedVertices', 'symmetry', 'fill', 'smoothing']}, indent=2), flush=True)
    print('Saved', args.bin, args.out/'sculpture-muscle-ortho-review.png', flush=True)


if __name__ == '__main__':
    main()

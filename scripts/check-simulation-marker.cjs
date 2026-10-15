// 独立坐标/图像诊断；只读六正式轨迹，不代表地图组件视觉验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { loadFormalRoutes } = require('./formal-route-fixtures.cjs');
const core = require('../miniprogram/utils/trail-progress');
const { createSimulator } = require('../miniprogram/utils/trail-simulator');
const { toStartMapData } = require('../miniprogram/utils/map-data');
const root = path.resolve(__dirname, '..');

// 与引擎插值实现独立：在当前段的局部米制平面投影，检查点到原段的距离。
function segmentDistance(p, a, b) {
  const scale = Math.cos(a.latitude * Math.PI / 180), k = 111195;
  const x = q => (q.longitude - a.longitude) * k * scale;
  const y = q => (q.latitude - a.latitude) * k;
  const bx = x(b), by = y(b), px = x(p), py = y(p);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by)));
  return Math.hypot(px - t * bx, py - t * by);
}
const reports = loadFormalRoutes().map(route => {
  const index = core.buildTrailIndex(route), map = toStartMapData(route);
  assert.deepEqual(map.polyline[0].points, route.track);
  assert.equal(route.coordinateSystem, 'gcj02');
  const s = createSimulator(route); s.start();
  // 单独保留正式起点元数据偏差，不能以此移动或改写起点。
  const startOffsetMeters = Math.min(...index.segments.map(seg => segmentDistance(route.startPoint, seg.a, seg.b)));
  let samples = 0, maximumOffsetMeters = 0, previousTime = -Infinity;
  for (let frame = 0; frame < 10000 && s.getSnapshot().playbackStatus === 'playing'; frame++) {
    const snap = s.advance(frame < 3 ? 2000 : 10000), point = snap.simulatedLocation;
    assert(point.updatedAt > previousTime); previousTime = point.updatedAt;
    if (snap.observationCount <= 3) continue;
    const segment = index.segments.find(seg => seg.endMeters >= snap.playbackDistanceMeters) || index.segments.at(-1);
    const offset = segmentDistance(point, segment.a, segment.b);
    maximumOffsetMeters = Math.max(maximumOffsetMeters, offset); samples++;
    assert(offset < 1, `${route._id}: 模拟点不在当前正式线段上`);
  }
  assert(samples > 100); assert.equal(s.getSnapshot().playbackStatus, 'finished');
  assert(s.getSnapshot().canConfirmCompletion); s.dispose();
  return { routeId: route._id, samples, maximumOffsetMeters, startMetadataOffsetMeters: startOffsetMeters, result: 'PASS' };
});

// 解码原创非交错RGBA PNG的alpha通道，确认透明边距/图像圆心没有偏移。
const png = fs.readFileSync(path.join(root, 'miniprogram/assets/map/simulation.png'));
assert.equal(png.subarray(1, 4).toString(), 'PNG');
const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
assert.equal(png[24], 8); assert.equal(png[25], 6); assert.equal(png[28], 0);
const parts = [];
for (let offset = 8; offset < png.length;) {
  const length = png.readUInt32BE(offset), kind = png.subarray(offset + 4, offset + 8).toString();
  if (kind === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
  offset += length + 12;
}
const raw = zlib.inflateSync(Buffer.concat(parts)), stride = width * 4;
const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
let previous = Buffer.alloc(stride), weight = 0, xSum = 0, ySum = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)], row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
  assert(filter <= 4);
  for (let i = 0; i < stride; i++) {
    const a = i >= 4 ? row[i - 4] : 0, b = previous[i], c = i >= 4 ? previous[i - 4] : 0;
    row[i] = (row[i] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
  }
  for (let x = 0; x < width; x++) { const alpha = row[x * 4 + 3]; weight += alpha; xSum += x * alpha; ySum += y * alpha; }
  previous = row;
}
assert(weight > 0);
const centroid = { x: xSum / weight, y: ySum / weight };
assert(Math.abs(centroid.x - (width - 1) / 2) < 0.1);
assert(Math.abs(centroid.y - (height - 1) / 2) < 0.1);
console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_GEOMETRY_AND_ICON_ONLY', reports,
  icon: { width, height, alphaCentroid: centroid }, visualAcceptance: 'DEVTOOLS_MARKER_VISUAL_PENDING' }, null, 2));

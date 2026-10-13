// 公开测试唯一路线来源；GPS插值/噪声只是临时输入，不创建新Route或修改正式文件。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const core = require('../miniprogram/utils/trail-progress');
const root = path.resolve(__dirname, '..');
const FILES = Object.freeze({
  'fj-route-005': 'xiamen-loop.json', 'fj-route-006': 'damushan.json',
  'fj-route-008': 'yushandao.json', 'fj-route-009': 'huanglianyu.json',
  'fj-route-010': 'taimushan.json', 'fj-route-011': 'xiaoping-forest-park.json'
});
const clone = value => JSON.parse(JSON.stringify(value));
function loadFormalRoutes() {
  const actual = fs.readdirSync(path.join(root, 'data/routes')).filter(f => f.endsWith('.json')).sort();
  const expected = Object.values(FILES).flatMap(f => [f, f.replace('.json', '-import.json')]).sort();
  assert.deepEqual(actual, expected, '正式目录只允许六Route及其Import');
  return Object.entries(FILES).map(([id, file]) => {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'data/routes', file), 'utf8'));
    assert.equal(r._id, id); assert.equal(r.coordinateSystem, 'gcj02'); return r;
  });
}
function routeById(id) { assert(Object.hasOwn(FILES, id)); return loadFormalRoutes().find(r => r._id === id); }
function atMeters(index, meters) {
  const s = Math.max(0, Math.min(index.totalTrackMeters, meters));
  const seg = index.segments.find(x => x.endMeters >= s) || index.segments.at(-1);
  const t = Math.max(0, Math.min(1, (s - seg.startMeters) / seg.lengthMeters));
  return { latitude: seg.a.latitude + t * (seg.b.latitude - seg.a.latitude), longitude: seg.a.longitude + t * (seg.b.longitude - seg.a.longitude) };
}
function gpsOffset(point, northMeters, eastMeters = 0) {
  return { latitude: point.latitude + northMeters / 111195,
    longitude: point.longitude + eastMeters / (111195 * Math.cos(point.latitude * Math.PI / 180)) };
}
function fixture(route = routeById('fj-route-006'), api = core) {
  assert(Object.hasOwn(FILES, route._id), '不允许第七Route');
  const index = api.buildTrailIndex(route); assert.equal(index.status, 'ready');
  let state = api.createProgressState(index), now = 1000000;
  const fix = (p, seconds = 5, accuracy = 5) => {
    now += seconds * 1000; const before = JSON.stringify(state), prior = state;
    const out = api.updateTrailProgress(index, state, { ...p, accuracy, updatedAt: now }, now);
    assert.equal(JSON.stringify(prior), before); state = out.state; return out;
  };
  const start = () => { for (let i = 0; i < 3; i++) fix(route.startPoint, 2); assert.equal(state.phase, 'following'); };
  const walk = (end, from = state.cursorMeters + 10, step = 10, interval = 5) => {
    for (let s = from; s <= end; s += step) fix(atMeters(index, s), interval);
  };
  return { index, at: s => atMeters(index, s), fix, step: fix, start, walk, get state() { return state; }, get now() { return now; } };
}
module.exports = { FILES, loadFormalRoutes, routeById, atMeters, gpsOffset, fixture, clone };

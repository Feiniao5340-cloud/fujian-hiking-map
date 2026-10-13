// 独立QA：不引用修复轮fixture；输入由正式track原序派生，不调用wx/云/真实GPS。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../miniprogram/utils/trail-progress');
const args = process.argv.slice(2);
const beforePath = args.includes('--before') ? args[args.indexOf('--before') + 1] : null;
let old = null;
if (beforePath) {
  // 历史源码作为只读文本fixture保存，禁止进入小程序运行路径。
  const Module = require('node:module'), snapshot = new Module('b1-before');
  snapshot._compile(fs.readFileSync(path.resolve(beforePath), 'utf8'), path.resolve(beforePath));
  old = snapshot.exports;
}
const meters = (a, b) => {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
};
function run(api, route, step, interval, strict = true) {
  const index = api.buildTrailIndex(route);
  assert.equal(index.status, 'ready');
  const original = JSON.stringify(route);
  const cumulative = [0];
  for (let i = 1; i < route.track.length; i++) cumulative.push(cumulative.at(-1) + meters(route.track[i - 1], route.track[i]));
  const total = cumulative.at(-1);
  assert(Math.abs(total - index.totalTrackMeters) < 1e-6);
  let state = api.createProgressState(index), now = 1000000, segment = 1;
  let rollback = false, premature = false, maxLag = 0, ambiguousFrames = 0, callbacks = 0;
  function send(p, seconds, accuracy = 5) {
    now += seconds * 1000;
    const previousState = state, previous = JSON.stringify(state);
    state = api.updateTrailProgress(index, state, { ...p, accuracy, updatedAt: now }, now).state;
    assert.equal(JSON.stringify(previousState), previous, '不得修改上一个模型');
    callbacks++;
    if (state.locationQuality === 'ambiguous') ambiguousFrames++;
    if (strict) {
      assert((state.branches || []).length <= 3, '候选容量');
      if (state.cursorMeters !== null) assert(state.cursorMeters - state.startCursorMeters <= api.POLICY.speed * state.activeReliableSeconds + state.initialAllowance + 1e-6, '总可信推进预算');
      assert.notEqual(state.phase, 'completed', '算法不得自动完成');
    }
  }
  for (let i = 0; i < 3; i++) send(route.startPoint, 2);
  assert.equal(state.phase, 'following');
  const start = state.cursorMeters;
  // 起点驻留两分钟，即使环线末点在同一位置也不能完成。
  for (let i = 0; i < 60; i++) {
    send(route.startPoint, 2);
    if (strict) { assert.equal(api.canConfirmCompletion(index, state, now), false); assert.equal(state.hasDeparted, false); }
  }
  let previousCursor = state.cursorMeters;
  function advance(s) {
    while (segment < route.track.length - 1 && cumulative[segment] < s) segment++;
    const t = Math.max(0, Math.min(1, (s - cumulative[segment - 1]) / (cumulative[segment] - cumulative[segment - 1] || 1)));
    const a = route.track[segment - 1], b = route.track[segment];
    send({ latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude) }, interval);
    rollback ||= state.cursorMeters < previousCursor - 5;
    previousCursor = state.cursorMeters;
    maxLag = Math.max(maxLag, s - state.cursorMeters);
    premature ||= api.canConfirmCompletion(index, state, now) && s < total - Math.min(100, total * 0.01);
  }
  for (let s = start + step; s < total; s += step) advance(s);
  advance(total);
  for (let i = 0; i < 10; i++) send(route.track.at(-1), 2);
  const qualified = api.canConfirmCompletion(index, state, now);
  const result = qualified && !rollback && !premature && maxLag <= api.POLICY.maxForward + 1e-6 ? 'PASS' : 'FAIL';
  const report = { routeId: route._id, name: route.name, trackPoints: route.track.length, stepMeters: step, intervalSeconds: interval,
    callbacks, ambiguousFrames, geometryMeters: total, cursorMeters: state.cursorMeters, progressPercent: state.cursorMeters / total * 100,
    maxLagMeters: maxLag, abnormalRollback: rollback, prematureCompletion: premature, canConfirmCompletion: qualified, phase: state.phase, result };
  if (strict) {
    assert.equal(result, 'PASS', JSON.stringify(report));
    assert.equal(api.canConfirmCompletion(index, state, now + 15001), false, 'freshness');
    for (const change of [{ hasDeparted: false }, { continuityBroken: true }, { pending: {} }, { phase: 'paused' },
      { offRouteStatus: 'suspected' }, { cursorMeters: total * 0.97 }, { routeIdentity: 'stale-route' }]) {
      assert.equal(api.canConfirmCompletion(index, { ...state, ...change }, now), false, JSON.stringify(change));
    }
    for (const accuracy of [35, 80, 100, null]) {
      const next = api.updateTrailProgress(index, state, { ...route.track.at(-1), accuracy, updatedAt: now + 2000 }, now + 2000).state;
      assert.equal(next.cursorMeters, state.cursorMeters);
      assert.equal(api.canConfirmCompletion(index, next, now + 2000), false, '低精度撤销终点资格');
      assert.equal(next.branches, null);
    }
    const p = route.track.at(-1);
    const jump = api.updateTrailProgress(index, state, { latitude: p.latitude + 0.01, longitude: p.longitude, accuracy: 5, updatedAt: now + 1000 }, now + 1000).state;
    assert.equal(jump.locationQuality, 'jump'); assert.equal(jump.cursorMeters, state.cursorMeters);
    assert.equal(api.canConfirmCompletion(index, jump, now + 1000), false);
    const gap = api.updateTrailProgress(index, state, { ...p, accuracy: 5, updatedAt: now + 120000 }, now + 120000).state;
    assert.equal(gap.activeReliableSeconds, state.activeReliableSeconds, '长断流不得补计');
    assert.equal(api.canConfirmCompletion(index, gap, now + 120000), false);
    const paused = api.pauseProgressState(index, state);
    assert.equal(paused.branches, null); assert.equal(api.canConfirmCompletion(index, paused, now), false);
    assert.equal(JSON.stringify(route), original, '正式数据保持');
  }
  return report;
}
const routes = require('./formal-route-fixtures.cjs').loadFormalRoutes();
const reproductionRoute = routes.find(r => r._id === 'fj-route-006');
const currentReproduction = run(core, reproductionRoute, 20, 10);
assert(currentReproduction.ambiguousFrames > 0, '必须实际经过正式轨迹歧义并恢复');
let beforeReproduction = null;
if (old) {
  assert.deepEqual(core.POLICY, old.POLICY);
  beforeReproduction = run(old, reproductionRoute, 20, 10, false);
  assert.equal(beforeReproduction.result, 'FAIL', '旧源码应在同一正式轨迹稳定复现B1');
  assert.equal(beforeReproduction.canConfirmCompletion, false);
}
const reports = routes.flatMap(route => [run(core, route, 20, 10), run(core, route, 2, 2)]);
console.log(JSON.stringify({ result: 'PASS', evidenceType: 'INDEPENDENT_FORMAL_TRACK_GPS_REPLAY_NOT_PHONE', beforeReproduction, currentReproduction, reports }, null, 2));

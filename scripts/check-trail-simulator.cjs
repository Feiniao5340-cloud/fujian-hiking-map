// 六正式路线 + 真实B1；禁止微信/网络/计时器的沙箱，不是手机导航验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const core = require('../miniprogram/utils/trail-progress');
const { loadFormalRoutes, atMeters } = require('./formal-route-fixtures.cjs');
const routes = loadFormalRoutes();
const source = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/trail-simulator.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const cases = [], reports = [], fastReports = [];
function test(name, fn) { fn(); cases.push(name); }
function sandbox() {
  const audit = { builds: 0, frames: 0, previous: null, last: null, index: null, milliseconds: [] };
  const forbidden = () => { throw new Error('真实GPS/云/网络/计时器不可调用'); };
  const module = { exports: {} };
  const api = { ...core, buildTrailIndex(route) { audit.builds++; return audit.index = core.buildTrailIndex(route); },
    updateTrailProgress(index, previous, point, now) {
      assert.equal(point.accuracy, 5); assert.equal(now, point.updatedAt);
      if (audit.previous) {
        assert(point.updatedAt > audit.previous.updatedAt, '虚拟时间必须严格增加');
        const seconds = (point.updatedAt - audit.previous.updatedAt) / 1000;
        assert(seconds <= core.POLICY.maxGapMs / 1000);
        assert(core.distance(audit.previous, point) <= core.POLICY.speed * seconds + 0.001, '不能用倍率制造瞬移');
      }
      const t = performance.now(), result = core.updateTrailProgress(index, previous, point, now);
      audit.milliseconds.push(performance.now() - t);
      assert(!['INVALID_TIME', 'STALE_LOCATION', 'POSITION_JUMP', 'TOTAL_PROGRESS_JUMP', 'INVALID_STATE'].includes(result.reason), result.reason);
      audit.frames++; audit.previous = { ...point }; audit.last = result;
      return result;
    } };
  vm.runInNewContext(source, { module, performance,
    require(name) { assert.equal(name, './trail-progress', '只允许纯B1依赖'); return api; },
    wx: new Proxy({}, { get: forbidden }), fetch: forbidden, setInterval: forbidden, setTimeout: forbidden,
    Date: class extends Date { static now() { return forbidden(); } } });
  return { ...module.exports, audit, resetAudit() { audit.previous = audit.last = null; } };
}
function verifiedFrame(session, audit, before) {
  const s = session.getSnapshot();
  assert.equal(s.mode, 'simulation'); assert.equal(s.actualOutdoorCompleted, false);
  if (audit.last) {
    assert.equal(s.matchedProgressMeters, audit.last.progressMeters);
    assert.equal(s.matchedProgressRatio, audit.last.progressRatio);
    assert.equal(s.remainingMeters, audit.last.remainingMeters);
    assert.equal(s.locationQuality, audit.last.locationQuality);
    assert.equal(s.b1Phase, audit.last.phase);
    assert.equal(s.canConfirmCompletion, core.canConfirmCompletion(audit.index, audit.last.state, s.simulatedLocation.updatedAt));
    if (s.simulatedLocation.updatedAt > 1000006 && s.observationCount > 3) {
      const point = atMeters(audit.index, s.playbackDistanceMeters);
      assert(core.distance(point, s.simulatedLocation) < 0.001, '必须沿正式原序插值');
    }
  }
  if (before) {
    assert(s.playbackDistanceMeters >= before.playbackDistanceMeters);
    if (before.matchedProgressMeters !== null && s.matchedProgressMeters !== null) {
      assert(s.matchedProgressMeters >= before.matchedProgressMeters - 5, '不得异常回退');
    }
  }
  if (s.canConfirmCompletion) {
    assert(s.playbackDistanceMeters >= audit.index.totalTrackMeters - Math.min(100, audit.index.totalTrackMeters * 0.01));
  }
  return s;
}

test('六路线索引、起点连续证据、全程真实B1、末点及性能', () => {
  for (const route of routes) {
    const bytes = JSON.stringify(route), h = sandbox(), session = h.createSimulator(route);
    assert.equal(session.getSnapshot().playbackStatus, 'idle'); assert.equal(h.audit.builds, 1);
    session.start(); session.start(); assert.equal(h.audit.frames, 0);
    for (let i = 0; i < 3; i++) {
      session.advance(2000); const s = verifiedFrame(session, h.audit);
      assert.equal(s.observationCount, i + 1);
      assert.equal(s.canConfirmCompletion, false);
      assert.equal(s.b1Phase, i < 2 ? 'starting' : 'following');
      assert(core.distance(route.startPoint, s.simulatedLocation) < 0.001);
    }
    const start = session.getSnapshot().playbackDistanceMeters;
    if (route._id === 'fj-route-010') { assert(start > 10 && start < 20); assert.deepEqual(route.startPoint.latitude, route.track[4].latitude); }
    let s = session.getSnapshot(), delayed = 0, ambiguous = 0, frames = 0;
    const begin = performance.now();
    while (s.playbackStatus === 'playing' && frames++ < 10000) {
      session.advance(10000); s = verifiedFrame(session, h.audit, s);
      assert.equal(s.errorCode, null);
      if (s.matchedProgressMeters < s.playbackDistanceMeters - 1) delayed++;
      if (s.locationQuality === 'ambiguous') ambiguous++;
    }
    assert.equal(s.playbackStatus, 'finished', JSON.stringify(s)); assert.equal(s.canConfirmCompletion, true);
    assert.equal(s.b1Phase, 'following', '演示终点不得伪造B1 completed');
    assert.equal(s.playbackRatio, 1); assert(delayed > 0, '播放与确认进度必须能不同');
    assert(core.distance(s.simulatedLocation, route.track.at(-1)) < 0.001);
    assert.equal(JSON.stringify(route), bytes); assert.equal(h.audit.builds, 1);
    if (route._id === 'fj-route-009') assert(core.distance(route.track[0], route.track.at(-1)) > 100);
    const times = h.audit.milliseconds.slice().sort((a, b) => a - b);
    const p95 = times[Math.floor((times.length - 1) * 0.95)], max = times.at(-1);
    if (route._id === 'fj-route-008') { assert(p95 < 100, '本机每帧p95应低于100ms'); assert(max < 500, '本机单帧不能严重阻塞'); }
    reports.push({ routeId: route._id, name: route.name, trackPoints: route.track.length,
      startMeters: start, playbackMeters: s.playbackDistanceMeters, matchedMeters: s.matchedProgressMeters,
      matchedPercent: s.matchedProgressRatio * 100, frames: h.audit.frames, delayedSnapshots: delayed,
      ambiguousSnapshots: ambiguous, canConfirmCompletion: s.canConfirmCompletion,
      playbackStatus: s.playbackStatus, b1Phase: s.b1Phase, actualOutdoorCompleted: false,
      replayComputeMs: performance.now() - begin, frameP95Ms: p95, frameMaxMs: max, result: 'PASS' });
  }
});
test('1/2/4倍改变帧消费，B1虚拟时间及位置完全一致', () => {
  const outputs = [1, 2, 4].map(rate => {
    const h = sandbox(), s = h.createSimulator(routes[1]); s.setPlaybackRate(rate); s.start();
    s.advance(6000 / rate); s.advance(10000 / rate); verifiedFrame(s, h.audit);
    assert.equal(h.audit.frames, 4); return s.getSnapshot();
  });
  for (const key of ['virtualElapsedMs', 'simulatedLocation', 'playbackDistanceMeters', 'matchedProgressMeters']) {
    assert.deepEqual(plain(outputs[0][key]), plain(outputs[1][key])); assert.deepEqual(plain(outputs[1][key]), plain(outputs[2][key]));
  }
});
test('暂停冻结虚拟位置/时钟/信用；继续与不中断观测完全一致', () => {
  const h = sandbox(), s = h.createSimulator(routes[1]), other = sandbox(), uninterrupted = other.createSimulator(routes[1]);
  s.start(); uninterrupted.start(); s.advance(6000); uninterrupted.advance(6000);
  s.advance(35000); uninterrupted.advance(35000);
  const paused = s.pause(), calls = h.audit.frames;
  for (let i = 0; i < 100; i++) assert.deepEqual(plain(s.advance(60000)), plain(paused));
  assert.equal(h.audit.frames, calls); s.resume(); s.advance(5000); uninterrupted.advance(5000);
  assert.deepEqual(plain(s.getSnapshot()), plain(uninterrupted.getSnapshot())); verifiedFrame(s, h.audit);
  const first = sandbox(), initial = first.createSimulator(routes[1]); initial.start(); initial.advance(2000);
  initial.pause(); initial.advance(60000); initial.resume(); initial.advance(4000);
  assert.equal(initial.getSnapshot().b1Phase, 'following');
});
test('倍率切换仅作用后续等待；不足一帧信用不重复计入', () => {
  const h = sandbox(), s = h.createSimulator(routes[1]); s.start(); s.advance(1000);
  s.setPlaybackRate(2); s.advance(500); assert.equal(s.getSnapshot().observationCount, 1);
  s.setPlaybackRate(4); s.advance(1000); assert.equal(s.getSnapshot().observationCount, 3);
  assert.equal(s.getSnapshot().virtualElapsedMs, 6000);
});
test('重播重建B1，不重建几何；快照及Route输入隔离', () => {
  const h = sandbox(), input = plain(routes[1]), s = h.createSimulator(input);
  s.start(); s.advance(6000); s.advance(20000); const previous = s.getSnapshot();
  assert(Object.isFrozen(previous)); assert(Object.isFrozen(previous.simulatedLocation));
  input.track[0].latitude = 0; input.startPoint.latitude = 0;
  s.restart(); h.resetAudit(); assert.equal(s.getSnapshot().matchedProgressMeters, null);
  assert.equal(s.getSnapshot().simulatedLocation, null); assert.equal(s.getSnapshot().virtualElapsedMs, 0);
  s.start(); s.advance(6000); assert.equal(s.getSnapshot().b1Phase, 'following'); assert.equal(h.audit.builds, 1);
  assert(core.distance(s.getSnapshot().simulatedLocation, routes[1].startPoint) < 0.001);
  assert.equal(previous.virtualElapsedMs, 26000);
});
test('切换路线与dispose永久作废旧会话；不继承进度/倍率', () => {
  const h = sandbox(), old = h.createSimulator(routes[1]); old.setPlaybackRate(4); old.start(); old.advance(10000);
  const next = old.switchRoute(routes[4]); assert.equal(old.getSnapshot().routeId, null);
  for (const action of [() => old.start(), () => old.advance(1000), () => old.resume(), () => old.restart()]) assert.equal(action().errorCode, 'DISPOSED');
  assert.equal(next.getSnapshot().routeId, routes[4]._id); assert.equal(next.getSnapshot().matchedProgressMeters, null);
  assert.equal(next.getSnapshot().playbackRate, 1); h.resetAudit(); next.start(); next.advance(6000);
  assert.equal(next.getSnapshot().b1Phase, 'following'); next.dispose(); assert.equal(next.getSnapshot().simulatedLocation, null);
});
test('非法Route/时间/倍率/状态安全拒绝，不推进', () => {
  for (const route of [null, undefined, {}, { ...routes[0], track: [] }, { ...routes[0], coordinateSystem: 'wgs84' },
    { ...routes[0], startPoint: { ...routes[0].startPoint, latitude: NaN } }]) {
    const s = sandbox().createSimulator(route); assert.equal(s.getSnapshot().errorCode, 'INVALID_ROUTE'); assert.equal(s.start().playbackStatus, 'error');
  }
  const h = sandbox(), s = h.createSimulator(routes[1]); s.start();
  for (const value of [0, -1, NaN, Infinity, '1000', null, 60001]) {
    assert.equal(s.advance(value).errorCode, 'INVALID_TIME_STEP'); assert.equal(s.getSnapshot().virtualElapsedMs, 0);
  }
  for (const rate of [0, -1, 3, NaN, Infinity, '2', null]) assert.equal(s.setPlaybackRate(rate).errorCode, 'INVALID_PLAYBACK_RATE');
  assert.equal(h.audit.frames, 0); s.advance(6000); assert.equal(s.getSnapshot().errorCode, null);
  s.pause(); assert.equal(s.start().errorCode, 'INVALID_STATE'); assert.equal(s.getSnapshot().playbackStatus, 'paused');
});
test('固定快速六路线17秒调度：完整合法序列、批次预算、B1终点而非假100%', () => {
  for (const route of routes) {
    const h = sandbox(), s = h.createSimulator(route, { fastDemo: true }); s.start();
    let wall = 0, maxBatch = 0, batches = 0, delayed = 0;
    const begin = performance.now();
    while (s.getSnapshot().playbackStatus === 'playing' && wall < 60000) {
      wall += h.FAST_DEMO.refreshMs; let snap = s.advance(h.FAST_DEMO.refreshMs), drains = 0;
      do {
        assert(snap.lastBatchFrames <= h.FAST_DEMO.maxFramesPerBatch);
        maxBatch = Math.max(maxBatch, snap.lastBatchCpuMs); batches++;
        verifiedFrame(s, h.audit);
        if (snap.matchedProgressMeters !== null && snap.playbackDistanceMeters > snap.matchedProgressMeters + 1) delayed++;
        if (!snap.hasPendingFrames) break;
        assert(drains++ < 1000); snap = s.drain();
      } while (true);
    }
    const snap = s.getSnapshot();
    assert.equal(h.audit.frames, reports.find(r => r.routeId === route._id).frames, '不得跳过旧序列的起点/行进/驻留观测');
    assert.equal(snap.playbackStatus, 'finished'); assert(snap.canConfirmCompletion); assert(wall >= 15000 && wall <= 18000); assert(wall <= 20000);
    assert.equal(snap.actualOutdoorCompleted, false); assert.equal(snap.b1Phase, 'following'); assert(delayed > 0);
    assert.equal(h.audit.builds, 1); assert(maxBatch < 100, '本机批次不可严重阻塞');
    fastReports.push({ routeId: route._id, targetMs: snap.demoTargetMs, controlledWallMs: wall,
      cpuMs: performance.now() - begin, maxBatchCpuMs: maxBatch, batches, frames: h.audit.frames,
      matchedPercent: snap.matchedProgressRatio * 100, canConfirmCompletion: snap.canConfirmCompletion, result: 'PASS' });
  }
});
test('快速模式暂停/重播/切换和欠帧drain，不追补暂停或创建新几何', () => {
  const h = sandbox(), s = h.createSimulator(routes[0], { fastDemo: true }); s.start();
  s.advance(10000); assert(s.getSnapshot().hasPendingFrames, '大信用必须受批次限制');
  const paused = s.pause(); assert.deepEqual(plain(s.advance(60000)), plain(paused)); assert.deepEqual(plain(s.drain()), plain(paused));
  s.resume(); const elapsed = s.getSnapshot().demoActiveElapsedMs; s.drain(); assert.equal(s.getSnapshot().demoActiveElapsedMs, elapsed);
  assert.equal(s.setPlaybackRate(4).errorCode, 'FIXED_DEMO_MODE'); s.restart(); h.resetAudit();
  assert.equal(s.getSnapshot().virtualElapsedMs, 0); assert.equal(s.getSnapshot().demoActiveElapsedMs, 0);
  s.start(); s.advance(200); assert.equal(h.audit.builds, 1);
  const next = s.switchRoute(routes[1]); assert.equal(next.getSnapshot().fastDemo, true); assert.equal(s.start().errorCode, 'DISPOSED');
});
console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_SIMULATOR_WITH_REAL_B1_NOT_PHONE', cases, reports, fastReports,
  realGpsCalled: false, networkCalled: false, internalTimers: false }, null, 2));

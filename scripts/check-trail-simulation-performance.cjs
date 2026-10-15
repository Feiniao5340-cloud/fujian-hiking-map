'use strict';
// 六正式路线；原B1逐帧等价 + 实际Node耗时 + 注入计算延迟的页面调度。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../miniprogram/utils/trail-progress');
const overview = require('../miniprogram/utils/native-route-overview');
const simulator = require('../miniprogram/utils/trail-simulator');
const { loadFormalRoutes } = require('./formal-route-fixtures.cjs');
const { harness } = require('./check-trail-simulation-page.cjs');
const source = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/trail-simulator.js'), 'utf8');
const routes = loadFormalRoutes(), reports = [], animation = [], delayedScheduler = [];
const plain = value => JSON.parse(JSON.stringify(value));
function realNodeSchedule(route) {
  return new Promise((resolve, reject) => {
    const begin = performance.now(), s = simulator.createSimulator(route, { fastDemo: true, visualPlayback: true });
    let last = begin, cpuMs = 0, maxBatchMs = 0, maxTickGapMs = 0, yields = 0, timer;
    let buttonDelayMs = null;
    const button = setTimeout(() => { buttonDelayMs = performance.now() - begin - 5000; }, 5000);
    s.start();
    const step = drain => {
      try {
        const now = performance.now(), started = now;
        let snap;
        if (drain) snap = s.drain();
        else { const gap = now - last; maxTickGapMs = Math.max(maxTickGapMs, gap); last = now; snap = s.advance(gap); }
        cpuMs += performance.now() - started; maxBatchMs = Math.max(maxBatchMs, snap.lastBatchCpuMs);
        const wallMs = performance.now() - begin;
        assert(wallMs <= 20000, '真实Node事件循环超过20秒；不得修改断言绕过');
        if (snap.playbackStatus === 'finished') {
          assert.equal(snap.matchedProgressRatio, 1); assert(snap.canConfirmCompletion); assert(buttonDelayMs !== null);
          clearTimeout(button); s.dispose();
          resolve({ routeId: route._id, wallMs, cpuMs, maxBatchMs, maxTickGapMs, asyncDrainYields: yields, buttonDelayMs, result: 'PASS' });
        } else {
          assert.equal(snap.playbackStatus, 'playing'); if (snap.hasPendingFrames) yields++;
          timer = setTimeout(() => step(snap.hasPendingFrames), snap.hasPendingFrames ? 2 : 40);
        }
      } catch (error) { clearTimeout(timer); clearTimeout(button); s.dispose(); reject(error); }
    };
    timer = setTimeout(() => step(false), 40);
  });
}
function distanceToSegment(p, segment) {
  const a = segment.a, b = segment.b, k = 111195, cos = Math.cos(a.latitude * Math.PI / 180);
  const x = (p.longitude - a.longitude) * cos * k, y = (p.latitude - a.latitude) * k;
  const bx = (b.longitude - a.longitude) * cos * k, by = (b.latitude - a.latitude) * k;
  const t = Math.max(0, Math.min(1, (x * bx + y * by) / (bx * bx + by * by)));
  return Math.hypot(x - t * bx, y - t * by);
}
function validatePoint(index, location, meters) {
  const seg = index.segments.find(s => s.endMeters >= meters) || index.segments.at(-1);
  assert(distanceToSegment(location, seg) < 0.001, '必须在对应正式段上，不能跨多个弯道直接插值');
}
for (const route of routes) {
  const rawIndex = core.buildTrailIndex(route);
  let capturedIndex, frames = 0, cachedCpuMs = 0, uncachedCpuMs = 0, maxFrameMs = 0, builds = 0, previousTime = 0;
  const api = { ...core,
    buildTrailIndex(r) { builds++; return capturedIndex = core.buildTrailIndex(r); },
    updateTrailProgress(index, previous, point, now) {
      assert(point.updatedAt > previousTime); previousTime = point.updatedAt;
      let begin = performance.now(); const actual = core.updateTrailProgress(index, previous, point, now);
      const cpu = performance.now() - begin; cachedCpuMs += cpu; maxFrameMs = Math.max(maxFrameMs, cpu);
      begin = performance.now(); const expected = core.updateTrailProgress(rawIndex, previous, point, now);
      uncachedCpuMs += performance.now() - begin;
      assert.deepEqual(actual, expected, '冻结静态校验缓存不能改变任何B1输出/状态'); frames++;
      return actual;
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, performance, require(name) { assert.equal(name, './trail-progress'); return api; } });
  let begin = performance.now();
  const s = module.exports.createSimulator(route, { fastDemo: true, visualPlayback: true });
  const preparationMs = performance.now() - begin; s.start();
  let wallMs = 0, maxBatchMs = 0, drainCount = 0, previousVisual = null;
  while (s.getSnapshot().playbackStatus === 'playing' && wallMs < 20000) {
    wallMs += 40; let snap = s.advance(40);
    for (let n = 0; ; n++) {
      maxBatchMs = Math.max(maxBatchMs, snap.lastBatchCpuMs);
      assert(snap.lastBatchFrames <= module.exports.FAST_DEMO.maxFramesPerBatch);
      if (!snap.hasPendingFrames) break;
      assert(n < 1000); drainCount++; snap = s.drain();
    }
    if (snap.observationCount > 3) {
      validatePoint(rawIndex, snap.visualLocation, snap.visualDistanceMeters);
      if (previousVisual !== null) assert(snap.visualDistanceMeters - previousVisual <= rawIndex.totalTrackMeters * 40 / 17000 + 0.001);
      previousVisual = snap.visualDistanceMeters;
    }
  }
  const final = s.getSnapshot(); assert.equal(final.playbackStatus, 'finished');
  assert.equal(final.staticValidationCache.scans, 1); assert.equal(final.staticValidationCache.hits, frames - 1);
  assert.equal(final.matchedProgressRatio, 1); assert(final.canConfirmCompletion); assert.equal(final.actualOutdoorCompleted, false);
  assert(wallMs >= 15000 && wallMs <= 18000); assert.equal(builds, 1);
  const expectedFrames = 3 + Math.ceil((rawIndex.totalTrackMeters - rawIndex.prefixStartCandidates.reduce((best, p) => p.distanceMeters < best.distanceMeters ? p : best).s) / 20) + 10;
  // 帧数更直接与已验收的真实起点匹配长度推导；太姥山按正式前缀。
  assert.equal(frames, expectedFrames);
  assert(Object.isFrozen(capturedIndex.segments)); assert(Object.isFrozen(capturedIndex.segments[0].a));
  assert.throws(() => { capturedIndex.segments[0].a.latitude = 0; });
  // 不认识的谓词不得缓存：同样源文本、不同闭包结果仍真实求值。
  const predicate = threshold => seg => seg.startMeters >= threshold;
  assert(capturedIndex.segments.every(predicate(-1))); assert(!capturedIndex.segments.every(predicate(1)));
  for (const point of [{ latitude: NaN, longitude: 118 }, { ...route.startPoint, accuracy: 100 },
    { ...route.startPoint, updatedAt: previousTime - 1 }, { ...route.startPoint, latitude: route.startPoint.latitude + 1 }]) {
    const p = { accuracy: 5, updatedAt: previousTime + 10000, ...point };
    const state = core.createProgressState(rawIndex);
    assert.deepEqual(core.updateTrailProgress(capturedIndex, state, p, p.updatedAt), core.updateTrailProgress(rawIndex, state, p, p.updatedAt));
  }
  reports.push({ routeId: route._id, points: route.track.length, frames, wallMs, preparationMs,
    actualCachedB1CpuMs: cachedCpuMs, actualUncachedB1CpuMs: uncachedCpuMs,
    maxFrameMs, maxBatchMsWithEquivalenceInstrumentation: maxBatchMs, drainCount,
    matchedPercent: final.matchedProgressRatio * 100, canConfirmCompletion: final.canConfirmCompletion, result: 'PASS' });
  s.dispose();
}
// 仅在测试VM内模拟编译器把箭头谓词改为普通函数/改参名；不改磁盘B1。
const coreSource = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/trail-progress.js'), 'utf8');
const compiledSource = coreSource.replace(/index\.segments\.every\(s => ([\s\S]*?)\)\)\) \{/, (_, body) =>
  'index.segments.every(function (segment) { return ' + body.replace(/\bs\b/g, 'segment') + '); })) {');
assert.notEqual(compiledSource, coreSource);
const compiledModule = { exports: {} }; vm.runInNewContext(compiledSource, { module: compiledModule });
const compiledEngine = { exports: {} }; vm.runInNewContext(source, { module: compiledEngine, performance, require: () => compiledModule.exports });
const compiledSession = compiledEngine.exports.createSimulator(routes[2], { fastDemo: true, visualPlayback: true });
compiledSession.start();
for (let i = 0; i < 10; i++) { let snap = compiledSession.advance(100); while (snap.hasPendingFrames) snap = compiledSession.drain(); }
const compiledCache = compiledSession.getSnapshot().staticValidationCache;
assert.equal(compiledCache.scans, 1); assert(compiledCache.hits > 10); assert.equal(compiledCache.fallbackScans, 0);
compiledSession.dispose();
async function main() {
  // 强制起点证据分三批执行：太姥山不能把实际前缀起点误标成0米再突然追跳。
  let budgetClock = 0;
  const forcedEngine = { exports: {} };
  vm.runInNewContext(source, { module: forcedEngine, performance: { now() { return budgetClock += 5; } }, require: () => core });
  const prefixRoute = routes.find(r => r._id === 'fj-route-010');
  const forced = forcedEngine.exports.createSimulator(prefixRoute, { fastDemo: true, visualPlayback: true });
  const prefixPage = harness(), p0 = prefixPage.page(); await prefixPage.open(p0, prefixRoute); p0._simulationSession = forced;
  forced.start(); const firstFix = forced.advance(40);
  assert.equal(firstFix.observationCount, 1); assert.equal(firstFix.visualLocation, null);
  p0.publishSimulation(firstFix); assert(!p0.data.mapMarkers.some(m => m.id === -2));
  forced.drain(); const confirmed = forced.drain(); assert.equal(confirmed.observationCount, 3);
  assert(confirmed.visualDistanceMeters > 0); p0.publishSimulation(confirmed);
  assert(p0.data.mapMarkers.some(m => m.id === -2));
  assert.equal(confirmed.visualLocation.latitude, prefixRoute.startPoint.latitude);
  p0.onUnload();
  for (const route of routes) {
    const h = harness(), p = h.page(); await h.open(p, route);
    if (overview.enabledRoute(route)) { p.onUnload(); continue; } // Native overview has its own animation/control coverage; engine replay above remains all six, including010.
    const index = core.buildTrailIndex(route), updateStart = h.calls.updates.length, start = h.time(); p.onSimulationStartTap(); await h.advance(20000);
    assert.equal(p.data.simulationState.status, 'finished'); assert(h.calls.finishedAt - start <= 18000);
    let maxGapMs = 0, maxStepMeters = 0;
    for (let n = 0; n < h.calls.markerTrace.length; n++) {
      const sample = h.calls.markerTrace[n], snap = sample.snapshot;
      assert(snap.observationCount >= 3, '视觉不能用未确认起点冒充0米');
      assert.equal(sample.id, -2); assert.deepEqual(sample.anchor, { x: 0.5, y: 0.5 });
      if (snap.observationCount > 3) validatePoint(index, sample, snap.visualDistanceMeters);
      if (!n) continue;
      const before = h.calls.markerTrace[n - 1], gap = sample.at - before.at;
      maxGapMs = Math.max(maxGapMs, gap);
      const step = snap.visualDistanceMeters - before.snapshot.visualDistanceMeters;
      maxStepMeters = Math.max(maxStepMeters, step);
      assert(step >= -0.001 && step <= index.totalTrackMeters * (gap + 0.1) / 17000 + 0.001);
      assert(gap <= 200, '不能冻结后远距闪现（受控调度）');
    }
    assert(h.calls.markerTrace.length >= 400);
    animation.push({ routeId: route._id, wallMs: h.calls.finishedAt - start,
      markerPublishes: h.calls.markerTrace.length, maxGapMs, maxStepMeters,
      totalPatchBytes: h.calls.updates.slice(updateStart).reduce((sum, u) => sum + u.bytes, 0), result: 'PASS' });
    p.onUnload(); assert.equal(h.timers.size, 0);
  }
  // 010已转原生页面，但保留完整6395点B1引擎的8ms/帧压力、暂停和继续验证。
  let engineClock = 0;
  const delayedApi = {...core,updateTrailProgress(...args){engineClock+=8;return core.updateTrailProgress(...args);}};
  const delayedModule={exports:{}};
  vm.runInNewContext(source,{module:delayedModule,performance:{now:()=>engineClock},require:()=>delayedApi});
  const delayed010=delayedModule.exports.createSimulator(prefixRoute,{fastDemo:true,visualPlayback:true});
  let engineSnap=delayed010.start(),lastEngineTick=0,pausedOnce=false,enginePauseMs=0;
  while(engineSnap.playbackStatus==='playing'){
    engineClock+=engineSnap.hasPendingFrames?2:40;
    if(!pausedOnce&&engineClock>=5000){engineSnap=delayed010.pause();const frozen=plain(engineSnap);engineClock+=10000;assert.deepEqual(plain(delayed010.getSnapshot()),frozen);enginePauseMs=10000;lastEngineTick=engineClock;engineSnap=delayed010.resume();pausedOnce=true;}
    if(engineSnap.hasPendingFrames)engineSnap=delayed010.drain();else{const delta=engineClock-lastEngineTick;lastEngineTick=engineClock;engineSnap=delayed010.advance(delta);}
    assert(engineClock-enginePauseMs<=20000,'010引擎8ms压力不得因改成原生页面而删掉');
  }
  assert.equal(engineSnap.playbackStatus,'finished');assert.equal(engineSnap.matchedProgressRatio,1);assert(engineSnap.canConfirmCompletion);assert(pausedOnce);
  delayedScheduler.push({routeId:prefixRoute._id,layer:'B1_ENGINE_PRESERVED',injectedFrameCostMs:8,activeWallMs:engineClock-enginePauseMs,result:'PASS'});delayed010.dispose();
  // 此为明确标注的延迟注入，不是实际DevToolsCPU或延迟证据。
  for (const route of routes.filter(r => !overview.enabledRoute(r) && r._id === 'fj-route-009')) {
    const h = harness({ frameCostMs: 8 }), p = h.page(); await h.open(p, route);
    const start = h.time(); p.onSimulationStartTap(); let pauseLatencyMs = null;
    h.userAction(() => {
      pauseLatencyMs = h.time() - (start + 5000); p.onSimulationPauseTap();
    }, 5000);
    await h.advance(5200); assert.equal(p.data.simulationState.status, 'paused'); assert(pauseLatencyMs <= 200);
    const frozen = plain(p._simulationSession.getSnapshot()), updates = h.calls.updates.length;
    await h.advance(10000); assert.deepEqual(plain(p._simulationSession.getSnapshot()), frozen);
    assert.equal(h.calls.updates.length, updates);
    p.onSimulationResumeTap(); const resumedAt = h.time(); await h.advance(14000);
    assert.equal(p.data.simulationState.status, 'finished');
    const activeWallMs = (h.calls.finishedAt - resumedAt) + frozen.demoActiveElapsedMs;
    assert(activeWallMs <= 20000); assert.equal(p.data.simulationState.snapshot.matchedProgressRatio, 1);
    delayedScheduler.push({ routeId: route._id, injectedFrameCostMs: 8, pauseLatencyMs, activeWallMs, result: 'PASS' });
    p.onUnload(); assert.equal(h.timers.size, 0);
  }
  // 六会话并发是额外事件循环压力检查，不模拟微信地图渲染，不能外推DevTools。
  const realNodeSchedules = await Promise.all(routes.map(realNodeSchedule));
  console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_NODE_CPU_AND_CONTROLLED_ANIMATION_NOT_DEVTOOLS', compiledPredicateCache: compiledCache, reports, animation, delayedScheduler, realNodeSchedules,
    pending: ['DEVTOOLS_20S_RETEST_PENDING', 'DEVTOOLS_SMOOTHNESS_RETEST_PENDING', 'DEVTOOLS_CONTROL_LATENCY_PENDING'] }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

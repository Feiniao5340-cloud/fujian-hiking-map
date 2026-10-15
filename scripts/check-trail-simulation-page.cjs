// 真实Page、Day5引擎、B1及Navigation；正式六路线，时间/微信均为替身。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const simulator = require('../miniprogram/utils/trail-simulator');
const { loadFormalRoutes } = require('./formal-route-fixtures.cjs');
const routes = loadFormalRoutes(), root = path.resolve(__dirname, '..');
const overview = require('../miniprogram/utils/native-route-overview');
const b1PageRoutes = routes.filter(r => !overview.enabledRoute(r));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const cases = [], estimates = [], performanceReport = {};
let maximumProjectionAheadMeters = 0;
const protectedHashes = {
  "cloudfunctions/planAccessRoute/index.js": "8e4653495338c3c4952ee7e68cf5b87b233cb9cb411b1932bc2efec4a6c1f308",
  "data/routes/damushan-import.json": "f18099d22bbdff65b77a5c4b0e6c029c560322e3a462d779a1f6ede836aae33c",
  "data/routes/damushan.json": "d04688c33709efa1c58cd37308aea39bdec6c880b1f794b531cae3af2ce2586d",
  "data/routes/huanglianyu-import.json": "8e00e6050a8983566aa6a8b5f4decb0ba649236b3caa89582d6a7bea06b86722",
  "data/routes/huanglianyu.json": "77dc502dc8af78d0ee2e709e136238e1a41f6be23dad0bb122afee1e385a7577",
  "data/routes/taimushan-import.json": "5e7e964be9275e8d4c24950d5668e0f04f79a5050c3d12a9c615541cefb50e15",
  "data/routes/taimushan.json": "1c63c85b0b67e1fb27c7769007b37f27a1349ace6ccade9538858c456469046c",
  "data/routes/xiamen-loop-import.json": "fb23751f95f2b9826e5ccee2b414236dbbdc4a56c67b0c5b130384df46a2420d",
  "data/routes/xiamen-loop.json": "06f5a5b111b011d0bb1c5966f3bcf5881f285a185103c8c69f005f12a6141fce",
  "data/routes/xiaoping-forest-park-import.json": "9c72752c9b3d25eba8285b28720b15322617bc9ecf250438289a4a6ebb49fa5c",
  "data/routes/xiaoping-forest-park.json": "e953b3483189e26634347928224043de29eed50eca85fa96b250958bcb06de2e",
  "data/routes/yushandao-import.json": "0e6b4dfdd503b94215c15a5fd70c92d89a1c4371079234052aae50dfbc9f8471",
  "data/routes/yushandao.json": "99a5afa37e12dc67bfd17ffc87b831224e3fce211c986c80990bfb07b512a94c",
  "miniprogram/services/navigation-service.js": "4898b902bd59d9bf86fc31f7d2b8834c4a91d12cb4dd8a0d53fd0ee76b2fcbd4",
  "miniprogram/services/trail-follow-service.js": "8b87946c63594f77002f39e49ea15f6d6051e1df0d20790fe79f2f0b34a404ab",
  "miniprogram/utils/map-data.js": "d72e158c3863dbed910bd1d262c5b3c0b616455f467e0a8132a97b7cc7cb229e",
  "miniprogram/utils/trail-progress.js": "11430fe6002eb91bbf82e20e216e890b72f7314003f56f6b7896ba669bd6ef86",
  "scripts/formal-route-fixtures.cjs": "87064f60ed695dd59e38b6a30d9e9582911b9a55df2df67fed3b1fed7453d5d9"
};
function harness(clockOptions = {}) {
  let now = 1800000000000, current = routes[0];
  const timers = new Set(), calls = { creates: 0, disposes: 0, gps: 0, location: [], native: [], cloud: [], updates: [], camera: 0, back: 0, markerTrace: [] };
  const sessions = [], flags = { createError: false, advanceError: false, deferred: null };
  calls.overviewMoves = []; calls.overviewMarkers = new Map();
  let nativeTimer = null;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const clock = { setInterval(fn, interval) { const t = { fn, interval, due: now + interval }; timers.add(t); return t; }, clearInterval(t) { timers.delete(t); },
    setTimeout(fn, interval) { const t = { fn, interval: 0, due: now + interval }; timers.add(t); return t; }, clearTimeout(t) { timers.delete(t); } };
  const forbiddenGps = () => { calls.gps++; throw new Error('模拟不得启动真实GPS'); };
  const wx = { startLocationUpdate: forbiddenGps, onLocationChange: forbiddenGps,
    getLocation(o) { calls.location.push(o); o.success({ ...current.track[104] }); },
    openLocation(o) { calls.native.push(o); o.success(); },
    cloud: { callFunction(o) { calls.cloud.push(o); }, database() { throw new Error('不能读写真实云'); } },
    createMapContext() { calls.camera++; assert(overview.enabledRoute(current), '四B1路线不应创建原生地图动画');
      return { addMarkers(o) { assert.equal(o.clear, false); for (const m of o.markers) calls.overviewMarkers.set(m.id, plain(m)); o.success(); },
        removeMarkers(o) { clock.clearTimeout(nativeTimer); nativeTimer = null; for (const id of o.markerIds) calls.overviewMarkers.delete(id); o.success(); },
        moveAlong(o) { calls.overviewMoves.push(o); clock.clearTimeout(nativeTimer); nativeTimer = clock.setTimeout(() => {
          nativeTimer = null; const m = calls.overviewMarkers.get(o.markerId); if (m) Object.assign(m, plain(o.path.at(-1))); o.success(); o.complete();
        }, o.duration); } };
    },
    navigateBack() { calls.back++; }, redirectTo() { calls.back++; } };
  const module = { exports: {} };
  vm.runInNewContext(read('miniprogram/services/navigation-service.js'), { wx, module, ...clock,
    require: () => require('../miniprogram/config/env') });
  const navigation = module.exports;
  const api = { ...simulator, createSimulator(route, options) {
    calls.creates++; if (flags.createError) throw new Error('create failure');
    const actual = simulator.createSimulator(route, options); sessions.push(actual);
    return Object.fromEntries(Object.keys(actual).map(name => [name, (...args) => {
      if (name === 'advance' && flags.advanceError) throw new Error('advance failure');
      if (name === 'dispose') calls.disposes++;
      const result = actual[name](...args);
      if (["advance", "drain"].includes(name)) now += (clockOptions.frameCostMs || 0) * result.lastBatchFrames;
      return result;
    }]));
  } };
  const overviewModule = { exports: {} };
  vm.runInNewContext(read('miniprogram/utils/native-route-overview.js'), { module: overviewModule, Date: ClockDate, ...clock,
    require: () => require('../miniprogram/utils/trail-progress') });
  function page() {
    let definition;
    vm.runInNewContext(read('miniprogram/pages/route-detail/index.js'), { wx, ...clock, Date: ClockDate,
      console: { info() {}, error() {} }, Page(value) { definition = value; }, require(name) {
        if (name.includes('native-route-overview')) return overviewModule.exports;
        if (name.includes('trail-simulator')) return api;
        if (name.includes('route-service')) return { getRouteById: async () => flags.deferred ? flags.deferred : current };
        if (name.includes('navigation-service')) return navigation;
        if (name.includes('trail-follow-service')) return { createSession: forbiddenGps, errorMessage: () => 'GPS forbidden' };
        return require(path.resolve(root, 'miniprogram/pages/route-detail', name));
      } });
    return { ...definition, data: plain(definition.data), setData(patch) {
      assert(!this._unloaded, '卸载后setData');
      calls.updates.push({ at: now, keys: Object.keys(patch), bytes: Buffer.byteLength(JSON.stringify(patch)) });
      if (patch.simulationState && patch.simulationState.status === 'finished' && !calls.finishedAt) calls.finishedAt = now;
      if (patch.overviewState && patch.overviewState.status === 'finished' && !calls.overviewFinishedAt) calls.overviewFinishedAt = now;
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
        for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
        target[parts.at(-1)] = plain(value);
      }
      if (Object.keys(patch).some(k => k.startsWith("mapMarkers"))) { const marker = this.data.mapMarkers.find(m => m.id === -2); if (marker && this._simulationSession) calls.markerTrace.push({ at: now, ...plain(marker), snapshot: plain(this._simulationSession.getSnapshot()) }); }
    } };
  }
  return { wx, calls, flags, sessions, timers, page,
    async open(p, route = current) { current = route; await p.onLoad({ id: route._id }); p.onShow(); },
    jump(ms) { now += ms; }, time: () => now, userAction(fn, ms) { clock.setTimeout(fn, ms); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const t = [...timers].filter(t => t.due <= end).sort((a, b) => a.due - b.due)[0]; if (!t) break;
        now = Math.max(now, t.due); if (t.interval) t.due = now + t.interval; else timers.delete(t);
        t.fn(); await flush();
      }
      now = Math.max(now, end); await flush();
    } };
}
async function test(name, fn) { await fn(); cases.push(name); }
const marker = p => p.data.mapMarkers.find(m => m.id === -2);
async function main() {
  await test('六正式/Import/B1与受保护服务SHA不变，引擎获授权扩展', async () => {
    for (const [file, hash] of Object.entries(protectedHashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, file);
  });
  await test('四路线B1面板、真实起点/Marker、匹配进度独立，模拟无GPS/云；008/010速览另测', async () => {
    for (const r of b1PageRoutes) {
      const h = harness(), p = h.page(); await h.open(p, r);
      const trail = p.data.mapPolylines, include = p.data.mapIncludePoints;
      assert.equal(p.data.simulationState.status, 'idle'); assert.equal(h.calls.creates, 0);
      p.onSimulationStartTap(); p.onSimulationStartTap(); assert.equal(h.calls.creates, 1); assert.equal(h.timers.size, 1);
      assert.equal(p.data.simulationState.matchedText, '待匹配');
      await h.advance(2000); assert(marker(p)); assert.equal(marker(p).latitude, p.data.simulationState.snapshot.visualLocation.latitude);
      assert.equal(marker(p).longitude, p.data.simulationState.snapshot.visualLocation.longitude); assert.deepEqual(plain(marker(p).anchor), { x: 0.5, y: 0.5 }); assert.equal(marker(p).iconPath, "/assets/map/simulation.png"); assert.equal(marker(p).width, 22); assert.equal(marker(p).height, 22); assert(marker(p).callout.content.includes('非GPS'));
      await h.advance(4000); assert.equal(p.data.simulationState.snapshot.b1Phase, 'following');
      // 010起点前缀与完整B1在引擎及性能测试保留；当前页面为原生速览。
      const previous = plain(marker(p)); await h.advance(10000); assert.notDeepEqual(marker(p), previous);
      const s = h.sessions[0].getSnapshot();
      assert.equal(p.data.simulationState.snapshot.matchedProgressMeters, s.matchedProgressMeters);
      maximumProjectionAheadMeters = Math.max(maximumProjectionAheadMeters, s.matchedProgressMeters - s.playbackDistanceMeters);
      assert(s.playbackDistanceMeters + 0.000001 >= s.matchedProgressMeters, JSON.stringify({ route: r._id, playback: s.playbackDistanceMeters, matched: s.matchedProgressMeters }));
      assert.equal(p.data.mapPolylines, trail); assert.equal(p.data.mapIncludePoints, include);
      assert.deepEqual(plain(p.data.mapMarkers.filter(m => m.id !== -2)), plain(p.data.mapCenter.markers));
      assert.equal(h.calls.location.length, 0); assert.equal(h.calls.gps, 0); assert.equal(h.calls.cloud.length, 0); assert.equal(h.calls.camera, 0);
      p.onUnload(); assert.equal(h.timers.size, 0); assert.equal(h.sessions[0].getSnapshot().playbackStatus, 'disposed');
    }
  });
  await test('固定演示暂停/继续冻结，不补后台等待，重播和旧timer清理', async () => {
    const h = harness(), p = h.page(); await h.open(p, routes[1]); p.onSimulationStartTap();
    await h.advance(4000); p.onSimulationPauseTap();
    const paused = plain(p.data.simulationState.snapshot), point = plain(marker(p));
    await h.advance(60000); assert.deepEqual(p.data.simulationState.snapshot, paused);
    assert.deepEqual(marker(p), point); assert.equal(h.timers.size, 0);
    p.onSimulationResumeTap(); p.onSimulationResumeTap(); await h.advance(4000);
    assert.equal(p.data.simulationState.snapshot.demoActiveElapsedMs, 8000);
    const oldTimer = [...h.timers][0]; p.onSimulationRestartTap(); assert(!marker(p));
    assert.equal(p.data.simulationState.matchedText, '待匹配'); assert.equal(p.data.simulationState.snapshot.virtualElapsedMs, 0);
    assert.equal(h.calls.creates, 1); assert.equal(h.timers.size, 1);
    const updates = h.calls.updates.length; oldTimer.fn(); assert.equal(h.calls.updates.length, updates);
    await h.advance(200); assert(marker(p)); p.onUnload(); assert.equal(h.timers.size, 0);
  });
  await test('完整真实大姆山页面播放终点，仅标模拟完成且停止timer', async () => {
    const h = harness(), p = h.page(); await h.open(p, routes[1]); p.onSimulationStartTap();
    await h.advance(60000);
    assert.equal(p.data.simulationState.status, 'finished'); assert.equal(h.timers.size, 0);
    assert(p.data.simulationState.message.includes('模拟播放完成')); assert(p.data.simulationState.message.includes('不代表实际徒步完成'));
    assert.equal(p.data.simulationState.snapshot.actualOutdoorCompleted, false);
    assert.equal(p.data.simulationState.snapshot.b1Phase, 'following'); assert.equal(p.data.simulationState.snapshot.canConfirmCompletion, true);
    assert.equal(marker(p).latitude, routes[1].track.at(-1).latitude);
    p.onSimulationRestartTap(); assert.equal(p.data.simulationState.status, 'playing'); assert.equal(p.data.simulationState.snapshot.matchedProgressMeters, null); p.onUnload();
  });
  await test('hide不自动继续；旧timer/卸载/返回重进安全清理', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); await h.advance(6000);
    const old = [...h.timers][0]; p.onHide(); assert.equal(p.data.simulationState.status, 'paused');
    const paused = plain(p.data.simulationState.snapshot); await h.advance(100000); old.fn(); p.onShow();
    assert.deepEqual(p.data.simulationState.snapshot, paused); assert.equal(h.timers.size, 0);
    p.onSimulationResumeTap(); await h.advance(10000); assert.equal(p.data.simulationState.snapshot.demoActiveElapsedMs, 16000);
    p.onBackTap(); assert.equal(h.timers.size, 0); assert(!marker(p)); assert.equal(h.calls.back, 1);
    p.onUnload(); const count = h.calls.updates.length; old.fn(); assert.equal(h.calls.updates.length, count);
    const next = h.page(); await h.open(next); assert.equal(next.data.simulationState.status, 'idle'); assert(!marker(next)); next.onUnload();
  });
  await test('四路线B1循环切换及迟到加载不串状态；原生跨模式另测', async () => {
    const h = harness(), p = h.page();
    for (const r of b1PageRoutes) {
      await h.open(p, r); assert.equal(p.data.simulationState.snapshot, null); assert(!marker(p));
      p.onSimulationStartTap(); await h.advance(2000); assert.equal(p.data.simulationState.snapshot.routeId, r._id);
      const old = [...h.timers][0]; await p.onRetryTap(); assert.equal(h.timers.size, 0); assert(!marker(p));
      const count = h.calls.updates.length; old.fn(); assert.equal(h.calls.updates.length, count);
    }
    let resolve; h.flags.deferred = new Promise(r => { resolve = r; });
    const oldLoad = p.onLoad({ id: routes[0]._id }); await flush(); h.flags.deferred = null;
    await h.open(p, routes[1]); resolve(routes[0]); await oldLoad;
    assert.equal(p.data.route._id, routes[1]._id); assert.equal(p.data.simulationState.status, 'idle'); p.onUnload();
  });
  await test('Waypoint/Native/Access与模拟共存，模拟点击不清线，真实起点不混用', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); await h.advance(6000);
    const s = plain(p.data.simulationState.snapshot);
    for (const waypoint of routes[0].waypoints) {
      p.onMarkerTap({ detail: { markerId: waypoint.id } }); assert.equal(p.data.selectedWaypoint.name, waypoint.name);
    }
    await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 1); assert.equal(p.data.simulationState.snapshot.virtualElapsedMs, s.virtualElapsedMs);
    const planning = p.onPlanAccessTap(); await flush(); assert.equal(h.calls.location.length, 1); assert.equal(h.calls.cloud.length, 1);
    assert.deepEqual(plain(h.calls.cloud[0].data.origin), routes[0].track[104]);
    assert.notDeepEqual(plain(h.calls.cloud[0].data.origin), { latitude: marker(p).latitude, longitude: marker(p).longitude });
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 30, durationSeconds: 20, points: routes[0].track.slice(104, 106) } });
    await planning; assert.equal(p.data.mapPolylines.length, 2); const selected = p.data.selectedWaypoint;
    p.onMarkerTap({ detail: { markerId: -2 } }); assert.equal(p.data.selectedWaypoint, selected); assert.equal(p.data.accessRoute.status, 'success');
    p.onSimulationPauseTap(); assert.equal(p.data.mapPolylines.length, 2);
    p.onSimulationRestartTap(); assert.equal(p.data.mapPolylines.length, 2); await h.advance(2000); assert(marker(p));
    const snapshot = plain(p.data.simulationState.snapshot); p.onClearAccessTap(); assert.equal(p.data.mapPolylines.length, 1);
    assert.deepEqual(p.data.simulationState.snapshot, snapshot); assert(marker(p)); assert.equal(h.calls.gps, 0);
    const pending = p.onPlanAccessTap(); await flush(); const late = h.calls.cloud[1];
    await h.open(p, routes[1]); late.success({ result: { success: true, distanceMeters: 30, durationSeconds: 20, points: routes[0].track.slice(104, 106) } });
    await pending; assert.equal(p.data.accessRoute.status, 'idle'); assert(!marker(p)); p.onUnload();
  });
  await test('Access渲染异常仍保留Trail，模拟暂停后可主动继续', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); await h.advance(6000);
    p.onMarkerTap({ detail: { markerId: routes[0].waypoints[0].id } });
    const planning = p.onPlanAccessTap(); await flush();
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 20, durationSeconds: 10, points: routes[0].track.slice(104, 106) } }); await planning;
    p.onMapError(); assert.equal(p.data.simulationState.status, 'paused'); assert.equal(h.timers.size, 0);
    assert.equal(p.data.mapRenderError, false); assert.equal(p.data.mapPolylines.length, 1);
    p.onSimulationResumeTap(); assert(marker(p)); await h.advance(10000);
    assert.equal(p.data.simulationState.snapshot.demoActiveElapsedMs, 16000); p.onUnload();
  });
  await test('地图错误暂停/重试重建；无效Route及引擎异常提示与清理', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); await h.advance(2000);
    p.onMapError(); assert.equal(p.data.simulationState.status, 'paused'); assert.equal(h.timers.size, 0);
    p.onSimulationResumeTap(); assert.equal(h.timers.size, 0); await p.onRetryTap();
    assert.equal(p.data.simulationState.status, 'idle'); assert(!marker(p));
    await h.open(p, { ...routes[0], track: [] }); p.onSimulationStartTap();
    assert.equal(p.data.simulationState.statusText, '当前路线不支持模拟'); assert.equal(h.timers.size, 0);
    await h.open(p, routes[0]); h.flags.createError = true; p.onSimulationStartTap();
    assert.equal(p.data.simulationState.status, 'error'); assert(p.data.simulationState.message); assert.equal(h.timers.size, 0);
    h.flags.createError = false; p.onSimulationRestartTap(); await h.advance(2000); h.flags.advanceError = true; await h.advance(500);
    assert.equal(p.data.simulationState.status, 'error'); assert(!marker(p)); assert.equal(h.timers.size, 0); p.onUnload();
  });
  await test('计时器长延迟或时钟倒退暂停，不伪造delta/虚拟时间', async () => {
    for (const delta of [70000, -1000]) {
      const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); await h.advance(2000);
      const before = p.data.simulationState.snapshot.demoActiveElapsedMs; const callback = [...h.timers][0].fn;
      h.jump(delta); callback(); assert.equal(p.data.simulationState.status, 'paused');
      assert.equal(p.data.simulationState.snapshot.demoActiveElapsedMs, before); assert.equal(h.timers.size, 0);
      p.onSimulationResumeTap(); await h.advance(2000); assert.equal(p.data.simulationState.snapshot.demoActiveElapsedMs, before + 2000); p.onUnload();
    }
  });
  await test('待处理批次让出UI，暂停清interval和drain，旧drain不误伤新会话', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap();
    const timer = [...h.timers][0]; h.jump(5000); timer.due = h.time() + 200; timer.fn();
    const oldDrain = [...h.timers].find(t => !t.interval); assert(oldDrain, '长等待必须产生有界待处理批次');
    p.onSimulationPauseTap(); const frozen = plain(p.data.simulationState.snapshot);
    assert.equal(h.timers.size, 0); await h.advance(60000); assert.deepEqual(p.data.simulationState.snapshot, frozen);
    p.onSimulationResumeTap(); const before = h.calls.updates.length; oldDrain.fn(); assert.equal(h.calls.updates.length, before);
    let interaction = false; h.userAction(() => { interaction = true; }, 1); await h.advance(1000);
    assert(interaction); assert(p.data.simulationState.snapshot.observationCount > frozen.observationCount);
    p.onUnload(); assert.equal(h.timers.size, 0);
  });
  await test('同一模拟快照合并Marker与面板发布，保留坐标/进度并跳过未变化更新', async () => {
    const h=harness(), p=h.page(); await h.open(p,routes.find(r => r._id === 'fj-route-009'));
    p.onSimulationStartTap(); await h.advance(1000); p.onSimulationPauseTap();
    const original=plain(p._simulationSession.getSnapshot());
    const snapshot={...original,visualLocation:plain(p.data.route.track[100]),visualRatio:0.2,visualDistanceMeters:100,matchedProgressMeters:80,matchedProgressRatio:0.1,remainingMeters:900};
    const trail=plain(p.data.mapPolylines), waypoints=plain(p.data.mapMarkers.filter(m=>m.id!==-2));
    let before=h.calls.updates.length;p.publishSimulation(snapshot);
    let updates=h.calls.updates.slice(before);assert.equal(updates.length,1);
    assert(updates[0].keys.includes('simulationState'));assert(updates[0].keys.some(k=>k.startsWith('mapMarkers')));
    assert.deepEqual(plain(p.data.mapMarkers.find(m=>m.id===-2).anchor),{x:0.5,y:0.5});
    assert.equal(p.data.mapMarkers.find(m=>m.id===-2).latitude,snapshot.visualLocation.latitude);
    assert.equal(p.data.simulationState.snapshot.matchedProgressRatio,0.1);
    assert.deepEqual(plain(p.data.mapPolylines),trail);assert.deepEqual(plain(p.data.mapMarkers.filter(m=>m.id!==-2)),waypoints);
    before=h.calls.updates.length;p.publishSimulation(snapshot);assert.equal(h.calls.updates.length,before);
    const visual={...snapshot,visualLocation:plain(p.data.route.track[101])};before=h.calls.updates.length;
    p.publishSimulation(visual,'',true);assert.equal(h.calls.updates.length,before+1);assert(!h.calls.updates.at(-1).keys.includes('simulationState'));
    assert.equal(p.data.simulationState.snapshot.matchedProgressRatio,0.1);
    assert.throws(()=>p.publishSimulation({...snapshot,visualLocation:{latitude:NaN,longitude:0}}),/INVALID_SIMULATION_POINT/);
    p.onUnload();
  });
  await test('四B1最大点数黄连盂播放仅小范围setData，无2464点重绘循环/抢镜头；008/010原生另测', async () => {
    const h = harness(), p = h.page(); await h.open(p, routes.find(r => r._id === 'fj-route-009'));
    const count = h.calls.updates.length, trail = p.data.mapPolylines, included = p.data.mapIncludePoints;
    const begin = performance.now(); p.onSimulationStartTap(); await h.advance(20000);
    const updates = h.calls.updates.slice(count);
    assert(updates.length > 10); assert(updates.every(u => u.keys.every(k => k === 'simulationState' || k === 'mapMarkers' || /^mapMarkers\[\d+\](?:\.(?:latitude|longitude))?$/.test(k))));
    assert(updates.every(u => u.bytes < 5000)); assert(updates.some(u => u.keys.some(k => /^mapMarkers\[\d+\]\.latitude$/.test(k))));
    assert.equal(p.data.mapPolylines, trail); assert.equal(p.data.mapIncludePoints, included); assert.equal(h.calls.camera, 0);
    Object.assign(performanceReport, { routeId: 'fj-route-009', trackPoints: 2464, controlledWindowMs: 20000, targetMs: 17000,
      setDataCalls: updates.length, maximumPatchBytes: Math.max(...updates.map(u => u.bytes)), localComputeMs: performance.now() - begin });
    p.onUnload();
  });
  const markup = read('miniprogram/pages/route-detail/index.wxml');
  assert(markup.includes('<text class="simulation-warning">虚拟位置演示，不代表真实GPS定位。</text>'));
  assert(markup.includes('show-location="{{false}}"')); assert(!/bindtap="onStartFollowTap"|bindagreeprivacyauthorization="onFollowPrivacyAgree"/.test(markup));
  assert(!/demo-notice|notice-symbol|notice-copy|notice-title|notice-text|资料说明|onSimulationRateTap|data-rate=|播放倍率/.test(markup));
  const css = read('miniprogram/pages/route-detail/index.wxss');
  assert(!/\.demo-notice|\.notice-symbol|\.notice-copy|\.notice-title|\.notice-text|simulation-rate/.test(css));
  await test('四路线B1无资料说明/倍率，页面实算终点15–18秒且有UI让出；008/010原生另测', async () => {
    for (const route of b1PageRoutes) {
      const h = harness(), p = h.page(); await h.open(p, route);
      let userCallbacks = 0;
      for (let t = 1000; t < 17000; t += 1000) h.userAction(() => { userCallbacks++; }, t);
      const updateStart = h.calls.updates.length;
      const begin = performance.now(), wallStart = h.time(); p.onSimulationStartTap();
      await h.advance(60000);
      assert.equal(p.data.simulationState.status, 'finished');
      assert(h.calls.finishedAt - wallStart >= 15000 && h.calls.finishedAt - wallStart <= 18000);
      assert(h.calls.finishedAt - wallStart <= 20000);
      assert(p.data.simulationState.snapshot.canConfirmCompletion);
      assert.equal(p.data.simulationState.snapshot.actualOutdoorCompleted, false);
      assert(userCallbacks >= 16); assert.equal(h.timers.size, 0);
      estimates.push({ routeId: route._id, targetMs: 17000, controlledWallMs: h.calls.finishedAt - wallStart,
        markerUpdates: h.calls.updates.slice(updateStart).filter(u => u.keys.some(k => k.startsWith("mapMarkers"))).length, maximumPatchBytes: Math.max(...h.calls.updates.slice(updateStart).map(u => u.bytes)), cpuMs: performance.now() - begin, matchedPercent: p.data.simulationState.snapshot.matchedProgressRatio * 100, result: 'PASS' });
      p.onUnload();
    }
  });
  for (const nativeRoute of routes.filter(overview.enabledRoute)) await test(nativeRoute._id+'原生速览实际Page：完整16段、少量发布、无B1/GPS，暂停继续及Native/Access隔离', async () => {
    const r = nativeRoute, h = harness(), p = h.page(); await h.open(p, r);
    assert.equal(p.data.overviewMode, true); const trail = p.data.mapPolylines[0], include = p.data.mapIncludePoints;
    const count = h.calls.updates.length, start = h.time(); p.onSimulationStartTap(); p.onSimulationStartTap();
    assert.equal(h.calls.overviewMoves.length, 1); assert.equal(h.calls.creates, 0); await h.advance(16000);
    assert.equal(p.data.overviewState.status, 'finished'); assert.equal(h.calls.overviewFinishedAt-start,15504);
    assert.equal(p.getPlanBSummary().completedSegments,16); assert.equal(p.getPlanBSummary().b1Matched,false);
    assert.equal(p.getPlanBSummary().progressRatio,1); assert.equal(h.calls.overviewMoves.length,16);
    assert(h.calls.updates.length-count <= 3); assert.equal(p.data.mapPolylines[0],trail); assert.equal(p.data.mapIncludePoints,include);
    const m=h.calls.overviewMarkers.get(-2); assert.deepEqual(m.anchor,{x:0.5,y:0.5}); assert.equal(m.latitude,r.track.at(-1).latitude);
    p.onSimulationRestartTap(); await h.advance(400); p.onSimulationPauseTap(); assert.equal(p.data.overviewState.status,'pausing');
    await h.advance(600); assert.equal(p.data.overviewState.status,'paused'); const frozen=p.getPlanBSummary().progressRatio, moves=h.calls.overviewMoves.length;
    await h.advance(3000); assert.equal(h.calls.overviewMoves.length,moves); assert.equal(p.getPlanBSummary().progressRatio,frozen);
    const w=r.waypoints[0];p.onMarkerTap({detail:{markerId:w.id}});assert.equal(p.data.selectedWaypoint.name,w.name);
    await p.onOpenTargetTap();assert.equal(h.calls.native.length,1);
    const planning=p.onPlanAccessTap();await flush(); assert.deepEqual(plain(h.calls.cloud[0].data.origin),r.track[104]);
    h.calls.cloud[0].success({result:{success:true,distanceMeters:20,durationSeconds:15,points:r.track.slice(104,106)}}); await planning;
    const selected=p.data.selectedWaypoint;p.onMarkerTap({detail:{markerId:-2}});assert.equal(p.data.selectedWaypoint,selected);assert.equal(p.data.mapPolylines.length,2);
    p.onClearAccessTap();assert.equal(p.data.mapPolylines.length,1);assert.equal(p.getPlanBSummary().progressRatio,frozen);
    p.onSimulationResumeTap();await h.advance(16000);assert.equal(p.data.overviewState.status,'finished');assert.equal(h.calls.gps,0);p.onUnload();assert.equal(h.timers.size,0);assert.equal(h.calls.overviewMarkers.size,0);
  });
  await test('六路线跨B1/速览切换、旧回调、隐藏退出清理及不支持API的可见失败', async () => {
    const h=harness(),p=h.page();let oldMove;
    for(const r of routes){await h.open(p,r);assert.equal(p.data.overviewMode,overview.enabledRoute(r));p.onSimulationStartTap();await h.advance(400);
      if(overview.enabledRoute(r))oldMove=h.calls.overviewMoves.at(-1);
      p.onHide();assert.equal(h.timers.size,0);p.onShow();assert.equal(h.timers.size,0);
    }
    oldMove.success();assert.equal(p.data.route._id,'fj-route-011');assert.equal(p.data.overviewMode,false);
    await h.open(p,routes.find(r=>r._id==='fj-route-008'));h.wx.createMapContext=()=>({});p.onSimulationStartTap();assert.equal(p.data.overviewState.status,'error');assert.equal(p.data.mapPolylines.length,1);
    p.onUnload();assert.equal(h.timers.size,0);
  });
  console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_UI_LOGIC_PASS / DEVTOOLS_PENDING', cases, estimates, performanceReport, maximumProjectionAheadMeters,
    realGpsDuringSimulation: false, cloudWrites: false, realAmapRequests: false }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { harness };

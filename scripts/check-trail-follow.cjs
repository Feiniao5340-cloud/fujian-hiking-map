// 真实Page/service + 六条正式数据；微信/GPS/云调用均为本地模拟，不代表真机通过。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const { loadFormalRoutes, routeById, atMeters, gpsOffset } = require('./formal-route-fixtures.cjs');
const core = require('../miniprogram/utils/trail-progress');
const formal = loadFormalRoutes();
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function harness() {
  let now = 1800000000000, currentRoute = formal[0], listener = null, errorListener = null;
  const timers = new Set(), calls = { start: [], stop: [], camera: [], overview: [], modal: [], cloud: [], native: [], updates: [] };
  const behavior = { privacy: false, deny: false, start: 'success', stop: 'success' };
  function schedule(fn, delay, interval = false) { const timer = { fn, due: now + delay, delay, interval }; timers.add(timer); return timer; }
  const clock = { setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: timer => timers.delete(timer),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: timer => timers.delete(timer) };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const wx = {
    getPrivacySetting(o) { o.success({ needAuthorization: behavior.privacy }); },
    authorize(o) { assert.equal(o.scope, 'scope.userLocation'); behavior.deny ? o.fail({ errMsg: 'deny' }) : o.success(); },
    startLocationUpdate(o) { calls.start.push(o); assert.equal(o.type, 'gcj02'); if (behavior.start === 'success') o.success(); if (behavior.start === 'fail') o.fail(); },
    stopLocationUpdate(o) { calls.stop.push(o); if (behavior.stop === 'success') o.success(); if (behavior.stop === 'fail') o.fail(); },
    onLocationChange(fn) { assert.equal(listener, null); listener = fn; },
    offLocationChange(fn) { assert.equal(listener, fn); listener = null; },
    onLocationChangeError(fn) { errorListener = fn; }, offLocationChangeError(fn) { assert.equal(errorListener, fn); errorListener = null; },
    createMapContext(id) { assert.equal(id, 'route-map'); return { moveToLocation(o) { calls.camera.push(o); }, includePoints(o) { calls.overview.push(o); } }; },
    showModal(o) { calls.modal.push(o); },
    openLocation(o) { calls.native.push(o); o.success(); }, getLocation(o) { o.success(currentRoute.track[1]); },
    cloud: { callFunction(o) { calls.cloud.push(o); } }
  };
  function service(file) { const module = { exports: {} }; vm.runInNewContext(read(file), { module, wx, Date: ClockDate, ...clock,
    require: () => require(path.join(root, 'miniprogram/config/env')) }); return module.exports; }
  const follow = service('miniprogram/services/trail-follow-service.js');
  const nav = service('miniprogram/services/navigation-service.js');
  function page() {
    let definition;
    vm.runInNewContext(read('miniprogram/pages/route-detail/index.js'), { wx, Date: ClockDate, ...clock, console: { info() {}, error() {} },
      Page(p) { definition = p; }, require(name) {
        if (name.includes('trail-follow-service')) return follow;
        if (name.includes('navigation-service')) return nav;
        if (name.includes('route-service')) return { getRouteById: async () => currentRoute };
        return require(path.resolve(root, 'miniprogram/pages/route-detail', name));
      } });
    return { ...definition, data: plain(definition.data), setData(patch) { assert(!this._unloaded, '禁止unload后setData'); calls.updates.push(Object.keys(patch)); Object.assign(this.data, patch); } };
  }
  return { wx, follow, calls, behavior, timers, page,
    async open(p, route = currentRoute) { currentRoute = route; await p.onLoad({ id: route._id }); },
    async confirmStart() { for (let i = 0; i < 3; i++) { await this.advance(2000); this.emit({ ...currentRoute.startPoint, accuracy: 5 }); } },
    emit(point = { ...currentRoute.startPoint, accuracy: 5 }) { if (listener) listener(point); },
    listener: () => listener, error: () => errorListener && errorListener(),
    async advance(ms) {
      const end = now + ms;
      while (true) { const next = [...timers].filter(t => t.due <= end).sort((a, b) => a.due - b.due)[0]; if (!next) break;
        now = next.due; timers.delete(next); if (next.interval) { next.due += next.delay; timers.add(next); } next.fn(); await flush(); }
      now = end; await flush();
    }
  };
}
const passed = [];
async function test(name, run) { await run(); passed.push(name); }
async function finishedFixture() {
  const r = routeById('fj-route-006');
  const index = core.buildTrailIndex(r), at = meters => atMeters(index, meters);
  const h = harness(), p = h.page(); await h.open(p, r); await p.onStartFollowTap(); await h.confirmStart();
  assert.equal(p.data.followState.walkedText, '0 m'); assert.equal(p.data.followState.canComplete, false);
  p.onConfirmFollowTap(); assert.equal(h.calls.modal.length, 0);
  for (let s = p._trailModel.cursorMeters + 20; s < index.totalTrackMeters; s += 20) { await h.advance(10000); h.emit({ ...at(s), accuracy: 5 }); }
  await h.advance(10000); h.emit({ ...index.finishPoint, accuracy: 5 });
  for (let i = 0; i < 8; i++) { await h.advance(2000); h.emit({ ...index.finishPoint, accuracy: 5 }); }
  assert.equal(p.data.followState.canComplete, true); assert.equal(p.data.followState.status, 'following');
  return { h, p };
}
async function main() {
  await test('六条完整Trail/节点不变；当前位置仅派生Marker，镜头仅手动动作', async () => {
    const h = harness(), p = h.page();
    for (const r of formal) {
      const original = JSON.stringify(r); const cameraCount = h.calls.camera.length; await h.open(p, r);
      await p.onStartFollowTap(); const polyline = p.data.mapPolylines, included = p.data.mapIncludePoints;
      await h.confirmStart(); await h.advance(2000); h.emit({ ...r.startPoint, accuracy: 150 });
      assert.equal(p.data.followState.status, 'following'); assert(p.data.followState.message.includes('精度'));
      assert.equal(p.data.mapMarkers.length, r.waypoints.length + 2); assert.equal(p.data.mapMarkers.at(-1).id, -1);
      assert.equal(p.data.mapPolylines, polyline); assert.equal(p.data.mapIncludePoints, included);
      assert.deepEqual(plain(polyline[0].points), r.track); assert.equal(JSON.stringify(r), original);
      await h.advance(2000); h.emit({ ...r.startPoint, accuracy: null }); assert.equal(p.data.followState.accuracyText, '精度未知');
      assert(h.calls.updates.at(-1).every(k => ['followState', 'mapMarkers'].includes(k)));
      assert.equal(h.calls.camera.length, cameraCount); p.onFollowRecenterTap(); assert.equal(h.calls.camera.length, cameraCount); await h.confirmStart(); p.onFollowRecenterTap(); assert.equal(h.calls.camera.at(-1).latitude, r.startPoint.latitude);
      p.onMarkerTap({ detail: { markerId: r.waypoints[0].id } }); const selected = p.data.selectedWaypoint;
      p.onMarkerTap({ detail: { markerId: -1 } }); assert.equal(p.data.selectedWaypoint, selected);
      const old = h.listener(); await p.onStopFollowTap(); const updates = h.calls.updates.length;
      old({ ...r.track[4], accuracy: 1 }); assert.equal(h.calls.updates.length, updates);
      assert.equal(p.data.followState.location, null); assert.equal(h.listener(), null);
      assert.equal(p.data.mapMarkers.length, r.waypoints.length + 1);
    }
    assert.equal(h.calls.cloud.length, 0); assert.equal(h.timers.size, 0);
  });
  await test('隐私未同意不定位，微信同意事件重试，拒绝不损坏Trail', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.privacy = true;
    await p.onStartFollowTap(); assert.equal(p.data.followPrivacyVisible, true); assert.equal(h.calls.start.length, 0);
    p.onFollowPrivacyCancel(); assert.equal(p.data.followPrivacyVisible, false);
    await p.onStartFollowTap(); h.behavior.privacy = false; await p.onFollowPrivacyAgree(); await h.confirmStart();
    assert.equal(p.data.followState.status, 'following'); await p.stopFollow();
    h.behavior.deny = true; await p.onStartFollowTap(); await flush();
    assert.equal(p.data.followState.status, 'permissionDenied'); assert.equal(p.data.mapPolylines.length, 1); assert.equal(p._followSession, null);
  });
  await test('缺接口及启动失败安全降级', async () => {
    for (const mode of ['unsupported', 'fail']) {
      const h = harness(), p = h.page(); await h.open(p);
      if (mode === 'unsupported') delete h.wx.startLocationUpdate; else h.behavior.start = 'fail';
      await p.onStartFollowTap(); await flush(); assert.equal(p.data.followState.status, 'error'); assert.equal(p._followSession, null);
      assert.equal(p.data.mapPolylines.length, 1); assert.equal(h.listener(), null);
    }
  });
  await test('非法位置忽略；首位置超时停止；过时位置隐藏直到新回调', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap();
    for (const point of [{ latitude: '24', longitude: 118 }, { latitude: NaN, longitude: 118 }, { latitude: 0, longitude: 0 }, { latitude: 91, longitude: 118 }]) h.emit(point);
    assert.equal(p.data.followState.location, null); await h.advance(20000); assert.equal(p.data.followState.status, 'error'); assert.equal(h.listener(), null);
    await p.onStartFollowTap(); await h.confirmStart(); await h.advance(35000); assert.equal(p.data.followState.stale, true);
    assert.equal(p.data.mapMarkers.length, p.data.mapCenter.markers.length); const count = h.calls.camera.length;
    p.onFollowRecenterTap(); assert.equal(h.calls.camera.length, count); await h.confirmStart(); assert.equal(p.data.followState.stale, false); await p.stopFollow();
  });
  await test('双击只有一次SDK启动；hide/unload/重进不自动恢复，无迟到写入', async () => {
    const h = harness(), p = h.page(); await h.open(p);
    const first = p.onStartFollowTap(); await p.onStartFollowTap(); await first; assert.equal(h.calls.start.length, 1);
    const old = h.listener(); await h.confirmStart(); p.onHide(); await flush(); p.onShow(); assert.equal(p.data.followState.status, 'paused');
    old({ ...formal[0].track[1], accuracy: 10 }); assert.equal(p.data.followState.location, null);
    await p.onStartFollowTap(); await h.confirmStart(); p.onUnload(); await flush(); assert.equal(h.listener(), null); assert.equal(h.timers.size, 0);
    const reentry = h.page(); await h.open(reentry); assert.equal(reentry.data.followState.status, 'idle'); assert.equal(h.calls.start.length, 2);
  });
  await test('启动中退出，迟到SDK成功先清理；会话锁不误伤新启动', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.start = 'pending';
    const pending = p.onStartFollowTap(); await flush(); p.onHide(); assert.equal(h.listener(), null);
    const newer = h.page(); await h.open(newer); const newerOpening = newer.onStartFollowTap(); await flush();
    await h.advance(8000); await newerOpening; await flush(); assert.equal(h.calls.start.length, 1);
    assert(newer.data.followState.message.includes('清理'));
    h.calls.start[0].success(); await pending; await flush(); assert.equal(h.calls.stop.length, 1);
    await p.stopFollow(); assert.equal(p._followSession, null);
    h.behavior.start = 'success'; await newer.onStartFollowTap(); await h.confirmStart(); assert.equal(newer.data.followState.status, 'following'); await newer.stopFollow();
  });
  await test('停止失败保留锁，重试成功后允许新会话', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); await h.confirmStart(); h.behavior.stop = 'fail';
    assert.equal(await p.stopFollow(), false); assert.equal(p.data.followState.cleanupPending, true); assert.equal(h.listener(), null);
    const startCount = h.calls.start.length; await p.onStartFollowTap(); assert.equal(h.calls.start.length, startCount);
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 0);
    h.behavior.stop = 'success'; assert.equal(await p.stopFollow(), true); await p.onStartFollowTap(); await p.stopFollow();
  });
  await test('SDK启动/停止超时仍持锁；迟到回执完成后才允许新会话', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.start = 'pending';
    const opening = p.onStartFollowTap(); await flush(); await h.advance(28000); await opening;
     assert.equal(p.data.followState.cleanupPending, true); assert.equal(h.listener(), null);
    h.behavior.stop = 'pending'; h.calls.start[0].success(); await flush(); assert.equal(h.calls.stop.length, 1);
    const stopping = p.stopFollow(); await h.advance(8000); assert.equal(await stopping, false);
    const retry = p.stopFollow(); await h.advance(8000); assert.equal(await retry, false); assert.equal(h.calls.stop.length, 1);
    h.calls.stop[0].success(); await flush(); assert.equal(await p.stopFollow(), true);
    h.behavior.start = h.behavior.stop = 'success'; await p.onStartFollowTap(); await p.stopFollow();
  });
  await test('退出页面停止失败后，新页面主动开始可重试清理', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); h.behavior.stop = 'fail';
    p.onUnload(); await flush(); h.behavior.stop = 'success';
    const next = h.page(); await h.open(next); await next.onStartFollowTap(); await h.confirmStart();
    assert.equal(next.data.followState.status, 'following'); assert.equal(h.calls.stop.length, 2); await next.stopFollow();
  });
  await test('位置流错误停止；Route切换后旧回调无效', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); await h.confirmStart(); h.error(); await flush();
    assert.equal(p.data.followState.status, 'paused'); assert.equal(h.listener(), null);
    await p.onStartFollowTap(); const old = h.listener(); await h.open(p, formal[1]); await flush();
    const updates = h.calls.updates.length; old({ ...formal[0].track[1], accuracy: 10 }); assert.equal(h.calls.updates.length, updates);
    assert.equal(p.data.route._id, formal[1]._id); assert.equal(p.data.followState.location, null);
  });
  await test('接驳与原生动作先停止循迹，原Trail保持', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); await h.confirmStart();
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 1); assert.equal(h.listener(), null);
    assert.equal(p.data.followState.status, 'paused'); const cursor = p._trailModel.cursorMeters;
    const planning = p.onPlanAccessTap(); await flush(); assert.equal(h.calls.cloud.length, 1);
    await p.onResumeFollowTap(); assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(p.data.accessRoute.status, 'idle');
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } });
    await planning; assert.equal(p.data.accessRoute.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1); await p.stopFollow();
  });
  await test('暂停时Access可成功显示；继续仅清Access，保留已确认进度', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); await h.confirmStart(); await p.onPauseFollowTap();
    const cursor = p._trailModel.cursorMeters;
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } });
    const planning = p.onPlanAccessTap(); await flush();
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } }); await planning;
    assert.equal(p.data.accessRoute.status, 'success'); assert.equal(p.data.mapPolylines.length, 2);
    assert.equal(p.data.followState.status, 'paused'); assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(h.listener(), null);
    await p.onResumeFollowTap(); assert.equal(p.data.accessRoute.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1);
    assert.equal(p._trailModel.cursorMeters, cursor); await h.confirmStart(); assert.equal(p.data.followState.status, 'following'); await p.stopFollow();
  });
  await test('位置流驱动进度；暂停保留标量，继续不追补；远处继续拒绝', async () => {
    const r = routeById('fj-route-006');
    const index = core.buildTrailIndex(r), point = meters => atMeters(index, meters);
    const h = harness(), p = h.page(); await h.open(p, r); await p.onStartFollowTap();
    assert.equal(p.data.followState.status, 'starting'); await h.confirmStart();
    const original = p.data.mapPolylines, include = p.data.mapIncludePoints;
    for (let s = 10; s <= 300; s += 10) { await h.advance(5000); h.emit({ ...point(s), accuracy: 5 }); }
    assert(p._trailModel.cursorMeters > 250); assert.notEqual(p.data.followState.progressText, '待确认');
    assert.equal(p.data.mapMarkers.at(-1).longitude, point(300).longitude, 'Marker用原GPS而非投影点');
    const cursor = p._trailModel.cursorMeters, budget = p._trailModel.activeReliableSeconds;
    const old = h.listener(); await p.onPauseFollowTap();
    assert.equal(p.data.followState.status, 'paused'); assert.equal(h.listener(), null);
    assert.equal(p._trailModel.anchor, null); assert.equal(p._trailModel.lastReliablePosition, null);
    assert.equal(p.data.followState.location, null); assert.equal(h.timers.size, 0);
    old({ ...point(500), accuracy: 5 }); assert.equal(p._trailModel.cursorMeters, cursor);
    await h.advance(3600000); const count = h.calls.start.length;
    const first = p.onResumeFollowTap(); await p.onResumeFollowTap(); await first;
    assert.equal(h.calls.start.length, count + 1); assert.equal(p.data.followState.status, 'resuming');
    const atCursor = point(cursor);
    for (let i = 0; i < 3; i++) { await h.advance(2000); h.emit({ ...atCursor, accuracy: 5 }); }
    assert.equal(p.data.followState.status, 'following'); assert.equal(p._trailModel.activeReliableSeconds, budget);
    assert(Math.abs(p._trailModel.cursorMeters - cursor) < 0.1);
    assert.equal(p.data.mapPolylines, original); assert.deepEqual(plain(p.data.mapIncludePoints), plain(include)); assert.equal(h.calls.camera.length, 0);
    await p.onPauseFollowTap(); await p.onResumeFollowTap(); h.emit({ ...point(700), accuracy: 5 }); await flush();
    assert.equal(p.data.followState.status, 'paused'); assert(p.data.followState.message.includes('暂停'));
    assert.equal(h.listener(), null); assert.equal(p._trailModel.lastReliablePosition, null);
    h.behavior.deny = true; await p.onResumeFollowTap(); assert.equal(p.data.followState.status, 'paused');
    assert(p.data.followState.message.includes('权限')); assert.equal(h.listener(), null);
    h.behavior.deny = false; await p.onResumeFollowTap(); await h.advance(20000);
    assert.equal(p.data.followState.status, 'paused'); assert.equal(h.listener(), null);
    await p.onStopFollowTap(); assert.equal(p._trailModel, null); assert.equal(p._trailIndex, null);
    assert.equal(p.data.followState.status, 'ended'); assert.equal(h.calls.cloud.length, 0);
  });
  await test('远离起点拒绝；低精度超时；跳点/精度降级/断流冻结，无异常Promise', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap();
    h.emit({ ...gpsOffset(formal[0].startPoint, 10000), accuracy: 5 }); await flush();
    assert.equal(p.data.followState.status, 'error'); assert(p.data.followState.message.includes('起点')); assert.equal(h.listener(), null);
    await p.onStartFollowTap(); h.emit({ ...formal[0].startPoint, accuracy: 100 }); await h.advance(20000);
    assert.equal(p.data.followState.status, 'error'); assert.equal(h.listener(), null);
    await p.onStartFollowTap(); await h.confirmStart(); const cursor = p._trailModel.cursorMeters;
    await h.advance(2000); h.emit({ ...gpsOffset(formal[0].startPoint, 10000), accuracy: 5 });
    assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(p.data.followState.location, null);
    await h.advance(2000); h.emit({ ...formal[0].startPoint, accuracy: 100 });
    assert.equal(p._trailModel.cursorMeters, cursor); const camera = h.calls.camera.length; p.onFollowRecenterTap(); assert.equal(h.calls.camera.length, camera);
    await h.advance(20000); assert.equal(p.data.followState.stale, true); assert.equal(p._trailModel.canConfirmCompletion, false);
    await p.onStopFollowTap(); assert.equal(h.timers.size, 0);
  });
  const config = JSON.parse(read('miniprogram/app.json'));
  await test('位置跟随默认关；手势/完整路线/低质量/暂停关闭；Trail和节点保持', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.onStartFollowTap(); await h.confirmStart();
    assert.equal(p.data.followCamera, false); p.onFollowCameraTap(); assert.equal(p.data.followCamera, true);
    const count = h.calls.camera.length; await h.advance(2000); h.emit(); assert.equal(h.calls.camera.length, count + 1);
    p.onMapRegionChange({ detail: { causedBy: 'update' } }); assert.equal(p.data.followCamera, true);
    p.onMapRegionChange({ detail: { causedBy: 'gesture' } }); assert.equal(p.data.followCamera, false);
    await h.advance(2000); h.emit(); assert.equal(h.calls.camera.length, count + 1);
    p.onFollowCameraTap(); const polyline = p.data.mapPolylines, markers = p.data.mapMarkers;
    p.onViewTrailTap(); assert.equal(p.data.followCamera, false);
    assert.deepEqual(plain(h.calls.overview[0].points), formal[0].track); assert.equal(p.data.mapPolylines, polyline); assert.equal(p.data.mapMarkers, markers);
    h.calls.overview[0].fail(); assert(p.data.followState.message.includes('视野')); assert.equal(p.data.mapPolylines, polyline);
    p.onFollowCameraTap(); await h.advance(2000); h.emit({ ...formal[0].startPoint, accuracy: 100 }); assert.equal(p.data.followCamera, false);
    assert(p.data.followState.qualityText.includes('精度')); await h.confirmStart(); p.onFollowCameraTap(); await p.onPauseFollowTap();
    assert.equal(p.data.followCamera, false); assert.equal(h.listener(), null); await p.onStopFollowTap();
  });
  await test('真实算法完成资格→用户取消/双击/确认→SDK停止才完成，摘要不伪造', async () => {
    const { h, p } = await finishedFixture(), summary = p.data.followState;
    p.onConfirmFollowTap(); await h.calls.modal[0].success({ confirm: false }); assert.equal(p.data.followState.status, 'following'); assert(h.listener());
    p.onConfirmFollowTap(); p.onConfirmFollowTap(); assert.equal(h.calls.modal.length, 2);
    h.behavior.stop = 'pending'; const confirmation = h.calls.modal[1].success({ confirm: true }); await flush();
    assert.equal(p.data.followState.status, 'stopping'); assert.equal(h.listener(), null); assert.equal(p.data.followState.canComplete, false);
    h.calls.stop.at(-1).success(); await confirmation;
    assert.equal(p.data.followState.status, 'completed'); assert.equal(p._trailModel, null); assert.equal(p._followSession, null); assert.equal(h.timers.size, 0);
    for (const key of ['walkedText','progressText','remainingText']) assert.equal(p.data.followState[key], summary[key]);
    p.onHide(); p.onShow(); assert.equal(p.data.followState.status, 'completed'); p.onUnload(); await flush();
    const next = h.page(); await h.open(next); assert.equal(next.data.followState.walkedText, '待确认');
  });
  await test('过时/低质量/暂停/换Route的旧确认拒绝；stop失败不能完成', async () => {
    for (const scenario of ['stale', 'quality', 'pause', 'route', 'stopFail']) {
      const { h, p } = await finishedFixture(); p.onConfirmFollowTap(); const modal = h.calls.modal[0];
      if (scenario === 'stale') await h.advance(16000);
      if (scenario === 'quality') { await h.advance(1000); h.emit({ ...p.data.route.track.at(-1), accuracy: 100 }); }
      if (scenario === 'pause') await p.onPauseFollowTap();
      if (scenario === 'route') await h.open(p, formal[1]);
      if (scenario === 'stopFail') h.behavior.stop = 'fail';
      await modal.success({ confirm: true }); assert.notEqual(p.data.followState.status, 'completed');
      if (scenario === 'stopFail') { assert(p.data.followState.cleanupPending); h.behavior.stop = 'success'; await p.onStopFollowTap(); assert.equal(p.data.followState.status, 'ended'); }
      await p.stopFollow(); assert.equal(h.listener(), null);
    }
  });
  const template = read('miniprogram/pages/route-detail/index.wxml');
  await test('公开页面无旧循迹绑定；六路线正常操作不启动持续GPS，Native与Access保留', async () => {
    // 仅移除过期的UI可见性断言；上面的17组定位/进度/暂停/完成回归保持执行。
    const handlers = new Set([...template.matchAll(/\b(?:bind|catch):?[a-z]+="([^"]+)"/g)].map(match => match[1]));
    assert.deepEqual([...handlers].sort(), ['onBackTap', 'onClearAccessTap', 'onMapError', 'onMapRegionChange', 'onNativeOverviewPoint',
      'onMarkerTap', 'onOpenTargetTap', 'onPlanAccessTap', 'onRetryTap', 'onSimulationStartTap',
      'onSimulationPauseTap', 'onSimulationResumeTap', 'onSimulationRestartTap'].sort());
    const config = JSON.parse(read('miniprogram/app.json'));
    for (const page of config.pages) {
      const markup = read('miniprogram/' + page + '.wxml');
      assert(!/\b(?:bind|catch):?[a-z]+="(?:onStartFollowTap|onResumeFollowTap|onFollowPrivacyAgree)"/.test(markup), page + ': 旧循迹入口');
    }
    for (const route of formal) {
      const h = harness(), p = h.page();
      h.wx.navigateBack = options => assert.equal(options.delta, 1);
      await h.open(p, route); p.onShow();
      for (const name of handlers) assert.equal(typeof p[name], 'function', name + ': 无效事件绑定');
      const trail = p.data.mapPolylines[0];
      assert.deepEqual(plain(trail.points), route.track);
      assert.equal(p.data.mapMarkers.length, route.waypoints.length + 1);
      for (const waypoint of route.waypoints) {
        p.onMarkerTap({ detail: { markerId: waypoint.id } });
        assert.equal(p.data.selectedWaypoint.name, waypoint.name);
        await p.onOpenTargetTap();
        assert.equal(h.calls.native.at(-1).latitude, waypoint.latitude);
        assert.equal(h.calls.native.at(-1).longitude, waypoint.longitude);
      }
      const planning = p.onPlanAccessTap(); await flush();
      assert.equal(h.calls.cloud.length, 1);
      h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: route.track.slice(0, 2) } });
      await planning;
      assert.equal(p.data.accessRoute.status, 'success'); assert.equal(p.data.mapPolylines.length, 2);
      assert.deepEqual(plain(p.data.mapPolylines[0].points), route.track);
      p.onClearAccessTap(); assert.equal(p.data.mapPolylines.length, 1);
      p.onMapRegionChange({ detail: { causedBy: 'gesture' } });
      p.onMapError(); assert.equal(p.data.mapRenderError, true);
      await p.onRetryTap(); assert.equal(p.data.status, 'success'); assert.equal(p.data.mapRenderError, false);
      p.onHide(); p.onShow(); p.onBackTap(); p.onUnload(); await flush();
      const next = h.page(); await h.open(next, route); next.onShow();
      assert.equal(next.data.followState.status, 'idle');
      assert.equal(h.calls.start.length, 0); assert.equal(h.listener(), null); assert.equal(h.timers.size, 0);
      next.onUnload(); await flush();
    }
  });
  for (const name of ['getLocation', 'startLocationUpdate', 'onLocationChange']) assert(config.requiredPrivateInfos.includes(name));
  assert(!config.requiredBackgroundModes); assert(!config.permission['scope.userLocationBackground']);
  const source = read('miniprogram/services/trail-follow-service.js');
  assert(!/setStorage|cloud\.|request\(|console\./.test(source.replace(/function request\(|await request\(/g, '')));
  console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_SIMULATION_ONLY', routes: formal.length, cases: passed }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

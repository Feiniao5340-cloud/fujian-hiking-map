const { APPROVED_ACCESS, consentEvent, startAccess } = require('./access-consent-fixtures.cjs');
// 真实Page/service + 六条正式数据；微信/GPS/云调用均为本地模拟，不代表真机通过。
// Day3保留Day2服务/模式用例：显式调用内部startFollow测试状态机，不给产品增加绕过平台门的开关。
// R4另测私人公共入口及正式版阻断；Node替身不代表设备GPS。
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
function harness(accessPolicy = APPROVED_ACCESS) {
  let now = 1800000000000, currentRoute = formal[0], listener = null, errorListener = null;
  const timers = new Set(), calls = { privacy: [], authorize: [], locate: [], moves: [], removes: [], start: [], stop: [], camera: [], overview: [], modal: [], cloud: [], native: [], updates: [], order: [], policy: [] };
  const behavior = { privacy: false, deny: false, start: 'success', stop: 'success', envVersion: 'develop' };
  function schedule(fn, delay, interval = false) { const timer = { fn, due: now + delay, delay, interval }; timers.add(timer); return timer; }
  const clock = { setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: timer => timers.delete(timer),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: timer => timers.delete(timer) };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const wx = {
    getAccountInfoSync() { return { miniProgram: { appId: "wx0000000000000001", envVersion: behavior.envVersion } }; },
    getPrivacySetting(o) { calls.order.push('privacy'); calls.privacy.push(o); if (!behavior.holdPrivacy) o.success({ needAuthorization: behavior.privacy }); },
    authorize(o) { calls.order.push('authorize'); calls.authorize.push(o); assert.equal(o.scope, 'scope.userLocation'); if (!behavior.holdAuthorize) behavior.deny ? o.fail({ errMsg: 'deny' }) : o.success(); },
    startLocationUpdate(o) { calls.start.push(o); assert.equal(o.type, 'gcj02'); if (behavior.start === 'success') o.success(); if (behavior.start === 'fail') o.fail(); },
    stopLocationUpdate(o) { calls.stop.push(o); if (behavior.stop === 'success') o.success(); if (behavior.stop === 'fail') o.fail(); },
    onLocationChange(fn) { assert.equal(listener, null); listener = fn; },
    offLocationChange(fn) { assert.equal(listener, fn); if (behavior.offFails) throw Error('off failed'); listener = null; },
    onLocationChangeError(fn) { errorListener = fn; }, offLocationChangeError(fn) { assert.equal(errorListener, fn); errorListener = null; },
    createMapContext(id) { assert.equal(id, 'route-map'); return { moveToLocation(o) { calls.camera.push(o); }, includePoints(o) { calls.overview.push(o); },
      addMarkers(o) { o.success(); }, moveAlong(o) { calls.moves.push(o); },
      removeMarkers(o) { calls.removes.push(o); if (!behavior.holdRemove) o.success(); } }; },
    showModal(o) { calls.modal.push(o); },
    openLocation(o) { calls.native.push(o); o.success(); }, getLocation(o) { calls.order.push('locate'); calls.locate.push(o); if (!behavior.holdLocate) o.success(currentRoute.track[1]); },
    cloud: { callFunction(o) { calls.order.push('cloud'); calls.cloud.push(o); } }, navigateTo(o) { calls.policy.push(o); behavior.policyFail ? o.fail() : o.success(); },
    openPrivacyContract(o) { calls.policy.push(o); if (behavior.policyThrow) throw Error('privacy contract unavailable');
      if (!behavior.holdPolicy) { if (behavior.policyFail) { if (o.fail) o.fail(); } else if (o.success) o.success(); } }
  };
  function service(file) { const module = { exports: {} }; vm.runInNewContext(read(file), { module, wx, Date: ClockDate, ...clock,
    require: name => name.includes('access-privacy') ? accessPolicy : require(path.join(root, 'miniprogram/config/env')) }); return module.exports; }
  const follow = service('miniprogram/services/trail-follow-service.js');
  const nav = service('miniprogram/services/navigation-service.js');
  const nativeModule = { exports: {} };
  vm.runInNewContext(read('miniprogram/utils/native-route-overview.js'), { module: nativeModule, Date: ClockDate, ...clock,
    require: () => core });
  let definition;
  function page() {
    if (!definition) {
    vm.runInNewContext(read('miniprogram/pages/route-detail/index.js'), { wx, Date: ClockDate, ...clock, console: { info() {}, error() {} },
      Page(p) { definition = p; }, require(name) {
        if (name.includes('trail-follow-service')) return follow;
        if (name.includes('navigation-service')) return nav;
        if (name.includes('native-route-overview')) return nativeModule.exports;
        if (name.includes('route-service')) return { getRouteById: async () => currentRoute };
        return require(path.resolve(root, 'miniprogram/pages/route-detail', name));
      } });
    }
    return { ...definition, data: plain(definition.data), setData(patch) { assert(!this._unloaded, '禁止unload后setData'); calls.updates.push(Object.keys(patch)); for (const [key,value] of Object.entries(patch)) { const m=/^mapMarkers\[(\d+)\]\.(latitude|longitude)$/.exec(key); if(m)this.data.mapMarkers[+m[1]][m[2]]=value;else this.data[key]=value; } } };
  }
  return { wx, follow, nav, calls, behavior, timers, page,
    async open(p, route = currentRoute) { currentRoute = route; await p.onLoad({ id: route._id }); },
    async confirmStart() { for (let i = 0; i < 3; i++) { await this.advance(2000); this.emit({ ...currentRoute.startPoint, accuracy: 5 }); } },
    emit(point = { ...currentRoute.startPoint, accuracy: 5 }) { if (listener) listener(point); },
    listener: () => listener, errorListener: () => errorListener, error: () => errorListener && errorListener(),
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
  const h = harness(), p = h.page(); await h.open(p, r); await p.startFollow(false); await h.confirmStart();
  assert.equal(p.data.followState.walkedText, '0 m'); assert.equal(p.data.followState.canComplete, false);
  p.onConfirmFollowTap(); assert.equal(h.calls.modal.length, 0);
  for (let s = p._trailModel.cursorMeters + 20; s < index.totalTrackMeters; s += 20) { await h.advance(10000); h.emit({ ...at(s), accuracy: 5 }); }
  await h.advance(10000); h.emit({ ...index.finishPoint, accuracy: 5 });
  for (let i = 0; i < 8; i++) { await h.advance(2000); h.emit({ ...index.finishPoint, accuracy: 5 }); }
  assert.equal(p.data.followState.canComplete, true); assert.equal(p.data.followState.status, 'following');
  return { h, p };
}
async function main() {
 await test('D8D2 auto start rejection preserves scalar evidence and cleanup contract',async()=>{const h=harness(),p=h.page();await h.open(p);await p.onStartFollowTap();h.emit({...formal[0].startPoint,latitude:formal[0].startPoint.latitude+1,accuracy:5});await flush();assert.equal(p.data.followState.observationCount,1);assert.equal(p.data.followState.sdkStartAcknowledged,true);assert.equal(p.data.followState.stopOutcome,'CLEANUP_CONTRACT_CONFIRMED');assert.equal(p.data.followState.evidenceKind,'LAST_SESSION');assert(p.data.followState.b1Reason);assert.equal(p.data.followState.location,null);await p.onStartFollowTap();assert.equal(p.data.followState.observationCount,0);assert.equal(p.data.followState.stopOutcome,'NOT_REQUESTED');await p.onStopFollowTap();p.onUnload();});
 await test('D8D2 stop failure cannot display confirmed cleanup',async()=>{const h=harness(),p=h.page();await h.open(p);await p.onStartFollowTap();h.behavior.stop='fail';await p.onStopFollowTap();assert.equal(p.data.followState.stopOutcome,'FAILED_OR_UNCONFIRMED');assert.equal(p.data.followState.cleanupPending,true);h.behavior.stop='success';await p.onStopFollowTap();assert.equal(p.data.followState.stopOutcome,'CLEANUP_CONTRACT_CONFIRMED');p.onUnload();});

 await test('D8 six public routes separate SDK first fix and B1',async()=>{for(const route of formal){const h=harness(),p=h.page();await h.open(p,route);await p.onStartFollowTap();assert.equal(p.data.followState.sdkStartAcknowledged,true);assert.equal(p.data.followState.observationCount,0);h.emit({...route.startPoint,accuracy:35});assert.equal(p.data.followState.observationCount,1);assert.equal(p.data.followState.b1Reason,'LOW_ACCURACY');await h.confirmStart();assert.equal(p.data.followState.status,'following');assert(p.data.followState.observationCount>=4);assert.equal(p.data.followState.confirmedText,'0 m');await p.onStopFollowTap();p.onUnload();}});
 await test('D8 timeout distinguishes no first fix from unconfirmed start',async()=>{for(const fix of [false,true]){const h=harness(),p=h.page();await h.open(p);await p.onStartFollowTap();if(fix)h.emit({...formal[0].startPoint,accuracy:35});await h.advance(21000);assert(p.data.followState.message.includes(fix?'已收到位置':'未收到有效位置'));assert.equal(h.calls.stop.length,1);p.onUnload();}});

  await test('六条完整Trail/节点不变；当前位置仅派生Marker，镜头仅手动动作', async () => {
    const h = harness(), p = h.page();
    for (const r of formal) {
      const original = JSON.stringify(r); const cameraCount = h.calls.camera.length; await h.open(p, r);
      await p.startFollow(false); const polyline = p.data.mapPolylines, included = p.data.mapIncludePoints;
      await h.confirmStart(); await h.advance(2000); h.emit({ ...r.startPoint, accuracy: 150 });
      assert.equal(p.data.followState.status, 'following'); assert(p.data.followState.message.includes('精度'));
      assert.equal(p.data.mapMarkers.length, r.waypoints.length + 2); assert.equal(p.data.mapMarkers.at(-1).id, -1);
      assert.equal(p.data.mapPolylines, polyline); assert.equal(p.data.mapIncludePoints, included);
      assert.deepEqual(plain(polyline[0].points), r.track); assert.equal(JSON.stringify(r), original);
      await h.advance(2000); h.emit({ ...r.startPoint, accuracy: null }); assert.equal(p.data.followState.accuracyText, '精度未知');
      assert(h.calls.updates.at(-1).every(k => ['followState', 'mapMarkers'].includes(k) || /^mapMarkers\[\d+\]\.(latitude|longitude)$/.test(k)));
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
    await p.startFollow(false); assert.equal(p.data.followPrivacyVisible, true); assert.equal(h.calls.start.length, 0);
    p.onFollowPrivacyCancel(); assert.equal(p.data.followPrivacyVisible, false);
    await p.startFollow(false); h.behavior.privacy = false; await p.onFollowPrivacyAgree({type:'agreeprivacyauthorization'}); assert.equal(h.calls.start.length,0); await p.startFollow(false); await h.confirmStart();
    assert.equal(p.data.followState.status, 'following'); await p.stopFollow();
    h.behavior.deny = true; await p.startFollow(false); await flush();
    assert.equal(p.data.followState.status, 'permissionDenied'); assert.equal(p.data.mapPolylines.length, 1); assert.equal(p._followSession, null);
  });
  await test('缺接口及启动失败安全降级', async () => {
    for (const mode of ['unsupported', 'fail']) {
      const h = harness(), p = h.page(); await h.open(p);
      if (mode === 'unsupported') delete h.wx.startLocationUpdate; else h.behavior.start = 'fail';
      await p.startFollow(false); await flush(); assert.equal(p.data.followState.status, 'error'); assert.equal(p._followSession, null);
      assert.equal(p.data.mapPolylines.length, 1); assert.equal(h.listener(), null);
    }
  });
  await test('非法位置忽略；首位置超时停止；过时位置隐藏直到新回调', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false);
    for (const point of [{ latitude: '24', longitude: 118 }, { latitude: NaN, longitude: 118 }, { latitude: 0, longitude: 0 }, { latitude: 91, longitude: 118 }]) h.emit(point);
    assert.equal(p.data.followState.location, null); await h.advance(20000); assert.equal(p.data.followState.status, 'error'); assert.equal(h.listener(), null);
    await p.startFollow(false); await h.confirmStart(); await h.advance(35000); assert.equal(p.data.followState.stale, true);
    assert.equal(p.data.mapMarkers.length, p.data.mapCenter.markers.length); const count = h.calls.camera.length;
    p.onFollowRecenterTap(); assert.equal(h.calls.camera.length, count); await h.confirmStart(); assert.equal(p.data.followState.stale, false); await p.stopFollow();
  });
  await test('双击只有一次SDK启动；hide/unload/重进不自动恢复，无迟到写入', async () => {
    const h = harness(), p = h.page(); await h.open(p);
    const first = p.startFollow(false); await p.startFollow(false); await first; assert.equal(h.calls.start.length, 1);
    const old = h.listener(); await h.confirmStart(); p.onHide(); await flush(); p.onShow(); assert.equal(p.data.followState.status, 'paused');
    old({ ...formal[0].track[1], accuracy: 10 }); assert.equal(p.data.followState.location, null);
    await p.startFollow(false); await h.confirmStart(); p.onUnload(); await flush(); assert.equal(h.listener(), null); assert.equal(h.timers.size, 0);
    const reentry = h.page(); await h.open(reentry); assert.equal(reentry.data.followState.status, 'idle'); assert.equal(h.calls.start.length, 2);
  });
  await test('启动中退出，迟到SDK成功先清理；会话锁不误伤新启动', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.start = 'pending';
    const pending = p.startFollow(false); await flush(); p.onHide(); assert.equal(h.listener(), null);
    const newer = h.page(); await h.open(newer); const newerOpening = newer.startFollow(false); await flush();
    await h.advance(8000); await newerOpening; await flush(); assert.equal(h.calls.start.length, 1);
    assert(newer.data.followState.message.includes('清理'));
    h.calls.start[0].success(); await pending; await flush(); assert.equal(h.calls.stop.length, 1);
    await p.stopFollow(); assert.equal(p._followSession, null);
    h.behavior.start = 'success'; await newer.startFollow(false); await h.confirmStart(); assert.equal(newer.data.followState.status, 'following'); await newer.stopFollow();
  });
  await test('停止失败保留锁，重试成功后允许新会话', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart(); h.behavior.stop = 'fail';
    assert.equal(await p.stopFollow(), false); assert.equal(p.data.followState.cleanupPending, true); assert.equal(h.listener(), null);
    const startCount = h.calls.start.length; await p.startFollow(false); assert.equal(h.calls.start.length, startCount);
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 0);
    h.behavior.stop = 'success'; assert.equal(await p.stopFollow(), true); await p.startFollow(false); await p.stopFollow();
  });
  await test('SDK启动/停止超时仍持锁；迟到回执完成后才允许新会话', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.start = 'pending';
    const opening = p.startFollow(false); await flush(); await h.advance(28000); await opening;
     assert.equal(p.data.followState.cleanupPending, true); assert.equal(h.listener(), null);
    h.behavior.stop = 'pending'; h.calls.start[0].success(); await flush(); assert.equal(h.calls.stop.length, 1);
    const stopping = p.stopFollow(); await h.advance(8000); assert.equal(await stopping, false);
    const retry = p.stopFollow(); await h.advance(8000); assert.equal(await retry, false); assert.equal(h.calls.stop.length, 1);
    h.calls.stop[0].success(); await flush(); assert.equal(await p.stopFollow(), true);
    h.behavior.start = h.behavior.stop = 'success'; await p.startFollow(false); await p.stopFollow();
  });
  await test('退出页面停止失败后，新页面主动开始可重试清理', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); h.behavior.stop = 'fail';
    p.onUnload(); await flush(); h.behavior.stop = 'success';
    const next = h.page(); await h.open(next); await next.startFollow(false); await h.confirmStart();
    assert.equal(next.data.followState.status, 'following'); assert.equal(h.calls.stop.length, 2); await next.stopFollow();
  });
  await test('位置流错误停止；Route切换后旧回调无效', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart(); h.error(); await flush();
    assert.equal(p.data.followState.status, 'paused'); assert.equal(h.listener(), null);
    await p.startFollow(false); const old = h.listener(); await h.open(p, formal[1]); await flush();
    const updates = h.calls.updates.length; old({ ...formal[0].track[1], accuracy: 10 }); assert.equal(h.calls.updates.length, updates);
    assert.equal(p.data.route._id, formal[1]._id); assert.equal(p.data.followState.location, null);
  });
  await test('接驳与原生动作先停止循迹，原Trail保持', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart();
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 1); assert.equal(h.listener(), null);
    assert.equal(p.data.followState.status, 'paused'); const cursor = p._trailModel.cursorMeters;
    const planning = startAccess(p); await flush(); assert.equal(h.calls.cloud.length, 1);
    const starts = h.calls.start.length;
    await p.startFollow(true); assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(p.data.accessRoute.status, 'planning');
    assert.equal(h.calls.start.length, starts, 'Day2: pending Access cannot be bypassed by resume');
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } });
    await planning; assert.equal(p.data.accessRoute.status, 'success');
    await p.startFollow(true); assert.equal(p.data.accessRoute.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1); await p.stopFollow();
  });
  await test('暂停时Access可成功显示；继续仅清Access，保留已确认进度', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart(); await p.onPauseFollowTap();
    const cursor = p._trailModel.cursorMeters;
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } });
    const planning = startAccess(p); await flush();
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } }); await planning;
    assert.equal(p.data.accessRoute.status, 'success'); assert.equal(p.data.mapPolylines.length, 2);
    assert.equal(p.data.followState.status, 'paused'); assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(h.listener(), null);
    await p.startFollow(true); assert.equal(p.data.accessRoute.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1);
    assert.equal(p._trailModel.cursorMeters, cursor); await h.confirmStart(); assert.equal(p.data.followState.status, 'following'); await p.stopFollow();
  });
  await test('位置流驱动进度；暂停保留标量，继续不追补；远处继续拒绝', async () => {
    const r = routeById('fj-route-006');
    const index = core.buildTrailIndex(r), point = meters => atMeters(index, meters);
    const h = harness(), p = h.page(); await h.open(p, r); await p.startFollow(false);
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
    const first = p.startFollow(true); await p.startFollow(true); await first;
    assert.equal(h.calls.start.length, count + 1); assert.equal(p.data.followState.status, 'resuming');
    const atCursor = point(cursor);
    for (let i = 0; i < 3; i++) { await h.advance(2000); h.emit({ ...atCursor, accuracy: 5 }); }
    assert.equal(p.data.followState.status, 'following'); assert.equal(p._trailModel.activeReliableSeconds, budget);
    assert(Math.abs(p._trailModel.cursorMeters - cursor) < 0.1);
    assert.equal(p.data.mapPolylines, original); assert.deepEqual(plain(p.data.mapIncludePoints), plain(include)); assert.equal(h.calls.camera.length, 0);
    await p.onPauseFollowTap(); await p.startFollow(true); h.emit({ ...point(700), accuracy: 5 }); await flush();
    assert.equal(p.data.followState.status, 'paused'); assert(p.data.followState.message.includes('暂停'));
    assert.equal(h.listener(), null); assert.equal(p._trailModel.lastReliablePosition, null);
    h.behavior.deny = true; await p.startFollow(true); assert.equal(p.data.followState.status, 'paused');
    assert(p.data.followState.message.includes('权限')); assert.equal(h.listener(), null);
    h.behavior.deny = false; await p.startFollow(true); await h.advance(20000);
    assert.equal(p.data.followState.status, 'paused'); assert.equal(h.listener(), null);
    await p.onStopFollowTap(); assert.equal(p._trailModel, null); assert.equal(p._trailIndex, null);
    assert.equal(p.data.followState.status, 'ended'); assert.equal(h.calls.cloud.length, 0);
  });
  await test('远离起点拒绝；低精度超时；跳点/精度降级/断流冻结，无异常Promise', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false);
    h.emit({ ...gpsOffset(formal[0].startPoint, 10000), accuracy: 5 }); await flush();
    assert.equal(p.data.followState.status, 'error'); assert(p.data.followState.message.includes('起点')); assert.equal(h.listener(), null);
    await p.startFollow(false); h.emit({ ...formal[0].startPoint, accuracy: 100 }); await h.advance(20000);
    assert.equal(p.data.followState.status, 'error'); assert.equal(h.listener(), null);
    await p.startFollow(false); await h.confirmStart(); const cursor = p._trailModel.cursorMeters;
    await h.advance(2000); h.emit({ ...gpsOffset(formal[0].startPoint, 10000), accuracy: 5 });
    assert.equal(p._trailModel.cursorMeters, cursor); assert.equal(p.data.followState.location, null);
    await h.advance(2000); h.emit({ ...formal[0].startPoint, accuracy: 100 });
    assert.equal(p._trailModel.cursorMeters, cursor); const camera = h.calls.camera.length; p.onFollowRecenterTap(); assert.equal(h.calls.camera.length, camera);
    await h.advance(20000); assert.equal(p.data.followState.stale, true); assert.equal(p._trailModel.canConfirmCompletion, false);
    await p.onStopFollowTap(); assert.equal(h.timers.size, 0);
  });
  const config = JSON.parse(read('miniprogram/app.json'));
  await test('位置跟随默认关；手势/完整路线/低质量/暂停关闭；Trail和节点保持', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart();
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
  // Day2 direct service tests: real module, isolated wx and controlled clock only.
  const observe = promise => promise.then(() => 'OK', error => error.code);
  const direct = h => { const locations = [], errors = []; return { locations, errors,
    session: h.follow.createSession({ onLocation: p => locations.push(p), onError: e => errors.push(e.code) }) }; };
  for (const phase of ['privacy', 'authorize', 'sdk']) {
    await test(`Day2 service same-session start is one Promise during ${phase}`, async () => {
      const h = harness(), d = direct(h);
      h.behavior.holdPrivacy = phase === 'privacy'; h.behavior.holdAuthorize = phase === 'authorize';
      if (phase === 'sdk') h.behavior.start = 'pending';
      const first = d.session.start(), second = d.session.start(); assert.strictEqual(first, second);
      await flush(); assert.equal(h.calls.privacy.length, 1);
      if (phase === 'privacy') h.calls.privacy[0].success({ needAuthorization: false });
      await flush(); assert.equal(h.calls.authorize.length, 1);
      if (phase === 'authorize') h.calls.authorize[0].success();
      await flush(); assert.equal(h.calls.start.length, 1);
      if (phase === 'sdk') h.calls.start[0].success();
      await Promise.all([first, second]); assert.strictEqual(d.session.start(), first); await d.session.stop();
    });
  }
  await test('Day2 service distinct sessions cannot bypass active owner', async () => {
    const h = harness(), a = direct(h), b = direct(h); h.behavior.holdPrivacy = true;
    const first = a.session.start(), blocked = observe(b.session.start()); await flush(); assert.equal(await blocked, 'BUSY');
    assert.equal(h.calls.privacy.length, 1); h.calls.privacy[0].success({ needAuthorization: false }); await first;
    assert.equal(h.calls.start.length, 1); await a.session.stop(); await b.session.stop();
  });
  for (const phase of ['privacy', 'authorize', 'sdk']) {
    await test(`Day2 stop during ${phase}; late callbacks never deliver positions`, async () => {
      const h = harness(), d = direct(h); h.behavior.holdPrivacy = phase === 'privacy'; h.behavior.holdAuthorize = phase === 'authorize';
      if (phase === 'sdk') h.behavior.start = 'pending';
      const opening = observe(d.session.start()); await flush(); const old = h.listener();
      const stop = d.session.stop();
      if (phase === 'privacy') h.calls.privacy[0].success({ needAuthorization: false });
      if (phase === 'authorize') h.calls.authorize[0].success();
      if (phase === 'sdk') h.calls.start[0].success();
      await stop; assert.equal(await opening, 'CANCELLED');
      if (old) old({ ...formal[0].track[0], accuracy: 5 });
      assert.equal(d.locations.length, 0); assert.equal(h.calls.start.length, phase === 'sdk' ? 1 : 0);
      assert.equal(h.calls.stop.length, phase === 'sdk' ? 1 : 0);
      assert.equal(d.session.cleanupState.ownsLocation, false);
    });
  }
  for (const phase of ['privacy', 'authorize', 'sdk']) {
    await test(`Day2 ${phase} timeout and late success cannot reactivate session`, async () => {
      const h = harness(), d = direct(h); h.behavior.holdPrivacy = phase === 'privacy'; h.behavior.holdAuthorize = phase === 'authorize';
      if (phase === 'sdk') h.behavior.start = 'pending';
      const opening = observe(d.session.start()); await flush(); const old = h.listener(); await h.advance(20000);
      assert.equal(await opening, phase === 'privacy' ? 'PRIVACY_FAILED' : phase === 'authorize' ? 'LOCATION_DENIED' : 'TIMEOUT');
      if (phase === 'privacy') h.calls.privacy[0].success({ needAuthorization: false });
      if (phase === 'authorize') h.calls.authorize[0].success();
      if (phase === 'sdk') h.calls.start[0].success();
      await flush(); if (old) old({ ...formal[0].startPoint, accuracy: 5 });
      assert.equal(d.locations.length, 0); assert.equal(h.calls.start.length, phase === 'sdk' ? 1 : 0);
      await d.session.stop(); assert.equal(d.session.cleanupState.ownsLocation, false);
    });
  }
  await test('Day2 concurrent stop shares cleanup and sends one SDK stop', async () => {
    const h = harness(), d = direct(h); await d.session.start(); h.behavior.stop = 'pending';
    const a = d.session.stop(), b = d.session.stop(); assert.strictEqual(a, b); await flush(); assert.equal(h.calls.stop.length, 1);
    h.calls.stop[0].success(); await Promise.all([a, b]); assert.equal(d.session.cleanupState.ownsLocation, false);
  });
  await test('Day2 off failure is observable; stopped callbacks/errors suppressed, owner retained until retry', async () => {
    const h = harness(), d = direct(h); await d.session.start(); const old = h.listener(), error = h.errorListener();
    h.behavior.offFails = true; assert.equal(await observe(d.session.stop()), 'STOP_FAILED');
    old({ ...formal[0].startPoint, accuracy: 5 }); error(); assert.equal(d.locations.length, 0); assert.equal(d.errors.length, 0);
    assert.equal(d.session.cleanupState.listening, true); assert.equal(d.session.cleanupState.started, false);
    assert.equal(d.session.cleanupState.ownsLocation, true);
    const b = direct(h); assert.equal(await observe(b.session.start()), 'BUSY'); assert.equal(h.calls.start.length, 1);
    h.behavior.offFails = false; await d.session.stop(); assert.equal(d.session.cleanupState.ownsLocation, false);
    const fresh = direct(h); await fresh.session.start(); old({ ...formal[0].startPoint, accuracy: 5 }); error(); assert.equal(d.locations.length, 0); assert.equal(d.errors.length, 0); await fresh.session.stop();
  });
  await test('Day2 permission denied and privacy required never start SDK', async () => {
    for (const mode of ['deny', 'privacy']) { const h = harness(), d = direct(h); h.behavior[mode] = true;
      assert.equal(await observe(d.session.start()), mode === 'deny' ? 'LOCATION_DENIED' : 'PRIVACY_REQUIRED');
      assert.equal(h.calls.start.length, 0); assert.equal(h.listener(), null); }
  });
  await test('Day2 real follow excludes B1 start/restart; synthetic completion cannot change real state', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart();
    const state = plain(p.data.followState), updates = h.calls.updates.length;
    p.onSimulationStartTap(); p.onSimulationRestartTap(); p.publishSimulation({ playbackStatus: 'finished', visualPlayback: false });
    assert.equal(p._simulationSession, null); assert.equal(h.calls.updates.length, updates);
    assert.deepEqual(plain(p.data.followState), state); assert.equal(p.getNavigationMode(), 'REAL_FOLLOW'); await p.stopFollow();
  });
  await test('Day2 active B1 blocks GPS; paused B1 is disposed before actual GPS start', async () => {
    const h = harness(), p = h.page(); await h.open(p); p.onSimulationStartTap(); assert.equal(p.getNavigationMode(), 'B1_SIMULATION');
    await p.startFollow(false); assert.equal(h.calls.start.length, 0); p.onSimulationPauseTap();
    await p.startFollow(false); assert.equal(h.calls.start.length, 1); assert.equal(p._simulationSession, null);
    assert(!p.data.mapMarkers.some(m => m.id === -2)); await p.stopFollow();
  });
  await test('Day2 real GPS excludes native overview; pending Native remove blocks GPS until ACK', async () => {
    for (const route of [routeById('fj-route-008'), routeById('fj-route-010')]) {
      const h = harness(), p = h.page(); await h.open(p, route); await p.startFollow(false);
      p.onSimulationStartTap(); p.onSimulationRestartTap(); assert.equal(h.calls.moves.length, 0); await p.stopFollow();
      p.onSimulationStartTap(); assert.equal(h.calls.moves.length, 1); h.behavior.holdRemove = true;
      const opening = p.startFollow(false); await flush(); assert.equal(h.calls.start.length, 1);
      p.onSimulationRestartTap(); assert.equal(h.calls.moves.length, 1, 'real transition owns pending cleanup');
      h.calls.removes.at(-1).success(); await opening; assert.equal(h.calls.start.length, 2); await p.stopFollow();
    }
  });
  await test('Day2 Native cleanup failure or timeout keeps GPS blocked; late ACK never auto-starts', async () => {
    for (const failure of ['fail', 'timeout']) {
      const h = harness(), p = h.page(); await h.open(p, routeById('fj-route-010')); p.onSimulationStartTap(); h.behavior.holdRemove = true;
      const opening = p.startFollow(false); await flush(); const remove = h.calls.removes.at(-1);
      if (failure === 'fail') remove.fail(); else await h.advance(1500);
      await opening; assert.equal(h.calls.start.length, 0); assert.equal(p.getNavigationMode(), 'NATIVE_OVERVIEW');
      if (failure === 'timeout') { remove.success(); await flush(); assert.equal(h.calls.start.length, 0); }
      p.onUnload();
    }
  });
  await test('Day2 pending Access survives clear/route switch; only settled request releases GPS gate', async () => {
    for (const phase of ['locating', 'planning']) {
      const h = harness(), p = h.page(); await h.open(p); h.behavior.holdLocate = phase === 'locating';
      p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); const request = startAccess(p); await flush();
      await p.startFollow(false); assert.equal(h.calls.start.length, 0); p.onClearAccessTap();
      await h.open(p, formal[1]); await p.startFollow(false); assert.equal(h.calls.start.length, 0);
      const before = h.calls.updates.length;
      if (phase === 'locating') h.calls.locate[0].success(formal[0].track[0]);
      else h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } });
      await request; assert.equal(h.calls.updates.length, before); await p.startFollow(false); assert.equal(h.calls.start.length, 1); await p.stopFollow();
    }
  });
  await test('Day2 Access timeout cannot be cleared into a new GPS session', async () => {
    const h = harness(), p = h.page(); await h.open(p); h.behavior.holdLocate = true;
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); const request = startAccess(p); await flush();
    await h.advance(20000); await request; p.onClearAccessTap(); await p.startFollow(false); assert.equal(h.calls.start.length, 0);
    const before = h.calls.updates.length; h.calls.locate[0].success(formal[0].track[0]); await flush();
    assert.equal(h.calls.updates.length, before); assert.equal(p.getNavigationMode(), 'IDLE'); assert.equal(h.calls.start.length,0); await p.startFollow(false); assert.equal(h.calls.start.length,1); await p.stopFollow(); p.onUnload();
  });
  await test('Day2 real stop pending/failure blocks Native and Access before any SDK request', async () => {
    const h = harness(), p = h.page(); await h.open(p); await p.startFollow(false); await h.confirmStart();
    p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } }); h.behavior.stop = 'pending';
    const request = startAccess(p); await flush(); p.onSimulationStartTap(); await p.onOpenTargetTap();
    assert.equal(h.calls.locate.length, 0); assert.equal(h.calls.native.length, 0); assert.equal(p._simulationSession, null);
    h.calls.stop[0].fail(); await request; assert.equal(p.getNavigationMode(), 'REAL_FOLLOW');
    h.behavior.stop = 'fail'; await p.onOpenTargetTap(); assert.equal(h.calls.native.length, 0);
    h.behavior.stop = 'success'; await p.stopFollow('paused'); assert.equal(p.data.followState.status, 'paused'); assert.equal(p.getNavigationMode(), 'IDLE');
    const retry = startAccess(p); await flush(); assert.equal(h.calls.cloud.length, 1);
    h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } }); await retry;
  });
  await test('Day2 hide/unload suppress late Access; quick competing modes grant no second GPS owner', async () => {
    for (const lifecycle of ['onHide', 'onUnload']) {
      const h = harness(), p = h.page(); await h.open(p); p.onMarkerTap({ detail: { markerId: formal[0].waypoints[0].id } });
      const request = startAccess(p); await flush(); p[lifecycle](); const before = h.calls.updates.length;
      h.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20, points: formal[0].track.slice(0, 2) } });
      await request; assert.equal(h.calls.updates.length, before);
    }
    const h = harness(), p = h.page(); await h.open(p); h.behavior.holdPrivacy = true;
    const real = p.startFollow(false); p.onSimulationStartTap(); p.onSimulationRestartTap(); await flush();
    assert.equal(p._simulationSession, null); assert.equal(h.calls.privacy.length, 1);
    h.calls.privacy[0].success({ needAuthorization: false }); await real; assert.equal(h.calls.start.length, 1); await p.stopFollow();
  });
  await test('Day2 explicit back waits real stop ACK; repeated back shares wait, failed stop does not navigate', async () => {
    const h = harness(), p = h.page(); await h.open(p); let backs = 0; h.wx.navigateBack = () => backs++;
    await p.startFollow(false); await h.confirmStart(); h.behavior.stop = 'pending';
    const first = p.onBackTap(), second = p.onBackTap(); assert.strictEqual(first, second); await flush();
    assert.equal(backs, 0); assert.equal(h.calls.stop.length, 1); h.calls.stop[0].fail(); await first; assert.equal(backs, 0);
    h.behavior.stop = 'success'; await p.onBackTap(); assert.equal(backs, 1); assert.equal(p._followSession, null);
  });
  await test('R4独立私人面板及六路线正常浏览和Native/Access隔离回归', async () => {
    // 仅移除过期的UI可见性断言；上面的17组定位/进度/暂停/完成回归保持执行。
    const handlers = new Set([...template.matchAll(/\b(?:bind|catch):?[a-z]+="([^"]+)"/g)].map(match => match[1]));
    for(const name of ['onStartFollowTap','onResumeFollowTap','onFollowPrivacyAgree','onCheckFollowPrivacyTap','onAccessRecoveryTap'])assert(handlers.has(name));
    assert(template.includes('open-type="agreePrivacyAuthorization"'));
    assert(template.includes('disabled="{{!!followPlatformBlock'));
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
      const planning = startAccess(p); await flush();
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

  await test('R4 release start/resume cannot bypass private runtime gate via data; no automatic GPS on load',async()=>{
    const h=harness(),p=h.page();await h.open(p);assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.start.length,0);
    h.behavior.envVersion='release';p.data.followPlatformBlock='';await p.onStartFollowTap();assert.equal(p.data.followState.status,'blocked');
    p.data.followState.status='paused';await p.onResumeFollowTap();assert.equal(p.data.followState.status,'blocked');
    assert.equal(h.calls.start.length,0);assert.equal(h.calls.authorize.length,0);assert(p.data.followState.message.includes('私人'));p.onUnload();
  });
  await test('Day3 explicit privacy check and official agreement event do not automatically start GPS',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;
    await p.onCheckFollowPrivacyTap();assert.equal(p.data.followPrivacyVisible,true);assert.equal(p.data.followPrivacyStatus,'required');
    p.onFollowPrivacyAgree({type:'tap'});assert.equal(p.data.followPrivacyVisible,true);
    p.onFollowPrivacyAgree({type:'agreeprivacyauthorization'});assert.equal(p.data.followPrivacyStatus,'agreed');
    assert.equal(h.calls.start.length,0);assert.equal(h.calls.authorize.length,0);
    h.behavior.privacy=false;await p.onCheckFollowPrivacyTap();assert.equal(p.data.followPrivacyStatus,'checked');assert(p.data.followPrivacyMessage.includes('不能证明'));p.onUnload();
  });
  await test('Day3 privacy denial does not loop; read contract is not consent; failure visible',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;await p.onCheckFollowPrivacyTap();
    p.onFollowPrivacyCancel();assert.equal(p.data.followPrivacyStatus,'declined');assert.equal(h.calls.privacy.length,1);
    h.wx.openPrivacyContract=()=>{};p.onFollowPrivacyView();assert.equal(p.data.followPrivacyStatus,'declined');
    h.wx.openPrivacyContract=o=>o.fail();p.onFollowPrivacyView();assert(p.data.followPrivacyMessage.includes('无法打开'));
    delete h.wx.getPrivacySetting;await p.onCheckFollowPrivacyTap();assert.equal(p.data.followPrivacyStatus,'error');assert.equal(h.calls.start.length,0);p.onUnload();
  });
  await test('Day3 hanging privacy query times out and late callbacks cannot grant or start',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdPrivacy=true;
    const q=p.onCheckFollowPrivacyTap();p.onCheckFollowPrivacyTap();assert.equal(h.calls.privacy.length,1);
    await h.advance(20000);await q;assert.equal(p.data.followPrivacyStatus,'error');const before=h.calls.updates.length;
    h.calls.privacy[0].success({needAuthorization:true});await flush();assert.equal(h.calls.updates.length,before);assert.equal(h.calls.start.length,0);p.onUnload();
  });
  await test('Day3 privacy query hide/show, unload or route switch cancels UI wait; stale results ignored',async()=>{
    for(const life of ['hide','unload','route']) {const h=harness(),p=h.page();await h.open(p);h.behavior.holdPrivacy=true;
      const q=p.onCheckFollowPrivacyTap();if(life==='hide'){p.onHide();p.onShow();}else if(life==='unload')p.onUnload();else await h.open(p,formal[1]);
      await q;const count=h.calls.updates.length;h.calls.privacy[0].success({needAuthorization:true});await flush();
      assert.equal(h.calls.updates.length,count);assert.equal(h.timers.size,0);assert.equal(h.calls.start.length,0);
      if(life==='hide'){assert.equal(p.data.followPrivacyStatus,'idle');h.behavior.holdPrivacy=false;await p.onCheckFollowPrivacyTap();assert.equal(p.data.followPrivacyStatus,'checked');}}
  });
  await test('Day3 raw GPS marker uses indexed coordinate patches; Trail and other markers unchanged',async()=>{
    const h=harness(),p=h.page();await h.open(p);await p.startFollow(false);await h.confirmStart();
    const markers=plain(p.data.mapMarkers.filter(m=>m.id!==-1)),trail=p.data.mapPolylines;
    await h.advance(2000);h.emit({...gpsOffset(formal[0].startPoint,1),accuracy:5});
    assert(!h.calls.updates.at(-1).includes('mapMarkers'));assert(h.calls.updates.at(-1).some(k=>/^mapMarkers\[\d+\]\.latitude$/.test(k)));
    assert.deepEqual(plain(p.data.mapMarkers.filter(m=>m.id!==-1)),markers);assert.equal(p.data.mapPolylines,trail);
    assert.equal(p.data.mapMarkers.at(-1).latitude,p.data.followState.location.latitude);await p.stopFollow();
  });
  await test('Day3 Access timeout retains owner until actual late success/fail ACK, no stale writes or auto-GPS',async()=>{
    for(const outcome of ['success','fail']) {const h=harness(),p=h.page();await h.open(p);h.behavior.holdLocate=true;
      p.onMarkerTap({detail:{markerId:formal[0].waypoints[0].id}});const q=startAccess(p);await flush();await h.advance(20000);await q;
      assert.equal(p.getNavigationMode(),'ACCESS');assert(p.data.accessRecoveryMessage.includes('尚未返回'));
      p.onAccessRecoveryTap();await startAccess(p);assert.equal(h.calls.locate.length,1);await p.startFollow(false);assert.equal(h.calls.start.length,0);
      const points=p.data.mapPolylines;if(outcome==='success')h.calls.locate[0].success(formal[0].track[0]);else h.calls.locate[0].fail({errMsg:'failed'});await flush();
      assert.equal(p.getNavigationMode(),'IDLE');assert(p.data.accessRecoveryMessage.includes('已结束'));assert.equal(h.calls.start.length,0);assert.equal(h.calls.cloud.length,0);assert.equal(p.data.mapPolylines,points);
      await p.startFollow(false);assert.equal(h.calls.start.length,1);await p.stopFollow();
    }
  });
  await test('Day3 timed-out Access old ACK after route switch/unload releases only its claim',async()=>{
    for(const action of ['route','unload']){const h=harness(),p=h.page();await h.open(p);h.behavior.holdLocate=true;
      p.onMarkerTap({detail:{markerId:formal[0].waypoints[0].id}});const q=startAccess(p);await flush();await h.advance(20000);await q;
      if(action==='route')await h.open(p,formal[1]);else p.onUnload();const count=h.calls.updates.length;
      h.calls.locate[0].success(formal[0].track[0]);await flush();assert.equal(h.calls.updates.length,count);assert.equal(p.getNavigationMode(),'IDLE');assert.equal(h.calls.start.length,0);}
  });
  await test('Day3 Native explicit remove failure retry needs genuine ACK; rapid retry coalesces; no auto GPS',async()=>{
    const h=harness(),p=h.page();await h.open(p,routeById('fj-route-010'));p.onSimulationStartTap();h.behavior.holdRemove=true;
    const start=p.startFollow(false);await flush();h.calls.removes.at(-1).fail();await start;
    assert(p.data.nativeRecoveryMessage.includes('尚未确认停止'));const moves=h.calls.moves.length;
    const retry=p.onRetryNativeCleanupTap();p.onRetryNativeCleanupTap();assert.equal(h.calls.removes.length,2);assert.equal(p.getNavigationMode(),'NATIVE_OVERVIEW');assert.equal(h.calls.start.length,0);
    h.calls.removes.at(-1).success();await retry;assert.equal(p.getNavigationMode(),'IDLE');assert(p.data.nativeRecoveryMessage.includes('清理已确认'));
    assert.equal(h.calls.moves.length,moves);assert.equal(h.calls.start.length,0);p.onUnload();
  });
  await test('Day3 Native timeout cannot be retried as fake success; late ACK only releases old claim',async()=>{
    const h=harness(),p=h.page();await h.open(p,routeById('fj-route-008'));p.onSimulationStartTap();h.behavior.holdRemove=true;
    const start=p.startFollow(false);await flush();await h.advance(1500);await start;
    await p.onRetryNativeCleanupTap();assert.equal(h.calls.removes.length,1);assert.equal(p.getNavigationMode(),'NATIVE_OVERVIEW');assert(p.data.nativeRecoveryMessage.includes('尚未确认停止'));
    h.calls.removes[0].success();await flush();assert.equal(p.getNavigationMode(),'IDLE');assert.equal(h.calls.start.length,0);p.onUnload();
  });
  await test('Day3 Native retries remain blocked on repeated failure; lifecycle suppresses late UI',async()=>{
    const h=harness(),p=h.page();await h.open(p,routeById('fj-route-010'));p.onSimulationStartTap();h.behavior.holdRemove=true;
    const start=p.startFollow(false);await flush();h.calls.removes[0].fail();await start;
    let retry=p.onRetryNativeCleanupTap();h.calls.removes[1].fail();await retry;assert.equal(p.getNavigationMode(),'NATIVE_OVERVIEW');
    retry=p.onRetryNativeCleanupTap();p.onUnload();const count=h.calls.updates.length;h.calls.removes[2].success();await retry;
    assert.equal(h.calls.updates.length,count);assert.equal(p.getNavigationMode(),'IDLE');assert.equal(h.calls.start.length,0);
  });
  function selectAccess(h,p){p.onMarkerTap({detail:{markerId:p.data.route.waypoints[0].id}});p.onPlanAccessTap();return consentEvent(p);}
  function finishAccess(h){h.calls.cloud.at(-1).success({result:{success:true,distanceMeters:10,durationSeconds:20,points:formal[0].track.slice(0,2)}});}
  await test('R4 public click only, six real routes use SDK and local B1; Access policy independent',async()=>{
    for(const route of formal){const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();await h.open(p,route);
      assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.start.length,0);assert.equal(h.calls.locate.length,0);
      await p.onStartFollowTap();await h.confirmStart();assert.equal(h.calls.start.length,1);assert.equal(p.data.followState.status,'following');
      assert.equal(p._trailIndex.status,'ready');assert.equal(p.getNavigationMode(),'REAL_FOLLOW');assert.equal(h.calls.cloud.length,0);assert.equal(h.calls.locate.length,0);
      const before=p._trailModel.cursorMeters;p.onSimulationStartTap();p.onSimulationRestartTap();assert.equal(h.calls.moves.length,0);assert.equal(p._simulationSession,null);assert.equal(p._trailModel.cursorMeters,before);
      await p.onPauseFollowTap();assert.equal(h.listener(),null);p.onHide();p.onShow();assert.equal(h.calls.start.length,1);p.onUnload();await flush();}
  });
  await test('R4 public privacy denial and ordinary tap never start; official agreement still requires new click',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;await p.onStartFollowTap();
    assert.equal(h.calls.start.length,0);assert.equal(h.calls.authorize.length,0);assert.equal(p.data.followPrivacyVisible,true);
    p.onFollowPrivacyAgree({type:'tap'});assert.equal(p.data.followPrivacyVisible,true);assert.equal(h.calls.start.length,0);
    p.onFollowPrivacyCancel();assert.equal(h.calls.start.length,0);await p.onStartFollowTap();p.onFollowPrivacyAgree({type:'agreeprivacyauthorization'});
    assert.equal(h.calls.start.length,0);h.behavior.privacy=false;await p.onStartFollowTap();assert.equal(h.calls.start.length,1);await p.stopFollow();p.onUnload();
  });
  await test('R4 public runtime/SDK/invalid privacy failures start zero GPS; scope denied also zero',async()=>{
    for(const kind of ['identity','sdk','privacy','scope']){const h=harness(),p=h.page();await h.open(p);
      if(kind==='identity')delete h.wx.getAccountInfoSync;if(kind==='sdk')delete h.wx.startLocationUpdate;
      if(kind==='privacy')h.wx.getPrivacySetting=o=>o.success({});if(kind==='scope')h.behavior.deny=true;
      p.data.followPlatformBlock='';await p.onStartFollowTap();await flush();assert.equal(h.calls.start.length,0);assert.equal(h.listener(),null);assert.equal(h.calls.cloud.length,0);p.onUnload();}
  });
  await test('R4 public concurrent clicks and lifecycle cancellation before authorization',async()=>{
    for(const life of ['hide','unload','route']){const h=harness(),p=h.page();await h.open(p);h.behavior.holdPrivacy=true;
      const q=p.onStartFollowTap();p.onStartFollowTap();await flush();assert.equal(h.calls.privacy.length,1);
      if(life==='hide'){p.onHide();p.onShow();}else if(life==='unload')p.onUnload();else await h.open(p,formal[1]);
      h.calls.privacy[0].success({needAuthorization:false});await q;await flush();assert.equal(h.calls.authorize.length,0);assert.equal(h.calls.start.length,0);if(!p._unloaded)p.onUnload();}
  });
  await test('R4 public raw position remains unsnapped; low quality, jump and stale freeze B1',async()=>{
    const h=harness(),p=h.page();await h.open(p);await p.onStartFollowTap();await h.confirmStart();const cursor=p._trailModel.cursorMeters,trail=p.data.mapPolylines;
    await h.advance(2000);const raw={...gpsOffset(formal[0].startPoint,2),accuracy:5};h.emit(raw);
    assert.equal(p.data.followState.location.latitude,raw.latitude);assert.equal(p.data.mapMarkers.find(m=>m.id===-1).longitude,raw.longitude);assert.equal(p.data.mapPolylines,trail);
    await h.advance(2000);h.emit({...formal[0].track.at(-1),accuracy:500});assert.equal(p._trailModel.cursorMeters,cursor);
    await h.advance(2000);h.emit({...formal[0].track[Math.floor(formal[0].track.length/2)],accuracy:5});assert.equal(p._trailModel.cursorMeters,cursor);
    await h.advance(35000);assert.equal(p.data.followState.stale,true);assert.equal(p._trailModel.cursorMeters,cursor);await p.stopFollow();p.onUnload();
  });
  await test('R4 public pause stops, resume reauthorizes, failed stop blocks simulation and native',async()=>{
    const h=harness(),p=h.page();await h.open(p);await p.onStartFollowTap();await h.confirmStart();const old=h.listener();await p.onPauseFollowTap();
    const cursor=p._trailModel.cursorMeters;old({...formal[0].track[100],accuracy:5});assert.equal(p._trailModel.cursorMeters,cursor);const queries=h.calls.privacy.length;
    await p.onResumeFollowTap();assert.equal(h.calls.privacy.length,queries+1);assert.equal(h.calls.start.length,2);
    h.behavior.stop='fail';await p.onStopFollowTap();assert.equal(p.data.followState.cleanupPending,true);const moves=h.calls.moves.length;
    p.onSimulationStartTap();p.onSimulationRestartTap();assert.equal(h.calls.moves.length,moves);assert.equal(p._simulationSession,null);
    h.behavior.stop='success';await p.onStopFollowTap();assert.equal(h.listener(),null);assert.equal(p.getNavigationMode(),'IDLE');p.onUnload();
  });
  await test('R4 public real follow cannot start during B1 playing or in-flight Access; policy null remains zero',async()=>{
    const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();await h.open(p);p.onSimulationStartTap();await p.onStartFollowTap();assert.equal(h.calls.start.length,0);
    p.onSimulationPauseTap();await p.onStartFollowTap();assert.equal(h.calls.start.length,1);await p.onStopFollowTap();
    p.onMarkerTap({detail:{markerId:p.data.route.waypoints[0].id}});p.onPlanAccessTap();await p.onAccessConsentAgree(consentEvent(p));
    assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert(h.nav.getAccessPreflight().codes.includes('ACCESS_REQUESTS_DISABLED'));p.onUnload();
  });
  await test('R4 public Access pending and Native remove ACK cannot be bypassed by GPS click',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdLocate=true;p.onMarkerTap({detail:{markerId:p.data.route.waypoints[0].id}});
    const q=startAccess(p);await flush();await p.onStartFollowTap();assert.equal(h.calls.start.length,0);p.onClearAccessTap();h.calls.locate[0].success(formal[0].track[1]);await q;
    assert.equal(h.calls.cloud.length,0);p.onUnload();
    const n=harness(),v=n.page();await n.open(v,formal.find(r=>r._id==='fj-route-010'));n.behavior.holdRemove=true;v.onSimulationStartTap();
    const start=v.onStartFollowTap();await flush();assert.equal(n.calls.start.length,0);assert.equal(n.calls.removes.length,1);
    n.calls.removes[0].success();await start;assert.equal(n.calls.start.length,1);await v.stopFollow();v.onUnload();
  });
  await test('R4 public unsupported runtime, invalid Route, hidden page and duplicate clicks do not leak SDK starts',async()=>{
    const h=harness(),p=h.page();await h.open(p);p.onHide();await p.onStartFollowTap();assert.equal(h.calls.start.length,0);p.onShow();
    p.data.mapRenderError=true;await p.onStartFollowTap();assert.equal(h.calls.privacy.length,0);p.data.mapRenderError=false;
    h.behavior.holdAuthorize=true;const q=p.onStartFollowTap();p.onStartFollowTap();await flush();assert.equal(h.calls.authorize.length,1);
    h.calls.authorize[0].success();await q;assert.equal(h.calls.start.length,1);await p.stopFollow();p.onUnload();
  });
  await test('R4 location purpose declared, no background API or real GPS upload/storage added',async()=>{
    const config=JSON.parse(read('miniprogram/app.json'));assert.equal(config.permission['scope.userLocation'].desc,'用于主动规划步行接驳及前台GPS循迹定位');
    assert.deepEqual(config.requiredPrivateInfos,['getLocation','startLocationUpdate','onLocationChange']);assert(!config.requiredBackgroundModes);
    const service=read('miniprogram/services/trail-follow-service.js');assert(!/startLocationUpdateBackground|setStorage|callFunction|wx[.]request|console[.]/.test(service));
  });
  await test('R3 owner-confirmed provider/API still blocked by missing policy; data cannot override',async()=>{
    const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();await h.open(p);const e=selectAccess(h,p);
    assert.equal(h.nav.getAccessPreflight().providerLegalName,'北京高德图强科技有限公司');assert.deepEqual(plain(h.nav.getAccessPreflight().codes),['ACCESS_REQUESTS_DISABLED']);assert.equal(require('../miniprogram/config/access-privacy').policyPagePath,null);
    p.data.accessConsent.ready=true;p.data.accessConsent.providerLegalName='page data cannot authorize';await p.onAccessConsentAgree(e);
    await assert.rejects(h.nav.authorizeAccess({isCurrent:()=>true,target:formal[0].track[0]}),x=>x.code==='ACCESS_REQUESTS_DISABLED');
    await assert.rejects(h.nav.locateOnce(),x=>x.code==='ACCESS_REQUESTS_DISABLED');
    await assert.rejects(h.nav.planAccessRoute(formal[0].track[0],formal[0].track[1]),x=>x.code==='ACCESS_REQUESTS_DISABLED');
    assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert.equal(h.calls.privacy.length,0);p.onUnload();
  });
  await test('R2 each missing provider, API or reader channel independently prevents requests',async()=>{
    for(const patch of [{providerLegalName:null},{getLocationApproved:false},{policyReader:null}]){const h=harness({...APPROVED_ACCESS,...patch}),p=h.page();await h.open(p);const e=selectAccess(h,p);await p.onAccessConsentAgree(e);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert.equal(h.calls.privacy.length,0);p.onUnload();}
  });
  await test('R2 disclosure precedes SDK; decline or close means zero location and zero cloud',async()=>{
    for(const close of ['decline','mask-close']){const h=harness(),p=h.page();await h.open(p);const trail=p.data.mapPolylines,markers=p.data.mapMarkers;
      const e=selectAccess(h,p);assert.equal(p.data.accessConsent.visible,true);assert.equal(p.data.accessConsent.policyUrl,'https://lbs.amap.com/pages/privacy/');
      assert.equal(p.data.accessConsent.providerLegalName,APPROVED_ACCESS.providerLegalName);assert.deepEqual(h.calls.order,[]);
      p.onAccessConsentCancel(e);assert.equal(p.data.accessConsent.visible,false);await p.onAccessConsentAgree(e);
      assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert.deepEqual(plain(p.data.mapPolylines),plain(trail));assert.equal(p.data.mapMarkers,markers);
      p.onPlanAccessTap();assert.equal(p.data.accessConsent.visible,true);assert.notEqual(p.data.accessConsent.requestId,e.currentTarget.dataset.requestId);p.onUnload();}
    const markup=read('miniprogram/pages/route-detail/index.wxml');assert(markup.includes('catchtap="onAccessConsentCancel"'));assert(markup.includes('暂不使用'));assert(markup.includes('Web API（非客户端SDK）'));
  });
  await test('R2 consent then privacy then location scope then fresh fix then cloud; duplicate click is one',async()=>{
    const h=harness(),p=h.page();await h.open(p);const e=selectAccess(h,p);p.onPlanAccessTap();assert.equal(p.data.accessConsent.requestId,e.currentTarget.dataset.requestId);
    const q=p.onAccessConsentAgree(e);p.onAccessConsentAgree(e);p.onPlanAccessTap();await flush();assert.deepEqual(h.calls.order,['privacy','authorize','locate','cloud']);
    assert.equal(h.calls.locate.length,1);assert.equal(h.calls.cloud.length,1);finishAccess(h);await q;assert.equal(p.data.accessRoute.status,'success');
    p.onPlanAccessTap();assert.equal(p.data.accessConsent.visible,true);assert.equal(h.calls.cloud.length,1);p.onUnload();
  });
  await test('R2 refused generation cannot agree for a newer request',async()=>{
    const h=harness(),p=h.page();await h.open(p);const old=selectAccess(h,p);p.onAccessConsentCancel(old);p.onPlanAccessTap();const current=consentEvent(p);
    await p.onAccessConsentAgree(old);assert.equal(h.calls.locate.length,0);assert.equal(p.data.accessConsent.visible,true);
    const q=p.onAccessConsentAgree(current);await flush();finishAccess(h);await q;assert.equal(h.calls.cloud.length,1);p.onUnload();
  });
  await test('R2 old agreement after target/route/hide/unload never locates or calls cloud',async()=>{
    for(const action of ['target','route','hide','unload']){const h=harness(),p=h.page();await h.open(p);const e=selectAccess(h,p);
      if(action==='target')p.onMarkerTap({detail:{markerId:formal[0].waypoints[1].id}});else if(action==='route')await h.open(p,formal[1]);else if(action==='hide'){p.onHide();p.onShow();}else p.onUnload();
      await p.onAccessConsentAgree(e);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);}
  });
  await test('R2 third-party consent cannot replace WeChat privacy; decline is zero location/cloud',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();
    assert.equal(p.data.accessConsent.stage,'wechatPrivacy');assert.equal(h.calls.authorize.length,0);assert.equal(h.calls.locate.length,0);
    p.onAccessConsentCancel(e);await q;p.onAccessWeChatPrivacyAgree({...e,type:'agreeprivacyauthorization'});await flush();
    assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert.equal(p.getNavigationMode(),'IDLE');
  });
  await test('R2 official WeChat event separately rechecks privacy; ordinary tap does not authorize',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();
    p.onAccessWeChatPrivacyAgree({...e,type:'tap'});await flush();assert.equal(h.calls.authorize.length,0);
    h.behavior.privacy=false;p.onAccessWeChatPrivacyAgree({...e,type:'agreeprivacyauthorization'});await flush();assert.deepEqual(h.calls.order,['privacy','privacy','authorize','locate','cloud']);
    finishAccess(h);await q;assert.equal(h.calls.start.length,0);p.onUnload();
  });
  await test('R2 denied scope or getLocation unavailable/failure sends no coordinates to cloud',async()=>{
    for(const kind of ['scope','not-open','fail']){const h=harness(),p=h.page();await h.open(p);
      if(kind==='scope')h.behavior.deny=true;else h.wx.getLocation=o=>{h.calls.locate.push(o);o.fail({errMsg:kind==='not-open'?'getLocation:fail api permission denied':'getLocation:fail unavailable'});};
      const e=selectAccess(h,p);await p.onAccessConsentAgree(e);assert.equal(h.calls.cloud.length,0);
      if(kind==='scope')assert.equal(h.calls.locate.length,0);if(kind==='not-open')assert(p.data.navigationMessage.includes('单次定位getLocation接口'));
      h.behavior.envVersion='release';await p.onStartFollowTap();assert.equal(p.data.followState.status,'blocked');assert.equal(h.calls.start.length,0);p.onUnload();}
  });
  await test('R2 late privacy/scope callback after route change cannot start getLocation',async()=>{
    for(const stage of ['Privacy','Authorize']){const h=harness(),p=h.page();await h.open(p);h.behavior['hold'+stage]=true;
      const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();await h.open(p,formal[1]);const before=h.calls.updates.length;
      if(stage==='Privacy')h.calls.privacy[0].success({needAuthorization:false});else h.calls.authorize[0].success();await q;
      assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);assert.equal(h.calls.updates.length,before);p.onUnload();}
  });
  await test('R2 late fix after route change is ACK only, no cloud or new-page update',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdLocate=true;const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();
    await h.open(p,formal[1]);const n=h.calls.updates.length;h.calls.locate[0].success(formal[0].track[0]);await q;
    assert.equal(h.calls.cloud.length,0);assert.equal(h.calls.updates.length,n);assert.equal(p.data.route._id,formal[1]._id);p.onUnload();
  });
  await test('R2 cancel after actual cloud dispatch cannot retract transmission or show late result',async()=>{
    const h=harness(),p=h.page();await h.open(p);const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();assert.equal(h.calls.cloud.length,1);
    p.onAccessConsentCancel(e);const n=h.calls.updates.length;finishAccess(h);await q;assert.equal(h.calls.updates.length,n);assert.equal(p.data.accessRoute.status,'idle');assert.equal(h.calls.cloud.length,1);p.onUnload();
  });
  await test('R2 policy opening failure blocks consent despite page data override',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.policyFail=true;const e=selectAccess(h,p);await p.onAccessPolicyTap(e);
    assert.equal(h.calls.policy.length,1);assert(p.data.accessConsent.message.includes('未能打开'));p.data.accessConsent.ready=true;
    await p.onAccessConsentAgree(e);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('R2 service grant cannot be forged, reused or assigned a different destination',async()=>{
    const h=harness(),target=formal[0].waypoints[0];
    await assert.rejects(h.nav.locateOnce({grant:{}}),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    const grant=await h.nav.authorizeAccess({isCurrent:()=>true,target});const origin=await h.nav.locateOnce({grant});
    await assert.rejects(h.nav.locateOnce({grant}),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    await assert.rejects(h.nav.planAccessRoute(origin,formal[0].waypoints[1],grant),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    const q=h.nav.planAccessRoute(origin,target,grant);await assert.rejects(h.nav.planAccessRoute(origin,target,grant),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    assert.equal(h.calls.cloud.length,1);finishAccess(h);await q;
  });
  await test('R2 back invalidates consent immediately before lifecycle callback, no late SDK start',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.wx.navigateBack=()=>{};const e=selectAccess(h,p);p.onBackTap();
    await p.onAccessConsentAgree(e);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('R2 unreadable WeChat contract blocks agreement separately from third-party consent',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.privacy=true;h.wx.openPrivacyContract=o=>o.fail();
    const e=selectAccess(h,p),q=p.onAccessConsentAgree(e);await flush();p.onAccessWeChatPrivacyView(e);
    assert(p.data.accessConsent.message.includes('微信隐私指引未能打开'));h.behavior.privacy=false;p.onAccessWeChatPrivacyAgree({...e,type:'agreeprivacyauthorization'});
    await flush();assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onAccessConsentCancel(e);await q;
  });
  await test('D3 reader is passive on load and Access disclosure alone; registered UI describes supplemental route',async()=>{
    const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();await h.open(p);selectAccess(h,p);
    assert.equal(h.calls.policy.length,0);assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);
    const wxml=read('miniprogram/pages/route-detail/index.wxml');assert(wxml.includes('catchtap="onAccessPolicyTap"'));assert(wxml.includes('补充文档中点击高德官方政策链接'));
    p.onUnload();
  });
  await test('D3 reader service opens native contract with null policy path and returns only open ACK',async()=>{
    const policy=require('../miniprogram/config/access-privacy'),h=harness(policy);assert.equal(policy.policyPagePath,null);
    h.wx.navigateTo=()=>{throw Error('reader must not navigate to a fabricated page');};
    assert.deepEqual(plain(await h.nav.openAccessPrivacyPolicy()),{opened:true});assert.equal(h.calls.policy.length,1);
    assert.equal(h.nav.getAccessPreflight().ready,false);assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);
  });
  await test('D3 open ACK never enables production Access in develop trial or release, including data override',async()=>{
    for(const envVersion of ['develop','trial','release']){const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();h.behavior.envVersion=envVersion;await h.open(p);const old=selectAccess(h,p);
      await p.onAccessPolicyTap(old);assert.equal(h.calls.policy.length,1);assert.equal(p._accessIntent,null);assert.equal(p.data.accessConsent.visible,false);
      assert(p.data.navigationMessage.includes('已打开'));assert(p.data.navigationMessage.includes('不代表已阅读全文或已同意'));
      await p.onAccessConsentAgree(old);p.onPlanAccessTap();const current=consentEvent(p);assert.notEqual(current.currentTarget.dataset.requestId,old.currentTarget.dataset.requestId);
      p.data.accessConsent.ready=true;await p.onAccessConsentAgree(current);assert.equal(h.nav.getAccessPreflight().ready,false);
      assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.authorize.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);
      if(envVersion==='release'){await p.onStartFollowTap();assert.equal(p.data.followState.status,'blocked');assert.equal(h.calls.start.length,0);}p.onUnload();}
  });
  await test('D3 successful overlay without hide invalidates old consent; new explicit choice is still required',async()=>{
    const h=harness(),p=h.page();await h.open(p);const old=selectAccess(h,p);await p.onAccessPolicyTap(old);
    assert.equal(h.calls.locate.length,0);assert.equal(p._accessIntent,null);await p.onAccessConsentAgree(old);assert.equal(h.calls.cloud.length,0);
    p.onPlanAccessTap();const fresh=consentEvent(p);assert.notEqual(fresh.currentTarget.dataset.requestId,old.currentTarget.dataset.requestId);assert.equal(p._accessIntent.stage,'pending');
    assert.equal(h.calls.privacy.length,0);const q=p.onAccessConsentAgree(fresh);await flush();assert.deepEqual(h.calls.order,['privacy','authorize','locate','cloud']);
    finishAccess(h);await q;assert.equal(h.calls.cloud.length,1);p.onUnload();
  });
  await test('D3 failure missing API and synchronous throw remain visible and block stale agreement',async()=>{
    for(const kind of ['failure','missing','throw']){const h=harness(),p=h.page();await h.open(p);const e=selectAccess(h,p);
      if(kind==='failure')h.behavior.policyFail=true;if(kind==='missing')delete h.wx.openPrivacyContract;if(kind==='throw')h.behavior.policyThrow=true;
      await p.onAccessPolicyTap(e);assert(p.data.accessConsent.message.includes('未能打开'));assert.equal(p.data.accessConsent.ready,false);
      p.data.accessConsent.ready=true;await p.onAccessConsentAgree(e);assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();}
  });
  await test('D3 pending repeated reader or agree clicks cannot duplicate contract or create consent',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdPolicy=true;const e=selectAccess(h,p),q=p.onAccessPolicyTap(e);
    p.onAccessPolicyTap(e);await p.onAccessConsentAgree(e);assert.equal(h.calls.policy.length,1);assert.equal(h.calls.locate.length,0);
    h.calls.policy[0].success();await q;await p.onAccessConsentAgree(e);await p.onAccessPolicyTap(e);
    assert.equal(h.calls.policy.length,1);assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('D3 reader timeout stays failed and late success cannot revive intent or grant',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdPolicy=true;const e=selectAccess(h,p),q=p.onAccessPolicyTap(e);
    await h.advance(20001);await q;assert(p.data.accessConsent.message.includes('未能打开'));const updates=h.calls.updates.length;
    h.calls.policy[0].success();await flush();assert.equal(h.calls.updates.length,updates);await p.onAccessConsentAgree(e);
    assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('D3 late reader success or failure after cancel hide unload route target or back cannot write new state',async()=>{
    for(const outcome of ['success','fail'])for(const action of ['cancel','hide','unload','route','target','back']){
      const h=harness(),p=h.page();await h.open(p);h.behavior.holdPolicy=true;const e=selectAccess(h,p),q=p.onAccessPolicyTap(e);
      if(action==='cancel')p.onAccessConsentCancel(e);else if(action==='hide'){p.onHide();p.onShow();}else if(action==='unload')p.onUnload();
      else if(action==='route')await h.open(p,formal[1]);else if(action==='target')p.onMarkerTap({detail:{markerId:formal[0].waypoints[1].id}});
      else{h.wx.navigateBack=()=>{};await p.onBackTap();}
      const before=JSON.stringify(p.data),updates=h.calls.updates.length;h.calls.policy[0][outcome]();await q;await p.onAccessConsentAgree(e);
      assert.equal(JSON.stringify(p.data),before);assert.equal(h.calls.updates.length,updates);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);
      if(!p._unloaded)p.onUnload();}
  });
  await test('D3 late old reader callback cannot cancel or update a newly created planning intent',async()=>{
    const h=harness(),p=h.page();await h.open(p);h.behavior.holdPolicy=true;const old=selectAccess(h,p),q=p.onAccessPolicyTap(old);
    p.onAccessConsentCancel(old);p.onPlanAccessTap();const fresh=p._accessIntent,before=JSON.stringify(p.data);
    h.calls.policy[0].success();await q;assert.strictEqual(p._accessIntent,fresh);assert.equal(JSON.stringify(p.data),before);
    await p.onAccessConsentAgree(old);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('D3 reader refusal and close keep map Waypoints Native and B1 simulation independent',async()=>{
    const h=harness(require('../miniprogram/config/access-privacy')),p=h.page();await h.open(p);const map=JSON.stringify(p.data.mapCenter),e=selectAccess(h,p);
    p.onAccessConsentCancel(e);await p.onAccessPolicyTap(e);assert.equal(h.calls.policy.length,0);assert.equal(JSON.stringify(p.data.mapCenter),map);
    await p.onOpenTargetTap();assert.equal(h.calls.native.length,1);p.onSimulationStartTap();assert.equal(p.data.simulationState.status,'playing');
    assert.equal(p.data.followState.status,'idle');assert.equal(h.calls.start.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('D7 reader channel verification URL and API are necessary even with request approval',async()=>{
    for(const patch of [{policyReader:null},{policyReader:'unknown'},{policyReaderVerified:false},{policyReaderVerified:'true'},{policyUrl:'https://example.invalid/privacy'},{policyReader:null,policyPagePath:'/pages/legacy-is-not-a-reader/index'}]){
      const h=harness({...APPROVED_ACCESS,...patch}),p=h.page();await h.open(p);const e=selectAccess(h,p);p.data.accessConsent.ready=true;
      assert.equal(h.nav.getAccessPreflight().readerAvailable,false);assert(h.nav.getAccessPreflight().codes.includes('ACCESS_POLICY_UNAVAILABLE'));
      await p.onAccessConsentAgree(e);await assert.rejects(h.nav.openAccessPrivacyPolicy(),x=>x.code==='ACCESS_POLICY_UNAVAILABLE');
      await assert.rejects(h.nav.authorizeAccess({isCurrent:()=>true,target:{latitude:30,longitude:120}}),x=>x.code==='ACCESS_POLICY_UNAVAILABLE');
      await assert.rejects(h.nav.locateOnce(),x=>x.code==='ACCESS_POLICY_UNAVAILABLE');
      await assert.rejects(h.nav.planAccessRoute({latitude:30,longitude:120},{latitude:30.01,longitude:120.01}),x=>x.code==='ACCESS_POLICY_UNAVAILABLE');
      assert.equal(h.calls.policy.length,0);assert.deepEqual(h.calls.order,[]);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
    }
    const h=harness(),p=h.page();await h.open(p);const e=selectAccess(h,p);delete h.wx.openPrivacyContract;
    assert.equal(h.nav.getAccessPreflight().readerAvailable,false);await p.onAccessPolicyTap(e);await p.onAccessConsentAgree(e);
    assert.equal(h.calls.privacy.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  await test('D7 verified reader and explicit consent never bypass disabled or missing request permit',async()=>{
    const real=require('../miniprogram/config/access-privacy');assert.equal(real.accessRequestsEnabled,false);assert.equal(real.policyReaderVerified,true);
    for(const permit of [false,undefined,null,'true',1]){
      const h=harness({...APPROVED_ACCESS,accessRequestsEnabled:permit}),p=h.page();await h.open(p);let e=selectAccess(h,p);
      assert.equal(h.nav.getAccessPreflight().readerAvailable,true);assert.deepEqual(plain(h.nav.getAccessPreflight().codes),['ACCESS_REQUESTS_DISABLED']);
      await p.onAccessPolicyTap(e);assert.equal(p._accessIntent,null);p.onPlanAccessTap();e=consentEvent(p);p.data.accessConsent.ready=true;
      await p.onAccessConsentAgree(e);await assert.rejects(h.nav.authorizeAccess({isCurrent:()=>true,target:{latitude:30,longitude:120}}),x=>x.code==='ACCESS_REQUESTS_DISABLED');
      await assert.rejects(h.nav.locateOnce({grant:{}}),x=>x.code==='ACCESS_REQUESTS_DISABLED');
      await assert.rejects(h.nav.planAccessRoute({latitude:30,longitude:120},{latitude:30.01,longitude:120.01},{}),x=>x.code==='ACCESS_REQUESTS_DISABLED');
      assert.equal(h.calls.policy.length,1);assert.deepEqual(h.calls.order,[]);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
    }
  });
  await test('D7 no consent or forged grant cannot locate; fully approved mock consumes each grant once',async()=>{
    const h=harness(),p=h.page();await h.open(p);const old=selectAccess(h,p);await p.onAccessPolicyTap(old);p.onPlanAccessTap();
    assert.equal(h.nav.getAccessPreflight().ready,true);assert.deepEqual(h.calls.order,[]);
    await assert.rejects(h.nav.locateOnce({grant:{}}),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    const e=consentEvent(p),r=p.onAccessConsentAgree(e);p.onAccessConsentAgree(e);await flush();assert.deepEqual(h.calls.order,['privacy','authorize','locate','cloud']);
    finishAccess(h);await r;assert.equal(h.calls.locate.length,1);assert.equal(h.calls.cloud.length,1);p.onUnload();
    const v=harness(),target={latitude:30.01,longitude:120.01};let current=true;
    const grant=await v.nav.authorizeAccess({isCurrent:()=>current,target});v.behavior.holdLocate=true;
    const pending=v.nav.locateOnce({grant});await assert.rejects(v.nav.locateOnce({grant}),x=>x.code==='ACCESS_CONSENT_REQUIRED');assert.equal(v.calls.locate.length,1);
    v.calls.locate[0].success({latitude:30,longitude:120});const origin=await pending;
    const request=v.nav.planAccessRoute(origin,target,grant);await assert.rejects(v.nav.planAccessRoute(origin,target,grant),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    assert.equal(v.calls.cloud.length,1);v.calls.cloud[0].success({result:{success:true,distanceMeters:5,durationSeconds:6,points:[origin,target]}});await request;
    await assert.rejects(v.nav.locateOnce({grant}),x=>x.code==='ACCESS_CONSENT_REQUIRED');
    current=false;assert.equal(v.calls.cloud.length,1);
  });
  await test('D7 request permit is rechecked before location and before cloud even for an existing grant',async()=>{
    for(const stage of ['authorized','located']){
      const policy={...APPROVED_ACCESS},h=harness(policy),target={latitude:30.01,longitude:120.01};
      const grant=await h.nav.authorizeAccess({isCurrent:()=>true,target});let origin;
      if(stage==='located'){h.behavior.holdLocate=true;const r=h.nav.locateOnce({grant});h.calls.locate[0].success({latitude:30,longitude:120});origin=await r;}
      policy.accessRequestsEnabled=false;
      if(stage==='authorized')await assert.rejects(h.nav.locateOnce({grant}),x=>x.code==='ACCESS_REQUESTS_DISABLED');
      else await assert.rejects(h.nav.planAccessRoute(origin,target,grant),x=>x.code==='ACCESS_REQUESTS_DISABLED');
      assert.equal(h.calls.locate.length,stage==='authorized'?0:1);assert.equal(h.calls.cloud.length,0);
    }
  });
  await test('D7 fully approved Access mock does not authorize release GPS',async()=>{
    const h=harness(),p=h.page();h.behavior.envVersion='release';await h.open(p);
    assert.equal(h.nav.getAccessPreflight().ready,true);await p.onStartFollowTap();assert.equal(p.data.followState.status,'blocked');
    assert.equal(h.calls.start.length,0);assert.equal(h.calls.locate.length,0);assert.equal(h.calls.cloud.length,0);p.onUnload();
  });
  for (const name of ['getLocation', 'startLocationUpdate', 'onLocationChange']) assert(config.requiredPrivateInfos.includes(name));
  assert(!config.requiredBackgroundModes); assert(!config.permission['scope.userLocationBackground']);
  const source = read('miniprogram/services/trail-follow-service.js');
  assert(!/setStorage|cloud\.|request\(|console\./.test(source.replace(/function request\(|await request\(/g, '')));
  console.log(JSON.stringify({ result: 'PASS', evidence: 'LOCAL_SIMULATION_ONLY', routes: formal.length, cases: passed }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

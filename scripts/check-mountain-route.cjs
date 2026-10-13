// 真实页面/service/adapter + 本地微信/数据库回调；不是云端或手机验收。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const { validateRoute } = require('./check-route-data.cjs');
const env = require('../miniprogram/config/env');
const mountain = JSON.parse(read('data/routes/damushan.json'));
const xiamen = JSON.parse(read('data/routes/xiamen-loop.json'));
const documents = new Map([mountain, xiamen].map(r => [r._id, r]));
const errors = [], calls = { native: [], location: [], cloud: [], queries: [], navigation: [] };
const hash = file => crypto.createHash('sha256').update(read(file)).digest('hex');
const protectedFiles = ['data/routes/damushan.json', 'data/routes/damushan-import.json', 'data/routes/xiamen-loop.json', 'data/routes/xiamen-loop-import.json'];
const hashes = protectedFiles.map(file => [file, hash(file)]);
const wx = {
  navigateTo(value) { calls.navigation.push(value); }, navigateBack() {}, redirectTo() {},
  openLocation(value) { calls.native.push(value); }, getLocation(value) { calls.location.push(value); },
  cloud: {
    callFunction(value) { assert.equal(value.config.env, env.cloudEnvId); calls.cloud.push(value); },
    database(config) {
      assert.equal(config.env, env.cloudEnvId);
      return { collection(name) {
        assert.equal(name, 'routes'); let filter, fields, limit;
        return { where(value) { filter = value; return this; }, field(value) { fields = value; return this; }, limit(value) { limit = value; return this; },
          async get() {
            calls.queries.push({ collection: name, filter: filter || null, fields: fields || null, limit });
            let rows = [...documents.values()].filter(r => !filter || r._id === filter._id).slice(0, limit);
            if (fields) rows = rows.map(r => Object.fromEntries(Object.keys(fields).map(k => [k, r[k]])));
            return { data: plain(rows) };
          } };
      } };
    }
  }
};
function service(file) {
  const module = { exports: {} };
  vm.runInNewContext(read(file), { module, wx, require: () => env, setTimeout, clearTimeout });
  return module.exports;
}
const routes = service('miniprogram/services/route-service.js');
const navigation = service('miniprogram/services/navigation-service.js');
function page(relative) {
  let definition;
  vm.runInNewContext(read(relative), { Page(p) { definition = p; }, wx, console: { info() {}, error(...args) { errors.push(args.map(String)); } }, require(name) {
    if (name.includes('navigation-service')) return navigation;
    if (name.includes('route-service')) return routes;
    return require(path.resolve(root, path.dirname(relative), name));
  } });
  return { ...definition, data: plain(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function assertTrail(p, r) {
  assert.equal(p.data.status, 'success'); assert.equal(p.data.route._id, r._id);
  assert.deepEqual(plain(p.data.mapPolylines[0].points), r.track);
  assert.deepEqual(plain(p.data.mapCenter.markers.map(m => m.id)), [0, ...r.waypoints.map(w => w.id)]);
  assert.equal(p.data.mapCenter.discardedTrackPointCount, 0);
  for (const point of r.track) assert(p.data.mapIncludePoints.some(p => p.latitude === point.latitude && p.longitude === point.longitude));
}
async function beginAccess(p, r) {
  p.onMarkerTap({ detail: { markerId: r.waypoints[0].id } });
  const pending = p.onPlanAccessTap(); assert.equal(p.data.accessRoute.status, 'locating');
  assert.equal(calls.location.at(-1).type, 'gcj02');
  const origin = { ...r.track[1] }; calls.location.at(-1).success(origin); await tick();
  assert.equal(p.data.accessRoute.status, 'planning');
  const request = calls.cloud.at(-1); assert.deepEqual(Object.keys(request.data).sort(), ['destination', 'origin']);
  const destination = { latitude: r.waypoints[0].latitude, longitude: r.waypoints[0].longitude };
  assert.deepEqual(plain(request.data.destination), destination);
  return { pending, request, result: { success: true, distanceMeters: 123, durationSeconds: 120, points: [origin, destination] } };
}
async function run() {
  validateRoute(mountain); validateRoute(xiamen);
  assert.deepEqual(mountain, JSON.parse(read('data/routes/damushan-import.json')));
  assert.equal(mountain.track.length, 735); assert.equal(mountain.waypoints.length, 5);
  [214, 372, 427, 540, 637].forEach((index, i) => {
    const w = mountain.waypoints[i]; assert.equal(w.id, i + 1);
    assert.equal(w.latitude, mountain.track[index].latitude); assert.equal(w.longitude, mountain.track[index].longitude);
  });
  const list = page('miniprogram/pages/routes/index.js'); await list.onLoad();
  assert.equal(list.data.status, 'success'); assert(list.data.routes.some(r => r._id === mountain._id));
  assert(list.data.routes.every(r => !r.track && !r.waypoints));
  list.onRouteTap({ currentTarget: { dataset: { id: mountain._id } } });
  assert(calls.navigation.at(-1).url.endsWith('id=fj-route-006'));
  const p = page('miniprogram/pages/route-detail/index.js'); await p.onLoad({ id: mountain._id }); assertTrail(p, mountain);
  for (const w of mountain.waypoints) {
    p.onMarkerTap({ detail: { markerId: w.id } }); assert.equal(p.data.selectedWaypoint.name, w.name);
    assert.equal(p.data.selectedWaypoint.latitude, w.latitude);
    const pending = p.onOpenTargetTap(); const target = calls.native.at(-1);
    assert.equal(target.name, w.name); assert.equal(target.latitude, w.latitude); assert.equal(target.longitude, w.longitude);
    target.success(); await pending; assert.equal(p.data.nativeNavigation.status, 'idle');
  }
  const active = await beginAccess(p, mountain); active.request.success({ result: active.result }); await active.pending;
  assert.equal(p.data.accessRoute.status, 'success'); assert.equal(p.data.mapPolylines.length, 2); assertTrail(p, mountain);
  p.onMarkerTap({ detail: { markerId: mountain.waypoints[1].id } });
  assert.equal(p.data.accessRoute.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1);
  // 同ID节点跨路线不能残留；规划中的旧成功回调不污染下一条路线。
  for (const [from, to] of [[xiamen, mountain], [mountain, xiamen]]) {
    await p.onLoad({ id: from._id }); const stale = await beginAccess(p, from);
    await p.onLoad({ id: to._id }); stale.request.success({ result: stale.result }); await stale.pending;
    assertTrail(p, to); assert.equal(p.data.selectedWaypoint, null); assert.equal(p.data.accessRoute.status, 'idle');
    assert.equal(p.data.accessRoute.origin, null); assert.equal(p.data.accessRoute.points.length, 0);
    assert.equal(p.data.nativeNavigation.status, 'idle'); assert.equal(p.data.mapPolylines.length, 1);
    p.onMarkerTap({ detail: { markerId: to.waypoints[0].id } }); assert.equal(p.data.selectedWaypoint.name, to.waypoints[0].name);
  }
  await p.onLoad({ id: mountain._id }); const denied = p.onPlanAccessTap(); await denied;
  assert.equal(calls.location.length, 3); // 未选节点不额外定位。
  for (const code of ['ROUTE_UNAVAILABLE', 'UPSTREAM_ERROR', 'WALKING_RANGE_EXCEEDED']) {
    const failure = await beginAccess(p, mountain);
    failure.request.success({ result: { success: false, errorCode: code, message: '本地模拟受控失败' } }); await failure.pending;
    assert.equal(p.data.accessRoute.status, 'error'); assert.equal(p.data.accessRoute.errorCode, code);
    assert.equal(p.data.mapPolylines.length, 1); assertTrail(p, mountain);
    if (code === 'UPSTREAM_ERROR') assert.equal(p.data.navigationMessage, '步行规划暂不可用，请使用打开目标位置。');
    if (code === 'WALKING_RANGE_EXCEEDED') {
      assert(p.data.navigationMessage.includes('最多100公里'));
      assert(p.data.navigationMessage.includes('打开目标位置'));
      const beforeLocation = calls.location.length, beforeCloud = calls.cloud.length, beforeNative = calls.native.length;
      const nativeFallback = p.onOpenTargetTap();
      assert.equal(calls.native.length, beforeNative + 1);
      assert.equal(calls.native.at(-1).latitude, p.data.selectedWaypoint.latitude);
      calls.native.at(-1).success(); await nativeFallback;
      assert.equal(calls.location.length, beforeLocation); assert.equal(calls.cloud.length, beforeCloud);
      assertTrail(p, mountain);
    }
  }
  p.onHide(); p.onUnload(); assert.equal(p.data.accessRoute.points.length, 0); assert.equal(p.data.mapPolylines.length, 0);
  assert.equal(errors.length, 0); hashes.forEach(([file, before]) => assert.equal(hash(file), before));
  console.log(JSON.stringify({ status: 'LOCAL_PASS', evidenceType: 'real source with mocked wx/cloud database/callbacks; not end-to-end',
    schema: true, trackPoints: 735, waypointCount: 5, markers: 6, listAndDetailMockRead: true,
    mapPolylineAndIncludePoints: true, allFiveWaypointClickAndNativeArguments: true, accessSuccessAndControlledFailure: true,
    bidirectionalRouteSwitchAndStaleSuccess: true, localConsoleErrors: 0, protectedFilesUnchanged: true,
    cloudImported: false, liveCloudVerified: false, actualViewportVerified: false, phoneVerified: false }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });

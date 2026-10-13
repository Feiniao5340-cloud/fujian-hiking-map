// 六条正式数据 + 真实 Page/service/adapter；微信、云数据库与导航回调均为本地模拟。
// 不连接 CloudBase，不把模拟蓝线或 Node 耗时当作真机证据。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sha = file => crypto.createHash('sha256').update(read(file)).digest('hex');
const { validateRoute } = require('./check-route-data.cjs');
const env = require('../miniprogram/config/env');
const files = fs.readdirSync(path.join(root, 'data/routes')).filter(f => f.endsWith('.json') && !f.endsWith('-import.json')).sort();
const formal = files.map(f => JSON.parse(read('data/routes/' + f)));
const documents = new Map(formal.map(r => [r._id, r]));
assert.equal(documents.size, formal.length);
const protectedFiles = fs.readdirSync(path.join(root, 'data/routes')).map(f => 'data/routes/' + f);
const protectedHashes = protectedFiles.map(f => [f, sha(f)]);
const calls = { native: [], location: [], cloud: [], navigation: [] }, errors = [];
const wx = {
  navigateTo(value) { calls.navigation.push(value); }, navigateBack() {}, redirectTo() {},
  openLocation(value) { calls.native.push(value); }, getLocation(value) { calls.location.push(value); },
  cloud: {
    callFunction(value) { assert.equal(value.config.env, env.cloudEnvId); calls.cloud.push(value); },
    database(config) {
      assert.equal(config.env, env.cloudEnvId);
      return { collection(name) {
        assert.equal(name, 'routes'); let filter, fields, limit;
        return { where(v) { filter = v; return this; }, field(v) { fields = v; return this; }, limit(v) { limit = v; return this; },
          async get() {
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
function page(relative = 'miniprogram/pages/route-detail/index.js') {
  let definition;
  vm.runInNewContext(read(relative), { Page(p) { definition = p; }, wx,
    console: { info() {}, error(...args) { errors.push(args.map(String)); } }, require(name) {
      if (name.includes('navigation-service')) return navigation;
      if (name.includes('route-service')) return routes;
      return require(path.resolve(root, path.dirname(relative), name));
    } });
  return { ...definition, data: plain(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function trail(p, r) {
  assert.equal(p.data.status, 'success'); assert.equal(p.data.route._id, r._id);
  assert.deepEqual(plain(p.data.mapPolylines[0].points), r.track);
  assert.deepEqual(plain(p.data.mapCenter.markers.map(m => m.id)), [0, ...r.waypoints.map(w => w.id)]);
  assert.equal(p.data.mapCenter.latitude, r.startPoint.latitude);
  assert.equal(p.data.mapCenter.longitude, r.startPoint.longitude);
  assert.equal(p.data.mapCenter.discardedTrackPointCount, 0);
  const included = new Set(p.data.mapIncludePoints.map(p => p.latitude + ',' + p.longitude));
  assert(r.track.every(p => included.has(p.latitude + ',' + p.longitude)));
}
async function begin(p, r) {
  p.onMarkerTap({ detail: { markerId: r.waypoints[0].id } });
  const pending = p.onPlanAccessTap(); assert.equal(p.data.accessRoute.status, 'locating');
  assert.equal(calls.location.at(-1).type, 'gcj02');
  const origin = { ...r.track[1] }; calls.location.at(-1).success(origin); await tick();
  assert.equal(p.data.accessRoute.status, 'planning'); const request = calls.cloud.at(-1);
  const destination = { latitude: r.waypoints[0].latitude, longitude: r.waypoints[0].longitude };
  assert.deepEqual(plain(request.data.destination), destination);
  return { pending, request, result: { success: true, distanceMeters: 123, durationSeconds: 120, points: [origin, destination] } };
}
async function run() {
  const list = page('miniprogram/pages/routes/index.js'); await list.onLoad();
  assert.equal(list.data.routes.length, formal.length);
  assert.deepEqual(list.data.routes.map(r => r._id).sort(), formal.map(r => r._id).sort());
  assert(list.data.routes.every(r => !r.track && !r.waypoints));
  const p = page(), report = [];
  for (let i = 0; i < formal.length; i++) {
    const r = formal[i], f = files[i]; validateRoute(r);
    assert.deepEqual(r, JSON.parse(read('data/routes/' + f.replace('.json', '-import.json'))));
    list.onRouteTap({ currentTarget: { dataset: { id: r._id } } });
    assert(calls.navigation.at(-1).url.endsWith('id=' + r._id));
    await p.onLoad({ id: r._id }); trail(p, r);
    for (const field of ['displayDistance', 'displayDuration', 'displayDifficulty']) {
      assert.equal(typeof p.data.route[field], 'string'); assert(!['暂无数据', '未标注', ''].includes(p.data.route[field]));
    }
    for (const w of r.waypoints) {
      p.onMarkerTap({ detail: { markerId: w.id } }); assert.equal(p.data.selectedWaypoint.name, w.name);
      assert.equal(p.data.selectedWaypoint.latitude, w.latitude);
      const pending = p.onOpenTargetTap(), target = calls.native.at(-1);
      assert.equal(target.name, w.name); assert.equal(target.latitude, w.latitude); assert.equal(target.longitude, w.longitude);
      target.success(); await pending; assert.equal(p.data.nativeNavigation.status, 'idle');
    }
    if (r.waypoints.length) {
      const active = await begin(p, r); active.request.success({ result: active.result }); await active.pending;
      assert.equal(p.data.accessRoute.status, 'success'); assert.equal(p.data.mapPolylines.length, 2); trail(p, r);
      p.onClearAccessTap(); assert.equal(p.data.mapPolylines.length, 1);
      const failure = await begin(p, r);
      failure.request.success({ result: { success: false, errorCode: 'WALKING_RANGE_EXCEEDED' } }); await failure.pending;
      assert.equal(p.data.accessRoute.status, 'error'); assert(p.data.navigationMessage.includes('最多100公里')); trail(p, r);
      const stale = await begin(p, r), next = formal[(i + 1) % formal.length];
      await p.onLoad({ id: next._id }); stale.request.success({ result: stale.result }); await stale.pending;
      trail(p, next); assert.equal(p.data.selectedWaypoint, null); assert.equal(p.data.accessRoute.status, 'idle');
      assert.equal(p.data.accessRoute.points.length, 0); assert.equal(p.data.nativeNavigation.status, 'idle');
      assert.equal(p.data.mapPolylines.length, 1);
    }
    p.onBackTap(); p.onHide(); p.onUnload();
    const again = page(); await again.onLoad({ id: r._id }); trail(again, r);
    const card = list.data.routes.find(item => item._id === r._id);
    for (const field of ['displayDistance', 'displayDuration', 'displayDifficulty']) assert.equal(again.data.route[field], card[field]);
    assert.equal(again.data.selectedWaypoint, null); assert.equal(again.data.accessRoute.status, 'idle'); again.onUnload();
    report.push({ id: r._id, name: r.name, trackPoints: r.track.length, waypoints: r.waypoints.length,
      markers: r.waypoints.length + 1, type: r.routeType, distance: again.data.route.displayDistance,
      duration: again.data.route.displayDuration, difficulty: again.data.route.displayDifficulty, result: 'LOCAL_PASS',
      jsonBytes: Buffer.byteLength(JSON.stringify(r)) });
  }
  // 本轮正式数据没有空节点时，覆盖纯内存空节点边界，不写入正式数据或云。
  const empty = { ...plain(formal[0]), waypoints: [] };
  documents.set(empty._id, empty); const q = page(); await q.onLoad({ id: empty._id }); trail(q, empty);
  const before = calls.location.length; await q.onPlanAccessTap(); assert.equal(calls.location.length, before);
  assert(q.data.navigationMessage.length > 0); q.onMarkerTap({ detail: { markerId: 1 } }); assert.equal(q.data.selectedWaypoint, null);
  q.onUnload(); documents.delete(empty._id);
  assert.equal(errors.length, 0); protectedHashes.forEach(([f, h]) => assert.equal(sha(f), h));
  const evidence = { checkedOn: '2026-10-11', status: 'LOCAL_PASS', evidenceType: 'REAL_SOURCE_WITH_MOCKED_WX_CLOUD_CALLBACKS',
    formalRoutes: report, allWaypointClicksAndNativeArguments: true, accessSuccessAndRangeFailure: true,
    cyclicSwitchAndStaleCallbackProtection: true, returnAndFreshPage: true, emptyWaypointInMemoryCase: true,
    pointToPointFormalRoutes: formal.filter(r => r.routeType === 'pointToPoint').length,
    consoleErrors: errors.length, protectedRouteFilesUnchanged: true, liveCloudCalled: false, phonePerformanceMeasured: false };
  if (process.argv.includes('--report')) fs.writeFileSync(path.join(root, 'docs/evidence/day4-multi-route-local.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
run().catch(error => { console.error(error); process.exitCode = 1; });

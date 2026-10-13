// 运行真实 Page、Navigation Service 与云函数；所有微信、数据库、高德调用均为本地模拟。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const { routeById } = require("./formal-route-fixtures.cjs");
const route = routeById("fj-route-005");
const secondRoute = routeById("fj-route-006");
const originalHash = crypto.createHash("sha256").update(read("data/routes/xiamen-loop.json")).digest("hex");
const env = require(path.join(root, "miniprogram/config/env"));
const testAppId = require(path.join(root, "project.config.json")).appid;
// 固定公开路线测试点，非用户当前位置；不修改Route，不将fixture当真实高德结果。
const fixedWaypoint = route.waypoints.find(p => p.id === 2);
const fixedRequest = {
  origin: { longitude: route.track[104].longitude, latitude: route.track[104].latitude },
  destination: { longitude: fixedWaypoint.longitude, latitude: fixedWaypoint.latitude }
};
function validCoordinate(p) {
  return !!p && typeof p.longitude === "number" && Number.isFinite(p.longitude)
    && typeof p.latitude === "number" && Number.isFinite(p.latitude)
    && Math.abs(p.longitude) <= 180 && Math.abs(p.latitude) <= 90
    && !(p.longitude === 0 && p.latitude === 0);
}
function straightLineMeters(a, b) {
  const radians = n => n * Math.PI / 180;
  const value = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude))
    * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
function client() {
  let currentRoute = route;
  const timers = [];
  const calls = { location: [], native: [], cloud: [], back: 0 };
  const wx = { navigateBack() { calls.back++; }, redirectTo() {}, getLocation(o) { calls.location.push(o); }, openLocation(o) { calls.native.push(o); },
    cloud: { callFunction(o) { assert.equal(o.config.env, env.cloudEnvId); calls.cloud.push(o); } } };
  const module = { exports: {} };
  vm.runInNewContext(read("miniprogram/services/navigation-service.js"), { module, wx, require: () => env,
    setTimeout(fn) { const timer = { fn, active: true }; timers.push(timer); return timer; }, clearTimeout(t) { t.active = false; } });
  const service = module.exports;
  let definition;
  vm.runInNewContext(read("miniprogram/pages/route-detail/index.js"), {
    wx, Page(p) { definition = p; }, console: { info() {}, error() {} }, require(p) {
      if (p.includes("navigation-service")) return service;
      if (p.includes("route-service")) return { getRouteById: async () => currentRoute };
      return require(path.join(root, "miniprogram/pages/route-detail", p));
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), updates: 0,
    setData(value) { Object.assign(this.data, value); this.updates++; } };
  const select = id => page.onMarkerTap({ detail: { markerId: id } });
  return { page, calls, service, select, setRoute(value) { currentRoute = value; }, expire() { timers.filter(t => t.active).forEach(t => { t.active = false; t.fn(); }); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function server() {
  const counters = new Map();
  const requests = [];
  const diagnostics = [];
  let context = { APPID: testAppId, OPENID: "test-user", SOURCE: "wx_client" };
  let body = { status: "1", infocode: "10000", route: { paths: [{ distance: "300", duration: "240",
    steps: [{ polyline: `${fixedRequest.origin.longitude},${fixedRequest.origin.latitude};${fixedRequest.destination.longitude},${fixedRequest.destination.latitude}` }] }] } };
  let mode = "ok";
  let queue = Promise.resolve();
  const db = {
    collection() { throw new Error("Step 3不访问或写入routes"); },
    runTransaction(fn) {
      // 串行化模拟共享事务；成功才提交，两条计数记录同时写入。
      const job = queue.then(async () => {
        const pending = new Map(counters);
        const result = await fn({ collection(name) { assert.equal(name, "navigation_limits"); return { doc(id) { return {
          async get() { return { data: pending.get(id) || null }; }, async set({ data }) { pending.set(id, data); }
        }; } }; } });
        counters.clear(); pending.forEach((v, k) => counters.set(k, v));
        return result;
      });
      queue = job.catch(() => {});
      return job;
    }
  };
  const https = { get(options, callback) {
    requests.push(options);
    const req = new EventEmitter(); req.destroy = () => {};
    setImmediate(() => {
      if (mode === "error") { req.emit("error", new Error("https://restapi.amap.com/v3/direction/walking?key=LOCAL_TEST_PLACEHOLDER&origin=118,24")); return; }
      if (mode === "timeout") return;
      const res = new EventEmitter(); res.statusCode = mode === "http" ? 500 : 200; res.resume = () => {};
      callback(res);
      res.emit("data", mode === "large" ? Buffer.alloc(1024 * 1024 + 1) : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
      res.emit("end");
    });
    return req;
  } };
  const exports = {};
  const process = { env: { AMAP_WEB_SERVICE_KEY: "LOCAL_TEST_PLACEHOLDER" } };
  let now = Date.parse("2026-10-09T15:59:00.000Z");
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  vm.runInNewContext(read("cloudfunctions/planAccessRoute/index.js"), {
    exports, process, Buffer, URLSearchParams, Date: ClockDate,
    console: { warn(...values) { diagnostics.push(values.join(" ")); } },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 8000 && mode === "timeout" ? 5 : ms), clearTimeout,
    require(p) { if (p === "wx-server-sdk") return { init() {}, DYNAMIC_CURRENT_ENV: "current", getWXContext: () => context, database: () => db };
      if (p === "node:https") return https; return require(p); }
  });
  return { main: exports.main, requests, counters, process, diagnostics, setContext(v) { context = v; },
    setBody(v) { body = v; }, setMode(v) { mode = v; }, advance(ms) { now += ms; } };
}
async function run() {
  if (!process.argv.includes("--server-only")) {
    const c = client(); await c.page.onLoad({ id: route._id }); c.select(route.waypoints[0].id);
    const selected = c.page.data.selectedWaypoint;
    const before = JSON.stringify(c.page.data.route);
    const trail = c.page.data.mapCenter;
    const trailPoints = JSON.stringify(trail.polyline[0].points);
    const native = c.page.onOpenTargetTap();
    assert.equal(c.calls.location.length, 0); assert.equal(c.calls.cloud.length, 0);
    assert.equal(c.calls.native[0].latitude, selected.latitude); assert.equal(c.calls.native[0].name, selected.name);
    c.calls.native[0].success(); await native;
    for (const patch of [{ latitude: NaN }, { longitude: Infinity }, { latitude: "24.42" },
      { latitude: 91 }, { longitude: 181 }, { latitude: 0, longitude: 0 }, { name: "过期名称" }]) {
      c.page.setData({ selectedWaypoint: { ...selected, ...patch } }); await c.page.onOpenTargetTap();
      assert.equal(c.calls.native.length, 1); assert.equal(c.calls.location.length, 0);
    }
    c.page.setData({ selectedWaypoint: selected });
    const origin = { latitude: 24.441532, longitude: 118.159944 };
    const response = { success: true, distanceMeters: 215, durationSeconds: 172,
      points: [origin, { latitude: selected.latitude, longitude: selected.longitude }] };
    const begin = async target => {
      const pending = target.page.onPlanAccessTap();
      assert.equal(target.page.data.accessRoute.status, "locating");
      assert.equal(target.calls.location.at(-1).type, "gcj02");
      target.calls.location.at(-1).success({ ...origin, accuracy: 3 }); await tick();
      assert.equal(target.page.data.accessRoute.status, "planning");
      return { pending, call: target.calls.cloud.at(-1) };
    };
    const assertTrail = target => {
      assert.equal(target.page.data.status, "success");
      assert.equal(target.page.data.mapCenter.polyline[0].points.length, target.page.data.route.track.length);
      assert.equal(JSON.stringify(target.page.data.mapPolylines[0].points), JSON.stringify(target.page.data.route.track));
    };
    // 1 正常规划：同一map中独立两条线；只发送origin/destination。
    const plan = await begin(c);
    const calls = c.calls.cloud.length; await c.page.onPlanAccessTap(); assert.equal(c.calls.cloud.length, calls);
    assert.equal(Object.keys(plan.call.data).sort().join(','), 'destination,origin');
    assert.equal(JSON.stringify(plan.call.data.destination), JSON.stringify({ latitude: selected.latitude, longitude: selected.longitude }));
    plan.call.success({ result: response }); await plan.pending;
    assert.equal(c.page.data.accessRoute.status, "success"); assert.equal(c.page.data.mapPolylines.length, 2);
    assert.equal(c.page.data.mapPolylines[1].color, "#2F80ED"); assert.equal(c.page.data.mapIncludePoints.length, 1005);
    assert.equal(c.page.data.accessSummary.distance, "215 m"); assert.equal(c.page.data.accessSummary.minutes, 3);
    assert.equal(JSON.stringify(c.page.data.route), before); assert.equal(c.page.data.mapCenter, trail); assertTrail(c);
    // 重新规划先清旧Access，然后替换而不是追加。
    const replacement = await begin(c); assert.equal(c.page.data.mapPolylines.length, 1);
    replacement.call.success({ result: { ...response, distanceMeters: 1200, durationSeconds: 601 } }); await replacement.pending;
    assert.equal(c.page.data.mapPolylines.length, 2); assert.equal(c.page.data.accessSummary.distance, "1.2 km");
    assert.equal(c.page.data.accessSummary.minutes, 11);
    // 2 换节点立即清接驳，稳定ID仍对应当前Route。
    c.select(route.waypoints[1].id); assert.equal(c.page.data.accessRoute.status, "idle");
    assert.equal(c.page.data.accessRoute.origin, null); assert.equal(c.page.data.mapPolylines.length, 1); assertTrail(c);
    c.select(selected.id); const clearPlan = await begin(c); clearPlan.call.success({ result: response }); await clearPlan.pending;
    // 3 手动清除，保留选择、Trail和唯一Marker数组。
    const markers = c.page.data.mapCenter.markers; c.page.onClearAccessTap();
    assert.equal(c.page.data.selectedWaypoint.id, selected.id); assert.equal(c.page.data.mapCenter.markers, markers);
    assert.equal(c.page.data.mapPolylines.length, 1); assert.equal(c.page.data.accessRoute.points.length, 0); assertTrail(c);
    // 4 服务端失败/无路线/无效点数不残留旧线或替换Trail。
    for (const result of [{ success: false, errorCode: "UPSTREAM_ERROR", message: "受控失败" },
      { success: false, errorCode: "WALKING_RANGE_EXCEEDED", message: "上游自由文本不用于展示" },
      { success: false, errorCode: "ROUTE_UNAVAILABLE", message: "无路线" },
      { ...response, points: [] }, { ...response, points: [origin] },
      { ...response, points: [origin, { latitude: NaN, longitude: 118 }] }]) {
      const bad = await begin(c); bad.call.success({ result }); await bad.pending;
      assert.equal(c.page.data.accessRoute.status, "error"); assert.equal(c.page.data.accessRoute.origin, null);
      assert.equal(c.page.data.accessRoute.points.length, 0); assert.equal(c.page.data.mapPolylines.length, 1); assertTrail(c);
      if (result.errorCode === "WALKING_RANGE_EXCEEDED") {
        assert.equal(c.page.data.accessRoute.errorCode, "WALKING_RANGE_EXCEEDED");
        assert(c.page.data.navigationMessage.includes("最多100公里"));
        assert(c.page.data.navigationMessage.includes("打开目标位置"));
        assert(!c.page.data.navigationMessage.includes(result.message));
      }
    }
    // 5 定位拒绝/失败/超时：不发云请求，原详情仍可用。
    for (const [message, status] of [["getLocation:fail auth deny", "permissionDenied"],
      ["getLocation:fail unavailable", "error"], ["getLocation:fail timeout", "error"]]) {
      const count = c.calls.cloud.length; const pending = c.page.onPlanAccessTap();
      c.calls.location.at(-1).fail({ errMsg: message }); await pending;
      assert.equal(c.calls.cloud.length, count); assert.equal(c.page.data.accessRoute.status, status); assertTrail(c);
    }
    const retry = await begin(c); retry.call.success({ result: response }); await retry.pending;
    assert.equal(c.page.data.accessRoute.status, "success", "失败后可再次规划");
    // 6 返回列表清状态，7 新Page再进入Route没有旧Access。
    c.page.onBackTap(); assert.equal(c.calls.back, 1); c.page.onHide(); c.page.onUnload();
    assert.equal(c.page.data.accessRoute.origin, null); assert.equal(c.page.data.accessRoute.points.length, 0);
    const reopened = client(); await reopened.page.onLoad({ id: route._id });
    assert.equal(reopened.page.data.accessRoute.status, "idle"); assert.equal(reopened.page.data.mapPolylines.length, 1);
    assert.equal(reopened.page.data.selectedWaypoint, null); assert.equal(reopened.calls.location.length, 0); assertTrail(reopened);
    // 定位中换目标：迟到位置不发云；规划中换目标/换Route/隐藏/退出/清除：迟到响应不回写。
    const locating = client(); await locating.page.onLoad({ id: route._id }); locating.select(selected.id);
    const loc = locating.page.onPlanAccessTap(); locating.select(route.waypoints[1].id);
    locating.calls.location[0].success(origin); await loc; assert.equal(locating.calls.cloud.length, 0);
    for (const phase of ["target", "route", "hide", "unload", "clear"]) {
      const n = client(); await n.page.onLoad({ id: route._id }); n.select(selected.id); const pending = await begin(n);
      if (phase === "target") n.select(route.waypoints[1].id);
      else if (phase === "route") { n.setRoute(secondRoute); await n.page.onLoad({ id: secondRoute._id }); }
      else if (phase === "hide") n.page.onHide();
      else if (phase === "unload") n.page.onUnload();
      else n.page.onClearAccessTap();
      const updates = n.page.updates; pending.call.success({ result: response }); await pending.pending;
      assert.equal(n.page.updates, updates); assert.equal(n.page.data.accessRoute.origin, null);
    }
    const race = client(); await race.page.onLoad({ id: route._id }); race.select(selected.id);
    const old = await begin(race); race.select(route.waypoints[1].id); const fresh = await begin(race);
    old.call.fail({}); await old.pending; assert.equal(race.page.data.accessRoute.status, "planning");
    fresh.call.success({ result: response }); await fresh.pending;
    assert.equal(race.page.data.accessRoute.waypointId, route.waypoints[1].id);
    race.page.onMapError({ detail: {} }); assert.equal(race.page.data.mapRenderError, false);
    assert.equal(race.page.data.mapPolylines.length, 1); assertTrail(race);
    race.page.onMapError({ detail: {} }); assert.equal(race.page.data.mapRenderError, true);
    const cloudTimeout = client(); await cloudTimeout.page.onLoad({ id: route._id }); cloudTimeout.select(selected.id);
    const wait = await begin(cloudTimeout); cloudTimeout.expire(); await wait.pending;
    assert.equal(cloudTimeout.page.data.accessRoute.errorCode, "CLOUD_CALL_FAILED"); assertTrail(cloudTimeout);
    const template = read("miniprogram/pages/route-detail/index.wxml");
    assert(template.includes('polyline="{{mapPolylines}}"')); assert(template.includes('bindtap="onClearAccessTap"'));
    assert(template.includes('预计步行：{{accessSummary.minutes}} min'));
    assert(template.includes("accessRoute.errorCode === 'WALKING_RANGE_EXCEEDED'"));
    assert(template.indexOf('class="navigation-feedback"') < template.indexOf('class="waypoint-card-actions"'));
    assert(template.includes('>打开目标位置</button>'));
    // Navigation State Hardening：16项独立边界，所有断言使用真实Page/service代码。
    const hardening = [];
    const target = async () => { const n = client(); await n.page.onLoad({ id: route._id }); n.select(selected.id); return n; };
    const record = (id, name) => hardening.push({ id, name, result: "LOCAL_PASS" });
    const n1 = client(); await n1.page.onLoad({ id: route._id }); await n1.page.onPlanAccessTap();
    assert.equal(n1.calls.location.length, 0); assert.equal(n1.calls.cloud.length, 0);
    assert(n1.page.data.navigationMessage.includes("请先选择")); assertTrail(n1);
    assert(template.includes('wx:if="{{navigationMessage && !selectedWaypoint}}"'), "无卡片时也必须显示目标错误提示");
    record(1, "未选节点");
    for (const point of [{ latitude: NaN }, { longitude: Infinity }, { latitude: "24" },
      { latitude: 91 }, { longitude: 181 }, { latitude: 0, longitude: 0 }]) {
      const n2 = await target(); n2.page.setData({ selectedWaypoint: { ...n2.page.data.selectedWaypoint, ...point } });
      await n2.page.onPlanAccessTap(); assert.equal(n2.calls.location.length, 0);
      assert.equal(n2.calls.cloud.length, 0); assert(n2.page.data.navigationMessage); assertTrail(n2);
    }
    record(2, "节点坐标非法");
    const n3 = await target(); const three = n3.page.onPlanAccessTap();
    await n3.page.onPlanAccessTap(); await n3.page.onPlanAccessTap(); assert.equal(n3.calls.location.length, 1);
    n3.calls.location[0].fail({ errMsg: "fail" }); await three; assertTrail(n3); record(3, "定位中重复点击");
    const n4 = await target(); const four = await begin(n4);
    await n4.page.onPlanAccessTap(); await n4.page.onPlanAccessTap();
    assert.equal(n4.calls.cloud.length, 1); assert.equal(n4.calls.location.length, 1);
    four.call.success({ result: response }); await four.pending; assert.equal(n4.page.data.mapPolylines.length, 2);
    record(4, "云请求中重复点击");
    for (const [id, message, status] of [[5, "location unavailable", "error"], [6, "getLocation:fail auth deny", "permissionDenied"]]) {
      const n = await target(); const pending = n.page.onPlanAccessTap(); n.calls.location[0].fail({ errMsg: message }); await pending;
      assert.equal(n.page.data.accessRoute.status, status); assert.equal(n.calls.cloud.length, 0);
      assert(n.page.data.navigationMessage); assertTrail(n); record(id, id === 5 ? "定位失败" : "拒绝授权");
    }
    for (const [id, result] of [[7, null], [8, { success: false, errorCode: "ROUTE_UNAVAILABLE" }],
      [9, { success: false, errorCode: "RATE_LIMITED" }], [10, { ...response, points: [] }],
      [11, { ...response, points: [origin] }]]) {
      const n = await target(); const pending = await begin(n);
      if (result === null) pending.call.fail({ errMsg: "cloud network unavailable" }); else pending.call.success({ result });
      await pending.pending; assert.equal(n.page.data.accessRoute.status, "error");
      assert.equal(n.page.data.accessRoute.points.length, 0); assert.equal(n.page.data.accessRoute.origin, null);
      assert.equal(n.page.data.mapPolylines.length, 1); assert(n.page.data.navigationMessage); assertTrail(n);
      record(id, ["", "", "", "", "", "", "", "服务端网络失败", "无路线", "限流", "空points", "单点points"][id]);
    }
    const n12 = await target(); const a = await begin(n12); n12.select(route.waypoints[1].id);
    const b = await begin(n12); n12.select(route.waypoints[2].id); const latest = await begin(n12);
    b.call.success({ result: response }); await b.pending; a.call.fail({}); await a.pending;
    assert.equal(n12.page.data.accessRoute.status, "planning"); assert.equal(n12.page.data.mapPolylines.length, 1);
    latest.call.success({ result: response }); await latest.pending;
    assert.equal(n12.page.data.accessRoute.waypointId, route.waypoints[2].id); assert.equal(n12.page.data.mapPolylines.length, 2);
    assertTrail(n12); record(12, "快速切换与乱序响应");
    n12.page.onClearAccessTap(); const replanned = await begin(n12); replanned.call.success({ result: response }); await replanned.pending;
    assert.equal(n12.page.data.mapPolylines.length, 2); assertTrail(n12); record(13, "清除后重新规划");
    n12.setRoute(secondRoute); await n12.page.onLoad({ id: secondRoute._id });
    assert.equal(n12.page.data.accessRoute.status, "idle"); assert.equal(n12.page.data.selectedWaypoint, null);
    assert.equal(n12.page.data.mapPolylines.length, 1); assertTrail(n12); record(14, "Route切换");
    const n15 = await target(); const pending15 = await begin(n15);
    n15.page.onBackTap(); n15.page.onHide(); n15.page.onUnload(); const updates15 = n15.page.updates;
    pending15.call.fail({}); await pending15.pending; assert.equal(n15.page.updates, updates15);
    assert.equal(n15.page.data.accessRoute.origin, null); assert.equal(n15.page.data.accessRoute.points.length, 0);
    record(15, "页面返回后旧失败");
    const n16 = client(); await n16.page.onLoad({ id: route._id }); assertTrail(n16);
    assert.equal(n16.page.data.accessRoute.status, "idle"); assert.equal(n16.page.data.selectedWaypoint, null);
    assert.equal(n16.calls.location.length, 0); assert.equal(n16.calls.cloud.length, 0); record(16, "再次进入同一Route");
    assert.equal(hardening.length, 16);
    // 高德限流本身走UPSTREAM_ERROR受控分支；与本地RATE_LIMITED两种情况均不会重试或留旧线。
    const throttled = server(); throttled.setBody({ status: "0", infocode: "10003", info: "DAILY_QUERY_OVER_LIMIT" });
    const throttledResult = await throttled.main(fixedRequest);
    assert.equal(throttledResult.success, false); assert.equal(throttledResult.errorCode, "UPSTREAM_ERROR");
    const n9 = await target(); const pending9 = await begin(n9); pending9.call.success({ result: throttledResult }); await pending9.pending;
    assert.equal(n9.page.data.accessRoute.status, "error"); assert.equal(n9.calls.cloud.length, 1);
    assert.equal(n9.page.data.mapPolylines.length, 1); assertTrail(n9); assert(n9.page.data.navigationMessage);
    console.log("Navigation Hardening 16项：", JSON.stringify(hardening));
    console.log("PASS: Step 4 Page本地模拟七项流程、重复/重规划、迟到成功与错误、Route切换、超时、Access渲染降级，1003点Trail与Marker保持。");
  }
  // Step 3薄客户端边界仅接受两组坐标，剥离名称/Route身份；尚未接Page流程。
  const api = client();
  const origin = { ...fixedRequest.origin, accuracy: 7 };
  const destination = { ...fixedRequest.destination, name: fixedWaypoint.name, id: fixedWaypoint.id };
  const call = api.service.planAccessRoute(origin, destination);
  assert.deepEqual(JSON.parse(JSON.stringify(api.calls.cloud[0].data)), fixedRequest);
  api.calls.cloud[0].success({ result: { success: true, distanceMeters: 10, durationSeconds: 20,
    points: [fixedRequest.origin, fixedRequest.destination], raw: "must not escape" } });
  const business = await call; assert.equal(business.success, true); assert.equal(business.raw, undefined);
  const failed = api.service.planAccessRoute(origin, destination);
  api.calls.cloud[1].success({ result: { success: false, errorCode: "RATE_LIMITED", message: "untrusted text" } });
  await assert.rejects(failed, error => error.code === "RATE_LIMITED");
  await assert.rejects(api.service.planAccessRoute({ latitude: "24", longitude: 118 }, destination), error => error.code === "INVALID_COORDINATES");
  const malformed = api.service.planAccessRoute(origin, destination);
  api.calls.cloud[2].success({ result: { success: true, distanceMeters: "10", durationSeconds: 20, points: [] } });
  await assert.rejects(malformed, error => error.code === "INVALID_RESPONSE");
  const s = server();
  const request = fixedRequest;
  assert(validCoordinate(request.origin)); assert(validCoordinate(request.destination));
  assert.equal(fixedWaypoint.name, "黄厝");
  const success = await s.main(request); assert.equal(success.success, true);
  assert.equal(success.durationSeconds, 240); assert.equal(typeof success.durationSeconds, "number");
  assert.equal(success.distanceMeters, 300); assert.equal(typeof success.distanceMeters, "number");
  const directMeters = straightLineMeters(request.origin, request.destination);
  // 仅为异常量级筛查，不是通行或真实路网证明；路网吸附/绕行会影响距离。
  assert(success.distanceMeters >= Math.max(0, directMeters - 100));
  assert(success.distanceMeters <= Math.max(3000, directMeters * 10));
  assert(success.points.length >= 2); assert(success.points.every(validCoordinate));
  assert.deepEqual(Object.keys(success).sort(), ["distanceMeters", "durationSeconds", "points", "success"]);
  assert.equal(s.requests[0].hostname, "restapi.amap.com");
  const params = new URLSearchParams(s.requests[0].path.split("?")[1]);
  assert.equal(params.get("origin"), "118.159944,24.441532");
  assert.equal(params.get("destination"), "118.161404,24.442980");
  assert(!JSON.stringify(success).includes("LOCAL_TEST_PLACEHOLDER"));
  assert(success.points.every(p => Object.keys(p).sort().join(",") === "latitude,longitude"));
  // 微信小程序云调用可注入event.userInfo；它是传输元数据，不是业务字段，也不作为鉴权来源。
  const platformEvent = await s.main({ ...request, userInfo: { openId: "PLATFORM_TEST_ONLY", appId: "PLATFORM_TEST_ONLY" } });
  assert.equal(platformEvent.success, true, "合法坐标加平台userInfo不能被误判为INVALID_COORDINATES");
  const tcbEvent = await s.main({ ...request, tcbContext: { arbitrary: "PLATFORM_TEST_ONLY" } });
  assert.equal(tcbEvent.success, true, "真机附加tcbContext应被忽略而非拒绝");
  assert.deepEqual(Object.keys(tcbEvent).sort(), ["distanceMeters", "durationSeconds", "points", "success"]);
  assert(!JSON.stringify(tcbEvent).includes("PLATFORM_TEST_ONLY"));
  assert.equal((await s.main({ ...request, userInfo: {}, tcbContext: {} })).success, true);
  s.setContext({ OPENID: "", APPID: testAppId, SOURCE: "wx_client" });
  assert.equal((await s.main({ ...request, userInfo: { openId: "FORGED_TEST_ONLY", appId: testAppId } })).errorCode,
    "AUTH_REQUIRED", "event.userInfo不能替代受信getWXContext身份");
  assert.equal((await s.main({ ...request, tcbContext: { OPENID: "FORGED_TEST_ONLY", APPID: testAppId, SOURCE: "wx_client" } })).errorCode,
    "AUTH_REQUIRED", "tcbContext不能伪造受信身份");
  s.setContext({ OPENID: "test-user", APPID: testAppId, SOURCE: "wx_client" });
  const invalidBefore = s.requests.length;
  for (const invalid of [null, {}, { ...request, routeId: "extra" }, { ...request, key: "never accepted" },
    { ...request, origin: { latitude: 0, longitude: 0 } }, { ...request, destination: { latitude: 91, longitude: 118 } },
    { ...request, destination: { latitude: 24, longitude: "118" } }, { ...request, destination: { latitude: NaN, longitude: 118 } },
    { ...request, origin: { latitude: 24, longitude: Infinity } }, { ...request, destination: { ...request.destination, name: "extra" } },
    { ...request, userInfo: { openId: "PLATFORM_TEST_ONLY" }, destination: { latitude: 91, longitude: 118 } },
    { ...request, tcbContext: {}, origin: { latitude: 0, longitude: 0 } },
    { ...request, tcbContext: {}, destination: { ...request.destination, key: "never accepted" } },
    { ...request, userInfo: { openId: "PLATFORM_TEST_ONLY" }, destination: { ...request.destination, key: "never accepted" } }]) {
    const result = await s.main(invalid); assert.equal(result.errorCode, "INVALID_COORDINATES");
    assert.equal(result.success, false); assert.equal(typeof result.message, "string");
  }
  assert.equal(s.requests.length, invalidBefore, "非法坐标不调用上游");
  for (const [data, reason] of [[null, "EVENT_SHAPE"], [{ ...request, extra: true }, "TOP_FIELDS"],
    [{ ...request, origin: { latitude: 0, longitude: 0 } }, "ORIGIN_VALUES"],
    [{ ...request, destination: { latitude: 91, longitude: 118 } }, "DESTINATION_VALUES"],
    [{ ...request, origin: { ...request.origin, key: "SENSITIVE_TEST_ONLY" } }, "ORIGIN_FIELDS"],
    [{ ...request, destination: { ...request.destination, key: "SENSITIVE_TEST_ONLY" } }, "DESTINATION_FIELDS"]]) {
    const response = await s.main(data);
    const expected = `起点或目标坐标无效。 [NAV_INPUT_20261009_B:${reason}]`;
    assert.equal(response.message, expected + (reason === "TOP_FIELDS" ? " [NAV_TOP_KEYS_20261009_C:extra]" : ""));
    assert(!JSON.stringify(response).includes("SENSITIVE_TEST_ONLY"));
    assert.deepEqual(Object.keys(response).sort(), ["errorCode", "message", "success"]);
  }
  const extraMetadata = await s.main({ ...request, platformMetadata: { key: "SENSITIVE_TEST_ONLY", longitude: 123 } });
  assert(extraMetadata.message.endsWith("[NAV_TOP_KEYS_20261009_C:platformMetadata]"));
  assert(!JSON.stringify(extraMetadata).includes("SENSITIVE_TEST_ONLY"));
  assert(!JSON.stringify(extraMetadata).includes("123"));
  const redactedField = await s.main({ ...request, ["a".repeat(32)]: "SENSITIVE_TEST_ONLY" });
  assert(redactedField.message.endsWith("[NAV_TOP_KEYS_20261009_C:REDACTED]"));
  s.setContext({ OPENID: "x", APPID: "wrong", SOURCE: "wx_client" }); assert.equal((await s.main(request)).errorCode, "AUTH_REQUIRED");
  s.setContext({ OPENID: "x", APPID: testAppId, SOURCE: "wx_http" }); assert.equal((await s.main(request)).errorCode, "AUTH_REQUIRED");
  s.setContext({ OPENID: "test-user", APPID: testAppId, SOURCE: "wx_client" });
  delete s.process.env.AMAP_WEB_SERVICE_KEY; assert.equal((await s.main(request)).errorCode, "SERVER_CONFIG_ERROR");
  s.process.env.AMAP_WEB_SERVICE_KEY = "LOCAL_TEST_PLACEHOLDER";
  const navPoints = route.track.slice(104, 107), pair = p => p.longitude+','+p.latitude;
  const validBody = { status:'1', infocode:'10000', route:{paths:[{distance:'10', duration:'20', steps:[{polyline:navPoints.slice(0,2).map(pair).join(';')}]}]} };
  const multipleSteps = {...validBody,route:{paths:[{distance:'10',duration:'20',steps:[
    {polyline:[navPoints[0],navPoints[0],navPoints[1]].map(pair).join(';')},
    {polyline:[navPoints[1],navPoints[2],navPoints[0]].map(pair).join(';')}
  ]}]}};
  s.setBody(multipleSteps); const merged = await s.main(request); assert.equal(merged.success,true);
  assert.equal(JSON.stringify(merged.points),JSON.stringify([navPoints[0],navPoints[1],navPoints[2],navPoints[0]]),'只去相邻重复，保留原真实点序');
  assert.equal(Object.keys(merged.points[0]).length, 2);
  for (const [body, code] of [["broken", "INVALID_RESPONSE"], [{ status: "0", infocode: "10001", key: "LOCAL_TEST_PLACEHOLDER" }, "UPSTREAM_ERROR"],
    [{ status: "0", infocode: "20803", info: "OVER_DIRECTION_RANGE" }, "WALKING_RANGE_EXCEEDED"],
    [{ status: "1", infocode: "10000", route: { paths: [] } }, "ROUTE_UNAVAILABLE"],
    [{ ...validBody, route: { paths: [{ distance: "10", duration: "20", steps: [{ polyline: pair(navPoints[0])+";broken;"+pair(navPoints[1]) }] }] } }, "INVALID_RESPONSE"],
    [{ ...validBody, route: { paths: [{ distance: "", duration: "20", steps: [{ polyline: navPoints.slice(0,2).map(pair).join(";") }] }] } }, "INVALID_RESPONSE"],
    [{ ...validBody, route: { paths: [{ distance: "10", duration: "20", steps: [{ polyline: [navPoints[0],navPoints[0]].map(pair).join(";") }] }] } }, "ROUTE_UNAVAILABLE"],
    [{ ...validBody, route: { paths: [{ distance: "10", duration: "20", steps: [{ polyline: Array.from({ length: 5001 }, (_, i) => pair(route.track[i % route.track.length])).join(";") }] }] } }, "ROUTE_TOO_LARGE"]]) {
    s.advance(60000); s.setBody(body); const beforeLogs = s.diagnostics.length;
    const result = await s.main(request); assert.equal(result.errorCode, code);
    if (code === "WALKING_RANGE_EXCEEDED") assert.equal(s.diagnostics.length, beforeLogs, "距离限制不再作为未知上游故障打印诊断");
    assert.deepEqual(Object.keys(result).sort(), ["errorCode", "message", "success"]);
    assert(!JSON.stringify(result).includes("LOCAL_TEST_PLACEHOLDER"));
  }
  s.setBody(validBody);
  for (const [mode, code] of [["large", "ROUTE_TOO_LARGE"], ["timeout", "UPSTREAM_TIMEOUT"], ["http", "UPSTREAM_ERROR"], ["error", "UPSTREAM_ERROR"]]) {
    s.advance(60000); s.setMode(mode); const result = await s.main(request); assert.equal(result.errorCode, code);
    assert.deepEqual(Object.keys(result).sort(), ["errorCode", "message", "success"]);
    assert(!JSON.stringify(result).includes("LOCAL_TEST_PLACEHOLDER"));
    assert(!JSON.stringify(result).includes("restapi.amap.com"));
  }
  const failedQuota = server(); failedQuota.setMode("error");
  for (let i=0;i<10;i++) assert.equal((await failedQuota.main(request)).errorCode,"UPSTREAM_ERROR");
  assert.equal((await failedQuota.main(request)).errorCode,"RATE_LIMITED","上游失败也计数");
  assert.equal(failedQuota.requests.length,10);
  const limits = server();
  const concurrent = await Promise.all(Array.from({ length: 11 }, () => limits.main(request)));
  assert.equal(concurrent.filter(r => r.success).length, 10); assert.equal(limits.requests.length, 10);
  assert.equal(concurrent.at(-1).errorCode, "RATE_LIMITED");
  const daily = server(); daily.advance(3600000);
  for (let i = 0; i < 6; i++) { daily.advance(60000); for (let j = 0; j < 10; j++) assert.equal((await daily.main(request)).success, true); }
  daily.advance(60000); assert.equal((await daily.main(request)).errorCode, "RATE_LIMITED");
  daily.advance(24 * 3600000); assert.equal((await daily.main(request)).success, true);
  assert(!JSON.stringify([...daily.counters.values()]).includes("latitude"));
  const globalLimit = server(); globalLimit.advance(3600000);
  for (let i = 0; i < 20; i++) {
    globalLimit.setContext({ OPENID: 'user-'+i, APPID: testAppId, SOURCE: "wx_client" });
    for (let j = 0; j < 10; j++) assert.equal((await globalLimit.main(request)).success, true);
  }
  globalLimit.setContext({ OPENID: "user-last", APPID: testAppId, SOURCE: "wx_client" });
  assert.equal((await globalLimit.main(request)).errorCode, "RATE_LIMITED"); assert.equal(globalLimit.requests.length, 200);
  assert.equal(originalHash, "06f5a5b111b011d0bb1c5966f3bcf5881f285a185103c8c69f005f12a6141fce");
  assert.equal(crypto.createHash("sha256").update(read("data/routes/xiamen-loop.json")).digest("hex"), originalHash);
  const source = read("cloudfunctions/planAccessRoute/index.js");
  assert(!/console\.(log|info|error)\s*\(/.test(source), "不得打印请求/Key/异常正文");
  assert.equal((source.match(/console\.warn\s*\(/g) || []).length, 1, "仅保留一个安全诊断日志入口");
  const diagnosticCheck = server();
  diagnosticCheck.setBody({ status: "0", infocode: "10001", info: "SENSITIVE_TEST_ONLY", key: "LOCAL_TEST_PLACEHOLDER", origin: "118.159944,24.441532" });
  assert.equal((await diagnosticCheck.main(request)).errorCode, "UPSTREAM_ERROR");
  const log = JSON.parse(diagnosticCheck.diagnostics.at(-1).split("] ")[1]);
  assert.deepEqual(log, { errorCode: "UPSTREAM_ERROR", stage: "AMAP_STATUS", httpStatus: null, amapStatus: "0", amapInfocode: "10001", networkCode: null });
  diagnosticCheck.advance(60000);
  diagnosticCheck.setBody({ status: "SENSITIVE_TEST_ONLY", infocode: "10001?key=LOCAL_TEST_PLACEHOLDER" });
  await diagnosticCheck.main(request);
  const scrubbed = JSON.parse(diagnosticCheck.diagnostics.at(-1).split("] ")[1]);
  assert.equal(scrubbed.amapStatus, null); assert.equal(scrubbed.amapInfocode, null);
  const diagnosticCases = [];
  for (const mode of ["http", "error", "timeout"]) {
    diagnosticCheck.advance(60000); diagnosticCheck.setMode(mode); await diagnosticCheck.main(request);
    diagnosticCases.push(JSON.parse(diagnosticCheck.diagnostics.at(-1).split("] ")[1]));
  }
  assert.equal(diagnosticCases[0].stage, "HTTP_STATUS"); assert.equal(diagnosticCases[0].httpStatus, 500);
  assert.equal(diagnosticCases[1].stage, "REQUEST_ERROR"); assert.equal(diagnosticCases[2].stage, "TIMEOUT");
  const logs = [...s.diagnostics, ...failedQuota.diagnostics, ...diagnosticCheck.diagnostics].join("\n");
  for (const secret of ["LOCAL_TEST_PLACEHOLDER", "SENSITIVE_TEST_ONLY", "restapi.amap.com", "118.159944", "test-user"]) assert(!logs.includes(secret), "安全日志泄漏");
  for (const file of ["miniprogram/config/env.js", "miniprogram/services/navigation-service.js", "miniprogram/services/route-service.js"]) {
    assert(!/AMAP_WEB_SERVICE_KEY|restapi\.amap\.com/.test(read(file)), "客户端不含Secret变量或高德直连");
  }
  // 不打印fixture距离/时长作为真实结果，只输出测试来源及检查状态。
  console.log(JSON.stringify({ verification: "LOCAL_MOCK_ONLY", routeId: route._id,
    originTrackIndex: 104, request: fixedRequest, waypointId: fixedWaypoint.id, waypointName: fixedWaypoint.name,
    straightLineMeters: Math.round(directMeters), successChecked: true, distanceMagnitudeChecked: true,
    durationIsNumberChecked: true, pointCountChecked: true, allCoordinatesChecked: true,
    placeholderSecretNotReturned: true, exactResponseFieldsChecked: true,
    upstreamErrorShapeChecked: true, invalidCoordinatesRejected: true,
    liveCloudCalled: false, liveDistanceMeters: null, liveDurationSeconds: null }));
  if (process.argv.includes("--server-only")) {
    console.log("PASS: 仅服务端与薄service边界本地模拟；未执行Page测试、未访问真实云或高德。");
    return;
  }
  console.log("PASS: Navigation真实代码本地模拟：Step 1独立；Step 4单次GCJ-02→云规划→独立Access/同map叠加与错误清理；Step 3薄service双坐标请求/最小返回与服务端身份/坐标/跨step相邻去重/解析/超时/大小/并发限频/用户日限额/全函数限额/上海日桶。未访问真实云、高德或真机。");
}
run().catch(error => { console.error(error); process.exitCode = 1; });

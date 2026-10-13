// 运行真实 service / Page 代码，但模拟 wx.cloud；不访问或写入 CloudBase。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const env = require(path.join(root, "miniprogram/config/env.js")).cloudEnvId;
const { routeById } = require("./formal-route-fixtures.cjs");
const seed = routeById("fj-route-005");

function harness() {
  const routes = [seed, routeById("fj-route-006")];
  const queries = [];
  const logs = [];
  let navigate;
  let fallback;
  let failBack = false;
  let handler = async query => ({ data: query.filter ? routes.filter(r => r._id === query.filter._id) : routes });
  const wx = {
    cloud: {
      database(options) {
        assert.equal(options.env, env);
        return {
          collection(name) {
            assert.equal(name, "routes");
            const query = {};
            return {
              where(value) { query.filter = value; return this; },
              field(value) { query.fields = value; return this; },
              limit(value) { query.limit = value; return this; },
              get() { queries.push(query); return handler(query); }
            };
          }
        };
      }
    },
    navigateTo(options) { navigate = options.url; },
    navigateBack(options) { assert.equal(options.delta, 1); if (failBack) options.fail(); },
    redirectTo(options) { fallback = options.url; }
  };
  const serviceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "miniprogram/services/route-service.js"), "utf8"), {
    wx, module: serviceModule, require() { return { cloudEnvId: env }; }
  });
  function page(pageName) {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(root, `miniprogram/pages/${pageName}/index.js`), "utf8"), {
      wx, Page(value) { definition = value; },
      console: {
        info(...args) { logs.push({ level: "info", args }); },
        error(...args) { logs.push({ level: "error", args }); }
      },
      require(name) {
        if (name === "../../services/route-service") return serviceModule.exports;
        if (name === "../../utils/format") return require(path.join(root, "miniprogram/utils/format.js"));
        if (name === "../../utils/map-data") return require(path.join(root, "miniprogram/utils/map-data.js"));
        if (name === "../../utils/trail-progress") return require(path.join(root, "miniprogram/utils/trail-progress.js"));
        if (name === "../../services/navigation-service") return require(path.join(root, "miniprogram/services/navigation-service.js"));
        if (name === "../../services/trail-follow-service") return require(path.join(root, "miniprogram/services/trail-follow-service.js"));
        throw new Error(`页面出现未允许的依赖（包括 Mock）：${name}`);
      }
    });
    return Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data)), updates: 0,
      setData(value, callback) { Object.assign(this.data, value); this.updates += 1; if (callback) callback(); }
    });
  }
  return {
    page, queries, logs, wx, service: serviceModule.exports,
    respond(next) { handler = next; },
    failBack() { failBack = true; },
    get navigate() { return navigate; },
    get fallback() { return fallback; }
  };
}

async function run() {
  const h = harness();
  const list = h.page("routes");
  await list.onLoad();
  list.onRouteTap({ currentTarget: { dataset: { id: list.data.routes[1]._id } } });
  const id = new URL(h.navigate, "https://test.invalid").searchParams.get("id");
  const detail = h.page("route-detail");
  await detail.onLoad({ id });
  assert.equal(detail.data.status, "success");
  assert.equal(detail.data.route._id, "fj-route-006");
  assert.equal(detail.data.route.summary, routeById("fj-route-006").summary);
  assert.equal(detail.data.route.displayElevationGain, require("../miniprogram/utils/format").formatElevationGain(routeById("fj-route-006").elevationGainMeters));
  assert.equal(detail.data.route.source.infoSource, routeById("fj-route-006").source.infoSource);
  const q = h.queries.at(-1);
  assert.deepEqual(Object.keys(q.filter), ["_id"]);
  assert.equal(q.filter._id, id);
  assert.equal(q.limit, 1);
  assert.equal(q.fields, undefined, "详情必须读取完整 Route");
  assert.equal(h.logs.filter(log => log.level === "error").length, 0);

  const xiamen = JSON.parse(fs.readFileSync(path.join(root, "data/routes/xiamen-loop.json"), "utf8"));
  // Day 3 完整正常流程：列表实际传 ID，详情完整读取后选中末尾节点。
  const fullFlow = harness();
  fullFlow.respond(async () => ({ data: [xiamen] }));
  const flowList = fullFlow.page("routes");
  await flowList.onLoad();
  assert.equal(flowList.data.status, "success");
  flowList.onRouteTap({ currentTarget: { dataset: { id: flowList.data.routes[0]._id } } });
  const flowId = new URL(fullFlow.navigate, "https://test.invalid").searchParams.get("id");
  assert.equal(flowId, xiamen._id);
  const flowDetail = fullFlow.page("route-detail");
  await flowDetail.onLoad({ id: flowId });
  assert.equal(flowDetail.data.status, "success");
  assert.equal(flowDetail.data.mapCenter.markers[0].id, 0);
  assert.equal(flowDetail.data.mapCenter.polyline[0].points.length, 1003);
  assert.deepEqual(flowDetail.data.mapCenter.polyline[0].points, xiamen.track);
  assert.deepEqual(flowDetail.data.mapCenter.markers.slice(1).map(p => p.id), xiamen.waypoints.map(p => p.id));
  const flowNode = xiamen.waypoints.at(-1);
  flowDetail.onMarkerTap({ detail: { markerId: flowNode.id } });
  assert.equal(flowDetail.data.selectedWaypoint.name, flowNode.name);
  assert.equal(flowDetail.data.selectedWaypoint.description, flowNode.description);
  assert.equal(flowDetail.data.selectedWaypoint.order, xiamen.waypoints.length);
  assert.equal(fullFlow.logs.filter(log => log.level === "error").length, 0);
  const mapHarness = harness();
  mapHarness.respond(async () => ({ data: [xiamen] }));
  const mapped = mapHarness.page("route-detail");
  assert.equal(mapped.data.mapCenter, null);
  await mapped.onLoad({ id: xiamen._id });
  assert.equal(mapped.data.mapCenter.latitude, 24.426528);
  assert.equal(mapped.data.mapCenter.longitude, 118.122046);
  assert.equal(mapped.data.mapCenter.markers.length, 1 + xiamen.waypoints.length);
  const startMarker = mapped.data.mapCenter.markers[0];
  assert.equal(typeof startMarker.id, "number");
  assert.equal(startMarker.id, 0);
  assert.equal(startMarker.latitude, xiamen.startPoint.latitude);
  assert.equal(startMarker.longitude, xiamen.startPoint.longitude);
  assert.equal(startMarker.callout.content, xiamen.startPoint.name);
  assert.equal(startMarker.callout.display, "ALWAYS", "起点名称直接显示");
  assert(fs.existsSync(path.join(root, "miniprogram", startMarker.iconPath)));
  assert.equal(mapped.data.markers, undefined, "不创建第二套页面 markers 状态");
  assert.equal(mapped.data.mapCenter.trackPointCount, 1003);
  assert.equal(mapped.data.mapCenter.discardedTrackPointCount, 0);
  assert.equal(mapped.data.mapCenter.polyline.length, 1);
  assert.equal(mapped.data.mapCenter.polyline[0].points.length, 1003);
  assert.deepEqual(mapped.data.mapCenter.polyline[0].points, xiamen.track, "1003 点原顺序/数值完整保留");
  assert.equal(mapHarness.logs.filter(log => log.level === "error").length, 0, "正常起点路径无新 Console 错误");
  const { toStartMapData } = require("../miniprogram/utils/map-data");
  const snapshot = JSON.stringify(xiamen);
  const output = toStartMapData(xiamen);
  output.markers[0].latitude = 1;
  output.polyline[0].points[0].longitude = 1;
  assert.equal(JSON.stringify(xiamen), snapshot, "Marker 输出不改变来源对象");
  const waypointCases = [];
  for (const count of [0, 1, 22]) {
    const waypoints = Array.from({ length: count }, (_, i) => ({ ...xiamen.waypoints[i % xiamen.waypoints.length], id: 100 + i, name: `测试节点${i + 1}` }));
    const source = { ...xiamen, waypoints };
    const before = JSON.stringify(source);
    mapHarness.respond(async () => ({ data: [source] }));
    await mapped.onRetryTap();
    const markers = mapped.data.mapCenter.markers;
    assert.equal(mapped.data.status, "success");
    assert.equal(markers.length, 1 + count);
    assert.equal(new Set(markers.map(p => p.id)).size, markers.length);
    assert(markers.every(p => typeof p.id === "number"));
    for (let i = 0; i < count; i++) {
      assert.equal(markers[i + 1].id, waypoints[i].id);
      assert.equal(markers[i + 1].latitude, waypoints[i].latitude);
      assert.equal(markers[i + 1].longitude, waypoints[i].longitude);
      assert.equal(markers[i + 1].callout.content, waypoints[i].name);
      assert.equal(markers[i + 1].callout.display, "BYCLICK");
      assert.notEqual(markers[i + 1].iconPath, markers[0].iconPath);
      assert(markers[i + 1].width < markers[0].width);
    }
    assert.equal(JSON.stringify(source), before, "Waypoint 适配不改输入");
    assert.equal(mapped.data.mapCenter.polyline[0].points.length, 1003);
    waypointCases.push({ waypoints: count, startMarkers: 1, waypointMarkers: count, totalMarkers: markers.length });
  }
  console.log("Waypoint 0/1/22 本地模拟结果：", JSON.stringify(waypointCases));
  const normalPoint = { ...xiamen.waypoints[0], id: 50 };
  const missingCases = [undefined, null, {}, "waypoints", []];
  for (const waypoints of missingCases) {
    const map = toStartMapData({ ...xiamen, waypoints });
    assert.equal(map.markers.length, 1);
    assert.equal(map.polyline[0].points.length, 1003);
  }
  for (const patch of [{ latitude: null }, { longitude: "118" }, { latitude: NaN }, { longitude: Infinity },
    { latitude: 91 }, { longitude: 181 }, { latitude: 0, longitude: 0 }, { id: 0 }, { id: -1 },
    { id: "51" }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { name: " " }, { type: "start" }]) {
    const map = toStartMapData({ ...xiamen, waypoints: [normalPoint, { ...normalPoint, id: 51, ...patch }] });
    assert.deepEqual(map.markers.map(p => p.id), [0, 50], "只跳过非法节点，保留其他合法节点");
  }
  const duplicate = { ...normalPoint, id: 52 };
  assert.deepEqual(toStartMapData({ ...xiamen, waypoints: [normalPoint, duplicate, { ...duplicate, name: "重复 ID" }] }).markers.map(p => p.id), [0, 50], "重复 ID 的节点全部跳过");
  assert.deepEqual(toStartMapData({ ...xiamen, waypoints: [...xiamen.waypoints].reverse() }).markers.slice(1).map(p => p.id), [...xiamen.waypoints].reverse().map(p => p.id), "排序不重编号");
  const detached = toStartMapData(xiamen);
  detached.markers[1].longitude = 1;
  assert.notEqual(detached.markers[1].longitude, xiamen.waypoints[0].longitude, "Marker 坐标对象不引用原节点");
  const validA = xiamen.track[0];
  const validB = xiamen.track[1];
  const badPoints = [null, undefined, [], {}, { latitude: null, longitude: 118 },
    { latitude: "24", longitude: 118 }, { latitude: NaN, longitude: 118 },
    { latitude: 24, longitude: Infinity }, { latitude: 91, longitude: 118 },
    { latitude: 24, longitude: 181 }, { latitude: 0, longitude: 0 }];
  for (const badPoint of badPoints) {
    const track = [validA, badPoint, validB];
    mapHarness.respond(async () => ({ data: [{ ...xiamen, track }] }));
    await mapped.onRetryTap();
    assert.equal(mapped.data.status, "success");
    assert.deepEqual(mapped.data.mapCenter.polyline[0].points, [validA, validB], "过滤非法点，合法点原序/原值不变");
    assert.equal(mapped.data.mapCenter.trackPointCount, 2);
    assert.equal(mapped.data.mapCenter.discardedTrackPointCount, 1);
    assert.equal(track.length, 3, "不删除原数组中的数据");
    assert.equal(track[1], badPoint);
  }
  for (const track of [[], [validA], [validA, null], badPoints, undefined, null, {}, "track"]) {
    mapHarness.respond(async () => ({ data: [{ ...xiamen, track }] }));
    await mapped.onRetryTap();
    assert.equal(mapped.data.status, "success", "空/非法轨迹不导致文字详情失败");
    assert.deepEqual(mapped.data.mapCenter.polyline, [], "不足两点不绘线");
    assert.equal(mapped.data.mapCenter.markers.length, 1 + xiamen.waypoints.length, "空轨迹保留合法起点和节点");
  }
  assert.deepEqual(toStartMapData({ ...xiamen, track: [validA, validA] }).polyline[0].points, [validA, validA], "不去重合法坐标");
  const anotherRoute = routeById("fj-route-006");
  mapHarness.respond(async () => ({ data: [anotherRoute] }));
  await mapped.onLoad({ id: anotherRoute._id });
  assert.equal(mapHarness.queries.at(-1).filter._id, anotherRoute._id);
  assert.equal(mapped.data.route._id, anotherRoute._id);
  assert.deepEqual(mapped.data.mapCenter.polyline[0].points, anotherRoute.track);
  assert.equal(mapped.data.mapCenter.markers[0].callout.content, anotherRoute.startPoint.name);
  mapHarness.respond(async () => ({ data: [{ ...anotherRoute, track: [] }] }));
  await mapped.onRetryTap();
  assert.deepEqual(mapped.data.mapCenter.polyline, [], "切到空轨迹不残留上一条折线");
  mapHarness.respond(async () => ({ data: [xiamen] }));
  await mapped.onLoad({ id: xiamen._id });
  assert.equal(mapped.data.mapCenter.polyline[0].points.length, 1003, "切回厦门恢复完整轨迹");
  for (const name of [undefined, null, "", "   ", 5]) {
    const withoutName = toStartMapData({ ...xiamen, startPoint: { ...xiamen.startPoint, name } });
    assert.equal(withoutName.latitude, xiamen.startPoint.latitude, "名称缺失保留基础地图中心");
    assert(!withoutName.markers.some(p => p.id === 0), "名称非法不创建 Start Marker");
    assert.equal(withoutName.markers.length, xiamen.waypoints.length);
  }
  for (const value of [null, undefined, [], {}, { ...xiamen, coordinateSystem: "wgs84" }]) {
    assert.equal(toStartMapData(value), null);
  }
  for (const startPoint of [undefined, null, {}, { latitude: null, longitude: null },
    { latitude: null, longitude: 118 }, { latitude: "24", longitude: 118 },
    { latitude: NaN, longitude: 118 }, { latitude: 24, longitude: Infinity },
    { latitude: 91, longitude: 118 }, { latitude: 24, longitude: 181 }, { latitude: 0, longitude: 0 }]) {
    mapHarness.respond(async () => ({ data: [{ ...xiamen, startPoint }] }));
    await mapped.onRetryTap();
    assert.equal(mapped.data.status, "success", "坏起点不影响文字详情");
    assert.equal(mapped.data.mapCenter, null, "即使有完整轨迹和节点，Step 1 也不从它们回退");
  }
  assert.equal(mapHarness.logs.filter(log => log.level === "error").length, 0, "非法起点安全降级，不产生数据异常");
  const changedStart = routeById("fj-route-006").startPoint;
  mapHarness.respond(async () => ({ data: [{ ...xiamen, startPoint: changedStart }] }));
  await mapped.onRetryTap();
  assert.equal(mapped.data.mapCenter.latitude, changedStart.latitude, "中心必须跟随当前云响应而非本地路线");
  assert.equal(mapped.data.mapCenter.longitude, changedStart.longitude);
  assert.equal(mapped.data.mapCenter.markers[0].latitude, changedStart.latitude);
  assert.equal(mapped.data.mapCenter.markers[0].longitude, changedStart.longitude);
  assert.equal(mapped.data.mapCenter.markers[0].callout.content, changedStart.name);
  assert.equal(mapped.data.mapCenter.markers[0].id, 0, "云起点变化仍使用稳定数字 ID");
  mapped.onMapError({ detail: { errMsg: "intentional map error" } });
  assert.equal(mapped.data.mapRenderError, true);
  assert.equal(mapped.data.status, "success");
  let resolveMap;
  mapHarness.respond(() => new Promise(done => { resolveMap = done; }));
  const reload = mapped.onRetryTap();
  assert.equal(mapped.data.status, "loading");
  assert.equal(mapped.data.mapCenter, null, "加载开始即清除旧中心");
  assert.equal(mapped.data.mapRenderError, false);
  resolveMap({ data: [xiamen] });
  await reload;
  assert.equal(mapped.data.mapCenter.latitude, xiamen.startPoint.latitude);
  mapHarness.respond(async () => { throw new Error("intentional offline"); });
  await mapped.onRetryTap();
  assert.equal(mapped.data.status, "error");
  assert.equal(mapped.data.mapCenter, null);
  mapHarness.respond(async () => ({ data: [] }));
  await mapped.onRetryTap();
  assert.equal(mapped.data.status, "notFound");
  assert.equal(mapped.data.mapCenter, null);
  const template = fs.readFileSync(path.join(root, "miniprogram/pages/route-detail/index.wxml"), "utf8");
  assert(template.includes('polyline="{{mapPolylines}}"'), "绑定独立组合的 Trail 与 Access 展示输出");
  assert(template.includes('markers="{{mapMarkers}}"'), "只绑定原路线Marker加可选当前位置的派生数组");
  assert(template.includes('show-location="{{false}}"'));

  const interactions = harness();
  const nodeA = { ...xiamen.waypoints[0], id: 41, name: "节点 A", description: "节点 A 的说明", order: 7 };
  const nodeB = { ...xiamen.waypoints[1], id: 99, name: "节点 B" };
  delete nodeB.description;
  const source = { ...xiamen, waypoints: [nodeA, nodeB] };
  const beforeClick = JSON.stringify(source);
  interactions.respond(async () => ({ data: [source] }));
  const clickable = interactions.page("route-detail");
  await clickable.onLoad({ id: source._id });
  assert.equal(clickable.data.selectedWaypoint, null);
  clickable.onMarkerTap({ detail: { markerId: 41 } });
  assert.equal(clickable.data.selectedWaypoint.name, "节点 A");
  assert.equal(clickable.data.selectedWaypoint.description, nodeA.description);
  assert.equal(clickable.data.selectedWaypoint.order, 7, "合法云 order 优先，仅用于展示");
  clickable.onMarkerTap({ detail: { markerId: 99 } });
  assert.equal(clickable.data.selectedWaypoint.name, "节点 B", "稀疏 ID 99 不作为数组下标");
  assert.equal(clickable.data.selectedWaypoint.description, "");
  assert.equal(clickable.data.selectedWaypoint.order, 2, "无 order 使用当前 Route 原序");
  assert.equal(clickable.data.selectedWaypoint.latitude, nodeB.latitude);
  assert.equal(JSON.stringify(source), beforeClick, "点击不改变原节点/Schema");
  for (const event of [undefined, {}, { detail: {} }, { detail: { markerId: "99" } },
    { detail: { markerId: 0 } }, { detail: { markerId: 9999 } }]) {
    clickable.onMarkerTap(event);
    assert.equal(clickable.data.selectedWaypoint, null);
  }
  interactions.respond(async () => ({ data: [{ ...source, waypoints: [nodeA, { ...nodeB, latitude: null }] }] }));
  await clickable.onRetryTap();
  clickable.onMarkerTap({ detail: { markerId: 99 } });
  assert.equal(clickable.data.selectedWaypoint, null, "被过滤节点不可通过伪造事件选中");
  interactions.respond(async () => ({ data: [{ ...source, waypoints: [nodeB, nodeA] }] }));
  await clickable.onRetryTap();
  clickable.onMarkerTap({ detail: { markerId: 99 } });
  assert.equal(clickable.data.selectedWaypoint.name, "节点 B");
  assert.equal(clickable.data.selectedWaypoint.order, 1, "重排后按 ID 找到正确节点，展示当前数组顺序");
  const switched = { ...routeById("fj-route-006"), waypoints: [{ ...routeById("fj-route-006").waypoints[0], id: 99 }] };
  interactions.respond(async () => ({ data: [switched] }));
  await clickable.onLoad({ id: switched._id });
  assert.equal(clickable.data.selectedWaypoint, null, "Route 切换清空旧卡片");
  clickable.onMarkerTap({ detail: { markerId: 99 } });
  assert.equal(clickable.data.selectedWaypoint.name, switched.waypoints[0].name, "相同 ID 只映射当前 Route");
  let releaseClickLoad;
  interactions.respond(() => new Promise(resolve => { releaseClickLoad = resolve; }));
  const clickReload = clickable.onRetryTap();
  assert.equal(clickable.data.selectedWaypoint, null, "重新加载立即清空卡片");
  releaseClickLoad({ data: [] });
  await clickReload;
  assert.equal(clickable.data.selectedWaypoint, null);
  assert.equal(clickable.data.status, "notFound");
  const clickUpdates = clickable.updates;
  clickable.onUnload();
  clickable.onMarkerTap({ detail: { markerId: 99 } });
  assert.equal(clickable.updates, clickUpdates, "卸载后忽略点击");
  assert.equal(interactions.logs.filter(log => log.level === "error").length, 0);

  const unknown = h.page("route-detail");
  await unknown.onLoad({ id: "nonexistent-id" });
  assert.equal(unknown.data.status, "notFound");
  assert.equal(unknown.data.route, null);
  const calls = h.queries.length;
  for (const options of [undefined, {}, { id: "" }, { id: "   " }, { id: 1 }]) {
    const invalid = h.page("route-detail");
    await invalid.onLoad(options);
    assert.equal(invalid.data.status, "invalid");
    await invalid.onRetryTap();
  }
  assert.equal(h.queries.length, calls, "缺参不发送查询");
  await assert.rejects(h.service.getRouteById(""), /缺少路线 ID/);

  let resolve;
  h.respond(() => new Promise(done => { resolve = done; }));
  const loading = h.page("route-detail");
  const pending = loading.onLoad({ id: seed._id });
  assert.equal(loading.data.status, "loading");
  assert.equal(loading.data.route, null);
  assert.equal(loading.data.mapCenter, null);
  const before = h.queries.length;
  await loading.onRetryTap();
  assert.equal(h.queries.length, before, "加载时不重复请求");
  resolve({ data: [seed] });
  await pending;
  assert.equal(loading.data.route.displayElevationGain, require("../miniprogram/utils/format").formatElevationGain(seed.elevationGainMeters));

  const failure = new Error("DATABASE_PERMISSION_DENIED");
  h.respond(async () => { throw failure; });
  await loading.onRetryTap();
  assert.equal(loading.data.status, "error", "请求失败不能显示路线不存在");
  assert.equal(loading.data.route, null, "失败不能保留旧详情或回退 Mock");
  assert.equal(h.logs.at(-1).args[1], failure);
  h.respond(async () => ({ data: [seed] }));
  await loading.onRetryTap();
  assert.equal(loading.data.status, "success");
  h.respond(async () => ({ data: null }));
  await loading.onRetryTap();
  assert.equal(loading.data.status, "error");
  // 加载中复用同一页面切换 ID：旧请求不能覆盖新 Route 或释放新请求的加载锁。
  const race = harness();
  const routeA = xiamen;
  const routeB = routeById("fj-route-006");
  const replies = new Map();
  race.respond(query => new Promise(resolve => replies.set(query.filter._id, resolve)));
  const reused = race.page("route-detail");
  const waitingA = reused.onLoad({ id: routeA._id });
  const waitingB = reused.onLoad({ id: routeB._id });
  assert.equal(race.queries.length, 2, "加载中切换 Route 必须发送新 ID 查询");
  replies.get(routeA._id)({ data: [routeA] });
  await waitingA;
  assert.equal(reused.data.status, "loading", "旧 A 响应不能挂载旧地图");
  assert.equal(reused.data.mapCenter, null);
  const beforeRetryB = race.queries.length;
  await reused.onRetryTap();
  assert.equal(race.queries.length, beforeRetryB, "旧 A finally 不能释放 B 的加载锁");
  replies.get(routeB._id)({ data: [routeB] });
  await waitingB;
  assert.equal(reused.data.route._id, routeB._id);
  assert.equal(reused.data.mapCenter.markers[0].callout.content, routeB.startPoint.name);
  assert.deepEqual(reused.data.mapCenter.markers.map(p => p.id), [0, ...routeB.waypoints.map(p => p.id)]);
  assert.deepEqual(reused.data.mapCenter.polyline[0].points, routeB.track);
  assert.equal(reused.data.selectedWaypoint, null);

  const lateFailure = harness();
  const lateReplies = new Map();
  lateFailure.respond(query => new Promise((resolve, reject) => lateReplies.set(query.filter._id, { resolve, reject })));
  const latePage = lateFailure.page("route-detail");
  const lateRequestA = latePage.onLoad({ id: routeA._id });
  const earlyRequestB = latePage.onLoad({ id: routeB._id });
  lateReplies.get(routeB._id).resolve({ data: [routeB] });
  await earlyRequestB;
  latePage.onMarkerTap({ detail: { markerId: routeB.waypoints[0].id } });
  lateReplies.get(routeA._id).reject(new Error("late A failure"));
  await lateRequestA;
  assert.equal(latePage.data.status, "success", "旧 A 错误不能清空 B");
  assert.equal(latePage.data.route._id, routeB._id);
  assert.equal(latePage.data.selectedWaypoint.name, routeB.waypoints[0].name);
  assert.deepEqual(latePage.data.mapCenter.markers.map(p => p.id), [0, ...routeB.waypoints.map(p => p.id)]);
  assert.equal(lateFailure.logs.filter(log => log.level === "error").length, 0);

  const boundary = harness();
  const boundaryPage = boundary.page("route-detail");
  const boundaryResults = [];
  const cases = [
    { name: "startPoint 缺失", patch: { startPoint: undefined }, map: false },
    { name: "track 缺失", patch: { track: undefined }, lines: 0, markers: 21 },
    { name: "track=[]", patch: { track: [] }, lines: 0, markers: 21 },
    { name: "track 单点", patch: { track: [xiamen.track[0]] }, lines: 0, markers: 21 },
    { name: "track 非法坐标", patch: { track: [xiamen.track[0], { latitude: null, longitude: 118 }, xiamen.track[1]] }, lines: 1, points: 2, markers: 21 },
    { name: "waypoints 缺失", patch: { waypoints: undefined }, lines: 1, points: 1003, markers: 1 },
    { name: "waypoints=[]", patch: { waypoints: [] }, lines: 1, points: 1003, markers: 1 },
    { name: "waypoint 非法坐标", patch: { waypoints: [xiamen.waypoints[0], { ...xiamen.waypoints[1], latitude: null }] }, lines: 1, points: 1003, markers: 2 }
  ];
  for (const scenario of cases) {
    boundary.respond(async () => ({ data: [routeA] }));
    await boundaryPage.onLoad({ id: routeA._id });
    boundaryPage.onMarkerTap({ detail: { markerId: routeA.waypoints[0].id } });
    assert(boundaryPage.data.selectedWaypoint);
    const next = { ...routeB, ...xiamen, _id: xiamen._id, ...scenario.patch };
    boundary.respond(async () => ({ data: [next] }));
    await boundaryPage.onLoad({ id: next._id });
    assert.equal(boundaryPage.data.status, "success");
    assert.equal(boundaryPage.data.selectedWaypoint, null);
    if (scenario.map === false) assert.equal(boundaryPage.data.mapCenter, null);
    else {
      assert.equal(boundaryPage.data.mapCenter.polyline.length, scenario.lines);
      if (scenario.points) assert.equal(boundaryPage.data.mapCenter.polyline[0].points.length, scenario.points);
      assert.equal(boundaryPage.data.mapCenter.markers.length, scenario.markers);
    }
    boundaryResults.push({ scenario: scenario.name, passed: true });
  }
  boundary.respond(async () => ({ data: [routeA] }));
  await boundaryPage.onLoad({ id: routeA._id });
  boundaryPage.onMarkerTap({ detail: { markerId: routeA.waypoints[0].id } });
  let rejectBoundary;
  boundary.respond(() => new Promise((_, reject) => { rejectBoundary = reject; }));
  const failingBoundary = boundaryPage.onRetryTap();
  assert.equal(boundaryPage.data.status, "loading");
  assert.equal(boundaryPage.data.route, null);
  assert.equal(boundaryPage.data.mapCenter, null);
  assert.equal(boundaryPage.data.selectedWaypoint, null);
  rejectBoundary(new Error("intentional boundary cloud failure"));
  await failingBoundary;
  assert.equal(boundaryPage.data.status, "error");
  assert.equal(boundaryPage.data.mapCenter, null);
  assert.equal(boundaryPage.data.selectedWaypoint, null);
  assert.equal(boundary.logs.filter(log => log.level === "error").length, 1, "仅捕获预期云失败日志");

  // 返回列表再打开 B 使用新页面；A 的迟到响应与选择不得更新 B。
  const returned = harness();
  let lateA;
  returned.respond(query => query.filter && query.filter._id === routeA._id
    ? new Promise(resolve => { lateA = resolve; }) : Promise.resolve({ data: [routeB] }));
  const oldPage = returned.page("route-detail");
  const oldRequest = oldPage.onLoad({ id: routeA._id });
  oldPage.onBackTap();
  oldPage.onUnload();
  const oldUpdateCount = oldPage.updates;
  const returnedList = returned.page("routes");
  await returnedList.onLoad();
  returnedList.onRouteTap({ currentTarget: { dataset: { id: routeB._id } } });
  const returnedId = new URL(returned.navigate, "https://test.invalid").searchParams.get("id");
  const newPage = returned.page("route-detail");
  await newPage.onLoad({ id: returnedId });
  lateA({ data: [routeA] });
  await oldRequest;
  assert.equal(oldPage.updates, oldUpdateCount);
  assert.equal(newPage.data.route._id, routeB._id);
  assert.equal(newPage.data.selectedWaypoint, null);
  assert.deepEqual(newPage.data.mapCenter.polyline[0].points, routeB.track);
  assert.deepEqual(newPage.data.mapCenter.markers.map(p => p.id), [0, ...routeB.waypoints.map(p => p.id)]);
  assert.equal(returned.logs.filter(log => log.level === "error").length, 0);
  console.log("Map Core 边界数据检查：", JSON.stringify(boundaryResults));
  h.respond(async () => ({ data: [{ ...seed, _id: "wrong-id" }] }));
  await loading.onRetryTap();
  assert.equal(loading.data.status, "error");

  const late = harness();
  late.respond(() => new Promise(done => { resolve = done; }));
  const unloaded = late.page("route-detail");
  const inFlight = unloaded.onLoad({ id: seed._id });
  unloaded.onUnload();
  const updates = unloaded.updates;
  resolve({ data: [seed] });
  await inFlight;
  assert.equal(unloaded.updates, updates);
  late.failBack();
  unloaded.onBackTap();
  assert.equal(late.fallback, "/pages/routes/index");
  h.wx.cloud = undefined;
  await loading.onRetryTap();
  assert.equal(loading.data.status, "error");
  console.log("通过：云列表→详情及既有错误恢复；Polyline 1003 点原序原值/空态/非法点过滤/Route 切换、Waypoint 0/1/22 与非法节点跳过、稳定唯一 ID、点击卡片稀疏ID/order/说明/跨Route清空、Start Marker/错误降级，正常与坏起点路径无新增 Console error。仅本地 wx.cloud 模拟。");
}

run().catch(error => { console.error(error); process.exitCode = 1; });

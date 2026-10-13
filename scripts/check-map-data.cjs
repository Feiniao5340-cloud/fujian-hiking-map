const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { toMapData, emptyMapData, toStartMapData, composeNavigationMap } = require("../miniprogram/utils/map-data");
const { validateRoute } = require("./check-route-data.cjs");
const route = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/routes/xiamen-loop.json"), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = JSON.stringify(route);
validateRoute(route);
const ready = toMapData(route);
assert.equal(ready.status, "ready");
assert.equal(ready.polyline[0].points.length, 1003);
assert.deepEqual(ready.polyline[0].points, route.track);
assert.equal(route.waypoints.length, 20);
assert.deepEqual(ready.markers.map(point => point.id), [0, ...route.waypoints.map(point => point.id)]);
assert.equal(ready.latitude, route.startPoint.latitude);
assert.equal(ready.longitude, route.startPoint.longitude);
assert.equal(JSON.stringify(route), snapshot);
ready.polyline[0].points[0].latitude = 1;
assert.equal(JSON.stringify(route), snapshot, "输出不得引用可变原始轨迹对象");
for (const marker of ready.markers) {
  assert(fs.existsSync(path.join(__dirname, "../miniprogram", marker.iconPath)));
}
const empty = { coordinateSystem: "gcj02", startPoint: { name: "", latitude: null, longitude: null }, track: [], waypoints: [] };
assert.deepEqual(toMapData(empty), emptyMapData());
for (const value of [null, undefined, [], "route", 5, {}, { ...route, coordinateSystem: "wgs84" }]) {
  const map = toMapData(value);
  assert.equal(map.status, "invalid");
  assert.equal(map.latitude, null);
  assert.deepEqual(map.polyline, []);
  assert.deepEqual(map.markers, []);
}
for (const point of [null, {}, { latitude: null, longitude: 118 }, { latitude: "24", longitude: 118 },
  { latitude: NaN, longitude: 118 }, { latitude: 24, longitude: Infinity },
  { latitude: 91, longitude: 118 }, { latitude: 24, longitude: 181 }, { latitude: 0, longitude: 0 }]) {
  const map = toMapData({ ...route, track: [route.track[0], point, route.track[2]] });
  assert.equal(map.status, "partial");
  assert.deepEqual(map.polyline, [], "坏点禁止跨缺口连线");
  assert.equal(map.includePoints.length, 1 + map.markers.length, "坏轨迹整组不参与视野");
  assert.equal(toMapData({ ...empty, startPoint: point }).status, "invalid");
}
for (const track of [[], [route.track[0]], [route.track[0], route.track[0]]]) {
  const map = toMapData({ ...route, track });
  assert.equal(map.status, "partial");
  assert.deepEqual(map.polyline, []);
}
for (const field of ["track", "waypoints", "startPoint"]) {
  const broken = clone(route);
  delete broken[field];
  assert.equal(toMapData(broken).status, "partial");
}
for (const patch of [{ id: 0 }, { id: -1 }, { id: 1.5 }, { id: "1" }, { name: " " }, { type: "start" }, { latitude: null }]) {
  const map = toMapData({ ...route, waypoints: [{ ...route.waypoints[0], ...patch }] });
  assert.equal(map.status, "partial");
  assert.deepEqual(map.markers.map(point => point.id), [0]);
  assert.equal(map.polyline[0].points.length, 1003);
}
assert.deepEqual(toMapData({ ...route, waypoints: [route.waypoints[0], route.waypoints[0]] }).markers.map(point => point.id), [0]);
assert.equal(toMapData({ ...route, waypoints: [] }).status, "ready");
const nameless = toMapData({ ...route, startPoint: { ...route.startPoint, name: "" } });
assert.equal(nameless.status, "partial");
assert.equal(nameless.latitude, route.startPoint.latitude);
assert(!nameless.markers.some(point => point.id === 0));
const trackFallback = toMapData({ ...route, startPoint: empty.startPoint });
assert.equal(trackFallback.latitude, route.track[0].latitude);
assert(!trackFallback.markers.some(point => point.id === 0));
const nodeFallback = toMapData({ ...empty, waypoints: route.waypoints });
assert.equal(nodeFallback.longitude, route.waypoints[0].longitude);
const reordered = toMapData({ ...route, waypoints: [...route.waypoints].reverse() });
assert.deepEqual(reordered.markers.slice(1).map(point => point.id), [...route.waypoints].reverse().map(point => point.id));
// 正式路线派生空字段负例；不读取停用Seed。
require("./formal-route-fixtures.cjs").loadFormalRoutes().forEach(r => assert.equal(toMapData({ ...r, startPoint: empty.startPoint, track: [], waypoints: [] }).status, "empty"));
const trail = toStartMapData(route);
const trailSnapshot = JSON.stringify(trail);
const access = { status: "success", coordinateSystem: "gcj02", points: [route.track[104], route.waypoints[0]] };
const accessSnapshot = JSON.stringify(access);
const composed = composeNavigationMap(trail, access);
assert.equal(composed.mapPolylines.length, 2);
assert.equal(composed.mapPolylines[0], trail.polyline[0], "Trail复用原适配结果，不覆盖或重建Route.track");
assert.equal(composed.mapIncludePoints.length, 1005);
assert.equal(composed.mapPolylines[1].color, "#2F80ED");
composed.mapPolylines[1].points[0].longitude = 1;
assert.equal(JSON.stringify(access), accessSnapshot, "派生蓝线不修改Access输入");
assert.equal(JSON.stringify(trail), trailSnapshot, "派生不修改Trail输入");
for (const input of [null, { ...access, status: "planning" }, { ...access, coordinateSystem: "wgs84" },
  { ...access, points: [] }, { ...access, points: [route.track[104]] },
  { ...access, points: [route.track[104], { latitude: NaN, longitude: 118 }] }]) {
  const output = composeNavigationMap(trail, input);
  assert.equal(output.mapPolylines.length, 1);
  assert.equal(output.mapPolylines[0].points.length, 1003);
  assert.deepEqual(output.mapIncludePoints, trail.polyline[0].points);
}
assert.deepEqual(composeNavigationMap(null, access), { mapPolylines: [], mapIncludePoints: [] });
assert.equal(JSON.stringify(route), snapshot);
console.log("通过：原Adapter/1003点/21Marker/数据边界；Step 4纯组合Trail+Access、少于2点/坏点/状态保护/输入不变。仅本地检查。");

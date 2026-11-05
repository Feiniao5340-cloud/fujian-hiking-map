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
assert.equal(ready.polyline[0].points.length, 1004);
assert.deepEqual(ready.polyline[0].points, route.track);
assert.equal(route.waypoints.length, 7);
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
  assert.equal(map.polyline[0].points.length, 1004);
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
assert.equal(composed.mapIncludePoints.length, 1006);
assert.equal(composed.mapPolylines[1].color, "#2F80ED");
composed.mapPolylines[1].points[0].longitude = 1;
assert.equal(JSON.stringify(access), accessSnapshot, "派生蓝线不修改Access输入");
assert.equal(JSON.stringify(trail), trailSnapshot, "派生不修改Trail输入");
for (const input of [null, { ...access, status: "planning" }, { ...access, coordinateSystem: "wgs84" },
  { ...access, points: [] }, { ...access, points: [route.track[104]] },
  { ...access, points: [route.track[104], { latitude: NaN, longitude: 118 }] }]) {
  const output = composeNavigationMap(trail, input);
  assert.equal(output.mapPolylines.length, 1);
  assert.equal(output.mapPolylines[0].points.length, 1004);
  assert.deepEqual(output.mapIncludePoints, trail.polyline[0].points);
}
assert.deepEqual(composeNavigationMap(null, access), { mapPolylines: [], mapIncludePoints: [] });
assert.equal(JSON.stringify(route), snapshot);
console.log("通过：原Adapter/1004点/8Marker/数据边界；Step 4纯组合Trail+Access、少于2点/坏点/状态保护/输入不变。仅本地检查。");

// D8-D2B授权005闭环移位；固定原顶点/节点摘要保留负向完整性校验。
{
const crypto=require('node:crypto'),core=require('../miniprogram/utils/trail-progress');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
assert.deepEqual(route.startPoint,{name:'珍珠湾',latitude:24.428810,longitude:118.114404});
assert.equal(route.waypoints.filter(w=>w.name==='珍珠湾').length,0);assert.equal(ready.markers.filter(m=>m.id===0).length,1);assert(!ready.markers.some(m=>m.id===1));
assert.deepEqual(route.waypoints.map(w=>w.id).sort((a,b)=>a-b),[2,4,6,8,13,14,19]);
assert.equal(hash(route.waypoints.filter(w=>w.id!==1).sort((a,b)=>a.id-b.id).map(w=>[w.id,w.name,w.latitude,w.longitude])),'1b314fa7b487565ae905335a149830a0c52fa930dcbc743b5f4a9a134067afe4');
const base=route.track.slice(0,-1),restored=[...base.slice(23),...base.slice(0,23)];assert.equal(hash(restored),'bbc94476021956508fddbbac2edec517e57b88ec41fd39bf7b8de2893c16c723');assert.deepEqual(route.track[0],route.track.at(-1));assert(core.distance(route.startPoint,route.track[0])<1);
const index=core.buildTrailIndex(route);assert.equal(index.status,'ready');assert(Math.abs(index.totalTrackMeters-46608.12763208423)<0.001);assert.equal(route.distanceMeters,46283);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname,'../data/routes/xiamen-loop-import.json'),'utf8')),route);
for(let i=1;i<route.waypoints.length;i++)assert(route.waypoints[i].distanceFromStartMeters>=route.waypoints[i-1].distanceFromStartMeters);
console.log('PASS: D2B exact target, unique migrated Waypoint, stable other coordinates, all original vertices/order, submeter seam and Import.');
}

// D2C user-approved Waypoint-only deletion; complete track invariant.
assert.equal(require("node:crypto").createHash("sha256").update(JSON.stringify(route.track)).digest("hex"),"5e55b1ccb73ca38dc2d370878a7a6904e6989a06a6553420fc12429519600f72");
for(const name of ["会展中心","桥墩公园","海堤纪念公园","港东路","港中路","殿前一路","筼筜湖西侧","鸿山寺","厦门理工学院思明校区","演武大桥步道","厦大白城"])assert(!route.waypoints.some(w=>w.name===name));

for(const name of ["五缘湾过桥后骑行步道","中山路"])assert(!route.waypoints.some(w=>w.name===name));

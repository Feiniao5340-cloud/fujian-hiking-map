// 检查本地首批 Demo 文件；不连接 CloudBase，不确认路线或坐标真实性。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const topKeys = "_id schemaVersion name city district locationText coverImage distanceMeters estimatedDurationMinutes difficulty elevationGainMeters routeType summary description bestSeason notice coordinateSystem startPoint track waypoints source updatedAt".split(" ");
const sourceKeys = "infoSource trackSource originalCoordinateSystem conversionMethod permissionNote checkedAt".split(" ");
function keys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unexpected/missing fields`);
}
function text(value, label, required = false) {
  assert.equal(typeof value, "string", `${label}: expected string`);
  if (required) assert(value.trim(), `${label}: empty string`);
}
function number(value, label, minimum, positive = false) {
  assert(typeof value === "number" && Number.isFinite(value), `${label}: expected finite number`);
  assert(positive ? value > minimum : value >= minimum, `${label}: invalid range`);
}
function date(value, label) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label}: expected YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, `${label}: invalid date`);
}
function coordinates(point, label, allowNull = false) {
  if (allowNull && point.latitude === null && point.longitude === null) return false;
  number(point.latitude, `${label}.latitude`, -90);
  number(point.longitude, `${label}.longitude`, -180);
  assert(point.latitude <= 90 && point.longitude <= 180, `${label}: coordinates out of range`);
  assert(point.latitude !== 0 || point.longitude !== 0, `${label}: zero placeholder`);
  return true;
}
function validateRoute(route) {
  keys(route, topKeys, "Route");
  for (const field of ["_id", "name", "city", "district", "locationText", "summary"]) text(route[field], field, true);
  for (const field of ["coverImage", "description", "bestSeason", "notice"]) text(route[field], field);
  assert(!route.coverImage || route.coverImage.startsWith("cloud://"), "coverImage: expected cloud fileID");
  assert.equal(route.schemaVersion, 1);
  assert.equal(route.coordinateSystem, "gcj02");
  number(route.distanceMeters, "distanceMeters", 0, true);
  number(route.estimatedDurationMinutes, "estimatedDurationMinutes", 0, true);
  assert(Number.isInteger(route.estimatedDurationMinutes));
  if (route.elevationGainMeters !== null) number(route.elevationGainMeters, "elevationGainMeters", 0);
  assert(["easy", "moderate", "hard"].includes(route.difficulty));
  assert(["loop", "outAndBack", "pointToPoint"].includes(route.routeType));
  keys(route.startPoint, ["name", "latitude", "longitude"], "startPoint");
  const hasStart = coordinates(route.startPoint, "startPoint", true);
  text(route.startPoint.name, "startPoint.name", hasStart);
  assert(Array.isArray(route.track) && Array.isArray(route.waypoints));
  for (const point of route.track) {
    keys(point, ["latitude", "longitude"], "track point");
    coordinates(point, "track point");
  }
  const waypointIds = new Set();
  for (const point of route.waypoints) {
    keys(point, ["id", "name", "type", "latitude", "longitude", "description", "distanceFromStartMeters"], "waypoint");
    assert(Number.isInteger(point.id) && point.id > 0 && !waypointIds.has(point.id), "waypoint: invalid/duplicate id");
    waypointIds.add(point.id);
    text(point.name, "waypoint.name", true);
    text(point.description, "waypoint.description");
    assert(["end", "viewpoint", "junction", "other"].includes(point.type));
    coordinates(point, "waypoint");
    if (point.distanceFromStartMeters !== null) number(point.distanceFromStartMeters, "distanceFromStartMeters", 0);
  }
  keys(route.source, sourceKeys, "source");
  for (const field of sourceKeys) text(route.source[field], `source.${field}`, field === "infoSource" || field === "checkedAt");
  date(route.source.checkedAt, "checkedAt");
  if (hasStart || route.track.length || route.waypoints.length) {
    text(route.source.trackSource, "trackSource", true);
    assert(["gcj02", "wgs84", "bd09"].includes(route.source.originalCoordinateSystem));
    text(route.source.conversionMethod, "conversionMethod", true);
  }
  text(route.updatedAt, "updatedAt", true);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(route.updatedAt));
  const updated = new Date(route.updatedAt);
  assert(Number.isFinite(updated.getTime()) && updated.toISOString() === route.updatedAt, "updatedAt: invalid timestamp");
}
function checkBatch() {
  const routes = require('./formal-route-fixtures.cjs').loadFormalRoutes();
  for (const route of routes) {
    validateRoute(route);
    const file = require('./formal-route-fixtures.cjs').FILES[route._id];
    const text = fs.readFileSync(path.join(root, 'data/routes', file.replace('.json','-import.json')), 'utf8');
    assert(!text.startsWith('\uFEFF')); const lines = text.trim().split(/\r?\n/);
    assert.equal(lines.length, 1); assert.deepEqual(JSON.parse(lines[0]), route);
  }
  console.log('PASS: six formal Route v1 documents and matching Imports; no Seed dependency.');
}
if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) checkBatch();
  else for (const file of files) {
    const content = fs.readFileSync(path.resolve(root, file), "utf8");
    assert(!content.startsWith("\uFEFF"), "unexpected BOM");
    const route = JSON.parse(content);
    assert(Object.hasOwn(require("./formal-route-fixtures.cjs").FILES, route._id), "非正式Route已停用");
    validateRoute(route);
    console.log(`PASS: ${file}; ${route._id}; ${route.track.length} track points; ${route.waypoints.length} waypoints.`);
  }
}
module.exports = { validateRoute };

// prepare-gpx-route.ps1 的内部纯数据处理部分；公开入口为该 PowerShell 脚本。
// 安全 XML 由同轮 PowerShell 解析后经 stdin 传入，不启动子进程、不调用网络/云端。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { validateRoute } = require("./check-route-data.cjs");
const { toStartMapData } = require("../miniprogram/utils/map-data.js");
const root = path.resolve(__dirname, "..");
const method = "prepare-gpx-route-v1: offline WGS84->GCJ-02 forward equations compatible with wandergis/coordtransform; no rounding, deduplication or resampling";

/*
 * Coordinate equations adapted from https://github.com/wandergis/coordtransform
 * The MIT License (MIT)
 * Copyright (c) 2015 记忆的残骸
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
function validPoint(p) {
  return p && typeof p.latitude === "number" && Number.isFinite(p.latitude)
    && typeof p.longitude === "number" && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180
    && !(p.latitude === 0 && p.longitude === 0);
}

function wgs84ToGcj02(point) {
  assert(validPoint(point), "Invalid original coordinate");
  const { latitude: lat, longitude: lon } = point;
  // 此工具仅处理福建数据；错序/明显错误地域拒绝，不能静默当作无需转换。
  assert(lat >= 23 && lat <= 29 && lon >= 115 && lon <= 122, "Coordinate outside Fujian preparation bounds");
  const x = lon - 105, y = lat - 35, pi = Math.PI;
  const oscillation = (a, b, c, d) => (a * Math.sin(b * pi) + c * Math.sin(d * pi)) * 2 / 3;
  let north = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  north += oscillation(20, 6 * x, 20, 2 * x) + oscillation(20, y, 40, y / 3) + oscillation(160, y / 12, 320, y / 30);
  let east = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  east += oscillation(20, 6 * x, 20, 2 * x) + oscillation(20, x, 40, x / 3) + oscillation(150, x / 12, 300, x / 30);
  const radians = lat * pi / 180, eccentricity = 0.00669342162296594323, semiMajor = 6378245;
  const factor = 1 - eccentricity * Math.sin(radians) ** 2, sqrtFactor = Math.sqrt(factor);
  const result = {
    latitude: lat + north * 180 / (semiMajor * (1 - eccentricity) / (factor * sqrtFactor) * pi),
    longitude: lon + east * 180 / (semiMajor / sqrtFactor * Math.cos(radians) * pi)
  };
  assert(validPoint(result), "Invalid converted coordinate");
  return result;
}

function haversine(a, b) {
  const radians = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians)
    * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 12742017.6 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// 只执行私有清单中用户已授权、绑定原件hash和原点值的展示清理。
// 不按时间排序，不按速度阈值自动删点；可按授权复用首点闭环，不插值新坐标。
function selectDisplayTrack(points, plan, sourceHash, startIndex) {
  assert(Array.isArray(points) && points.length >= 2 && points.every(validPoint));
  assert(Number.isInteger(startIndex) && startIndex >= 0 && startIndex < points.length);
  const removed = new Set();
  if (plan) {
    assert.equal(plan.version, "display-cleanup-v1");
    assert.equal(plan.ownerAuthorized, true, "Display cleanup lacks project owner authorization");
    assert.equal(plan.sourceSha256, sourceHash, "Cleanup plan belongs to a different source");
    assert(Array.isArray(plan.removePoints), "Explicit removal list required");
    for (const entry of plan.removePoints) {
      const index = entry.ordinalOneBased - 1;
      assert(Number.isSafeInteger(entry.ordinalOneBased) && index > 0 && index < points.length - 1, "Cannot remove endpoints or invalid indices");
      assert(index !== startIndex && !removed.has(index), "Cannot remove selected start or duplicate an index");
      assert.deepEqual(points[index], entry.expectedWgs84, "Cleanup point differs from inspected source");
      removed.add(index);
    }
  }
  const keptOriginalIndices = points.flatMap((_, index) => removed.has(index) ? [] : [index]);
  assert(keptOriginalIndices.length >= 2);
  let closingPointAdded = false;
  if (plan && plan.closeLoop === true) {
    const first = points[keptOriginalIndices[0]], last = points[keptOriginalIndices.at(-1)];
    if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
      keptOriginalIndices.push(keptOriginalIndices[0]);
      closingPointAdded = true;
    }
  }
  return { points: keptOriginalIndices.map(index => ({ ...points[index] })), keptOriginalIndices,
    removedOrdinals: [...removed].sort((a,b) => a-b).map(index => index + 1),
    startIndex: keptOriginalIndices.indexOf(startIndex), closingPointAdded };
}

function decodePoints(data) {
  assert(Array.isArray(data.points) && data.points.length >= 2, "Insufficient path points");
  data.points = data.points.map(point => {
    assert(typeof point.latitude === "string" && point.latitude.trim() && typeof point.longitude === "string" && point.longitude.trim(), "Missing coordinate attribute");
    const p = { latitude: Number(point.latitude), longitude: Number(point.longitude) };
    assert(validPoint(p), "Invalid GPX coordinate; refusing to drop points or bridge gaps");
    return p;
  });
  return data;
}

function prepare(manifestFile, parsedGpx) {
  const rawDir = fs.realpathSync(path.join(root, "data/raw/gpx"));
  const file = fs.realpathSync(path.resolve(root, manifestFile));
  assert(path.dirname(file) === rawDir && file.endsWith(".source.json"), "Select one private source manifest directly in raw/gpx");
  const source = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(source.originalCoordinateSystem, "wgs84", "Only explicitly confirmed WGS84 source accepted");
  assert.equal(path.basename(source.archivedFileName), source.archivedFileName);
  const gpxFile = fs.realpathSync(path.join(rawDir, source.archivedFileName));
  assert.equal(path.dirname(gpxFile), rawDir);
  const hash = () => crypto.createHash("sha256").update(fs.readFileSync(gpxFile)).digest("hex");
  assert.equal(hash(), source.sha256, "Original hash mismatch");
  const data = decodePoints(parsedGpx), selection = source.startPointSelection, p = source.routePreparation;
  assert(selection && validPoint(selection.referenceWgs84) && p, "Confirmed start and manual preparation required");
  assert.equal(data.pointType, selection.pointType);
  assert.equal(data.points.length, selection.pathPointCount);
  let startIndex = 0, minimum = Infinity;
  data.points.forEach((point, index) => {
    const distance = haversine(selection.referenceWgs84, point);
    if (distance < minimum) { minimum = distance; startIndex = index; }
  });
  assert.equal(startIndex, selection.pointIndexZeroBased, "Start selection changed; review instead of silently replacing");
  assert.deepEqual(data.points[startIndex], selection.selectedWgs84);
  assert.deepEqual(p.waypoints, [], "This preparation stage explicitly uses empty waypoints");
  const display = selectDisplayTrack(data.points, source.displayTrackCleanup, source.sha256, startIndex);
  const track = display.points.map(wgs84ToGcj02);
  const distanceMeters = Math.round(display.points.slice(1).reduce((sum, point, index) => sum + haversine(display.points[index], point), 0));
  const cleanupText = (display.removedOrdinals.length ? `; project-owner display cleanup excluded original ordinals ${display.removedOrdinals.join(",")}; remaining points connected in original order` : "")
    + (display.closingPointAdded ? "; loop closed by reusing the first retained coordinate" : "");
  const trackSource = cleanupText
    ? `${source.sourcePlatform} GPX; ${source.candidateRouteId} source-v1; ${data.points.length} original path points, ${track.length} retained; raw wpt excluded by project owner${cleanupText}`
    : `${source.sourcePlatform} GPX; ${source.candidateRouteId} source-v1; ${track.length} original ordered path points; raw wpt excluded by project owner`;
  const route = {
    _id: source.candidateRouteId, schemaVersion: 1, name: p.name, city: p.city, district: p.district,
    locationText: p.locationText, coverImage: p.coverImage, distanceMeters, estimatedDurationMinutes: p.estimatedDurationMinutes,
    difficulty: p.difficulty, elevationGainMeters: p.elevationGainMeters, routeType: p.routeType,
    summary: p.summary, description: p.description, bestSeason: p.bestSeason, notice: p.notice, coordinateSystem: "gcj02",
    startPoint: { name: p.startPointName, ...track[display.startIndex] }, track, waypoints: [],
    source: { infoSource: p.infoSource, trackSource,
      originalCoordinateSystem: "wgs84", conversionMethod: method + cleanupText, permissionNote: p.permissionNote, checkedAt: p.checkedAt }, updatedAt: p.updatedAt
  };
  validateRoute(route);
  const map = toStartMapData(route);
  assert(map && map.polyline.length === 1 && map.trackPointCount === track.length && map.discardedTrackPointCount === 0);
  assert.deepEqual(map.polyline[0].points, track);
  assert.equal(map.markers.length, 1); assert.equal(map.markers[0].id, 0);
  assert.equal(hash(), source.sha256, "Original changed during preparation");
  const basename = source.archivedFileName.replace(/__source-v\d+\.gpx$/, "");
  assert(/^[a-z0-9-]+__[a-z0-9-]+$/.test(basename), "Unexpected archive name");
  assert.equal(basename.split("__")[0], route._id);
  return { route, basename, sourceSha256: source.sha256, pointType: data.pointType, startIndex: display.startIndex, removedOrdinals: display.removedOrdinals, closingPointAdded: display.closingPointAdded };
}

function main(args) {
  assert(args.length === 1 || (args.length === 2 && args[1] === "--write"), "Select one manifest; optional --write; no batch input");
  const result = prepare(args[0], JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "")));
  const routeFile = path.join(root, "data/routes", `${result.basename}.json`);
  const importFile = path.join(root, "data/routes", `${result.basename}-import.json`);
  if (args[1] === "--write") {
    assert(!fs.existsSync(routeFile) && !fs.existsSync(importFile), "Output exists; refusing to overwrite either file");
    const readable = JSON.stringify(result.route, null, 2) + "\n", lines = JSON.stringify(result.route) + "\n";
    fs.writeFileSync(routeFile, readable, { encoding: "utf8", flag: "wx" });
    fs.writeFileSync(importFile, lines, { encoding: "utf8", flag: "wx" });
    assert.deepEqual(JSON.parse(fs.readFileSync(routeFile, "utf8")), JSON.parse(fs.readFileSync(importFile, "utf8")));
  }
  console.log(JSON.stringify({ status: args[1] === "--write" ? "LOCAL_FILES_GENERATED_PENDING_GEO_CLOUD_DEVICE" : "LOCAL_CHECK_PASS_NO_WRITE",
    id: result.route._id, pointCount: result.route.track.length, waypoints: result.route.waypoints.length, markers: 1,
    distanceMeters: result.route.distanceMeters, durationMinutes: result.route.estimatedDurationMinutes, difficulty: result.route.difficulty,
    startIndexZeroBased: result.startIndex, sourceSha256: result.sourceSha256, cloudImported: false, deviceVerified: false,
    removedOriginalOrdinals: result.removedOrdinals,
    closingPointCopyAdded: result.closingPointAdded,
    routeFile: path.relative(root, routeFile), importFile: path.relative(root, importFile) }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`PREPARATION_REJECTED: ${error.message}`); process.exitCode = 1; }
}
module.exports = { wgs84ToGcj02, haversine, selectDisplayTrack, prepare };

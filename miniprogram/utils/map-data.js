// 只适配地图数据：不修补坐标、不转换坐标系、不修改 Route。
function emptyMapData() {
  return { status: "empty", latitude: null, longitude: null, polyline: [], markers: [], includePoints: [], issues: [] };
}

function validPoint(point) {
  return !!point && typeof point === "object" && !Array.isArray(point)
    && typeof point.latitude === "number" && Number.isFinite(point.latitude)
    && typeof point.longitude === "number" && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && !(point.latitude === 0 && point.longitude === 0);
}

const named = value => typeof value === "string" && !!value.trim();
const position = point => ({ latitude: point.latitude, longitude: point.longitude });

function trackMapData(track) {
  const isArray = Array.isArray(track);
  // filter/map 都生成新数组；保持合法点原序与数值，不转换、补点或简化。
  const points = isArray ? track.filter(validPoint).map(position) : [];
  return {
    polyline: points.length >= 2 ? [{ points, color: "#41614D", width: 5 }] : [],
    trackPointCount: points.length,
    discardedTrackPointCount: isArray ? track.length - points.length : 0,
    trackInvalid: !isArray
  };
}

function waypointMarkers(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  const idCounts = new Map();
  waypoints.forEach(point => {
    if (point && Number.isSafeInteger(point.id) && point.id > 0) {
      idCounts.set(point.id, (idCounts.get(point.id) || 0) + 1);
    }
  });
  return waypoints.filter(point => validPoint(point) && Number.isSafeInteger(point.id)
    && point.id > 0 && idCounts.get(point.id) === 1 && named(point.name)
    && ["end", "viewpoint", "junction", "other"].includes(point.type))
    .map(point => marker(point, point.id, false));
}

// 现有起点中心、唯一 markers 数组与 Polyline 使用同一输出。
function toStartMapData(route) {
  if (!route || typeof route !== "object" || Array.isArray(route)
    || route.coordinateSystem !== "gcj02" || !validPoint(route.startPoint)) return null;
  const startMarker = named(route.startPoint.name) ? marker(route.startPoint, 0, true) : null;
  if (startMarker) startMarker.callout.display = "ALWAYS";
  const markers = startMarker ? [startMarker] : [];
  markers.push(...waypointMarkers(route.waypoints));
  return Object.assign(position(route.startPoint), { markers }, trackMapData(route.track));
}

function marker(point, id, start) {
  return Object.assign(position(point), {
    id, iconPath: start ? "/assets/map/start.png" : "/assets/map/waypoint.png",
    width: start ? 32 : 24, height: start ? 40 : 30,
    callout: { content: point.name, display: "BYCLICK", padding: 8, borderRadius: 6, color: "#263c32", bgColor: "#fffdf8" }
  });
}

function toMapData(route) {
  const result = emptyMapData();
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    result.status = "invalid";
    result.issues.push("route-invalid");
    return result;
  }
  if (route.coordinateSystem !== "gcj02") {
    result.status = "invalid";
    result.issues.push("coordinate-system-unsupported");
    return result;
  }

  const start = route.startPoint;
  const startValid = validPoint(start);
  const startEmpty = start && start.latitude === null && start.longitude === null;
  if (!startValid && !startEmpty) result.issues.push("start-invalid");
  if (startValid && named(start.name)) result.markers.push(marker(start, 0, true));
  else if (startValid) result.issues.push("start-name-missing");

  const trackValid = Array.isArray(route.track) && route.track.every(validPoint);
  if (!trackValid) result.issues.push("track-invalid");
  const track = trackValid ? route.track.map(position) : [];
  const distinct = track.length > 1 && track.some(point => point.latitude !== track[0].latitude || point.longitude !== track[0].longitude);
  if (distinct) result.polyline.push({ points: track, color: "#41614D", width: 5 });
  else if (track.length) result.issues.push("track-insufficient");

  const ids = new Set();
  const waypointsValid = Array.isArray(route.waypoints) && route.waypoints.every(point => {
    if (!validPoint(point) || !Number.isInteger(point.id) || point.id <= 0 || ids.has(point.id)
      || !named(point.name) || !["end", "viewpoint", "junction", "other"].includes(point.type)) return false;
    ids.add(point.id);
    return true;
  });
  if (!waypointsValid) result.issues.push("waypoints-invalid");
  const waypoints = waypointsValid ? route.waypoints : [];
  waypoints.forEach(point => result.markers.push(marker(point, point.id, false)));

  const center = startValid ? start : track[0] || waypoints[0];
  if (!center) {
    result.status = result.issues.length ? "invalid" : "empty";
    return result;
  }
  Object.assign(result, position(center));
  result.includePoints = [position(center), ...track, ...result.markers.map(position)];
  result.status = result.markers.some(point => point.id === 0) && distinct && !result.issues.length ? "ready" : "partial";
  return result;
}

// Trail仍由原适配结果提供；Access整组有效才叠加，不过滤坏点后跨缺口连线。
function composeNavigationMap(mapCenter, accessRoute) {
  const trail = mapCenter && Array.isArray(mapCenter.polyline) ? mapCenter.polyline : [];
  const accepted = !!mapCenter && accessRoute && accessRoute.status === "success"
    && accessRoute.coordinateSystem === "gcj02" && Array.isArray(accessRoute.points)
    && accessRoute.points.length >= 2 && accessRoute.points.length <= 5000
    && accessRoute.points.every(validPoint);
  const access = accepted ? accessRoute.points.map(position) : [];
  return {
    mapPolylines: access.length ? [...trail, { points: access, color: "#2F80ED", width: 5 }] : trail,
    mapIncludePoints: [...(trail.length ? trail[0].points : []), ...access]
  };
}

module.exports = { toMapData, emptyMapData, toStartMapData, composeNavigationMap };

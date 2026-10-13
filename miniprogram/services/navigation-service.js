const { cloudEnvId } = require("../config/env");

const messages = {
  NO_TARGET: "请先选择一个节点。", TARGET_INVALID: "目标位置暂不可用，请重新选择。",
  TARGET_CHANGED: "路线资料已更新，请重新加载路线。", TARGET_NOT_FOUND: "目标节点不存在，请重新加载路线。",
  OPEN_LOCATION_FAILED: "无法打开目标位置，请检查微信权限后重试。",
  LOCATION_DENIED: "未获得定位许可。请在微信小程序设置或系统设置中允许定位后再次尝试，也可使用“导航到这里”。", LOCATION_FAILED: "定位失败，请检查系统定位后重试。",
  LOCATION_TIMEOUT: "定位超时，请重试或打开目标位置。", CLOUD_CALL_FAILED: "规划服务暂不可用，请重试或打开目标位置。",
  AUTH_REQUIRED: "规划服务暂不可用，请使用打开目标位置。", SERVER_CONFIG_ERROR: "规划服务尚未配置好，请使用打开目标位置。",
  RATE_LIMITED: "规划次数已达上限，请稍后重试或打开目标位置。", UPSTREAM_TIMEOUT: "步行规划超时，请重试。",
  UPSTREAM_ERROR: "步行规划暂不可用，请使用打开目标位置。", ROUTE_UNAVAILABLE: "暂未找到可用步行路线，请使用打开目标位置。",
  WALKING_RANGE_EXCEEDED: "当前位置距目标过远，无法规划步行接驳（最多100公里）。请使用“打开目标位置”继续查看目标或导航，到附近后再规划步行接驳。",
  INVALID_RESPONSE: "规划结果暂不可用，请重试。", ROUTE_TOO_LARGE: "规划路线过长，暂无法展示。",
  INVALID_COORDINATES: "起点或目标坐标无效，请重新选择或定位。"
};
const failure = code => Object.assign(new Error(code), { code });
function errorCode(error, fallback = "CLOUD_CALL_FAILED") {
  return error && Object.prototype.hasOwnProperty.call(messages, error.code) ? error.code : fallback;
}
const errorMessage = code => messages[code] || messages.CLOUD_CALL_FAILED;
function validPoint(p) {
  return !!p && typeof p.latitude === "number" && Number.isFinite(p.latitude)
    && typeof p.longitude === "number" && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180
    && !(p.latitude === 0 && p.longitude === 0);
}
const position = p => ({ latitude: p.latitude, longitude: p.longitude });
function emptyAccessRoute(status = "idle", code = null) {
  return { status, routeId: null, routeUpdatedAt: null, waypointId: null, coordinateSystem: "gcj02",
    origin: null, destination: null, distanceMeters: null, durationSeconds: null, points: [], errorCode: code };
}
function resolveTarget(route, mapCenter, selected) {
  if (!selected) throw failure("NO_TARGET");
  const matches = route && Array.isArray(route.waypoints) ? route.waypoints.filter(p => p && p.id === selected.id) : [];
  const target = matches[0];
  if (!route || route.coordinateSystem !== "gcj02" || !Number.isSafeInteger(selected.id) || selected.id <= 0
    || matches.length !== 1 || !validPoint(target) || !validPoint(selected)
    || typeof target.name !== "string" || !target.name.trim()
    || selected.name !== target.name || selected.latitude !== target.latitude || selected.longitude !== target.longitude
    || !["end", "viewpoint", "junction", "other"].includes(target.type)
    || !mapCenter || !mapCenter.markers.some(p => p.id === selected.id)) throw failure("TARGET_INVALID");
  // 当前选中节点是原生目标的数据来源；Route重查仅用于身份/有效性校验。
  return { id: selected.id, name: selected.name, ...position(selected) };
}
function timedCall(invoke, milliseconds, timeoutCode, fallbackCode) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => { if (done) return; done = true; clearTimeout(timer); callback(value); };
    const timer = setTimeout(() => finish(reject, failure(timeoutCode)), milliseconds);
    try { invoke(value => finish(resolve, value), error => finish(reject, failure(errorCode(error, fallbackCode)))); }
    catch (_) { finish(reject, failure(fallbackCode)); }
  });
}
function openTarget(target) {
  if (!validPoint(target)) return Promise.reject(failure("TARGET_INVALID"));
  return timedCall((success, fail) => wx.openLocation({ ...position(target), name: target.name, scale: 16, success, fail }),
    20000, "OPEN_LOCATION_FAILED", "OPEN_LOCATION_FAILED");
}
async function locateOnce() {
  const point = await timedCall((success, fail) => wx.getLocation({ type: "gcj02", success, fail(error) {
    const denied = /auth deny|auth denied|authorize|permission|privacy/i.test(error && error.errMsg || "");
    const timeout = /timeout|time out/i.test(error && error.errMsg || "");
    fail(failure(denied ? "LOCATION_DENIED" : timeout ? "LOCATION_TIMEOUT" : "LOCATION_FAILED"));
  } }), 20000, "LOCATION_TIMEOUT", "LOCATION_FAILED");
  if (!validPoint(point)) throw failure("LOCATION_FAILED");
  return position(point);
}
function validateResult(result) {
  if (!result || result.success !== true) throw failure(errorCode({ code: result && result.errorCode }, "INVALID_RESPONSE"));
  if (!Number.isFinite(result.distanceMeters) || result.distanceMeters < 0
    || !Number.isFinite(result.durationSeconds) || result.durationSeconds < 0
    || !Array.isArray(result.points) || result.points.length < 2 || result.points.length > 5000
    || !result.points.every(validPoint)) throw failure("INVALID_RESPONSE");
  return { success: true, distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds, points: result.points.map(position) };
}
async function planAccessRoute(origin, destination) {
  if (!validPoint(origin) || !validPoint(destination)) throw failure("INVALID_COORDINATES");
  const request = { origin: position(origin), destination: position(destination) };
  const response = await timedCall((success, fail) => wx.cloud.callFunction({ name: "planAccessRoute", config: { env: cloudEnvId },
    data: request, success, fail }), 20000, "CLOUD_CALL_FAILED", "CLOUD_CALL_FAILED");
  return validateResult(response && response.result);
}
module.exports = { emptyAccessRoute, resolveTarget, openTarget, locateOnce, planAccessRoute, errorCode, errorMessage };

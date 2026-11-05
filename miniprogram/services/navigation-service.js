const { cloudEnvId } = require("../config/env");
const accessPrivacy = require("../config/access-privacy");
const accessGrants = new WeakMap(); // 本次授权凭据只在内存中，不能用普通布尔值伪造。

const messages = {
  AMAP_PROVIDER_PENDING: "高德服务提供方法律主体尚未核实，暂不能定位或发送接驳请求。请由项目所有者核对适用协议。",
  LOCATION_INTERFACE_UNAVAILABLE: "当前账号的单次定位getLocation接口未开通或不可用，请由项目所有者核对接口准入。持续定位接口已开通不能替代此权限。",
  ACCESS_POLICY_UNAVAILABLE: "真实接驳的政策准入条件尚未满足，暂不能规划。阅读隐私指引不会启用定位或规划。",
  ACCESS_REQUESTS_DISABLED: "真实步行接驳尚未获准启用；阅读指引或同意本次操作均不会解除此限制。",
  ACCESS_CONSENT_REQUIRED: "请先确认本次第三方服务及必要授权，再发起新的接驳请求。",
  ACCESS_CANCELLED: "本次接驳意图已取消，请主动重新发起。",
  PRIVACY_REQUIRED: "微信隐私授权尚未完成，本次未发起规划。",
  PRIVACY_DENIED: "您未同意微信隐私指引，本次未定位或规划。",
  PRIVACY_FAILED: "无法确认微信隐私授权，请稍后主动重试。",
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
function policyReaderAvailable() {
  return accessPrivacy.policyReader === "wechatPrivacyContractSupplement" && accessPrivacy.policyReaderVerified === true
    && accessPrivacy.policyUrl === "https://lbs.amap.com/pages/privacy/"
    && typeof wx !== "undefined" && typeof wx.openPrivacyContract === "function";
}
function getAccessPreflight() {
  const provider = typeof accessPrivacy.providerLegalName === "string" ? accessPrivacy.providerLegalName.trim() : "";
  const codes = [];
  if (!provider) codes.push("AMAP_PROVIDER_PENDING");
  if (accessPrivacy.getLocationApproved !== true) codes.push("LOCATION_INTERFACE_UNAVAILABLE");
  if (!policyReaderAvailable()) codes.push("ACCESS_POLICY_UNAVAILABLE");
  if (accessPrivacy.accessRequestsEnabled !== true) codes.push("ACCESS_REQUESTS_DISABLED");
  return { providerLegalName: provider, policyUrl: accessPrivacy.policyUrl, readerAvailable: policyReaderAvailable(),
    blockedReason: codes.map(errorMessage).join(" "), codes, ready: codes.length === 0 };
}
function requireAccessReady() { const state = getAccessPreflight(); if (!state.ready) throw failure(state.codes[0]); }
function requireCurrent(grant, stage) {
  requireAccessReady();
  const state = accessGrants.get(grant);
  if (!state || state.stage !== stage) throw failure("ACCESS_CONSENT_REQUIRED");
  if (!state.isCurrent()) throw failure("ACCESS_CANCELLED");
  return state;
}
async function authorizeAccess({ isCurrent, onPrivacyRequired, target }) {
  requireAccessReady();
  if (typeof isCurrent !== "function" || !isCurrent() || !validPoint(target)) throw failure("ACCESS_CANCELLED");
  const check = () => { if (!isCurrent()) throw failure("ACCESS_CANCELLED"); };
  const query = () => timedCall((success, fail) => wx.getPrivacySetting({ success, fail }), 20000, "PRIVACY_FAILED", "PRIVACY_FAILED");
  let privacy = await query(); check();
  if (!privacy || typeof privacy.needAuthorization !== "boolean") throw failure("PRIVACY_FAILED");
  if (privacy.needAuthorization) {
    if (typeof onPrivacyRequired !== "function") throw failure("PRIVACY_REQUIRED");
    if (!await onPrivacyRequired()) throw failure("PRIVACY_DENIED");
    check(); privacy = await query(); check();
    if (!privacy || privacy.needAuthorization !== false) throw failure("PRIVACY_REQUIRED");
  }
  await timedCall((success, fail) => wx.authorize({ scope: "scope.userLocation", success, fail }), 20000, "LOCATION_DENIED", "LOCATION_DENIED");
  check();
  const grant = Object.freeze({});
  accessGrants.set(grant, { isCurrent, target: position(target), stage: "authorized" });
  return grant;
}
function openAccessPrivacyPolicy() {
  // 阅读入口与Access准入分离；打开微信指引不证明高德全文已读或已同意。
  if (!policyReaderAvailable()) return Promise.reject(failure("ACCESS_POLICY_UNAVAILABLE"));
  return timedCall((success, fail) => wx.openPrivacyContract({ success: () => success({ opened: true }), fail }),
    20000, "ACCESS_POLICY_UNAVAILABLE", "ACCESS_POLICY_UNAVAILABLE");
}
async function locateOnce({ onSettled, grant } = {}) {
  const authorization = requireCurrent(grant, "authorized");
  authorization.stage = "locating";
  // UI超时不是SDK取消。仅在原始成功/失败回执后通知业务释放单次请求令牌；不传坐标。
  let settled = false;
  const acknowledge = () => { if (settled) return; settled = true;
    if (typeof onSettled === "function") { try { onSettled(); } catch (_) { /* 不影响定位结果 */ } }
  };
  const point = await timedCall((success, fail) => { try { wx.getLocation({ type: "gcj02", success(value) { acknowledge(); success(value); }, fail(error) {
    acknowledge();
    const unavailable = /api.*(?:permission|not available|not open)|no permission to call|未开通/i.test(error && error.errMsg || "");
    const denied = /auth deny|auth denied|authorize|permission|privacy/i.test(error && error.errMsg || "");
    const timeout = /timeout|time out/i.test(error && error.errMsg || "");
    fail(failure(unavailable ? "LOCATION_INTERFACE_UNAVAILABLE" : denied ? "LOCATION_DENIED" : timeout ? "LOCATION_TIMEOUT" : "LOCATION_FAILED"));
  } }); } catch (error) { acknowledge(); throw error; } }, 20000, "LOCATION_TIMEOUT", "LOCATION_FAILED");
  if (!validPoint(point)) throw failure("LOCATION_FAILED");
  if (!authorization.isCurrent()) throw failure("ACCESS_CANCELLED");
  authorization.origin = position(point); authorization.stage = "located";
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
async function planAccessRoute(origin, destination, grant) {
  if (!validPoint(origin) || !validPoint(destination)) throw failure("INVALID_COORDINATES");
  const authorization = requireCurrent(grant, "located");
  if (origin.latitude !== authorization.origin.latitude || origin.longitude !== authorization.origin.longitude
    || destination.latitude !== authorization.target.latitude || destination.longitude !== authorization.target.longitude) throw failure("ACCESS_CONSENT_REQUIRED");
  authorization.stage = "sent";
  const request = { origin: position(origin), destination: position(destination) };
  const response = await timedCall((success, fail) => wx.cloud.callFunction({ name: "planAccessRoute", config: { env: cloudEnvId },
    data: request, success, fail }), 20000, "CLOUD_CALL_FAILED", "CLOUD_CALL_FAILED");
  if (!authorization.isCurrent()) throw failure("ACCESS_CANCELLED");
  return validateResult(response && response.result);
}
module.exports = { emptyAccessRoute, resolveTarget, openTarget, locateOnce, planAccessRoute, errorCode, errorMessage,
  getAccessPreflight, authorizeAccess, openAccessPrivacyPolicy };

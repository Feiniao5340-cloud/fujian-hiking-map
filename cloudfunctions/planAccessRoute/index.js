const cloud = require("wx-server-sdk");
const https = require("node:https");
const crypto = require("node:crypto");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const APP_ID = "YOUR_MINIPROGRAM_APPID";
const messages = {
  AUTH_REQUIRED: "请从当前微信小程序调用规划服务。",
  INVALID_COORDINATES: "起点或目标坐标无效。", SERVER_CONFIG_ERROR: "规划服务配置暂不可用。",
  RATE_LIMITED: "规划次数已达上限，请稍后再试。", UPSTREAM_TIMEOUT: "步行规划超时，请稍后再试。",
  UPSTREAM_ERROR: "步行规划服务暂不可用。", ROUTE_UNAVAILABLE: "未找到可用的步行路线。",
  WALKING_RANGE_EXCEEDED: "起点与目标距离超出步行规划范围。",
  INVALID_RESPONSE: "步行规划结果无效。", ROUTE_TOO_LARGE: "步行规划结果过大，暂无法展示。"
};
const fail = code => Object.assign(new Error(code), { code });
// 临时安全诊断：只记录固定阶段/数值状态码，不记录URL、Key、坐标、账号或上游正文。
function upstreamFailure(code, stage, values = {}) {
  const networkCodes = ["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH",
    "EHOSTUNREACH", "EPROTO", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"];
  const numberCode = Number.isInteger(values.httpStatus) && values.httpStatus >= 100 && values.httpStatus <= 599 ? values.httpStatus : null;
  return Object.assign(fail(code), { upstreamDiagnostic: {
    stage, httpStatus: numberCode,
    amapStatus: ["0", "1"].includes(values.amapStatus) ? values.amapStatus : null,
    amapInfocode: typeof values.amapInfocode === "string" && /^\d{5}$/.test(values.amapInfocode) ? values.amapInfocode : null,
    networkCode: networkCodes.includes(values.networkCode) ? values.networkCode : values.networkCode ? "OTHER" : null
  } });
}
function validPoint(p) {
  return !!p && !Array.isArray(p) && typeof p.latitude === "number" && Number.isFinite(p.latitude)
    && typeof p.longitude === "number" && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0);
}
const position = p => ({ latitude: p.latitude, longitude: p.longitude });
function validateInput(e) {
  // 临时固定诊断码只标明失败层，不包含字段值、位置、身份或Secret。
  const reject = inputReason => { throw Object.assign(fail("INVALID_COORDINATES"), { inputReason }); };
  if (!e || typeof e !== "object" || Array.isArray(e)) reject("EVENT_SHAPE");
  // 小程序云调用附加的平台元数据不属于业务输入；不读取内容，鉴权只使用getWXContext。
  // tcbContext已由真机字段名诊断确认，不能用于代替受信身份或修改规划目标。
  const extraFields = Object.keys(e).filter(k => !["origin", "destination", "userInfo", "tcbContext"].includes(k));
  if (extraFields.length) {
    // 仅回传短标识符字段名；任意文本/疑似Secret字段名遮蔽，所有字段值均不读取或输出。
    const names = extraFields.slice(0, 8).map(k => /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(k)
      && !/[a-f0-9]{24,}/i.test(k) ? k : "REDACTED");
    throw Object.assign(fail("INVALID_COORDINATES"), { inputReason: "TOP_FIELDS", diagnosticFieldNames: names.join(",") });
  }
  for (const [field, label] of [["origin", "ORIGIN"], ["destination", "DESTINATION"]]) {
    const p = e[field];
    if (!validPoint(p)) reject(`${label}_VALUES`);
    if (Object.keys(p).some(k => !["latitude", "longitude"].includes(k))) reject(`${label}_FIELDS`);
  }
}
async function readCounter(ref) {
  // wx-server-sdk 的 document.get 在不存在时可能返回空值或抛出不存在错误；其他错误必须失败关闭。
  try { const result = await ref.get(); return result.data || {}; }
  catch (error) {
    if (/document.*(?:does not exist|not exist)|DOCUMENT_NOT_EXIST/i.test(error && error.errMsg || "")) return {};
    throw error;
  }
}
async function consumeLimit(db, identity, now) {
  const minute = Math.floor(now / 60000);
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  await db.runTransaction(async transaction => {
    const collection = transaction.collection("navigation_limits");
    const userRef = collection.doc(`u_${crypto.createHash("sha256").update(identity).digest("hex")}`);
    const globalRef = collection.doc("global");
    const user = await readCounter(userRef);
    const global = await readCounter(globalRef);
    const count = (record, bucket, field, current) => {
      if (record[bucket] !== current) return 0;
      if (!Number.isSafeInteger(record[field]) || record[field] < 0) throw fail("SERVER_CONFIG_ERROR");
      return record[field];
    };
    const minuteCount = count(user, "minute", "minuteCount", minute);
    const dayCount = count(user, "day", "dayCount", day);
    const globalCount = count(global, "day", "dayCount", day);
    if (minuteCount >= 10 || dayCount >= 60 || globalCount >= 200) throw fail("RATE_LIMITED");
    await userRef.set({ data: { minute, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 } });
    await globalRef.set({ data: { day, dayCount: globalCount + 1 } });
  });
}
function fetchWalking(origin, destination, key) {
  const coord = p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`;
  const params = new URLSearchParams({ key, origin: coord(origin), destination: coord(destination), output: "JSON" });
  return new Promise((resolve, reject) => {
    let done = false;
    let req;
    const finish = (error, data) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(data); };
    const timer = setTimeout(() => { finish(upstreamFailure("UPSTREAM_TIMEOUT", "TIMEOUT")); if (req) req.destroy(); }, 8000);
    try {
      req = https.get({ hostname: "restapi.amap.com", path: `/v3/direction/walking?${params}`, method: "GET" }, res => {
        if (res.statusCode !== 200) { finish(upstreamFailure("UPSTREAM_ERROR", "HTTP_STATUS", { httpStatus: res.statusCode })); res.resume(); return; }
        const chunks = [];
        let bytes = 0;
        res.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { finish(fail("ROUTE_TOO_LARGE")); req.destroy(); return; }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (done) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch (_) { finish(fail("INVALID_RESPONSE")); }
        });
        res.on("error", error => finish(upstreamFailure("UPSTREAM_ERROR", "RESPONSE_ERROR", { networkCode: error && error.code })));
        res.on("aborted", () => finish(upstreamFailure("UPSTREAM_ERROR", "RESPONSE_ABORTED")));
      });
      req.on("error", error => finish(upstreamFailure("UPSTREAM_ERROR", "REQUEST_ERROR", { networkCode: error && error.code })));
    } catch (error) { finish(upstreamFailure("UPSTREAM_ERROR", "REQUEST_THROW", { networkCode: error && error.code })); }
  });
}
function parseWalking(body) {
  // 高德距离超限是明确的规划限制，单独返回受控错误供页面引导原生地图。
  if (body && body.status === "0" && body.infocode === "20803") throw fail("WALKING_RANGE_EXCEEDED");
  if (!body || body.status !== "1" || body.infocode !== "10000") throw upstreamFailure("UPSTREAM_ERROR", "AMAP_STATUS", {
    amapStatus: body && body.status, amapInfocode: body && body.infocode
  });
  if (!body.route || !Array.isArray(body.route.paths)) throw fail("INVALID_RESPONSE");
  if (!body.route.paths.length) throw fail("ROUTE_UNAVAILABLE");
  const path = body.route.paths.find(p => p && Array.isArray(p.steps) && p.steps.length);
  if (!path) throw fail("ROUTE_UNAVAILABLE");
  const numeric = value => {
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d+)?$/.test(String(value))) throw fail("INVALID_RESPONSE");
    const n = Number(value);
    if (!Number.isFinite(n)) throw fail("INVALID_RESPONSE");
    return n;
  };
  if (!path || !Array.isArray(path.steps) || !path.steps.length) throw fail("INVALID_RESPONSE");
  const distanceMeters = numeric(path.distance);
  const durationSeconds = numeric(path.duration);
  const points = [];
  for (const step of path.steps) {
    if (!step || typeof step.polyline !== "string" || !step.polyline) throw fail("INVALID_RESPONSE");
    for (const pair of step.polyline.split(";")) {
      if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(pair)) throw fail("INVALID_RESPONSE");
      const [longitude, latitude] = pair.split(",").map(Number);
      const point = { latitude, longitude };
      if (!validPoint(point)) throw fail("INVALID_RESPONSE");
      // 只去除相邻、数值完全相同的点（含step边界）；不排序、不全局去重、不简化。
      const previous = points[points.length - 1];
      if (previous && previous.latitude === latitude && previous.longitude === longitude) continue;
      points.push(point);
      if (points.length > 5000) throw fail("ROUTE_TOO_LARGE");
    }
  }
  if (points.length < 2) throw fail("ROUTE_UNAVAILABLE");
  return { distanceMeters, durationSeconds, points };
}
exports.main = async event => {
  try {
    const context = cloud.getWXContext();
    if (!context || context.APPID !== APP_ID || typeof context.OPENID !== "string" || !context.OPENID.trim()
      || context.SOURCE !== "wx_client") throw fail("AUTH_REQUIRED");
    validateInput(event);
    const key = process.env.AMAP_WEB_SERVICE_KEY;
    if (typeof key !== "string" || !key.trim()) throw fail("SERVER_CONFIG_ERROR");
    const db = cloud.database();
    await consumeLimit(db, `${context.APPID}:${context.OPENID}`, Date.now());
    const planned = parseWalking(await fetchWalking(position(event.origin), position(event.destination), key));
    return { success: true, ...planned };
  } catch (error) {
    // 不输出上游URL、body、坐标、Key或堆栈。
    const errorCode = Object.prototype.hasOwnProperty.call(messages, error && error.code) ? error.code : "SERVER_CONFIG_ERROR";
    const upstreamStages = ["TIMEOUT", "HTTP_STATUS", "RESPONSE_ERROR", "RESPONSE_ABORTED", "REQUEST_ERROR", "REQUEST_THROW", "AMAP_STATUS"];
    if (["UPSTREAM_ERROR", "UPSTREAM_TIMEOUT"].includes(errorCode) && error.upstreamDiagnostic
      && upstreamStages.includes(error.upstreamDiagnostic.stage)) {
      // 日志失败不改变原业务返回；诊断值均由上方白名单构造。
      try {
        const safe = upstreamFailure(errorCode, error.upstreamDiagnostic.stage, error.upstreamDiagnostic).upstreamDiagnostic;
        console.warn("[NAV_UPSTREAM_20261011_D]", JSON.stringify({ errorCode, ...safe }));
      } catch (_) {}
    }
    const reasons = ["EVENT_SHAPE", "TOP_FIELDS", "ORIGIN_VALUES", "DESTINATION_VALUES", "ORIGIN_FIELDS", "DESTINATION_FIELDS"];
    const diagnostic = errorCode === "INVALID_COORDINATES" && reasons.includes(error.inputReason)
      ? ` [NAV_INPUT_20261009_B:${error.inputReason}]` : "";
    const fieldDiagnostic = errorCode === "INVALID_COORDINATES" && error.inputReason === "TOP_FIELDS"
      ? ` [NAV_TOP_KEYS_20261009_C:${error.diagnosticFieldNames}]` : "";
    return { success: false, errorCode, message: messages[errorCode] + diagnostic + fieldDiagnostic };
  }
};

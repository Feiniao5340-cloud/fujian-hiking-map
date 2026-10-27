// 前台SDK是小程序级资源；保留唯一会话直到迟到启动/停止完成。
let owner = null;
const messages = {
  UNSUPPORTED: "当前微信环境不支持前台循迹，请更新微信后重试。",
  PRIVACY_REQUIRED: "请先阅读并同意隐私指引，再开始循迹。",
  PRIVACY_FAILED: "无法确认隐私授权，请稍后重试。",
  LOCATION_DENIED: "未获得位置权限。可在小程序设置中允许位置后重试。",
  LOCATION_FAILED: "位置更新失败，已停止循迹，可稍后重试。",
  START_FAILED: "前台定位启动失败，请检查系统定位开关后重试。",
  TIMEOUT: "定位等待超时，请检查定位权限与系统定位开关。",
  STOP_FAILED: "停止定位未确认，请再次停止；暂不能开启新的循迹。",
  BUSY: "上一次定位仍在清理，请稍后重试停止。",
  CANCELLED: "循迹已取消。"
};
function failure(code) { return Object.assign(new Error(messages[code]), { code }); }
function errorMessage(code) { return messages[code] || messages.LOCATION_FAILED; }
function deadline(promise, code, milliseconds = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failure(code)), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
function request(name, options, code) {
  return deadline(new Promise((resolve, reject) => {
    try { wx[name]({ ...options, success: resolve, fail: () => reject(failure(code)) }); }
    catch (_) { reject(failure(code)); }
  }), code);
}
function validLocation(point) {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && !(point.latitude === 0 && point.longitude === 0);
}
function createSession({ onLocation, onError }) {
  let cancelled = false, requested = false, pending = false, started = false, listening = false, errorListening = false;
  let startSettled = Promise.resolve(), startPromise = null, stopPromise = null, stopInFlight = null;
  const session = { start, stop, get cancelled() { return cancelled; },
    get cleanupState() { return { pending, started, listening, errorListening, ownsLocation: owner === session }; } };
  const release = () => { if (owner === session && !pending && !started && !listening && !errorListening) owner = null; };
  const current = () => !cancelled && owner === session;
  const check = () => { if (!current()) throw failure("CANCELLED"); };
  const listener = point => {
    if (!current() || !started || !validLocation(point)) return;
    onLocation({ latitude: point.latitude, longitude: point.longitude,
      accuracy: Number.isFinite(point.accuracy) && point.accuracy >= 0 ? point.accuracy : null,
      updatedAt: Date.now() });
  };
  const errorListener = () => {
    if (current() && started) onError(failure("LOCATION_FAILED"));
  };
  function detach() {
    if (listening) {
      try { wx.offLocationChange(listener); listening = false; } catch (_) { /* 保留未确认解绑，允许主动重试 */ }
    }
    if (errorListening) {
      try { wx.offLocationChangeError(errorListener); errorListening = false; } catch (_) { /* 取消标志屏蔽旧错误 */ }
    }
  }
  function stopSdk() {
    if (!started) { release(); return Promise.resolve(); }
    if (stopInFlight) return stopInFlight;
    const operation = new Promise((resolve, reject) => {
      try {
        wx.stopLocationUpdate({ success() { started = false; release(); resolve(); },
          fail() { reject(failure("STOP_FAILED")); } });
      } catch (_) { reject(failure("STOP_FAILED")); }
    });
    // 超时只结束页面等待，不清除未回执的SDK操作；避免重试与迟到stop跨会话。
    stopInFlight = operation;
    stopInFlight.then(() => { stopInFlight = null; }, () => { stopInFlight = null; });
    return stopInFlight;
  }
  function stop() {
    cancelled = true;
    detach();
    if (stopPromise) return stopPromise;
    if (!requested && !listening && !errorListening) { release(); return Promise.resolve(); }
    // SDK尚未回执时不能释放锁。迟到success必须先stop，禁止启动下一个会话。
    const operation = Promise.resolve().then(async () => {
      if (pending) await startSettled;
      await stopSdk();
      if (listening || errorListening) throw failure("STOP_FAILED");
      release();
    });
    stopPromise = deadline(operation, "STOP_FAILED", 8000);
    stopPromise.then(() => { stopPromise = null; }, () => { stopPromise = null; });
    return stopPromise;
  }
  function start() {
    if (cancelled) return Promise.reject(failure("CANCELLED"));
    // 在任何异步权限查询前缓存同一Promise；取消状态与SDK实际状态独立。
    if (!startPromise) startPromise = Promise.resolve().then(startOnce);
    return startPromise;
  }
  async function startOnce() {
    if (owner && owner !== session) {
      if (!owner.cancelled) throw failure("BUSY");
      // 已退出页面的失败清理也可由下一次主动开始重试，不丢失会话锁。
      try { await owner.stop(); } catch (_) { throw failure("BUSY"); }
      if (owner) throw failure("BUSY");
    }
    if (cancelled || requested) throw failure("CANCELLED");
    const required = ["getPrivacySetting", "authorize", "startLocationUpdate", "stopLocationUpdate", "onLocationChange", "offLocationChange"];
    if (required.some(name => typeof wx[name] !== "function")) throw failure("UNSUPPORTED");
    owner = session;
    try {
      const privacy = await request("getPrivacySetting", {}, "PRIVACY_FAILED");
      check();
      if (!privacy || typeof privacy.needAuthorization !== "boolean") throw failure("PRIVACY_FAILED");
      if (privacy.needAuthorization) throw failure("PRIVACY_REQUIRED");
      await request("authorize", { scope: "scope.userLocation" }, "LOCATION_DENIED");
      check();
      listening = true;
      wx.onLocationChange(listener);
      if (typeof wx.onLocationChangeError === "function" && typeof wx.offLocationChangeError === "function") {
        errorListening = true; wx.onLocationChangeError(errorListener);
      }
      requested = true; pending = true;
      const sdkStart = new Promise((resolve, reject) => {
        try {
          wx.startLocationUpdate({ type: "gcj02", success() { pending = false; started = true; resolve(); },
            fail() { pending = false; release(); reject(failure("START_FAILED")); } });
        } catch (_) { pending = false; release(); reject(failure("START_FAILED")); }
      });
      startSettled = sdkStart.then(() => undefined, () => undefined);
      sdkStart.then(() => { if (cancelled) stop().catch(() => {}); }, () => {});
      await deadline(sdkStart, "TIMEOUT");
      check();
    } catch (error) {
      stop().catch(() => {});
      throw error && messages[error.code] ? error : failure("START_FAILED");
    }
  }
  return session;
}
module.exports = { createSession, errorMessage };

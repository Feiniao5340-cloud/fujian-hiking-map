// 纯模拟：由调用方驱动真实等待时间；无计时器、定位、网络或持久化。
const core = require("./trail-progress");
const ROUTE_IDS = ["fj-route-005", "fj-route-006", "fj-route-008", "fj-route-009", "fj-route-010", "fj-route-011"];
const TIMING = Object.freeze({ epochMs: 1000000, accuracy: 5, startIntervalMs: 2000,
  travelIntervalMs: 10000, stepMeters: 20, finishIntervalMs: 2000, finishObservations: 10, maxAdvanceMs: 60000 });

const FAST_DEMO = Object.freeze({ targetMs: 17000, refreshMs: 100, maxFramesPerBatch: 8, workBudgetMs: 4, yieldMs: 2, visualRefreshMs: 40, lookAheadMs: 500 });
const cpuNow = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

// 仅缓存原B1对不可变轨迹数组的静态校验；定位/状态/候选计算每次仍真实执行。
function freezeSimulationIndex(index) {
  const segments = index.segments, every = Array.prototype.every;
  for (const segment of segments) { Object.freeze(segment.a); Object.freeze(segment.b); Object.freeze(segment); }
  Object.freeze(index.startPoint); Object.freeze(index.finishPoint);
  const validation = "s&&validPoint(s.a)&&validPoint(s.b)&&Number.isFinite(s.lengthMeters)&&s.lengthMeters>0&&Number.isFinite(s.startMeters)&&Number.isFinite(s.endMeters)";
  let cached;
  const stats = { scans: 0, hits: 0, fallbackScans: 0 };
  Object.defineProperty(segments, "every", { value(predicate, thisArg) {
    // 精确限定无捕获变量的静态谓词。将来B1更改谓词时自动退回完整扫描。
    const text = String(predicate).replace(/\s/g, "");
    const match = /^(?:\(([\w$]+)\)|([\w$]+))=>(.*)$/.exec(text) || /^function(?:[\w$]+)?\(([\w$]+)\)\{return(.*?);?\}$/.exec(text);
    const parameter = match && (match[1] || match[2]);
    const body = match && (match.length === 4 ? match[3] : match[2]);
    const normalized = parameter && body.replace(new RegExp("\\b" + parameter + "\\b", "g"), "s");
    if (this !== segments || normalized !== validation || thisArg !== undefined) { stats.fallbackScans++; return every.call(this, predicate, thisArg); }
    if (cached === undefined) { stats.scans++; cached = every.call(segments, predicate); } else stats.hits++;
    return cached;
  } });
  Object.freeze(segments);
  return stats;
}

function createSimulator(route, options = {}) {
  const fast = !!(options && options.fastDemo === true);
  const visual = fast && options.visualPlayback === true;
  let computedFinished = false, visualDistance = 0, validationStats = null;
  let demoActiveElapsedMs = 0, demoVirtualDurationMs = 0, batchFrames = 0, batchCpuMs = 0;
  let index = null, model = null, routeId = null, startPoint = null;
  let status = "idle", error = null, location = null, distance = 0, elapsed = 0;
  let credit = 0, rate = 1, startCount = 0, finishCount = 0, observations = 0;
  try {
    // 会话独占几何副本，调用方修改对象不会改变本轮播放；预处理仅执行一次。
    const input = JSON.parse(JSON.stringify(route));
    if (!input || !ROUTE_IDS.includes(input._id)) throw new Error("INVALID_ROUTE");
    index = core.buildTrailIndex(input);
    if (index.status !== "ready") throw new Error("INVALID_ROUTE");
    validationStats = freezeSimulationIndex(index);
    routeId = input._id;
    startPoint = { latitude: input.startPoint.latitude, longitude: input.startPoint.longitude };
    model = core.createProgressState(index);
    // 以原轨迹全长估算上限；太姥山的前缀起点会略提前结束，不跳过任何观测。
    demoVirtualDurationMs = core.POLICY.startCount * TIMING.startIntervalMs
      + Math.ceil(index.totalTrackMeters / TIMING.stepMeters) * TIMING.travelIntervalMs
      + TIMING.finishObservations * TIMING.finishIntervalMs;
  } catch (_) { index = null; status = "error"; error = "INVALID_ROUTE"; }

  function snapshot() {
    const known = model && Number.isFinite(model.cursorMeters);
    // 视觉沿原轨迹累计距离前进，最多到已真实处理的观测前沿，不认领B1进度。
    const visualMeters = visual ? visualDistance : distance;
    const visualLocation = visual ? (location && startCount >= core.POLICY.startCount ? position(visualMeters) : null) : location;
    return Object.freeze({ mode: "simulation", routeId, playbackStatus: status, playbackRate: rate,
      simulatedLocation: location ? Object.freeze({ ...location }) : null,
      playbackDistanceMeters: distance, playbackRatio: index ? distance / index.totalTrackMeters : null,
      matchedProgressMeters: known ? model.cursorMeters : null,
      matchedProgressRatio: known ? model.cursorMeters / index.totalTrackMeters : null,
      remainingMeters: known ? Math.max(0, index.totalTrackMeters - model.cursorMeters) : null,
      b1Phase: model ? model.phase : "unavailable", locationQuality: model ? model.locationQuality : "unavailable",
      b1Reason: model ? model.reason : null,
      canConfirmCompletion: !!(model && core.canConfirmCompletion(index, model, TIMING.epochMs + elapsed)),
      actualOutdoorCompleted: false, virtualElapsedMs: elapsed, observationCount: observations, errorCode: error,
      visualPlayback: visual, visualLocation: visualLocation ? Object.freeze({ latitude: visualLocation.latitude, longitude: visualLocation.longitude }) : null,
      visualDistanceMeters: visualMeters, visualRatio: index ? visualMeters / index.totalTrackMeters : null,
      b1ComputedFinished: computedFinished,
      staticValidationCache: visual && validationStats ? Object.freeze({ ...validationStats }) : null,
      fastDemo: fast, demoTargetMs: fast ? FAST_DEMO.targetMs : null, demoActiveElapsedMs,
      hasPendingFrames: !!(fast && index && status === "playing" && !computedFinished && credit >= interval()),
      lastBatchFrames: batchFrames, lastBatchCpuMs: batchCpuMs });
  }
  function reject(code) { error = code; return snapshot(); }
  function available() { return status !== "disposed" && !!index; }
  function blocked() { return reject(status === "disposed" ? "DISPOSED" : "INVALID_ROUTE"); }
  function position(meters) {
    // 二分复用B1已构建的累计线段；不再全量预处理、不重排或闭合轨迹。
    let low = 0, high = index.segments.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (index.segments[mid].endMeters < meters) low = mid + 1; else high = mid;
    }
    const segment = index.segments[low];
    const t = Math.max(0, Math.min(1, (meters - segment.startMeters) / segment.lengthMeters));
    return { latitude: segment.a.latitude + t * (segment.b.latitude - segment.a.latitude),
      longitude: segment.a.longitude + t * (segment.b.longitude - segment.a.longitude) };
  }
  function interval() {
    return startCount < core.POLICY.startCount ? TIMING.startIntervalMs
      : distance < index.totalTrackMeters ? TIMING.travelIntervalMs : TIMING.finishIntervalMs;
  }
  function observe() {
    elapsed += interval();
    let point;
    if (startCount < core.POLICY.startCount) { point = startPoint; startCount++; }
    else if (distance < index.totalTrackMeters) {
      distance = Math.min(index.totalTrackMeters, distance + TIMING.stepMeters); point = position(distance);
    } else { point = index.finishPoint; finishCount++; }
    location = { ...point, accuracy: TIMING.accuracy, updatedAt: TIMING.epochMs + elapsed };
    model = core.updateTrailProgress(index, model, location, location.updatedAt).state;
    observations++;
    if (startCount === core.POLICY.startCount && observations === startCount) {
      if (model.phase !== "following") { status = "error"; error = "START_NOT_CONFIRMED"; }
      else { distance = model.cursorMeters; if (visual) visualDistance = model.cursorMeters; } // 太姥山等使用真实起点匹配结果，而非强设track[0]。
    }
    if (finishCount >= TIMING.finishObservations) {
      const qualified = core.canConfirmCompletion(index, model, location.updatedAt);
      computedFinished = qualified;
      status = qualified ? (visual ? "playing" : "finished") : "error";
      error = qualified ? null : "FINISH_NOT_CONFIRMED";
    }
  }
  function start() {
    if (!available()) return blocked();
    if (status === "playing") { error = null; return snapshot(); }
    if (status !== "idle") return reject("INVALID_STATE");
    status = "playing"; error = null;
    if (visual) credit = FAST_DEMO.lookAheadMs * demoVirtualDurationMs / FAST_DEMO.targetMs;
    return snapshot();
  }
  function advance(realElapsedMs) {
    if (!available()) return blocked();
    if (!Number.isFinite(realElapsedMs) || realElapsedMs <= 0 || realElapsedMs > TIMING.maxAdvanceMs) return reject("INVALID_TIME_STEP");
    if (status !== "playing") return snapshot();
    error = null;
    if (fast) { demoActiveElapsedMs += realElapsedMs;
      credit += realElapsedMs * demoVirtualDurationMs / FAST_DEMO.targetMs; consumeBatch();
      if (visual && startCount >= core.POLICY.startCount && Number.isFinite(model.startCursorMeters)) {
        const remaining = index.totalTrackMeters - model.startCursorMeters;
        const scheduled = model.startCursorMeters + remaining * Math.min(1, demoActiveElapsedMs / FAST_DEMO.targetMs);
        // 计算积压后也不突然追跳：视觉只按本次真实前台delta增加原轨迹里程。
        visualDistance = Math.min(distance, scheduled, visualDistance + remaining * realElapsedMs / FAST_DEMO.targetMs);
        if (computedFinished && demoActiveElapsedMs >= FAST_DEMO.targetMs && visualDistance >= index.totalTrackMeters - 1e-7) {
          visualDistance = index.totalTrackMeters; status = "finished"; credit = 0;
        }
      }
      return snapshot(); }
    credit += realElapsedMs * rate;
    while (status === "playing" && credit >= interval()) { credit -= interval(); observe(); }
    if (status !== "playing") credit = 0;
    return snapshot();
  }
  function consumeBatch() {
    const begin = cpuNow(); batchFrames = 0;
    while (status === "playing" && !computedFinished && credit >= interval() && batchFrames < FAST_DEMO.maxFramesPerBatch) {
      credit -= interval(); observe(); batchFrames++;
      // B1单帧不可中断，预算在帧间检查；最多超出一次单帧计算时间。
      if (cpuNow() - begin >= FAST_DEMO.workBudgetMs) break;
    }
    batchCpuMs = cpuNow() - begin;
    if (status !== "playing") credit = 0;
    return snapshot();
  }
  function drain() {
    if (!available()) return blocked();
    if (!fast) return reject("INVALID_MODE");
    return status === "playing" ? consumeBatch() : snapshot(); // 不增加真实或虚拟时间信用。
  }
  function pause() {
    if (!available()) return blocked();
    if (status !== "playing" && status !== "paused") return reject("INVALID_STATE");
    // 播放暂停，不是假GPS断流：虚拟时间不走，原B1模型不变，保留不足一帧的credit。
    status = "paused"; error = null; return snapshot();
  }
  function resume() {
    if (!available()) return blocked();
    if (status !== "paused") return reject("INVALID_STATE");
    status = "playing"; error = null; return snapshot();
  }
  function setPlaybackRate(value) {
    if (!available()) return blocked();
    if (fast) return reject("FIXED_DEMO_MODE");
    if (![1, 2, 4].includes(value)) return reject("INVALID_PLAYBACK_RATE");
    rate = value; error = null; return snapshot();
  }
  function restart() {
    if (!available()) return blocked();
    model = core.createProgressState(index); location = null; distance = elapsed = credit = 0;
    computedFinished = false; visualDistance = 0; startCount = finishCount = observations = 0; status = "idle"; error = null;
    demoActiveElapsedMs = batchFrames = batchCpuMs = 0;
    return snapshot(); // 保留选定倍率；调用start明确启动新一轮。
  }
  function dispose() {
    index = model = startPoint = location = routeId = null;
    distance = elapsed = credit = observations = startCount = finishCount = 0;
    demoActiveElapsedMs = demoVirtualDurationMs = batchFrames = batchCpuMs = 0;
    computedFinished = false; visualDistance = 0; validationStats = null; status = "disposed"; error = null; return snapshot();
  }
  function switchRoute(nextRoute) { dispose(); return createSimulator(nextRoute, { fastDemo: fast, visualPlayback: visual }); }
  return Object.freeze({ start, advance, drain, pause, resume, setPlaybackRate, restart, getSnapshot: snapshot, dispose, switchRoute });
}

module.exports = { createSimulator, TIMING, FAST_DEMO };

// D022纯计算；不调用wx/网络，不修改track，不保存运动历史。候选阈值待实测校准。
const POLICY = Object.freeze({ reliableAccuracy: 30, degradedAccuracy: 80, freshMs: 15000,
  prefixMeters: 80, startRadius: 60, startCount: 3, startMs: 4000,
  speed: 3, maxGapMs: 20000, maxForward: 120, backward: 30,
  confirmCount: 3, confirmMs: 4000, departureMeters: 60,
  offCount: 3, offMs: 8000, returnCount: 3, returnMs: 5000,
  finishRatio: 0.98, finishRadius: 50, finishCount: 3, finishMs: 4000 });
const rad = n => n * Math.PI / 180;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
function validPoint(p) {
  return !!p && typeof p === "object" && !Array.isArray(p)
    && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180
    && !(p.latitude === 0 && p.longitude === 0);
}
function distance(a, b) {
  if (!validPoint(a) || !validPoint(b)) return null;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}
function project(point, segment) {
  // 各段附近局部米制平面；不转换GCJ-02，不生成新轨迹。
  const scale = 6371000 * Math.cos(rad((segment.a.latitude + segment.b.latitude) / 2));
  const bx = rad(segment.b.longitude - segment.a.longitude) * scale;
  const by = rad(segment.b.latitude - segment.a.latitude) * 6371000;
  const px = rad(point.longitude - segment.a.longitude) * scale;
  const py = rad(point.latitude - segment.a.latitude) * 6371000;
  const t = clamp((px * bx + py * by) / (bx * bx + by * by), 0, 1);
  return { segmentIndex: segment.segmentIndex, s: segment.startMeters + t * segment.lengthMeters,
    distanceMeters: Math.hypot(px - t * bx, py - t * by) };
}
function buildTrailIndex(route) {
  const unavailable = reason => ({ status: "unavailable", reason, calibration: "CALIBRATION_PENDING" });
  if (!route || route.coordinateSystem !== "gcj02" || typeof route._id !== "string" || !route._id
    || typeof route.updatedAt !== "string" || !["loop", "outAndBack", "pointToPoint"].includes(route.routeType)
    || !validPoint(route.startPoint) || !Array.isArray(route.track) || route.track.length < 2) return unavailable("INVALID_ROUTE");
  for (const p of route.track) if (!validPoint(p)) return unavailable("INVALID_ROUTE");
  const segments = [], cumulativeMeters = [0];
  let totalTrackMeters = 0;
  for (let i = 0; i < route.track.length - 1; i++) {
    const lengthMeters = distance(route.track[i], route.track[i + 1]);
    if (lengthMeters > 0) segments.push({ segmentIndex: i, a: route.track[i], b: route.track[i + 1],
      lengthMeters, startMeters: totalTrackMeters, endMeters: totalTrackMeters + lengthMeters });
    totalTrackMeters += lengthMeters;
    cumulativeMeters.push(totalTrackMeters);
  }
  if (!segments.length) return unavailable("NO_DISTINCT_POINTS");
  if (totalTrackMeters < 200) return unavailable("ROUTE_TOO_SHORT");
  const prefixStartCandidates = segments.map(s => project(route.startPoint, s))
    .filter(c => c.s <= POLICY.prefixMeters && c.distanceMeters <= 20);
  if (!prefixStartCandidates.length) return unavailable("START_OUTSIDE_PREFIX");
  return { status: "ready", routeIdentity: `${route._id}|${route.updatedAt}`, segments, cumulativeMeters,
    totalTrackMeters, prefixStartCandidates, startPoint: route.startPoint,
    finishPoint: route.track[route.track.length - 1], policy: POLICY, calibration: "CALIBRATION_PENDING",
    issues: segments.some(s => s.lengthMeters > 200) ? ["SPARSE_SEGMENTS"] : [] };
}
function createProgressState(index) {
  return { phase: index && index.status === "ready" ? "starting" : "unavailable",
    routeIdentity: index && index.routeIdentity || null, cursorMeters: null, segmentIndex: null,
    startCursorMeters: null, maxConfirmedMeters: null, hasDeparted: false, departureCount: 0,
    activeReliableSeconds: 0, initialAllowance: null, cursorAt: null, lastObservedAt: null,
    lastReliablePosition: null, anchor: null, continuityBroken: true, pending: null,
    startEvidence: null, offEvidence: null, returnEvidence: null, finishEvidence: null,
    offRouteStatus: "unknown", locationQuality: "unavailable", canConfirmCompletion: false,
    globalDistanceMeters: null, reason: null, branches: null, positionContinuous: false, ambiguityActive: false };
}
// 仅保留少量沿线标量候选，不保存用户坐标历史。分支随连续观测延续，
// confirmed cursor冻结时也不会把每次恢复窗口重新钉死在旧cursor。
function matchBranches(candidates, state, point) {
  const a = point.accuracy, span = 20 + 2 * a;
  const previous = Array.isArray(state.branches) && state.branches.length ? state.branches :
    [{ s: state.cursorMeters, segmentIndex: state.segmentIndex, at: state.cursorAt, rate: 0, score: 0 }];
  const options = [];
  for (const c of candidates) {
    let best = null;
    for (const branch of previous) {
      if (!branch || !Number.isFinite(branch.s) || !Number.isFinite(branch.at) || branch.at > point.updatedAt
        || !Number.isFinite(branch.rate) || Math.abs(branch.rate) > POLICY.speed || !Number.isFinite(branch.score)) continue;
      if (state.branches && point.updatedAt - branch.at > POLICY.maxGapMs) continue;
      const seconds = Math.min(POLICY.maxGapMs, Math.max(0, point.updatedAt - branch.at)) / 1000;
      const delta = c.s - branch.s;
      const reach = state.positionContinuous ? Math.min(POLICY.maxForward, POLICY.speed * seconds + span) : span;
      if (Math.abs(delta) > reach) continue;
      const score = branch.score + c.distanceMeters / Math.max(1, a)
        + Math.abs(delta - branch.rate * seconds) / span;
      if (!best || score < best.score) best = { ...c, score, at: point.updatedAt,
        fromS: branch.s, rate: seconds ? clamp(delta / seconds, -POLICY.speed, POLICY.speed) : branch.rate };
    }
    if (best) options.push(best);
  }
  options.sort((x, y) => x.score - y.score || x.distanceMeters - y.distanceMeters);
  // 减去公共基线只防止数值增长，不遗忘分支切换造成的历史代价。
  const baseline = options.length ? options[0].score : 0;
  for (const c of options) c.score -= baseline;
  const branches = [];
  for (const c of options) {
    if (!branches.some(b => Math.abs(b.s - c.s) <= clamp(a / 2, 5, 15))) branches.push(c);
    // 三条是内存上限，不是路线ID、里程或完成门槛。
    if (branches.length === 3) break;
  }
  return { best: options[0], branches };
}
function evidence(previous, time) {
  return previous ? { count: previous.count + 1, since: previous.since } : { count: 1, since: time };
}
// 暂停只留标量；恢复锚从公开track重建，不保留暂停前的用户坐标。
function pauseProgressState(index, previous) {
  if (!index || index.status !== "ready" || !previous || previous.routeIdentity !== index.routeIdentity
    || !Number.isFinite(previous.cursorMeters) || previous.cursorMeters < 0 || previous.cursorMeters > index.totalTrackMeters) return createProgressState(index);
  return { ...previous, phase: "paused", lastReliablePosition: null, anchor: null,
    lastObservedAt: null, cursorAt: null, continuityBroken: true, pending: null, branches: null, positionContinuous: false, ambiguityActive: false,
    startEvidence: null, offEvidence: null, returnEvidence: null, finishEvidence: null,
    departureCount: 0, canConfirmCompletion: false, locationQuality: "unavailable", globalDistanceMeters: null, reason: null };
}
function resumeProgressState(index, previous) {
  const state = pauseProgressState(index, previous);
  if (state.phase !== "paused") return state;
  if (!Array.isArray(index.segments) || !index.segments.length) return { ...createProgressState(index), phase: "unavailable", reason: "INVALID_INDEX" };
  const segment = index.segments[lowerSegment(index.segments, state.cursorMeters)];
  if (!segment || !validPoint(segment.a) || !validPoint(segment.b) || !Number.isFinite(segment.lengthMeters) || segment.lengthMeters <= 0) return { ...createProgressState(index), phase: "unavailable", reason: "INVALID_INDEX" };
  const t = clamp((state.cursorMeters - segment.startMeters) / segment.lengthMeters, 0, 1);
  return { ...state, phase: "resuming", cursorAt: 0, anchor: {
    latitude: segment.a.latitude + t * (segment.b.latitude - segment.a.latitude),
    longitude: segment.a.longitude + t * (segment.b.longitude - segment.a.longitude) } };
}
function sufficient(e, count, span, time) { return !!e && e.count >= count && time - e.since >= span; }
function output(index, state) {
  const known = Number.isFinite(state.cursorMeters) && index && index.status === "ready";
  return { state, phase: state.phase, locationQuality: state.locationQuality, offRouteStatus: state.offRouteStatus,
    progressMeters: known ? state.cursorMeters : null,
    progressRatio: known ? state.cursorMeters / index.totalTrackMeters : null,
    remainingMeters: known ? Math.max(0, index.totalTrackMeters - state.cursorMeters) : null,
    canConfirmCompletion: state.canConfirmCompletion, reason: state.reason };
}
function lowerSegment(segments, meters) {
  let low = 0, high = segments.length;
  while (low < high) { const middle = (low + high) >> 1;
    if (segments[middle].endMeters < meters) low = middle + 1; else high = middle; }
  return low;
}
function updateTrailProgress(index, previous, point, now) {
  const state = { ...(previous || createProgressState(index)), canConfirmCompletion: false, reason: null };
  const freeze = (quality, reason) => {
    Object.assign(state, { locationQuality: quality, reason, continuityBroken: true, pending: null, branches: null, positionContinuous: false, ambiguityActive: false,
      startEvidence: null, finishEvidence: null, offEvidence: null, returnEvidence: null, departureCount: 0 });
    return output(index, state);
  };
  if (!index || index.status !== "ready" || !Array.isArray(index.segments) || !index.segments.length
    || !Number.isFinite(index.totalTrackMeters) || index.totalTrackMeters <= 0
    || !validPoint(index.startPoint) || !validPoint(index.finishPoint)
    || !index.segments.every(s => s && validPoint(s.a) && validPoint(s.b)
      && Number.isFinite(s.lengthMeters) && s.lengthMeters > 0 && Number.isFinite(s.startMeters) && Number.isFinite(s.endMeters))) {
    state.phase = "unavailable"; state.cursorMeters = null; return freeze("unavailable", "INVALID_INDEX");
  }
  if (state.routeIdentity !== index.routeIdentity || !["starting", "following", "resuming"].includes(state.phase)
    || !Number.isFinite(state.activeReliableSeconds) || state.activeReliableSeconds < 0
    || (state.phase !== "starting" && (!Number.isFinite(state.cursorMeters) || !Number.isFinite(state.startCursorMeters) || !Number.isFinite(state.initialAllowance)
      || !Number.isFinite(state.cursorAt) || !Number.isFinite(state.maxConfirmedMeters)))
    || (state.cursorMeters !== null && (!Number.isFinite(state.cursorMeters)
      || state.cursorMeters < 0 || state.cursorMeters > index.totalTrackMeters))) {
    return output(index, { ...createProgressState(index), reason: "INVALID_STATE" });
  }
  if (!validPoint(point)) return freeze("unavailable", "INVALID_LOCATION");
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(point.updatedAt) || point.updatedAt < 0 || point.updatedAt > now
    || (state.lastObservedAt !== null && point.updatedAt <= state.lastObservedAt)) return freeze("unavailable", "INVALID_TIME");
  const observedGap = state.lastObservedAt === null ? null : point.updatedAt - state.lastObservedAt;
  state.lastObservedAt = point.updatedAt;
  if (now - point.updatedAt > POLICY.freshMs) return freeze("stale", "STALE_LOCATION");
  if (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > POLICY.degradedAccuracy) {
    return freeze("unavailable", "ACCURACY_UNKNOWN_OR_POOR");
  }
  if (point.accuracy > POLICY.reliableAccuracy) return freeze("degraded", "LOW_ACCURACY");
  const a = point.accuracy;
  if (state.phase === "resuming" && (!validPoint(state.anchor) || distance(point, state.anchor) + a > POLICY.startRadius)) return freeze("recovering", "RESUME_TOO_FAR");
  const last = state.lastReliablePosition;
  const gap = last ? point.updatedAt - last.updatedAt : null;
  if (last && (!validPoint(last) || !Number.isFinite(last.accuracy) || !Number.isFinite(last.updatedAt) || gap <= 0)) return freeze("unavailable", "INVALID_ANCHOR");
  if (observedGap > POLICY.maxGapMs) {
    state.continuityBroken = true; state.pending = null; state.branches = null; state.positionContinuous = false;
    state.startEvidence = null; state.offEvidence = null; state.returnEvidence = null; state.finishEvidence = null;
  }
  if (last && gap <= POLICY.maxGapMs && distance(last, point) > POLICY.speed * gap / 1000 + last.accuracy + a + 10) {
    return freeze("jump", "POSITION_JUMP");
  }
  const location = { latitude: point.latitude, longitude: point.longitude, accuracy: a, updatedAt: point.updatedAt };
  state.lastReliablePosition = location;
  // 每个可信位置只全扫一次；复用投影，绝不从全局最近点认领进度。
  const candidates = index.segments.map(s => project(point, s));
  const globalDistance = candidates.reduce((minimum, c) => Math.min(minimum, c.distanceMeters), Infinity);
  state.globalDistanceMeters = globalDistance;
  state.locationQuality = "reliable";
  if (globalDistance > 30 + 1.5 * a) {
    state.offEvidence = evidence(state.offEvidence, point.updatedAt); state.returnEvidence = null;
    if (sufficient(state.offEvidence, POLICY.offCount, POLICY.offMs, point.updatedAt)) state.offRouteStatus = "suspected";
    state.continuityBroken = true; state.pending = null; state.branches = null; state.positionContinuous = false; state.finishEvidence = null; state.startEvidence = null; state.departureCount = 0;
    state.reason = "OFF_ROUTE_OR_PENDING"; return output(index, state);
  }
  state.offEvidence = null;
  if (state.offRouteStatus === "suspected") {
    state.returnEvidence = globalDistance <= 15 + a ? evidence(state.returnEvidence, point.updatedAt) : null;
    if (!sufficient(state.returnEvidence, POLICY.returnCount, POLICY.returnMs, point.updatedAt)) {
      state.reason = "RETURN_PENDING"; return output(index, state);
    }
    state.offRouteStatus = "near"; state.continuityBroken = true;
  } else state.offRouteStatus = "near";
  const starting = state.phase === "starting";
  const seconds = state.positionContinuous && gap && gap <= POLICY.maxGapMs && state.phase !== "resuming" ? gap / 1000 : 0;
  const activeSeconds = state.activeReliableSeconds + seconds;
  let local = candidates.filter(c => c.distanceMeters <= Math.min(clamp(15 + 1.5 * a, 20, 60), globalDistance + a)
    && c.s - (state.startCursorMeters || 0) <= POLICY.speed * activeSeconds + (state.initialAllowance || 20 + 2 * a));
  let best, branches;
  const envelopeSeconds = state.cursorAt === null ? 0 : Math.min(20, (point.updatedAt - state.cursorAt) / 1000);
  const geometryCandidates = local.filter(c => c.s >= Math.max(0, (state.cursorMeters || 0) - POLICY.backward - a)
    && c.s <= (state.cursorMeters || 0) + Math.min(POLICY.maxForward, POLICY.speed * envelopeSeconds + 20 + 2 * a));
  if (starting) {
    local = candidates.filter(c => c.s <= POLICY.prefixMeters && c.distanceMeters <= clamp(15 + 1.5 * a, 20, 60));
    local.sort((x, y) => x.distanceMeters - y.distanceMeters || x.s - y.s);
    best = local[0];
  } else {
    const matched = matchBranches(local, state, point);
    best = matched.best; branches = matched.branches;
    if (best) local = branches;
  }
  if (!best) {
    // 单次匹配失败并非GPS失效；短时保留原候选，不认领位移或补计时间。
    // 到期后仍走原freeze，禁止长断流后全局重捕获/直接跳进度。
    if (!starting && Array.isArray(state.branches) && state.branches.some(b => b && Number.isFinite(b.at)
      && point.updatedAt - b.at <= POLICY.maxGapMs)) {
      Object.assign(state, { locationQuality: "recovering", reason: "NO_LOCAL_MATCH", continuityBroken: true,
        pending: null, finishEvidence: null, departureCount: 0 });
      return output(index, state);
    }
    return freeze("recovering", "NO_LOCAL_MATCH");
  }
  const geometricAmbiguity = (starting ? local : geometryCandidates).some(c => Math.abs(c.s - best.s) > Math.max(20, 2 * a)
    && Math.abs(c.distanceMeters - best.distanceMeters) <= Math.max(3, a));
  const ambiguous = geometricAmbiguity && (!state.ambiguityActive || local.some(c =>
    Math.abs(c.s - best.s) > Math.max(20, 2 * a) && Math.abs(c.score - best.score) <= 1 / POLICY.confirmCount));
  state.ambiguityActive = geometricAmbiguity;
  if (starting && geometricAmbiguity) return freeze("ambiguous", "BRANCH_AMBIGUOUS");
  if (starting) {
    if (distance(point, index.startPoint) + a > POLICY.startRadius) return freeze("unavailable", "NOT_AT_START");
    state.startEvidence = evidence(state.startEvidence, point.updatedAt);
    if (sufficient(state.startEvidence, POLICY.startCount, POLICY.startMs, point.updatedAt)) {
      Object.assign(state, { phase: "following", cursorMeters: best.s, startCursorMeters: best.s,
        maxConfirmedMeters: best.s, segmentIndex: best.segmentIndex, cursorAt: point.updatedAt,
        initialAllowance: 20 + 2 * a, anchor: location, continuityBroken: false, positionContinuous: true,
        branches: [{ ...best, at: point.updatedAt, rate: 0, score: 0 }] });
    }
    return output(index, state);
  }
  if (best.s - state.startCursorMeters > POLICY.speed * activeSeconds + state.initialAllowance) return freeze("jump", "TOTAL_PROGRESS_JUMP");
  state.activeReliableSeconds = activeSeconds;
  state.branches = branches; state.positionContinuous = true;
  if (distance(point, index.startPoint) - a > POLICY.departureMeters
    && state.cursorMeters - state.startCursorMeters > POLICY.departureMeters) state.departureCount++;
  else state.departureCount = 0;
  if (state.departureCount >= 2) state.hasDeparted = true;
  const delta = best.s - state.cursorMeters;
  const deadZone = clamp(a / 2, 5, 15);
  if (Math.abs(delta) > deadZone || state.continuityBroken || ambiguous) {
    const direction = Math.sign(delta);
    const compatible = state.pending && state.pending.direction === direction
      && Math.abs(best.fromS - state.pending.s) <= deadZone
      && Math.abs(best.s - state.pending.s) <= POLICY.speed * Math.min(gap || 0, POLICY.maxGapMs) / 1000 + 20 + 2 * a;
    const e = evidence(compatible ? state.pending : null, point.updatedAt);
    state.pending = { ...e, s: best.s, direction, segmentIndex: best.segmentIndex };
    if (ambiguous || !sufficient(state.pending, POLICY.confirmCount, POLICY.confirmMs, point.updatedAt)) {
      state.reason = ambiguous ? "BRANCH_AMBIGUOUS" : "PROGRESS_CONFIRMING";
      if (ambiguous) { state.locationQuality = "ambiguous"; state.continuityBroken = true; }
      state.finishEvidence = null; return output(index, state);
    }
    Object.assign(state, { phase: "following", cursorMeters: best.s, segmentIndex: best.segmentIndex, cursorAt: point.updatedAt,
      maxConfirmedMeters: Math.max(state.maxConfirmedMeters, best.s), pending: null, anchor: location, continuityBroken: false });
  } else { state.pending = null; state.cursorAt = point.updatedAt; state.anchor = location; }
  const remaining = index.totalTrackMeters - state.cursorMeters;
  const finish = state.hasDeparted && !state.continuityBroken && state.offRouteStatus === "near"
    && state.cursorMeters / index.totalTrackMeters >= POLICY.finishRatio
    && remaining <= Math.min(100, index.totalTrackMeters * 0.01)
    && distance(point, index.finishPoint) + a <= POLICY.finishRadius;
  state.finishEvidence = finish ? evidence(state.finishEvidence, point.updatedAt) : null;
  state.canConfirmCompletion = sufficient(state.finishEvidence, POLICY.finishCount, POLICY.finishMs, point.updatedAt);
  return output(index, state);
}
function canConfirmCompletion(index, state, now) {
  return !!(index && index.status === "ready" && state && state.routeIdentity === index.routeIdentity
    && state.phase === "following" && state.canConfirmCompletion === true && state.hasDeparted
    && state.locationQuality === "reliable" && !state.continuityBroken && !state.pending
    && state.offRouteStatus === "near" && Number.isFinite(now) && state.lastReliablePosition
    && now >= state.lastReliablePosition.updatedAt && now - state.lastReliablePosition.updatedAt <= POLICY.freshMs
    && state.cursorMeters / index.totalTrackMeters >= POLICY.finishRatio
    && index.totalTrackMeters - state.cursorMeters <= Math.min(100, index.totalTrackMeters * 0.01)
    && validPoint(state.lastReliablePosition) && validPoint(index.finishPoint)
    && Number.isFinite(state.lastReliablePosition.accuracy)
    && distance(state.lastReliablePosition, index.finishPoint) + state.lastReliablePosition.accuracy <= POLICY.finishRadius);
}
module.exports = { POLICY, buildTrailIndex, createProgressState, pauseProgressState, resumeProgressState, updateTrailProgress, canConfirmCompletion, distance };

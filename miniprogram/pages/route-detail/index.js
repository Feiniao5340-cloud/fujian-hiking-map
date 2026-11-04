const { getRouteById } = require("../../services/route-service");
const { toStartMapData, composeNavigationMap } = require("../../utils/map-data");
const navigation = require("../../services/navigation-service");
const trailFollow = require("../../services/trail-follow-service");
const progress = require("../../utils/trail-progress");
const simulator = require("../../utils/trail-simulator");
const SIMULATION_MARKER_ID = -2;
// OWNER_CONFIRMED：当前账号前台接口及含两种位置用途的隐私指引已生效。
// 前台GPS许可与Access独立；身份形状检查不代替账号归属或平台审核。
const gpsRelease = require("../../config/gps-release");
const routeEnvironment = require("../../config/env");
function privateFollowBlock(route) {
  try {
    const account = wx.getAccountInfoSync().miniProgram;
    if (!account || !/^wx[0-9a-f]{16}$/i.test(account.appId) || !["develop", "trial", "release"].includes(account.envVersion))
      return "真实循迹仅供当前已获准账号的私人开发／体验版测试；请核对运行身份，正式版暂未启用。";
  } catch (_) { return "无法确认私人开发／体验版运行身份，未启动定位。"; }
  try {
    if (wx.getAccountInfoSync().miniProgram.envVersion === "release") {
      if (!gpsRelease || gpsRelease.foregroundReleaseEnabled !== true || routeEnvironment.routeCollection !== "routes_v03")
        return "正式版前台循迹尚未获准启用。";
      const ids = ["fj-route-005", "fj-route-006", "fj-route-008", "fj-route-009", "fj-route-010", "fj-route-011"];
      if (!route || !ids.includes(route._id) || route.schemaVersion !== 1 || typeof route.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(route.updatedAt) || !Number.isFinite(Date.parse(route.updatedAt)) || typeof route.name !== "string" || !route.name.trim() ||
        !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 ||
        !Number.isInteger(route.estimatedDurationMinutes) || route.estimatedDurationMinutes <= 0 ||
        !["easy", "moderate", "hard"].includes(route.difficulty) || !Array.isArray(route.waypoints))
        return "正式路线资料无效，未启动定位。";
      const seen = new Set();
      for (const w of route.waypoints) {
        if (!w || !Number.isInteger(w.id) || w.id <= 0 || seen.has(w.id) || typeof w.name !== "string" || !w.name.trim() ||
          !["end", "viewpoint", "junction", "other"].includes(w.type) ||
          !Number.isFinite(w.latitude) || Math.abs(w.latitude) > 90 || !Number.isFinite(w.longitude) || Math.abs(w.longitude) > 180 ||
          (w.latitude === 0 && w.longitude === 0)) return "正式路线节点无效，未启动定位。";
        seen.add(w.id);
      }
      if (progress.buildTrailIndex(route).status !== "ready") return "正式轨迹索引无效，未启动定位。";
    }
  } catch (_) { return "无法确认正式循迹许可，未启动定位。"; }
  return "";
}
const emptySimulation = () => ({ status: "idle", statusText: "尚未开始",
  playbackText: "0 m · 0.0%", matchedText: "待匹配", remainingText: "待匹配", b1Text: "待匹配", message: "", snapshot: null });
const emptyFollow = () => ({ status: "idle", message: "", location: null, accuracyText: "", updatedText: "", stale: false, cleanupPending: false,
  evidenceKind: "NO_SESSION", stopOutcome: "NOT_REQUESTED", sdkStartAcknowledged: false, observationCount: 0, b1Phase: "notStarted", b1Reason: null, confirmedText: "待确认",
  walkedText: "待确认", progressText: "待确认", remainingText: "待确认", quality: "unavailable", qualityText: "等待定位", offRouteStatus: "unknown", canComplete: false });
const qualityText = quality => ({ reliable: "定位可靠", degraded: "精度较低，进度冻结", unavailable: "精度不足或未知", stale: "位置已过期", jump: "位置跳变，进度冻结", ambiguous: "路段不确定，进度冻结", recovering: "正在重新确认路段" }[quality] || "等待定位");
const {
  formatRouteCopy,
  formatDistance,
  formatDuration,
  formatDifficulty,
  formatRouteType,
  formatElevationGain
} = require("../../utils/format");

const routeOverview = require("../../utils/native-route-overview");
// 仅保存资源令牌，不保存位置。异步请求/清理跨hide与换路线仍持有令牌。
const navigationClaims = new Set();
const definition = {
  data: {
    route: null,
    status: "loading",
    mapCenter: null,
    mapRenderError: false,
    selectedWaypoint: null,
    followState: emptyFollow(),
    followPrivacyVisible: false,
    followPlatformBlock: privateFollowBlock(),
    followLabels: { idle: "尚未开始", blocked: "暂未启用", starting: "检查权限及确认起点", resuming: "重新获取真实位置",
      following: "真实定位循迹中", paused: "已暂停，定位已停止", stopping: "正在确认停止定位", ended: "已结束", completed: "用户已确认完成",
      error: "定位或清理异常", permissionDenied: "位置权限未授权" },
    followPrivacyStatus: "idle",
    followPrivacyMessage: "",
    followPrivacyContractName: "隐私保护指引",
    accessRecoveryMessage: "",
    accessConsent: { visible: false, requestId: 0, stage: "idle", message: "", ...navigation.getAccessPreflight() },
    nativeRecoveryMessage: "",
    followCamera: false,
    simulationState: emptySimulation(),
    mapMarkers: [],
    nativeNavigation: { status: "idle", errorCode: null },
    accessRoute: navigation.emptyAccessRoute(),
    mapPolylines: [],
    mapIncludePoints: [],
    navigationMessage: "",
    accessSummary: { distance: "", minutes: null }
  },

  claimNavigationMode(kind) {
    for (const claim of navigationClaims) {
      const session = claim.page._followSession;
      if (claim.kind === "REAL_FOLLOW" && session && session.cancelled && session.cleanupState
        && !session.cleanupState.ownsLocation) navigationClaims.delete(claim);
    }
    const real = kind === "REAL_FOLLOW";
    if ([...navigationClaims].some(c => real
      ? c.kind !== "REAL_FOLLOW" && !(c.kind === "NATIVE_OVERVIEW" && c.page === this)
      : c.kind === "REAL_FOLLOW")) return null;
    const claim = { kind, page: this };
    navigationClaims.add(claim);
    return claim;
  },
  releaseNavigationMode(claim) { if (claim) navigationClaims.delete(claim); },
  getNavigationMode() {
    const priorities = ["REAL_FOLLOW", "ACCESS", "NATIVE_TARGET", "NATIVE_OVERVIEW", "B1_SIMULATION"];
    return priorities.find(kind => [...navigationClaims].some(c => c.kind === kind)) || "IDLE";
  },
  prepareNavigationAction(kind) {
    if (this._navigationTransition || this._hidden || this._unloaded) return null;
    if (!this._followSession) return this.claimNavigationMode(kind);
    const route = this.data.route;
    this._navigationTransition = true;
    return (async () => { try {
      if (this._followSession && !await this.stopFollow("paused")) return null;
      if (this._hidden || this._unloaded || this.data.route !== route) return null;
      return this.claimNavigationMode(kind);
    } finally { this._navigationTransition = false; } })();
  },

  onLoad(options) {
    this._unloaded = false;
    this._hidden = false;
    const routeId = options && typeof options.id === "string" ? options.id : "";
    if (this._routeId !== routeId) {
      this._loadVersion = (this._loadVersion || 0) + 1;
      this._loading = false;
    }
    this._routeId = routeId;
    if (!this._routeId.trim()) {
      this.resetDetail("invalid");
      return;
    }
    return this.loadRoute();
  },

  async loadRoute() {
    if (this._loading || this._unloaded) return;
    if (!this._routeId || !this._routeId.trim()) {
      this.resetDetail("invalid");
      return;
    }
    this._loading = true;
    const loadVersion = this._loadVersion = (this._loadVersion || 0) + 1;
    this.resetDetail("loading");
    try {
      const route = await getRouteById(this._routeId);
      if (this._unloaded || loadVersion !== this._loadVersion) return;
      if (!route) {
        this.resetDetail("notFound");
        console.info("[route-detail] 未找到路线，_id：", this._routeId);
        return;
      }
      const mapCenter = toStartMapData(route);
      console.info("[route-detail] 轨迹适配：", {
        routeId: route._id,
        sourcePointCount: Array.isArray(route.track) ? route.track.length : 0,
        validPointCount: mapCenter ? mapCenter.trackPointCount : 0,
        renderedPointCount: mapCenter && mapCenter.polyline.length ? mapCenter.polyline[0].points.length : 0,
        discardedPointCount: mapCenter ? mapCenter.discardedTrackPointCount : 0
      });
      this.setData({
        status: "success",
        followPlatformBlock: privateFollowBlock(route),
        mapCenter,
        mapMarkers: mapCenter ? mapCenter.markers : [],
        ...composeNavigationMap(mapCenter, navigation.emptyAccessRoute()),
        route: Object.assign({}, route, {
          displayDistance: formatDistance(route.distanceMeters),
          displayDuration: formatDuration(route.estimatedDurationMinutes),
          displayDifficulty: formatDifficulty(route.difficulty),
          displayRouteType: formatRouteType(route.routeType),
          displayElevationGain: formatElevationGain(route.elevationGainMeters),
          ...formatRouteCopy(route)
        })
      });
      console.info("[route-detail] 云端详情读取成功，_id：", this._routeId);
    } catch (error) {
      if (this._unloaded || loadVersion !== this._loadVersion) return;
      console.error("[route-detail] 云端详情读取失败：", error);
      this.resetDetail("error");
    } finally {
      if (loadVersion === this._loadVersion) this._loading = false;
    }
  },

  resetDetail(status) {
    if (this._cancelPrivacyCheck) this._cancelPrivacyCheck();
    this._privacyGeneration = (this._privacyGeneration || 0) + 1;
    this.disposeSimulation();
    this.stopFollow();
    this.clearNavigation();
    this.setData({ status, route: null, mapCenter: null, mapRenderError: false, selectedWaypoint: null,
      followPrivacyVisible: false, followPrivacyStatus: "idle", followPrivacyMessage: "",
      accessRecoveryMessage: this._accessRequest && !this._accessRequest.finished && !this._accessRequest.sdkSettled ? "上一单次定位请求仍在等待回执，请检查请求状态。" : "",
      nativeRecoveryMessage: this._nativeCleanup ? "上一次地图路线速览尚未确认停止，请检查清理状态。" : "" });
    this.setData({ mapPolylines: [], mapIncludePoints: [], mapMarkers: [] });
  },

  onMarkerTap(event) {
    if (this._unloaded || this.data.status !== "success") return;
    const id = event && event.detail && event.detail.markerId;
    if (id === -1 || id === SIMULATION_MARKER_ID) return;
    const { route, mapCenter } = this.data;
    if (!this.data.selectedWaypoint || this.data.selectedWaypoint.id !== id) this.clearNavigation();
    if (!Number.isSafeInteger(id) || id <= 0 || !mapCenter
      || !mapCenter.markers.some(point => point.id === id) || !route || !Array.isArray(route.waypoints)) {
      this.setData({ selectedWaypoint: null });
      return;
    }
    const index = route.waypoints.findIndex(point => point && point.id === id);
    if (index < 0) {
      this.setData({ selectedWaypoint: null });
      return;
    }
    const waypoint = route.waypoints[index];
    this.setData({ selectedWaypoint: {
      id: waypoint.id,
      name: waypoint.name,
      description: typeof waypoint.description === "string" ? waypoint.description : "",
      // 冻结 v1 没有 order；只为卡片派生顺序，不写回 Route。
      order: Number.isSafeInteger(waypoint.order) && waypoint.order > 0 ? waypoint.order : index + 1,
      latitude: waypoint.latitude,
      longitude: waypoint.longitude
    } });
  },

  onMapError(event) {
    if (this._unloaded || this.data.status !== "success") return;
    this.pauseSimulation("地图异常，模拟已暂停；恢复地图后再继续。");
    this.stopFollow();
    if (this.data.accessRoute.status === "success") {
      this.clearNavigation();
      this.setData({ navigationMessage: "接驳线显示失败，已恢复徒步轨迹。" });
      return;
    }
    console.error("[route-detail] 地图组件错误");
    this.setData({ mapRenderError: true });
  },

  onRetryTap() {
    return this.loadRoute();
  },

  onUnload() {
    this._unloaded = true;
    this.cancelAccessIntent();
    if (this._cancelPrivacyCheck) this._cancelPrivacyCheck();
    this.disposeSimulation();
    this.stopFollow();
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._loading = false;
    this._navigationVersion = (this._navigationVersion || 0) + 1;
    // 页面已销毁，不再setData；释放临时位置/接驳引用。
    Object.assign(this.data, { accessRoute: navigation.emptyAccessRoute(),
      nativeNavigation: { status: "idle", errorCode: null }, mapPolylines: [], mapIncludePoints: [],
      navigationMessage: "", accessSummary: { distance: "", minutes: null },
      followState: emptyFollow(), followPrivacyVisible: false, followCamera: false, mapMarkers: [], simulationState: emptySimulation() });
  },

  clearNavigation() {
    this.cancelAccessIntent();
    this._navigationVersion = (this._navigationVersion || 0) + 1;
    if (this._unloaded) return;
    const accessRoute = navigation.emptyAccessRoute();
    this.setData({ nativeNavigation: { status: "idle", errorCode: null }, accessRoute,
      navigationMessage: "", accessSummary: { distance: "", minutes: null }, ...composeNavigationMap(this.data.mapCenter, accessRoute) });
  },

  onHide() {
    this._hidden = true;
    if (this._cancelPrivacyCheck) this._cancelPrivacyCheck();
    this._privacyGeneration = (this._privacyGeneration || 0) + 1;
    this.setData({ followPrivacyVisible: false, followPrivacyStatus: this.data.followPrivacyStatus === "checking" ? "idle" : this.data.followPrivacyStatus });
    this.pauseSimulation("返回页面后请主动继续模拟。");
    if (this._followSession || this._trailModel) this.stopFollow("paused");
    else this.setData({ followCamera: false });
    this.clearNavigation();
  },
  onShow() { this._hidden = false; },

  navigationSnapshot() {
    if (this._unloaded || this._hidden || this.data.status !== "success") return null;
    try {
      const target = navigation.resolveTarget(this.data.route, this.data.mapCenter, this.data.selectedWaypoint);
      this.clearNavigation();
      return { version: this._navigationVersion, route: this.data.route, target };
    } catch (error) {
      this.clearNavigation();
      this.setData({ navigationMessage: navigation.errorMessage(navigation.errorCode(error, "TARGET_INVALID")) });
      return null;
    }
  },

  navigationIsCurrent(snapshot) {
    return !this._unloaded && !this._hidden && snapshot.version === this._navigationVersion
      && this.data.status === "success" && this.data.route === snapshot.route
      && this.data.selectedWaypoint && this.data.selectedWaypoint.id === snapshot.target.id;
  },

  async onOpenTargetTap() {
    if (this.data.nativeNavigation.status === "opening") return;
    const prepared = this.prepareNavigationAction("NATIVE_TARGET");
    const claim = prepared && typeof prepared.then === "function" ? await prepared : prepared;
    if (!claim) return;
    const snapshot = this.navigationSnapshot();
    if (!snapshot) { this.releaseNavigationMode(claim); return; }
    this.setData({ nativeNavigation: { status: "opening", errorCode: null } });
    try {
      await navigation.openTarget(snapshot.target);
      if (this.navigationIsCurrent(snapshot)) this.setData({ nativeNavigation: { status: "idle", errorCode: null } });
    } catch (error) {
      if (!this.navigationIsCurrent(snapshot)) return;
      const code = navigation.errorCode(error, "OPEN_LOCATION_FAILED");
      this.setData({ nativeNavigation: { status: "error", errorCode: code }, navigationMessage: navigation.errorMessage(code) });
    } finally { this.releaseNavigationMode(claim); }
  },

  async onPlanAccessTap() {
    if (this._accessRequest && !this._accessRequest.finished && !this._accessRequest.sdkSettled) { this.onAccessRecoveryTap(); return; }
    if (["locating", "planning"].includes(this.data.accessRoute.status) || this.data.nativeNavigation.status === "opening") return;
    if (this._accessIntent) return;
    const snapshot = this.navigationSnapshot();
    if (!snapshot) return;
    const intent = { id: this._accessIntentGeneration = (this._accessIntentGeneration || 0) + 1, snapshot, stage: "pending" };
    this._accessIntent = intent;
    this.setData({ accessConsent: { visible: true, requestId: intent.id, stage: "pending", message: "",
      targetName: snapshot.target.name, ...navigation.getAccessPreflight() } });
  },
  accessIntentIsCurrent(intent) {
    return !!intent && this._accessIntent === intent && this.navigationIsCurrent(intent.snapshot);
  },
  accessEventIntent(event) {
    const intent = this._accessIntent;
    const id = Number(event && event.currentTarget && event.currentTarget.dataset.requestId);
    return this.accessIntentIsCurrent(intent) && id === intent.id ? intent : null;
  },
  cancelAccessIntent() {
    const intent = this._accessIntent;
    this._accessIntent = null;
    if (intent && intent.cancelPrivacy) intent.cancelPrivacy();
    if (!this._unloaded && this.data.accessConsent.visible) this.setData({ accessConsent: { ...this.data.accessConsent, visible: false } });
  },
  onAccessConsentCancel(event) {
    if (this.accessEventIntent(event)) this.clearNavigation();
  },
  onAccessConsentContentTap() {},
  onAccessWeChatPrivacyAgree(event) {
    const intent = this.accessEventIntent(event);
    if (event && event.type === "agreeprivacyauthorization" && intent && !intent.wechatPolicyFailed && intent.stage === "wechatPrivacy" && intent.agreePrivacy) intent.agreePrivacy();
  },
  onAccessWeChatPrivacyView(event) {
    const intent = this.accessEventIntent(event);
    if (!intent || intent.stage !== "wechatPrivacy") return;
    const fail = () => { if (this.accessIntentIsCurrent(intent)) { intent.wechatPolicyFailed = true;
      this.setData({ accessConsent: { ...this.data.accessConsent, wechatPolicyFailed: true, message: "微信隐私指引未能打开，请暂不使用；本次不会定位或规划。" } }); } };
    try { wx.openPrivacyContract({ fail }); } catch (_) { fail(); }
  },
  waitAccessPrivacy(intent) {
    intent.stage = "wechatPrivacy";
    this.setData({ accessConsent: { ...this.data.accessConsent, stage: "wechatPrivacy", message: "本次高德同意已记录；还需您单独阅读并同意微信隐私指引。" } });
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => finish(false), 20000);
      intent.cancelPrivacy = () => finish(false);
      intent.agreePrivacy = () => finish(this.accessIntentIsCurrent(intent));
    });
  },
  async onAccessPolicyTap(event) {
    const intent = this.accessEventIntent(event);
    if (!intent || intent.stage !== "pending" || intent.policyOpening) return;
    intent.policyOpening = true;
    this.setData({ accessConsent: { ...this.data.accessConsent, message: "正在打开微信隐私保护指引；不会定位或规划。" } });
    try {
      await navigation.openAccessPrivacyPolicy();
      if (!this.accessIntentIsCurrent(intent)) return;
      // 浮层未触发hide时也作废本次意图；阅读成功不能生成或保留同意凭据。
      this.cancelAccessIntent();
      this.setData({ navigationMessage: "微信隐私保护指引已打开。请在补充文档中主动查看高德官方政策；这不代表已阅读全文或已同意。返回后请重新点击“规划到这里”。真实接驳仍未启用。" });
    }
    catch (_) { if (this.accessIntentIsCurrent(intent)) { intent.policyFailed = true;
      this.setData({ accessConsent: { ...this.data.accessConsent, ready: false, message: "政策阅读入口未能打开。请暂不使用；本次不会定位或规划。" } }); } }
    finally { intent.policyOpening = false; }
  },
  async onAccessConsentAgree(event) {
    const intent = this.accessEventIntent(event);
    if (!intent || intent.stage !== "pending" || intent.policyFailed || intent.policyOpening) return;
    const preflight = navigation.getAccessPreflight();
    if (!preflight.ready) { this.setData({ accessConsent: { ...this.data.accessConsent, ...preflight, message: preflight.blockedReason } }); return; }
    intent.stage = "authorizing";
    this.setData({ accessConsent: { ...this.data.accessConsent, stage: "authorizing", message: "正在检查本次微信隐私与位置权限…" } });
    return this.performAccessRequest(intent);
  },
  async performAccessRequest(intent) {
    if (!this.accessIntentIsCurrent(intent) || intent.stage !== "authorizing") return;
    const prepared = this.prepareNavigationAction("ACCESS");
    const claim = prepared && typeof prepared.then === "function" ? await prepared : prepared;
    if (!claim) { if (this.accessIntentIsCurrent(intent)) { intent.stage = "pending";
      this.setData({ accessConsent: { ...this.data.accessConsent, stage: "pending", message: "其他定位资源尚未确认结束，请暂不使用并先完成清理。" } }); } return; }
    const snapshot = intent.snapshot;
    if (!this.accessIntentIsCurrent(intent)) { this.releaseNavigationMode(claim); return; }
    let locationSettled = true; // 授权查询不是定位请求；真正提交getLocation前才置false。
    const request = { claim, timedOut: false, finished: false };
    this._accessRequest = request;
    const acknowledge = () => {
      locationSettled = true;
      request.sdkSettled = true;
      if (!request.timedOut) return;
      request.finished = true;
      this.releaseNavigationMode(claim);
      // 只确认资源结束，永不使用迟到坐标或自动启动GPS。
      if (this.navigationIsCurrent(snapshot)) this.setData({ accessRecoveryMessage: "单次定位请求现已结束。请主动重新发起操作。" });
    };
    try {
      const grant = await navigation.authorizeAccess({ isCurrent: () => this.accessIntentIsCurrent(intent), target: snapshot.target,
        onPrivacyRequired: () => this.waitAccessPrivacy(intent) });
      if (!this.accessIntentIsCurrent(intent)) return;
      intent.stage = "locating";
      this.setData({ accessConsent: { ...this.data.accessConsent, visible: false }, accessRoute: navigation.emptyAccessRoute("locating") });
      locationSettled = false;
      const origin = await navigation.locateOnce({ onSettled: acknowledge, grant });
      locationSettled = true;
      if (!this.navigationIsCurrent(snapshot)) return;
      const identity = { routeId: snapshot.route._id, routeUpdatedAt: snapshot.route.updatedAt,
        waypointId: snapshot.target.id, origin,
        destination: { name: snapshot.target.name, latitude: snapshot.target.latitude, longitude: snapshot.target.longitude } };
      this.setData({ accessRoute: { ...navigation.emptyAccessRoute("planning"), ...identity } });
      intent.stage = "planning";
      const result = await navigation.planAccessRoute(origin, snapshot.target, grant);
      if (!this.navigationIsCurrent(snapshot)) return;
      const accessRoute = { ...navigation.emptyAccessRoute("success"), ...identity,
        distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds, points: result.points };
      this.setData({ accessRoute, ...composeNavigationMap(this.data.mapCenter, accessRoute),
        accessSummary: { distance: result.distanceMeters === 0 ? "0 m" : formatDistance(result.distanceMeters),
          minutes: Math.ceil(result.durationSeconds / 60) } });
    } catch (error) {
      // 单次定位超时不证明SDK请求已结束；不让清UI/换路线释放其所有权。
      if (error.code !== "LOCATION_TIMEOUT") locationSettled = true;
      request.timedOut = error.code === "LOCATION_TIMEOUT";
      if (!this.navigationIsCurrent(snapshot)) return;
      const fallback = this.data.accessRoute.status === "locating" ? "LOCATION_FAILED" : "CLOUD_CALL_FAILED";
      const code = navigation.errorCode(error, fallback);
      const accessRoute = navigation.emptyAccessRoute(code === "LOCATION_DENIED" ? "permissionDenied" : "error", code);
      this.setData({ accessRoute, ...composeNavigationMap(this.data.mapCenter, accessRoute),
        accessSummary: { distance: "", minutes: null }, navigationMessage: navigation.errorMessage(code),
        accessRecoveryMessage: request.timedOut && !locationSettled ? "单次定位已超时，但请求尚未返回。已屏蔽迟到结果；请检查系统定位。收到请求结束回执后可主动重试；若一直无回执，请关闭并重新进入小程序。" : "" });
    } finally { if (locationSettled) { request.finished = true; this.releaseNavigationMode(claim); }
      if (this._accessIntent === intent) { this._accessIntent = null;
        if (!this._unloaded && !this._hidden) this.setData({ accessConsent: { ...this.data.accessConsent, visible: false } }); }
    }
  },

  onAccessRecoveryTap() {
    if (this._unloaded || this._hidden) return;
    const pending = this._accessRequest && !this._accessRequest.finished;
    this.setData({ accessRecoveryMessage: pending && !this._accessRequest.sdkSettled ? "单次定位请求仍未确认结束，暂不能开始真实循迹或重复定位。请检查系统定位；持续无回执时关闭并重新进入小程序。"
      : pending ? "单次定位已返回，接驳规划仍在等待；可清除当前显示，旧规划结果将按请求代次隔离。" : "单次定位请求已结束，可主动重试。" });
  },

  onClearAccessTap() { this.clearNavigation(); },

  stopSimulationTimer() {
    this._simulationTimerGeneration = (this._simulationTimerGeneration || 0) + 1;
    if (this._simulationTimer != null) clearInterval(this._simulationTimer);
    if (this._simulationDrainTimer != null) clearTimeout(this._simulationDrainTimer);
    this._simulationDrainTimer = null;
    this._simulationTimer = null;
    this._simulationLastAt = null;
  },
  disposeSimulation() {
    this.stopSimulationTimer();
    this._simulationVersion = (this._simulationVersion || 0) + 1;
    const session = this._simulationSession;
    this._simulationSession = null;
    if (session) { try { session.dispose(); } catch (_) { /* 不阻断页面离开 */ } }
    this.releaseNavigationMode(this._simulationModeClaim);
    this._simulationModeClaim = null;
    if (!this._unloaded) {
      this.setData({ simulationState: emptySimulation() });
      this.updateSimulationMarker(null);
    }
  },
  simulationMarkerPatch(location) {
    if (this._unloaded) return {};
    const markers = this.data.mapMarkers || [], i = markers.findIndex(m => m.id === SIMULATION_MARKER_ID);
    if (!location || this.data.mapRenderError) {
      return i >= 0 ? { mapMarkers: markers.filter(m => m.id !== SIMULATION_MARKER_ID) } : {};
    }
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
      || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180
      || (location.latitude === 0 && location.longitude === 0)) throw new Error("INVALID_SIMULATION_POINT");
    if (i >= 0 && markers[i].latitude === location.latitude && markers[i].longitude === location.longitude) return {};
    const marker = { id: SIMULATION_MARKER_ID, latitude: location.latitude, longitude: location.longitude,
      iconPath: "/assets/map/simulation.png", width: 22, height: 22, anchor: { x: 0.5, y: 0.5 }, zIndex: 10,
      callout: { content: "模拟位置（非GPS）", display: "ALWAYS", color: "#795222", bgColor: "#fff6e6", padding: 6, borderRadius: 6 } };
    return i < 0 ? { mapMarkers: [...markers, marker] }
      : { [`mapMarkers[${i}].latitude`]: location.latitude, [`mapMarkers[${i}].longitude`]: location.longitude };
  },
  updateSimulationMarker(location) {
    const patch = this.simulationMarkerPatch(location);
    if (Object.keys(patch).length) this.setData(patch);
  },
  publishSimulation(snapshot, message = "", visualOnly = false) {
    if (this._unloaded || this._followSession || this._followTransition) return;
    const patch = this.simulationMarkerPatch(snapshot.visualPlayback ? snapshot.visualLocation : snapshot.simulatedLocation);
    if (visualOnly) {
      if (Object.keys(patch).length) this.setData(patch);
      return;
    }
    this._simulationLastPanelAt = Date.now();
    const unsupported = snapshot.errorCode === "INVALID_ROUTE";
    const statusText = unsupported ? "当前路线不支持模拟" : ({ idle: "尚未开始", playing: "正在模拟", paused: "已暂停",
      finished: "模拟播放已到终点", error: "模拟异常" }[snapshot.playbackStatus] || "模拟异常");
    const ratio = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "待匹配";
    const meters = value => Number.isFinite(value) ? (value === 0 ? "0 m" : formatDistance(value)) : "待匹配";
    const state = { status: snapshot.playbackStatus, statusText,
      playbackText: `${meters(snapshot.visualPlayback ? snapshot.visualDistanceMeters : snapshot.playbackDistanceMeters)} · ${ratio(snapshot.visualPlayback ? snapshot.visualRatio : snapshot.playbackRatio)}`,
      matchedText: snapshot.matchedProgressMeters === null ? "待匹配" : `${meters(snapshot.matchedProgressMeters)} · ${ratio(snapshot.matchedProgressRatio)}`,
      remainingText: meters(snapshot.remainingMeters),
      b1Text: snapshot.b1Phase === "starting" ? "正在进行B1轨迹匹配" : snapshot.b1Reason === "PROGRESS_CONFIRMING" ? "B1正在确认进度" : snapshot.locationQuality === "reliable" ? "B1匹配可靠"
        : ({ ambiguous: "B1路段歧义，等待确认", recovering: "B1正在重新匹配" }[snapshot.locationQuality] || "B1待匹配"),
      message: message || (snapshot.playbackStatus === "finished" ? "模拟播放完成，仅为算法演示，不代表实际徒步完成。"
        : snapshot.errorCode ? (unsupported ? "路线资料不适合模拟，原地图与接驳功能仍可使用。" : "模拟异常，已停止播放，可重新播放。") : ""), snapshot };
    if (JSON.stringify(state) !== JSON.stringify(this.data.simulationState)) patch.simulationState = state;
    // 同一快照的Marker与面板只过一次数据桥；不会重发Trail或include-points。
    if (Object.keys(patch).length) this.setData(patch);
  },
  simulationFailure() {
    this.disposeSimulation();
    if (!this._unloaded) this.setData({ simulationState: { ...emptySimulation(), status: "error", statusText: "模拟异常",
      message: "模拟异常，已停止播放，可重新播放。" } });
  },
  tickSimulation() {
    if (this._hidden || this._unloaded || !this._simulationSession) return;
    const now = Date.now(), delta = now - this._simulationLastAt;
    if (delta === 0) return;
    this._simulationLastAt = now;
    try {
      if (!Number.isFinite(delta) || delta < 0 || delta > simulator.TIMING.maxAdvanceMs) {
        this.pauseSimulation("播放时间间隔异常，已暂停，请主动继续。"); return;
      }
      const snapshot = this._simulationSession.advance(delta);
      if (snapshot.errorCode || snapshot.playbackStatus !== "playing") this.stopSimulationTimer();
      this.publishSimulation(snapshot, "", !snapshot.errorCode && snapshot.playbackStatus === "playing" && now - this._simulationLastPanelAt < 200);
      if (snapshot.hasPendingFrames) this.queueSimulationDrain();
    } catch (_) { this.simulationFailure(); }
  },
  runSimulationTimer() {
    if (this._simulationTimer != null) return;
    const session = this._simulationSession, route = this.data.route, version = this._simulationVersion;
    const generation = this._simulationTimerGeneration = (this._simulationTimerGeneration || 0) + 1;
    this._simulationLastAt = Date.now();
    this._simulationTimer = setInterval(() => {
      if (this._unloaded || this._hidden || this.data.route !== route || this._simulationSession !== session || this._simulationVersion !== version || this._simulationTimerGeneration !== generation) return;
      this.tickSimulation();
    }, simulator.FAST_DEMO.visualRefreshMs);
  },
  queueSimulationDrain() {
    if (this._simulationDrainTimer != null || this._hidden || this._unloaded || !this._simulationSession) return;
    const session = this._simulationSession, route = this.data.route, generation = this._simulationTimerGeneration;
    this._simulationDrainTimer = setTimeout(() => {
      if (this._hidden || this._unloaded || this.data.route !== route || this._simulationSession !== session || generation !== this._simulationTimerGeneration) return;
      this._simulationDrainTimer = null;
      try {
        const snapshot = session.drain();
        if (snapshot.errorCode || snapshot.playbackStatus !== "playing") { this.stopSimulationTimer(); this.publishSimulation(snapshot); }
        else if (snapshot.hasPendingFrames) this.queueSimulationDrain();
      } catch (_) { this.simulationFailure(); }
    }, simulator.FAST_DEMO.yieldMs);
  },
  pauseSimulation(message = "") {
    this.stopSimulationTimer();
    if (!this._simulationSession || this._unloaded) return;
    try {
      const snapshot = this._simulationSession.getSnapshot();
      this.publishSimulation(snapshot.playbackStatus === "playing" ? this._simulationSession.pause() : snapshot, message);
    } catch (_) { this.simulationFailure(); }
  },
  simulationAction(action) {
    if (this._unloaded || this._hidden || this.data.status !== "success" || this.data.mapRenderError || !this.data.mapCenter) return;
    if (!this._simulationSession && !["start", "restart"].includes(action)) return;
    if (!this._simulationModeClaim) this._simulationModeClaim = this.claimNavigationMode("B1_SIMULATION");
    if (!this._simulationModeClaim) return;
    try {
      if (!this._simulationSession) {
        if (!["start", "restart"].includes(action)) return;
        this._simulationVersion = (this._simulationVersion || 0) + 1;
        this._simulationSession = simulator.createSimulator(this.data.route, { fastDemo: true, visualPlayback: true });
      }
      const session = this._simulationSession, current = session.getSnapshot();
      if (current.errorCode === "INVALID_ROUTE") { this.publishSimulation(current); this.stopSimulationTimer(); return; }
      if (action === "start" && current.playbackStatus !== "idle") return;
      if (action === "resume" && current.playbackStatus !== "paused") return;
      if (this._simulationSession !== session) return;
      let snapshot;
      if (action === "restart") { this.stopSimulationTimer(); session.restart(); this.updateSimulationMarker(null); snapshot = session.start(); }
      else snapshot = session[action]();
      this.publishSimulation(snapshot);
      if (snapshot.playbackStatus === "playing" && !snapshot.errorCode) this.runSimulationTimer();
      else this.stopSimulationTimer();
    } catch (_) { this.simulationFailure(); }
  },
  onSimulationStartTap() { this.simulationAction("start"); },
  onSimulationPauseTap() { this.pauseSimulation(); },
  onSimulationResumeTap() { this.simulationAction("resume"); },
  onSimulationRestartTap() { this.simulationAction("restart"); },

  followEvidence() {
    const state = this.data.followState;
    return { sdkStartAcknowledged: state.sdkStartAcknowledged, observationCount: state.observationCount,
      b1Phase: state.b1Phase, b1Reason: state.b1Reason, confirmedText: state.confirmedText,
      evidenceKind: state.evidenceKind, stopOutcome: state.stopOutcome };
  },
  followSummary() {
    const model = this._trailModel, index = this._trailIndex;
    if (!model || !index || !Number.isFinite(model.cursorMeters)) return { walkedText: "待确认", progressText: "待确认", remainingText: "待确认", canComplete: false };
    const walked = Math.max(0, model.cursorMeters - model.startCursorMeters);
    return { confirmedText: model.maxConfirmedMeters <= model.startCursorMeters ? "0 m" : formatDistance(model.maxConfirmedMeters - model.startCursorMeters), walkedText: walked === 0 ? "0 m" : formatDistance(walked), progressText: `${(model.cursorMeters / index.totalTrackMeters * 100).toFixed(1)}%`,
      canComplete: progress.canConfirmCompletion(index, model, Date.now()),
      remainingText: index.totalTrackMeters <= model.cursorMeters ? "0 m" : formatDistance(index.totalTrackMeters - model.cursorMeters) };
  },

  async onStartFollowTap() { return this.requestFollowStart(false); },
  async onResumeFollowTap() {
    if (this.data.followState.status !== "paused") return;
    return this.requestFollowStart(true);
  },
  requestFollowStart(resume) {
    if (this._unloaded || this._hidden) return;
    const block = privateFollowBlock(this.data.route);
    if (block) {
      this.setData({ followPlatformBlock: block, followState: { ...this.data.followState, status: "blocked", message: block } }); return;
    }
    if (this._privacyCheck || this.data.status !== "success" || !this.data.route || !this.data.mapCenter || this.data.mapRenderError) return;
    // 每次主动开始/继续重新走service隐私和位置授权；同意事件不自动定位。
    this.setData({ followPlatformBlock: "" });
    return this.startFollow(resume);
  },
  async onCheckFollowPrivacyTap() {
    if (this._unloaded || this._hidden || this._privacyCheck) return;
    const route = this.data.route, generation = this._privacyGeneration = (this._privacyGeneration || 0) + 1;
    const current = () => !this._unloaded && !this._hidden && this.data.route === route && this._privacyGeneration === generation;
    this._privacyCheck = true;
    this.setData({ followPrivacyStatus: "checking", followPrivacyMessage: "正在检查隐私授权；不会启动定位。" });
    try {
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => reject(new Error("PRIVACY_TIMEOUT")), 20000);
        const end = fn => value => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
        this._cancelPrivacyCheck = () => end(reject)(new Error("CANCELLED"));
        try { wx.getPrivacySetting({ success: end(resolve), fail: end(reject) }); } catch (error) { clearTimeout(timer); reject(error); }
      });
      if (!current()) return;
      if (typeof result.needAuthorization !== "boolean") throw new Error("PRIVACY_UNKNOWN");
      this.setData({ followPrivacyVisible: result.needAuthorization,
        followPrivacyContractName: typeof result.privacyContractName === "string" ? result.privacyContractName : "隐私保护指引",
        followPrivacyStatus: result.needAuthorization ? "required" : "checked",
        followPrivacyMessage: result.needAuthorization ? "请阅读隐私指引，可选择同意或暂不使用。" : "接口返回无需新增同意；这不能证明后台声明、准入已核验。私人测试请主动点击开始，仍会重新检查授权。" });
    } catch (_) { if (current()) this.setData({ followPrivacyStatus: "error", followPrivacyMessage: "无法确认隐私授权，请更新微信或稍后主动重试；未启动定位。" }); }
    finally { this._privacyCheck = false; this._cancelPrivacyCheck = null; }
  },
  async onRetryNativeCleanupTap() {
    if (this._unloaded || this._hidden || this._nativeRetryWaiting) return;
    this._nativeRetryWaiting = true;
    const route = this.data.route;
    this.setData({ nativeRecoveryMessage: "正在确认路线速览清理，不会自动启动定位…" });
    const error = await new Promise(resolve => this.retryNativeOverviewCleanup(resolve));
    this._nativeRetryWaiting = false;
    if (this._unloaded || this._hidden || this.data.route !== route) return;
    this.setData({ nativeRecoveryMessage: error ? "路线速览尚未确认停止。可再次检查清理；若一直失败，请关闭并重新进入小程序。真实GPS保持阻断。" : "路线速览清理已确认。需要定位时请主动点击开始；平台准入仍须核实。" });
  },
  followMarkerPatch(location) {
    const markers = this.data.mapMarkers || [], i = markers.findIndex(m => m.id === -1);
    if (!location) return i < 0 ? {} : { mapMarkers: markers.filter(m => m.id !== -1) };
    if (i < 0) return { mapMarkers: [...markers, { id: -1, latitude: location.latitude, longitude: location.longitude,
      iconPath: "/assets/map/location.png", width: 24, height: 24, anchor: { x: 0.5, y: 0.5 }, zIndex: 10 }] };
    return markers[i].latitude === location.latitude && markers[i].longitude === location.longitude ? {}
      : { [`mapMarkers[${i}].latitude`]: location.latitude, [`mapMarkers[${i}].longitude`]: location.longitude };
  },
  async startFollow(resume) {
    const block = privateFollowBlock(this.data.route);
    if (block) { this.setData({ followPlatformBlock: block, followState: { ...this.data.followState, status: "blocked", message: block } }); return; }
    if (this._unloaded || this._hidden || this.data.status !== "success" || !this.data.mapCenter
      || this.data.mapRenderError || this._followSession || this.data.nativeNavigation.status === "opening") return;
    if (this._followTransition || this._navigationTransition) return;
    if (this._simulationSession && this._simulationSession.getSnapshot().playbackStatus === "playing") {
      this.setData({ followState: { ...this.data.followState, message: "请先暂停模拟演示，再主动开始真实循迹。" } }); return;
    }
    // 暂停的B1不再推进，但其Marker必须先移除；Native则须等待异步remove确认。
    if (this._simulationSession) this.disposeSimulation();
    const claim = this.claimNavigationMode("REAL_FOLLOW");
    if (!claim) { this.setData({ followState: { ...this.data.followState, message: "其他定位请求或地图资源尚未释放，请先结束或确认清理。" } }); return; }
    this._realModeClaim = claim;
    const expectedRoute = this.data.route, expectedVersion = this._followVersion;
    this._followTransition = true;
    try {
      if (typeof this.stopNativeOverview === "function") {
        const error = await new Promise(resolve => this.stopNativeOverview(resolve));
        if (error) { this.releaseNavigationMode(claim); this._realModeClaim = null;
          if (!this._unloaded && !this._hidden) this.setData({ nativeRecoveryMessage: "上一次地图路线速览尚未确认停止。请重试清理后再开始真实循迹。" }); return; }
      }
      if (this._hidden || this._unloaded || this.data.route !== expectedRoute || this._followVersion !== expectedVersion) {
        this.releaseNavigationMode(claim); return;
      }
    } finally { this._followTransition = false; }
    const route = this.data.route;
    if (!resume) { this._trailIndex = progress.buildTrailIndex(route); this._trailModel = progress.createProgressState(this._trailIndex); }
    else this._trailModel = progress.resumeProgressState(this._trailIndex, this._trailModel);
    if (!this._trailIndex || this._trailIndex.status !== "ready") {
      this.releaseNavigationMode(claim);
      this.setData({ followState: { ...emptyFollow(), status: "error", message: "路线资料暂不支持循迹计算，原路线仍可查看。" } }); return;
    }
    this.clearNavigation();
    const version = this._followVersion = (this._followVersion || 0) + 1;
    const current = () => !this._unloaded && !this._hidden && version === this._followVersion && route === this.data.route
      && navigationClaims.has(claim);
    const session = trailFollow.createSession({
      beforeSdkStart: () => current() && !privateFollowBlock(route),
      onLocation: location => {
        if (!current()) return;
        try {
          const result = progress.updateTrailProgress(this._trailIndex, this._trailModel, location, Date.now());
          this._trailModel = result.state;
          this.setData({ followState: { ...this.data.followState, observationCount: this.data.followState.observationCount + 1, b1Phase: result.phase, b1Reason: result.reason } });
          if ((resume && result.reason === "RESUME_TOO_FAR") || (!resume && result.phase === "starting" && ["NOT_AT_START", "NO_LOCAL_MATCH", "OFF_ROUTE_OR_PENDING"].includes(result.reason))) {
            this.failFollow({ code: "POSITION_REQUIRED", message: resume ? "请回到暂停时已确认的路段再继续，或结束循迹。" : "请到路线起点附近再开始循迹。" }); return;
          }
          const confirmed = result.phase === "following";
          if (confirmed && this._followFixTimer) { clearTimeout(this._followFixTimer); this._followFixTimer = null; }
          const date = new Date(location.updatedAt);
          const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
          const visible = !["jump", "ambiguous", "recovering"].includes(result.locationQuality);
          let message = confirmed ? "蓝点为当前位置；进度仅供参考，不代表实际通行情况。" : resume ? "正在原路段确认位置…" : "正在起点附近确认位置…";
          if (["unavailable", "degraded"].includes(result.locationQuality)) message = "定位精度不足或未知，参考进度暂不更新。";
          else if (result.locationQuality !== "reliable") message = "位置跳变或路段不确定，参考进度暂不更新。";
          else if (result.offRouteStatus === "suspected") message = "疑似偏离轨迹，请结合现场道路与地图确认。";
          this.setData({ followState: { ...emptyFollow(), evidenceKind: "RUNNING", sdkStartAcknowledged: this.data.followState.sdkStartAcknowledged, observationCount: this.data.followState.observationCount, b1Phase: result.phase, b1Reason: result.reason, ...this.followSummary(), status: confirmed ? "following" : resume ? "resuming" : "starting",
            location: visible ? location : null, quality: result.locationQuality, qualityText: qualityText(result.locationQuality), offRouteStatus: result.offRouteStatus,
            accuracyText: location.accuracy === null ? "精度未知" : `约${Math.ceil(location.accuracy)}米`, updatedText: time,
            message },
            ...this.followMarkerPatch(visible ? location : null) });
          if (this.data.followCamera) {
            if (confirmed && result.locationQuality === "reliable") this.onFollowRecenterTap();
            else this.setData({ followCamera: false });
          }
        } catch (_) { this.failFollow({ code: "LOCATION_FAILED" }); }
      },
      onError: error => { if (current()) this.failFollow(error); }
    });
    this._followSession = session;
    this.setData({ followState: { ...emptyFollow(), ...this.followSummary(), evidenceKind: "RUNNING", b1Phase: resume ? "resuming" : "starting", status: resume ? "resuming" : "starting", message: "正在开启前台定位…" }, followPrivacyVisible: false });
    try {
      await session.start();
      if (!current()) return;
      this.setData({ followState: { ...this.data.followState, sdkStartAcknowledged: true } });
      if (["starting", "resuming"].includes(this.data.followState.status)) this.setData({ followState: { ...this.data.followState, message: "正在获取真实位置，等待起点或原路段确认…" } });
      if (this.data.followState.status !== "following") {
        this._followFixTimer = setTimeout(() => { if (current()) this.failFollow({ code: "TIMEOUT", message: this.data.followState.observationCount === 0 ? "定位SDK已启动，但未收到有效位置，请检查系统定位与微信权限。" : "已收到位置，但尚未确认起点或恢复路段；请检查精度并靠近正确路段后主动重试。" }); }, 20000);
      }
      this._followStaleTimer = setInterval(() => {
        if (!current()) return;
        const state = this.data.followState;
        const latest = this._trailModel && this._trailModel.lastObservedAt;
        if (Number.isFinite(latest) && Date.now() - latest > progress.POLICY.freshMs && state.quality !== "stale") {
          this._trailModel = progress.updateTrailProgress(this._trailIndex, this._trailModel,
            { ...(state.location || {}), updatedAt: latest }, Date.now()).state;
          this.setData({ followCamera: false, followState: { ...state, quality: "stale", qualityText: qualityText("stale"), canComplete: false, stale: true, location: null, accuracyText: "", updatedText: "",
            message: "位置未及时更新，进度暂停确认，当前点已隐藏。" }, mapMarkers: this.data.mapCenter.markers });
        }
      }, 5000);
    } catch (error) {
      if (!current()) return;
      if (error.code === "PRIVACY_REQUIRED") {
        await this.stopFollow(resume ? "paused" : "idle");
        if (!this._unloaded && !this._hidden && this.data.route === route) { this._privacyResume = resume; this.setData({ followPrivacyVisible: true }); }
      } else await this.failFollow(error);
    }
  },

  async failFollow(error) {
    const version = this._followVersion;
    const retain = !!(this._trailModel && Number.isFinite(this._trailModel.cursorMeters));
    const stopped = await this.stopFollow(retain ? "paused" : "idle");
    if (this._unloaded || this._hidden || this._followVersion !== version + 1 || !stopped) return;
    this.setData({ followState: { ...emptyFollow(), ...this.followEvidence(), ...this.followSummary(), status: retain ? "paused" : error.code === "LOCATION_DENIED" ? "permissionDenied" : "error",
      message: error.message || trailFollow.errorMessage(error.code) } });
  },

  async stopFollow(target = "idle") {
    this._followStopTarget = target;
    this._privacyResume = false;
    this._completionPrompt = null;
    const summary = target === "ended" ? (this._trailModel ? this.followSummary() : this.data.followState) : null;
    const version = this._followVersion = (this._followVersion || 0) + 1;
    if (this._followFixTimer) clearTimeout(this._followFixTimer);
    if (this._followStaleTimer) clearInterval(this._followStaleTimer);
    this._followFixTimer = null;
    this._followStaleTimer = null;
    if (target === "paused" && this._trailModel && Number.isFinite(this._trailModel.cursorMeters)) this._trailModel = progress.pauseProgressState(this._trailIndex, this._trailModel);
    else { this._trailIndex = null; this._trailModel = null; if (target === "paused") target = "idle"; }
    const session = this._followSession;
    const finalState = { ...emptyFollow(), ...this.followEvidence(), ...this.followSummary(), evidenceKind: session ? "LAST_SESSION" : this.data.followState.evidenceKind, ...(summary ? { walkedText: summary.walkedText, progressText: summary.progressText, remainingText: summary.remainingText } : {}),
      canComplete: false, status: target, message: target === "paused" ? "循迹已暂停，返回前台后需主动继续。" : target === "ended" ? "循迹已结束，未记录位置历史。" : "" };
    if (!this._unloaded) this.setData({ followState: { ...finalState, status: session ? "stopping" : target, stopOutcome: session ? "PENDING" : finalState.stopOutcome },
      followCamera: false, followPrivacyVisible: false, mapMarkers: this.data.mapCenter ? this.data.mapCenter.markers : [] });
    if (!session) { this.releaseNavigationMode(this._realModeClaim); this._realModeClaim = null; return true; }
    try {
      await session.stop();
      finalState.stopOutcome = "CLEANUP_CONTRACT_CONFIRMED";
      this.releaseNavigationMode(this._realModeClaim);
      this._realModeClaim = null;
      if (this._followSession === session) this._followSession = null;
      if (!this._unloaded && version === this._followVersion) this.setData({ followState: finalState });
      return true;
    } catch (_) {
      if (!this._unloaded && version === this._followVersion) this.setData({ followState: { ...finalState, status: "error", stopOutcome: "FAILED_OR_UNCONFIRMED", cleanupPending: true, message: trailFollow.errorMessage("STOP_FAILED") } });
      return false;
    }
  },

  onPauseFollowTap() { return this.stopFollow("paused"); },
  onStopFollowTap() { return this.stopFollow(this.data.followState.cleanupPending ? this._followStopTarget : "ended"); },
  onFollowPrivacyAgree(event) {
    // 仅绑定官方agreePrivacyAuthorization事件；阅读指引和普通tap都不视作同意。
    if (this._unloaded || this._hidden || !this.data.followPrivacyVisible || !event || event.type !== "agreeprivacyauthorization") return;
    this.setData({ followPrivacyVisible: false, followPrivacyStatus: "agreed", followPrivacyMessage: "已收到微信隐私同意事件，尚未启动GPS。请主动点击开始或继续，届时重新检查隐私和定位权限。" });
  },
  onFollowPrivacyCancel() { if (this._cancelPrivacyCheck) this._cancelPrivacyCheck(); this._privacyGeneration = (this._privacyGeneration || 0) + 1;
    this.setData({ followPrivacyVisible: false, followPrivacyStatus: "declined", followPrivacyMessage: "您已暂不授权，未启动定位。可继续查看地图。" }); },
  onFollowPrivacyView() {
    if (this._unloaded || this._hidden) return;
    const route = this.data.route;
    const fail = () => { if (!this._unloaded && !this._hidden && this.data.route === route) this.setData({ followPrivacyMessage: "无法打开隐私指引，请更新微信或检查公众平台隐私配置；未启动定位。" }); };
    try { wx.openPrivacyContract({ fail }); } catch (_) { fail(); }
  },
  onFollowCameraTap() {
    if (this.data.followCamera) { this.setData({ followCamera: false }); return; }
    const state = this.data.followState;
    if (this._hidden || this._unloaded || state.status !== "following" || !state.location || state.quality !== "reliable" || state.stale
      || Date.now() - state.location.updatedAt > progress.POLICY.freshMs) return;
    this.setData({ followCamera: true }); this.onFollowRecenterTap();
  },
  onMapRegionChange(event) {
    const causedBy = event && (event.causedBy || event.detail && event.detail.causedBy);
    if (!this._unloaded && this.data.followCamera && (causedBy === "gesture" || causedBy === "drag")) this.setData({ followCamera: false });
  },
  onViewTrailTap() {
    if (this._unloaded || this._hidden || this.data.mapRenderError || !this.data.mapCenter) return;
    this.setData({ followCamera: false });
    const route = this.data.route, points = this.data.mapCenter.polyline[0] && this.data.mapCenter.polyline[0].points;
    if (!points || points.length < 2) return;
    const fail = () => { if (!this._unloaded && !this._hidden && this.data.route === route) this.setData({ followState: { ...this.data.followState, message: "完整路线视野调整失败，可手动缩放地图。" } }); };
    try { wx.createMapContext("route-map", this).includePoints({ points, padding: [30, 30, 30, 30], fail }); }
    catch (_) { fail(); }
  },
  completionIsCurrent(snapshot) {
    return !this._unloaded && !this._hidden && this.data.route === snapshot.route && this._followVersion === snapshot.version
      && !!this._followSession && this.data.followState.status === "following" && progress.canConfirmCompletion(this._trailIndex, this._trailModel, Date.now());
  },
  onConfirmFollowTap() {
    const snapshot = { route: this.data.route, version: this._followVersion };
    if (this._completionPrompt || this._unloaded || this._hidden) return;
    if (!this.completionIsCurrent(snapshot)) {
      if (this.data.followState.status === "following") this.setData({ followState: { ...this.data.followState, canComplete: false, message: "当前位置或进度尚不满足完成条件，请等待可靠定位。" } });
      return;
    }
    this._completionPrompt = snapshot;
    const fail = () => {
      if (this._completionPrompt !== snapshot) return;
      this._completionPrompt = null;
      if (!this._unloaded && !this._hidden) this.setData({ followState: { ...this.data.followState, message: "无法打开完成确认，请稍后重试。" } });
    };
    try { wx.showModal({ title: "确认完成本次循迹？", content: "参考进度已接近终点。请结合现场确认；确认后将停止定位，仅保留本页摘要。", confirmText: "确认完成", cancelText: "继续循迹",
      success: async result => {
        if (this._completionPrompt !== snapshot) return;
        this._completionPrompt = null;
        if (!result.confirm || !this.completionIsCurrent(snapshot)) return;
        const stopped = await this.stopFollow("ended");
        if (stopped && !this._unloaded && !this._hidden && this.data.route === snapshot.route && this._followVersion === snapshot.version + 1) {
          this.setData({ followState: { ...this.data.followState, status: "completed", message: "本次循迹已由您确认完成，定位已停止。" } });
        }
      }, fail }); } catch (_) { fail(); }
  },
  onFollowRecenterTap() {
    const state = this.data.followState;
    if (this._hidden || this._unloaded || state.status !== "following" || !state.location || state.stale || state.quality !== "reliable" || Date.now() - state.location.updatedAt > progress.POLICY.freshMs) return;
    const { latitude, longitude } = state.location;
    const failed = () => {
      if (!this._unloaded && !this._hidden && this.data.followState.location === state.location) this.setData({ followCamera: false, followState: { ...state, message: "地图回中失败，可手动拖动地图。" } });
    };
    try { wx.createMapContext("route-map", this).moveToLocation({ latitude, longitude, fail: failed }); }
    catch (_) { failed(); }
  },

  onBackTap() {
    this.clearNavigation();
    this.disposeSimulation();
    const back = () => wx.navigateBack({
      delta: 1,
      fail() {
        wx.redirectTo({ url: "/pages/routes/index" });
      }
    });
    if (this._backPending) return this._backPending;
    if (!this._followSession && !this._followTransition) return back();
    this._backPending = this.stopFollow("paused").then(stopped => {
      if (stopped && !this._hidden && !this._unloaded) back();
    }).finally(() => { this._backPending = null; });
    return this._backPending;
  }
};
Page(routeOverview.install(definition,wx,"ROUTE-OVERVIEW-v0.2"));

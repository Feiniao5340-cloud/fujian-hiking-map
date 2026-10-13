const { getRouteById } = require("../../services/route-service");
const { toStartMapData, composeNavigationMap } = require("../../utils/map-data");
const navigation = require("../../services/navigation-service");
const trailFollow = require("../../services/trail-follow-service");
const progress = require("../../utils/trail-progress");
const emptyFollow = () => ({ status: "idle", message: "", location: null, accuracyText: "", updatedText: "", stale: false, cleanupPending: false,
  walkedText: "待确认", progressText: "待确认", remainingText: "待确认", quality: "unavailable", qualityText: "等待定位", offRouteStatus: "unknown", canComplete: false });
const qualityText = quality => ({ reliable: "定位可靠", degraded: "精度较低，进度冻结", unavailable: "精度不足或未知", stale: "位置已过期", jump: "位置跳变，进度冻结", ambiguous: "路段不确定，进度冻结", recovering: "正在重新确认路段" }[quality] || "等待定位");
const {
  formatDistance,
  formatDuration,
  formatDifficulty,
  formatRouteType,
  formatElevationGain
} = require("../../utils/format");

Page({
  data: {
    route: null,
    status: "loading",
    mapCenter: null,
    mapRenderError: false,
    selectedWaypoint: null,
    followState: emptyFollow(),
    followPrivacyVisible: false,
    followCamera: false,
    mapMarkers: [],
    nativeNavigation: { status: "idle", errorCode: null },
    accessRoute: navigation.emptyAccessRoute(),
    mapPolylines: [],
    mapIncludePoints: [],
    navigationMessage: "",
    accessSummary: { distance: "", minutes: null }
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
        mapCenter,
        mapMarkers: mapCenter ? mapCenter.markers : [],
        ...composeNavigationMap(mapCenter, navigation.emptyAccessRoute()),
        route: Object.assign({}, route, {
          displayDistance: formatDistance(route.distanceMeters),
          displayDuration: formatDuration(route.estimatedDurationMinutes),
          displayDifficulty: formatDifficulty(route.difficulty),
          displayRouteType: formatRouteType(route.routeType),
          displayElevationGain: formatElevationGain(route.elevationGainMeters)
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
    this.stopFollow();
    this.clearNavigation();
    this.setData({ status, route: null, mapCenter: null, mapRenderError: false, selectedWaypoint: null });
    this.setData({ mapPolylines: [], mapIncludePoints: [], mapMarkers: [] });
  },

  onMarkerTap(event) {
    if (this._unloaded || this.data.status !== "success") return;
    const id = event && event.detail && event.detail.markerId;
    if (id === -1) return;
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
    this.stopFollow();
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._loading = false;
    this._navigationVersion = (this._navigationVersion || 0) + 1;
    // 页面已销毁，不再setData；释放临时位置/接驳引用。
    Object.assign(this.data, { accessRoute: navigation.emptyAccessRoute(),
      nativeNavigation: { status: "idle", errorCode: null }, mapPolylines: [], mapIncludePoints: [],
      navigationMessage: "", accessSummary: { distance: "", minutes: null },
      followState: emptyFollow(), followPrivacyVisible: false, followCamera: false, mapMarkers: [] });
  },

  clearNavigation() {
    this._navigationVersion = (this._navigationVersion || 0) + 1;
    if (this._unloaded) return;
    const accessRoute = navigation.emptyAccessRoute();
    this.setData({ nativeNavigation: { status: "idle", errorCode: null }, accessRoute,
      navigationMessage: "", accessSummary: { distance: "", minutes: null }, ...composeNavigationMap(this.data.mapCenter, accessRoute) });
  },

  onHide() {
    this._hidden = true;
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
    if (this._followSession && !await this.stopFollow("paused")) return;
    const snapshot = this.navigationSnapshot();
    if (!snapshot) return;
    this.setData({ nativeNavigation: { status: "opening", errorCode: null } });
    try {
      await navigation.openTarget(snapshot.target);
      if (this.navigationIsCurrent(snapshot)) this.setData({ nativeNavigation: { status: "idle", errorCode: null } });
    } catch (error) {
      if (!this.navigationIsCurrent(snapshot)) return;
      const code = navigation.errorCode(error, "OPEN_LOCATION_FAILED");
      this.setData({ nativeNavigation: { status: "error", errorCode: code }, navigationMessage: navigation.errorMessage(code) });
    }
  },

  async onPlanAccessTap() {
    if (["locating", "planning"].includes(this.data.accessRoute.status) || this.data.nativeNavigation.status === "opening") return;
    if (this._followSession && !await this.stopFollow("paused")) return;
    const snapshot = this.navigationSnapshot();
    if (!snapshot) return;
    this.setData({ accessRoute: navigation.emptyAccessRoute("locating") });
    try {
      const origin = await navigation.locateOnce();
      if (!this.navigationIsCurrent(snapshot)) return;
      const identity = { routeId: snapshot.route._id, routeUpdatedAt: snapshot.route.updatedAt,
        waypointId: snapshot.target.id, origin,
        destination: { name: snapshot.target.name, latitude: snapshot.target.latitude, longitude: snapshot.target.longitude } };
      this.setData({ accessRoute: { ...navigation.emptyAccessRoute("planning"), ...identity } });
      const result = await navigation.planAccessRoute(origin, snapshot.target);
      if (!this.navigationIsCurrent(snapshot)) return;
      const accessRoute = { ...navigation.emptyAccessRoute("success"), ...identity,
        distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds, points: result.points };
      this.setData({ accessRoute, ...composeNavigationMap(this.data.mapCenter, accessRoute),
        accessSummary: { distance: result.distanceMeters === 0 ? "0 m" : formatDistance(result.distanceMeters),
          minutes: Math.ceil(result.durationSeconds / 60) } });
    } catch (error) {
      if (!this.navigationIsCurrent(snapshot)) return;
      const fallback = this.data.accessRoute.status === "locating" ? "LOCATION_FAILED" : "CLOUD_CALL_FAILED";
      const code = navigation.errorCode(error, fallback);
      const accessRoute = navigation.emptyAccessRoute(code === "LOCATION_DENIED" ? "permissionDenied" : "error", code);
      this.setData({ accessRoute, ...composeNavigationMap(this.data.mapCenter, accessRoute),
        accessSummary: { distance: "", minutes: null }, navigationMessage: navigation.errorMessage(code) });
    }
  },

  onClearAccessTap() { this.clearNavigation(); },

  followSummary() {
    const model = this._trailModel, index = this._trailIndex;
    if (!model || !index || !Number.isFinite(model.cursorMeters)) return { walkedText: "待确认", progressText: "待确认", remainingText: "待确认", canComplete: false };
    const walked = Math.max(0, model.cursorMeters - model.startCursorMeters);
    return { walkedText: walked === 0 ? "0 m" : formatDistance(walked), progressText: `${(model.cursorMeters / index.totalTrackMeters * 100).toFixed(1)}%`,
      canComplete: progress.canConfirmCompletion(index, model, Date.now()),
      remainingText: index.totalTrackMeters <= model.cursorMeters ? "0 m" : formatDistance(index.totalTrackMeters - model.cursorMeters) };
  },

  async onStartFollowTap() { return this.startFollow(false); },
  async onResumeFollowTap() {
    if (this.data.followState.status !== "paused") return;
    return this.startFollow(true);
  },
  async startFollow(resume) {
    if (this._unloaded || this._hidden || this.data.status !== "success" || !this.data.mapCenter
      || this.data.mapRenderError || this._followSession || this.data.nativeNavigation.status === "opening") return;
    const route = this.data.route;
    if (!resume) { this._trailIndex = progress.buildTrailIndex(route); this._trailModel = progress.createProgressState(this._trailIndex); }
    else this._trailModel = progress.resumeProgressState(this._trailIndex, this._trailModel);
    if (!this._trailIndex || this._trailIndex.status !== "ready") {
      this.setData({ followState: { ...emptyFollow(), status: "error", message: "路线资料暂不支持循迹计算，原路线仍可查看。" } }); return;
    }
    this.clearNavigation();
    const version = this._followVersion = (this._followVersion || 0) + 1;
    const current = () => !this._unloaded && !this._hidden && version === this._followVersion && route === this.data.route;
    const session = trailFollow.createSession({
      onLocation: location => {
        if (!current()) return;
        try {
          const result = progress.updateTrailProgress(this._trailIndex, this._trailModel, location, Date.now());
          this._trailModel = result.state;
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
          this.setData({ followState: { ...emptyFollow(), ...this.followSummary(), status: confirmed ? "following" : resume ? "resuming" : "starting",
            location: visible ? location : null, quality: result.locationQuality, qualityText: qualityText(result.locationQuality), offRouteStatus: result.offRouteStatus,
            accuracyText: location.accuracy === null ? "精度未知" : `约${Math.ceil(location.accuracy)}米`, updatedText: time,
            message },
            mapMarkers: visible ? [...this.data.mapCenter.markers, { id: -1, latitude: location.latitude, longitude: location.longitude,
              iconPath: "/assets/map/location.png", width: 24, height: 24, anchor: { x: 0.5, y: 0.5 }, zIndex: 10 }] : this.data.mapCenter.markers });
          if (this.data.followCamera) {
            if (confirmed && result.locationQuality === "reliable") this.onFollowRecenterTap();
            else this.setData({ followCamera: false });
          }
        } catch (_) { this.failFollow({ code: "LOCATION_FAILED" }); }
      },
      onError: error => { if (current()) this.failFollow(error); }
    });
    this._followSession = session;
    this.setData({ followState: { ...emptyFollow(), ...this.followSummary(), status: resume ? "resuming" : "starting", message: "正在开启前台定位…" }, followPrivacyVisible: false });
    try {
      await session.start();
      if (!current()) return;
      if (this.data.followState.status !== "following") {
        this._followFixTimer = setTimeout(() => { if (current()) this.failFollow({ code: "TIMEOUT" }); }, 20000);
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
    this.setData({ followState: { ...emptyFollow(), ...this.followSummary(), status: retain ? "paused" : error.code === "LOCATION_DENIED" ? "permissionDenied" : "error",
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
    const finalState = { ...emptyFollow(), ...this.followSummary(), ...(summary ? { walkedText: summary.walkedText, progressText: summary.progressText, remainingText: summary.remainingText } : {}),
      canComplete: false, status: target, message: target === "paused" ? "循迹已暂停，返回前台后需主动继续。" : target === "ended" ? "循迹已结束，未记录位置历史。" : "" };
    if (!this._unloaded) this.setData({ followState: { ...finalState, status: session ? "stopping" : target },
      followCamera: false, followPrivacyVisible: false, mapMarkers: this.data.mapCenter ? this.data.mapCenter.markers : [] });
    if (!session) return true;
    try {
      await session.stop();
      if (this._followSession === session) this._followSession = null;
      if (!this._unloaded && version === this._followVersion) this.setData({ followState: finalState });
      return true;
    } catch (_) {
      if (!this._unloaded && version === this._followVersion) this.setData({ followState: { ...finalState, status: "error", cleanupPending: true, message: trailFollow.errorMessage("STOP_FAILED") } });
      return false;
    }
  },

  onPauseFollowTap() { return this.stopFollow("paused"); },
  onStopFollowTap() { return this.stopFollow(this.data.followState.cleanupPending ? this._followStopTarget : "ended"); },
  onFollowPrivacyAgree() { this.setData({ followPrivacyVisible: false }); return this._privacyResume ? this.onResumeFollowTap() : this.onStartFollowTap(); },
  onFollowPrivacyCancel() { this.setData({ followPrivacyVisible: false }); },
  onFollowPrivacyView() { if (typeof wx.openPrivacyContract === "function") wx.openPrivacyContract({ fail() {} }); },
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
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.redirectTo({ url: "/pages/routes/index" });
      }
    });
  }
});

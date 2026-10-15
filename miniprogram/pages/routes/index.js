const { getRouteList } = require("../../services/route-service");
const { formatRouteCopy, formatDistance, formatDuration, formatDifficulty, formatRouteType } = require("../../utils/format");

Page({
  data: {
    routes: [],
    routeCount: "--",
    status: "loading"
  },

  onLoad() {
    this._unloaded = false;
    return this.loadRoutes();
  },

  async loadRoutes() {
    if (this._loading || this._unloaded) return;
    this._loading = true;
    this.setData({ status: "loading", routes: [], routeCount: "--" });

    try {
      const routes = await getRouteList();
      if (this._unloaded) return;
      const displayRoutes = routes.map((route) => Object.assign({}, route, {
        displayDistance: formatDistance(route.distanceMeters),
        displayDuration: formatDuration(route.estimatedDurationMinutes),
        displayDifficulty: formatDifficulty(route.difficulty),
        displayRouteType: formatRouteType(route.routeType),
        ...formatRouteCopy(route)
      }));

      this.setData({
        routes: displayRoutes,
        routeCount: displayRoutes.length < 10 ? `0${displayRoutes.length}` : String(displayRoutes.length),
        status: displayRoutes.length ? "success" : "empty"
      });
      console.info("[routes] 云端列表读取成功，条数：", displayRoutes.length);
    } catch (error) {
      if (this._unloaded) return;
      console.error("[routes] 云端列表读取失败：", error);
      this.setData({ status: "error", routes: [], routeCount: "--" });
    } finally {
      this._loading = false;
    }
  },

  onRetryTap() {
    return this.loadRoutes();
  },

  onUnload() {
    this._unloaded = true;
  },

  onRouteTap(event) {
    const routeId = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/route-detail/index?id=${encodeURIComponent(routeId)}`
    });
  }
});

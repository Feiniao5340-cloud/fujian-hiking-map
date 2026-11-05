const { cloudEnvId, routeCollection } = require("../config/env");

// V0.3独立数据集；配置缺失或误指旧集合时拒绝，绝不静默回落V0.2。
function checkedCollection() {
  if (routeCollection !== "routes_v03") throw new Error("V0.3路线数据源配置无效");
  return routeCollection;
}
// 只读取列表所需摘要，不传输轨迹和节点。
async function getRouteList() {
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云开发");
  }

  const collection = checkedCollection();
  const db = wx.cloud.database({ env: cloudEnvId });
  const result = await db.collection(collection).field({
    _id: true,
    name: true,
    city: true,
    district: true,
    distanceMeters: true,
    estimatedDurationMinutes: true,
    difficulty: true,
    routeType: true
  }).limit(20).get();

  if (!result || !Array.isArray(result.data)) {
    throw new Error("云数据库返回格式异常");
  }
  return result.data;
}

async function getRouteById(routeId) {
  if (typeof routeId !== "string" || !routeId.trim()) {
    throw new Error("缺少路线 ID");
  }
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云开发");
  }

  // _id 等值查询一次取完整文档；空数组代表不存在，请求拒绝仍抛出。
  const collection = checkedCollection();
  const db = wx.cloud.database({ env: cloudEnvId });
  const result = await db.collection(collection).where({ _id: routeId }).limit(1).get();
  if (!result || !Array.isArray(result.data)) {
    throw new Error("云数据库返回格式异常");
  }
  if (result.data.length === 0) return null;
  const route = result.data[0];
  if (!route || route._id !== routeId) {
    throw new Error("云数据库返回的路线 ID 不匹配");
  }
  // Keep existing map degradation for missing/bad geometry; B1 independently rejects invalid tracks.
  if (route.schemaVersion !== 1 || typeof route.name !== "string" || !route.name.trim()
    || typeof route.updatedAt !== "string" || !Number.isFinite(Date.parse(route.updatedAt))) {
    throw new Error("云数据库返回的路线结构异常");
  }
  return route;
}

module.exports = { getRouteList, getRouteById };

const { cloudEnvId } = require("../config/env");

// 当前 MVP 仅 1–3 条路线；只读取列表所需摘要，不传输轨迹和节点。
async function getRouteList() {
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云开发");
  }

  const db = wx.cloud.database({ env: cloudEnvId });
  const result = await db.collection("routes").field({
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
  const db = wx.cloud.database({ env: cloudEnvId });
  const result = await db.collection("routes").where({ _id: routeId }).limit(1).get();
  if (!result || !Array.isArray(result.data)) {
    throw new Error("云数据库返回格式异常");
  }
  if (result.data.length === 0) return null;
  const route = result.data[0];
  if (!route || route._id !== routeId) {
    throw new Error("云数据库返回的路线 ID 不匹配");
  }
  return route;
}

module.exports = { getRouteList, getRouteById };

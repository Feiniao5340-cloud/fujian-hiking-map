const difficultyLabels = {
  easy: "轻松",
  moderate: "适中",
  hard: "较难"
};

const routeTypeLabels = {
  loop: "环线",
  outAndBack: "往返",
  pointToPoint: "穿越"
};

function formatDistance(meters) {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0) {
    return "暂无数据";
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")} km`;
}

function formatDuration(minutes) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return "暂无数据";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} 小时 ${remainingMinutes} 分`;
  }
  if (hours > 0) {
    return `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}

function formatDifficulty(difficulty) {
  return difficultyLabels[difficulty] || "未标注";
}

function formatRouteType(routeType) {
  return routeTypeLabels[routeType] || "路线";
}

function formatElevationGain(meters) {
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
    return "暂无数据";
  }
  return `${Math.round(meters)} m`;
}

function formatRouteCopy(route) {
  let displayDistrict = route.district;
  let displayLocationText = route.locationText;
  let displaySummary = route.summary;
  if (route._id === "fj-route-005") {
    if (typeof displayDistrict === "string") displayDistrict = displayDistrict.replace("（行政区划待核对）", "");
    if (typeof displayLocationText === "string") displayLocationText = displayLocationText.replace("具体行政区划与通行条件待核对。", "今日通行条件待核对。");
  }
  if (typeof displaySummary === "string") {
    const labels = { 简单: "轻松", 中等: "适中", 困难: "较难" };
    displaySummary = displaySummary.replace(/难度为(简单|中等|困难)/g, (_, label) => "难度为" + labels[label]).replace(/（项目参考评级）/g, "");
  }
  return { displayDistrict, displayLocationText, displaySummary };
}

module.exports = {
  formatRouteCopy,
  formatDistance,
  formatDuration,
  formatDifficulty,
  formatRouteType,
  formatElevationGain
};

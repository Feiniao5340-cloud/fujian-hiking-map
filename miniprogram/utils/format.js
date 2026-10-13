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

module.exports = {
  formatDistance,
  formatDuration,
  formatDifficulty,
  formatRouteType,
  formatElevationGain
};

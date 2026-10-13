const { cloudEnvId } = require("./config/env");

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("[CloudBase] 当前基础库不支持 wx.cloud，请检查基础库版本。");
      return;
    }

    try {
      wx.cloud.init({ env: cloudEnvId });
      // 初始化返回不代表云端连接或数据库权限已验证。
      console.info("[CloudBase] 初始化调用完成，目标环境：", cloudEnvId);
    } catch (error) {
      console.error("[CloudBase] 初始化失败：", error);
    }
  }
});

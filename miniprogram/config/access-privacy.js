// 阅读通道可达、当前操作明示同意、真实请求许可相互独立；平台/合规准入仍须另行审查。
// 不是运行时开关；页面data、用户的通用隐私同意均不能修改这些条件。
module.exports = Object.freeze({
  providerLegalName: "北京高德图强科技有限公司", // OWNER_CONFIRMED；未独立登录后台核验。
  getLocationApproved: true, // OWNER_CONFIRMED：单次接口已开通；不代表其他AppID也获准。
  policyPagePath: null, // 历史站内页字段；微信指引桥接不是站内页面，不再作为请求许可。
  policyReader: "wechatPrivacyContractSupplement", // 微信指引→补充文档→高德官方政策。
  policyReaderVerified: true, // D2/D5 USER_REPORTED_ANDROID；仅通道可达，不证明当前用户已读或同意。
  accessRequestsEnabled: false, // 独立构建准入硬阻断；须另行核对平台/合规并明确授权才能修改。
  policyUrl: "https://lbs.amap.com/pages/privacy/"
});

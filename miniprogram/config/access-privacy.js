// 只有所有者确认当前账号协议主体、接口准入及可访问政策页后，才可另行审查修改。
// 不是运行时开关；页面data、用户的通用隐私同意均不能修改这些条件。
module.exports = Object.freeze({
  providerLegalName: "北京高德图强科技有限公司", // OWNER_CONFIRMED；未独立登录后台核验。
  getLocationApproved: true, // OWNER_CONFIRMED：单次接口已开通；不代表其他AppID也获准。
  policyPagePath: null, // 尚无已验证可展示高德政策的合法站内页面，不猜测web-view资质。
  policyUrl: "https://lbs.amap.com/pages/privacy/"
});

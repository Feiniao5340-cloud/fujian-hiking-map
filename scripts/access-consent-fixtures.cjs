// 隔离wx单测的假定条件；不是实际主体/平台审核结果，不被生产源码引用。
const APPROVED_ACCESS = Object.freeze({ providerLegalName: "ISOLATED_TEST_PROVIDER_NOT_VERIFIED",
  getLocationApproved: true, policyPagePath: null, policyReader: "wechatPrivacyContractSupplement",
  policyReaderVerified: true, accessRequestsEnabled: true, policyUrl: "https://lbs.amap.com/pages/privacy/" });
const consentEvent = page => ({ currentTarget: { dataset: { requestId: page.data.accessConsent.requestId } } });
function startAccess(page) {
  // 既有正常/失败回归显式补上本次同意；新的拒绝/生产门禁测试不使用此助手。
  const previous = page._accessIntent;
  page.onPlanAccessTap();
  if (!page._accessIntent || (page._accessIntent === previous && page._accessIntent.stage !== "pending")) return;
  return page.onAccessConsentAgree(consentEvent(page));
}
module.exports = { APPROVED_ACCESS, consentEvent, startAccess };

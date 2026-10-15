# v0.2 运行配置与安全说明

日期：2026-10-15（Asia/Shanghai）。本文为当前公开候选运行指南；自有账号和独立CloudBase环境仍待独立复验。本轮准备没有部署或写云数据，下列操作由使用者在自己的环境执行。

## 真实配置方式

| 项目 | 当前读取位置 | 使用者需要配置 |
| --- | --- | --- |
| 小程序 AppID | `project.config.json` 的 `appid` | 自己小程序的 AppID |
| 云环境 | `miniprogram/config/env.js` 的 `cloudEnvId` | 与自己的 AppID 关联的 CloudBase 环境 ID；app.js、route-service、navigation-service 均读取它 |
| 服务端调用方 | `cloudfunctions/planAccessRoute/index.js` 的 `APP_ID` 常量 | 同一个自己的 AppID；不是环境变量 |
| 高德 Web Service Key | 函数 `process.env.AMAP_WEB_SERVICE_KEY` | 仅在自己的云函数控制台设置并应用，不保存值到本地模板 |
| 私人开发配置 | `project.private.config.json` | 由开发者工具按需生成的本地文件；当前公开候选不包含，禁止发布 |

正式工作区保持原样；本候选沿用经审查的三处YOUR占位值，使用者必须在导入开发者工具前替换为自有值。占位不是可用AppID，不宣称未经替换可完成图形导入。示例只解释需要的字段，不能覆盖整份现有项目配置：

```json
{ "appid": "YOUR_MINIPROGRAM_APPID" }
```

```js
// miniprogram/config/env.js：仅云环境标识，无 Key
module.exports = { cloudEnvId: "YOUR_CLOUDBASE_ENV_ID" };
// 云函数现有 APP_ID 常量的替换值；保留所有鉴权条件
const APP_ID = "YOUR_MINIPROGRAM_APPID";
```

项目没有 `.env` 加载器；新建 `.env` 不会自动配置小程序或函数。`APP_ID` 不支持环境变量覆盖。候选接驳测试从project.config.json读取测试AppID，临时runner同时包含该配置。占位也能离线执行身份成功/错误AppID/空身份/错误SOURCE测试；使用者仍须同步替换函数APP_ID后重跑，不能关闭鉴权。

## 开发者工具与环境

1. 使用自己的小程序账号登录开发者工具，导入项目根目录。当前配置为 `compileType=miniprogram`、`miniprogramRoot=miniprogram/`、`cloudfunctionRoot=cloudfunctions/`，基础库 `3.17.3`。独立账号、其他工具/基础库版本兼容性待复验。
2. 自行开通、关联 CloudBase 环境，核对环境有效期、套餐、额度及费用提醒；不要使用所有者环境。初始化返回只证明调用过 `wx.cloud.init`，不能证明读库权限或云函数可用。
3. 云数据库只放获准公开的六条正式路线。客户端列表取摘要 `limit(20)`；详情按 `_id` 等值查询取完整文档。数据库安全保护不依赖前端没有编辑按钮。
4. 使用者按后台当前要求核对账号类目、`getLocation` 等接口准入及隐私指引。候选 `app.json` 用途文案已收窄为主动发起接驳时获取一次位置；`getLocation/startLocationUpdate/onLocationChange` 声明暂保留，因为保留服务源码仍含持续定位API。官方配置/API页面与阅读代理本轮未能取得内容，未确认无运行入口时能否删除后两项；此项必须人工核对平台要求与后台隐私，未完成不能宣称声明Gate通过。不能重新开启旧循迹入口。
5. 本候选 `project.config.json` 已设置 `urlCheck=true`，原开发配置未改；开启工具校验仍不是正式发布合规证明；不要通过关闭校验解决权限问题。本项目客户端不直接请求高德，没有必要把服务端 Key 或高德请求代码搬入客户端。

## 数据库集合与规则

仅在自己的独立环境创建集合，按现有设计配置以下客户端规则，不调整所有者正式环境：

`routes`：

```json
{ "read": true, "write": false }
```

`navigation_limits`：

```json
{ "read": false, "write": false }
```

不要额外开放 create/update/delete。公开读取意味着客户端可以请求完整 Route，因此不能混放账号、Secret、草稿或私人字段。管理端导入与服务端 SDK 权限不由上述客户端规则等同约束，管理账号及云函数调用权限仍需独立核对。规则示例是冻结设计，独立环境实际拒写/计数隔离证据仍待复验。

`navigation_limits` 不需手工预填计数；函数通过事务创建/更新用户哈希记录和 `global` 记录，仅保存时间桶与计数。当前代码每用户 10 次/分钟、60 次/上海自然日，全函数 200 次/日；通过限频后上游失败也消耗计数。不能将集合改为公开读写，不能用清空计数来绕过保护。

## 六路线导入

只导入以下明确文件，各为一行 UTF-8 JSON Lines 完整文档：

| 导入文件（data/routes/） | 必须保留的 `_id` |
| --- | --- |
| xiamen-loop-import.json | fj-route-005 |
| damushan-import.json | fj-route-006 |
| yushandao-import.json | fj-route-008 |
| huanglianyu-import.json | fj-route-009 |
| taimushan-import.json | fj-route-010 |
| xiaoping-forest-park-import.json | fj-route-011 |

先在本地执行 README 的统一测试，再在自己 CloudBase 控制台选择 `routes`。按控制台实际支持的 JSON Lines 导入方式逐份导入；若无适用导入入口，用添加记录的 JSON 编辑器填写该文件唯一完整对象。界面流程与新环境导入待复验。

保留稳定 `_id`、数字/数组/null 类型和 `gcj02`。云库已有同 ID 时先停止核对，备份后单独决定，不重复 Insert 或自动覆盖。普通 JSON 与 Import 是同一对象，不能都导入。完成后逐条读回，确认只含六 ID、点数/Waypoint 与 README 表一致、没有 Seed/Mock。不在小程序中写库，不运行原 GPX 转换重造已接受的正式轨迹。

## planAccessRoute 部署前置（使用者执行，尚未独立环境复验）

1. 先完成自己的 AppID/环境关联、`navigation_limits` 私有规则、定位接口/隐私配置和高德 Web Service 服务额度配置。
2. 在独立候选源码中替换函数 `APP_ID`；保持 `cloud.getWXContext()` 的 APPID、非空 OPENID、`SOURCE=wx_client` 三项校验。函数不信任 event 身份，不开放匿名 HTTP/Web 代理。
3. 在开发者工具自己的云环境中对 `cloudfunctions/planAccessRoute/` 上传部署并云端安装依赖。唯一依赖来自该目录 `package.json`：`wx-server-sdk: ~3.0.1`。选择支持当前 Node.js 源码、内置 HTTPS/crypto/URLSearchParams 的运行时；部署平台当前可选版本及实际兼容性待复验。
4. 仅在函数控制台添加并应用 `AMAP_WEB_SERVICE_KEY`；不展开或截图其值。函数建议超时 15 秒（既有设计），代码上游等待 8 秒，客户端等待 20 秒；核对实际平台超时设置及调用权限，不能以 README 代替云端检查。
5. 核对到高德服务的网络访问及额度；函数返回米、秒、2–5000 个合法 GCJ-02 点，限制上游响应 1MiB，统一错误。失败保留正式 Trail 和原生目标入口，不补假直线。
6. 从真实小程序上下文验证；如工具上下文不是 `wx_client` 而被拒绝，记录 AUTH_REQUIRED，在手机验证，不能伪造身份或放宽鉴权。只记录成功/错误码、点数与单位摘要，不公开原始 event、响应点集或个人坐标。

只有路线展示不需要高德 Key；接驳功能需要函数部署及位置授权。拒绝定位、网络失败、限频、无可达路径或距离过远均应有受控提示。远距离受控失败不能替代近距正常蓝线验收。

## 编译与用户验证清单

- 首页 → 六路线列表 → 六详情，基本信息、完整绿色轨迹、起点和节点/卡片正确；旧真实循迹控件消失。
- Native 目标入口、近距 Access 规划/蓝线/米秒、清除后 Trail 保留；返回/重进/换路线无旧状态。
- 空数据、网络失败、定位拒绝及重试恢复；Console 无新错误。
- 确认客户端不能写 routes、不能读写 navigation_limits；使用隔离测试资料验证权限，不用正式数据做破坏性测试。
- 独立环境导入读回、函数部署版本/依赖/变量是否应用、身份拒绝及限频/日志边界；手机与 DevTools 分别记录设备/版本/步骤。

最新Task2E双端用户接受属于现有环境的整体视觉/交互结果，不等于上述独立账号和全部云安全验收。记录不应包含账号、Key、OPENID、个人位置或原始请求。

## 发布安全边界

`.gitignore` 是防误加入措施，不能撤销已跟踪文件或清理历史。当前公开候选实际没有Mock/Seed；历史存在与否不能只凭忽略规则判断。独立候选必须按闭合文件清单导出，排除旧 Seed/Mock、Raw、temporary、response、私配、未经审查日志/截图和原 `.git`/内部 refs。禁止整目录复制、镜像历史或 `git add .`。

当前候选保留完整业务源码与YOUR配置；Runner临时目录仅验证测试依赖。最新用户已接受的模式与证据层级见PORTFOLIO_STATUS.md。微信隐私正式一致性继续NOT_VERIFIED / PRIVACY_PENDING_LAST_KNOWN，不以本地无警告替代官方审核。截图和拟发布内容需单独确认。公开白名单为RELEASE_FILES_V02_DRAFT.txt，私人报告原件不在候选。

## v0.2演示与正常使用

不启动模拟即可浏览六路线、地图/Waypoint及使用Native/单次Access。005/006/009/011是完整B1虚拟GPS；008/010是原生速览。播放/暂停/继续/重播保留，倍率未交付；模拟不采集真实位置、不写历史。原生暂停在短段边界生效。特殊faceTo警告与证据边界见SIMULATION.md。独立环境首次编译和真机复现仍待使用者验证，不能直接运行YOUR占位。

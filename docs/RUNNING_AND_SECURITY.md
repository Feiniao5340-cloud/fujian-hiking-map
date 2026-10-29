# V0.3运行配置与安全说明（保留V0.2指南）

## 2026-10-29 · Day6-D4 当前交付边界

高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。

Day6-D3已只读核对实际部署包、控制台截图及用户报告：部署入口除账号绑定和行尾外与本地安全实现同源；客户端invoke允许认证非匿名身份，navigation_limits禁止客户端读写。当前V0.3客户端关闭不等于所有服务端调用路径全局关闭；未调用线上服务，Key有效性、自动日志及实际事务行为仍未验证。

以下部署步骤仅供未来另行批准的独立环境参考；当前方案A不需要为了浏览或演示部署/测试高德，也不得照步骤解除Access或release门。正式配置保持公开占位，不读取或合入私人运行身份。

正式005 Android首位置/起点保护/停止、Nearby连续会话进度/暂停恢复及六正式路线离线回放分别成立；正式Route following、进度、正式页暂停恢复、偏航回归、终点和现场校准仍待，硬件停止独立证据UNKNOWN。历史用户设备结果不提升为Codex独立手机操作。

[3分钟/8分钟演示指南](PORTFOLIO_DEMO_GUIDE.md) · [正式GPS现场手册](V03_GPS_FIELD_ACCEPTANCE_RUNBOOK.md)

以下带日期内容为各阶段记录；当前结论以上节为准。

## 2026-10-27 · 当前运行边界

V0.2已公开，V0.3仅为内部候选。下方Day2/Day3/R2/R4保留当时记录，其中尚未开通、主体待确认及全入口关闭不是当前结论。

真实GPS仅允许开发/体验版本在用户主动操作后进入必要隐私/位置授权，release仍由privateFollowBlock拒绝（RELEASE_GPS_BLOCKED）。高德法律主体与getLocation准入已有OWNER_CONFIRMED，但未由Codex独立登录后台核验；policyPagePath仍为null，真实Access继续阻断（ACCESS_POLICY_PENDING）。

当前scope.userLocation.desc为“用于主动规划步行接驳及前台GPS循迹定位”；requiredPrivateInfos仍声明getLocation/startLocationUpdate/onLocationChange，不含后台定位。账号开通、隐私指引用途与主体均由所有者确认，不可自动套用于其他AppID或独立环境；仍须核对本账号实际生效状态及用户可见披露。

正式005页面已有Android真实GPS启动、首位置和对应停止回执证据，远离起点时未错误进入following，重进未观察到自动定位。私人Nearby QA已取得真实following、同冻结路线同连续会话正向进度及暂停/恢复回执；这不能替代正式页面验收，也不证明实际步行距离测量精度。六条正式Route普通/密采样B1离线回放已通过。

正式Route的Android following、沿线进度、正式页面暂停/恢复、现场偏航和终点仍未完成验证；B1阈值仍为CALIBRATION_PENDING。停止回执证明SDK契约层结果，不独立证明硬件GPS停止；停止后的历史observationCount不是迟到回调探针。

逐次主动开始/恢复仍检查隐私与scope；官方同意不自动启动。停止失败或解绑不确认时保留owner/资源阻断，不以清UI释放；Access超时只有原始单次请求回执可解除对应等待，迟到结果受代次屏蔽，不自动GPS。Native清理ACK未确认同样阻断。

基础指南日期：2026-10-15（Asia/Shanghai），当前V0.3修订见上节；自有账号和独立CloudBase环境仍待独立复验。本轮准备没有部署或写云数据，下列操作由使用者在自己的环境执行。

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
4. 使用者按后台当前要求核对自己的账号类目、三项定位接口准入、隐私指引及实际用途。当前app.json同时描述主动单次接驳与前台循迹；运行版本和资源门仍需满足，不能通过修改页面data或关闭校验绕过。所有者确认不能替代独立账号审核。
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

- 首页 → 六路线列表 → 六详情，基本信息、完整绿色轨迹、起点和节点/卡片正确；真实GPS独立面板与模拟同时存在，加载不自动定位。
- Native目标入口可用；当前Access只核对政策阻断和拒绝零请求，未来解除政策门并获授权后另验近距蓝线/米秒与清除。返回/重进/换路线无旧状态。
- 空数据、网络失败、定位拒绝及重试恢复；Console 无新错误。
- 确认客户端不能写 routes、不能读写 navigation_limits；使用隔离测试资料验证权限，不用正式数据做破坏性测试。
- 独立环境导入读回、函数部署版本/依赖/变量是否应用、身份拒绝及限频/日志边界；手机与 DevTools 分别记录设备/版本/步骤。

最新Task2E双端用户接受属于现有环境的整体视觉/交互结果，不等于上述独立账号和全部云安全验收。记录不应包含账号、Key、OPENID、个人位置或原始请求。

## 发布安全边界与Day2历史记录

以下Day2状态按当时阶段保留，当前私人入口、配置和设备证据以上节为准。

V0.3 Day2开发只修服务并发与页面资源仲裁，真实循迹入口仍关闭，app.json及后台配置未改。启动Promise共享不替代隐私授权；`needAuthorization`仍拒绝启动。停止/解绑未确认保留资源锁，不能通过页面状态归零启动第二定位会话。Access单次定位超时不证明底层取消，保留对真实GPS启动的阻断，开放入口前需验证可解释的恢复路径。

当前仍为PLATFORM_PRIVACY_PENDING；B1为CALIBRATION_PENDING。Node替身通过不代表Android定位停止、微信隐私审核或户外安全已通过。没有新增后台定位、云写入、位置日志/历史存储；后续用户界面和实机流程需要另行授权。

`.gitignore` 是防误加入措施，不能撤销已跟踪文件或清理历史。当前公开候选实际没有Mock/Seed；历史存在与否不能只凭忽略规则判断。独立候选必须按闭合文件清单导出，排除旧 Seed/Mock、Raw、temporary、response、私配、未经审查日志/截图和原 `.git`/内部 refs。禁止整目录复制、镜像历史或 `git add .`。

当前候选保留完整业务源码与YOUR配置；Runner临时目录仅验证测试依赖。最新用户已接受的模式与证据层级见PORTFOLIO_STATUS.md。微信隐私正式一致性继续NOT_VERIFIED / PRIVACY_PENDING_LAST_KNOWN，不以本地无警告替代官方审核。截图和拟发布内容需单独确认。V0.3成员清单为RELEASE_FILES_V03_INTERNAL_CANDIDATE.txt；其自身为控制文件，不计入87个成员。RELEASE_FILES_V02_DRAFT.txt保持原样作为历史清单，私人报告原件不在候选。

## v0.2演示与正常使用（历史范围，V0.3 Access受政策门阻断）

不启动模拟即可浏览六路线、地图/Waypoint及使用Native/单次Access。005/006/009/011是完整B1虚拟GPS；008/010是原生速览。播放/暂停/继续/重播保留，倍率未交付；模拟不采集真实位置、不写历史。原生暂停在短段边界生效。特殊faceTo警告与证据边界见SIMULATION.md。独立环境首次编译和真机复现仍待使用者验证，不能直接运行YOUR占位。

## 历史阶段 · V0.3 Day3 前台实验界面与隐私核验边界

真实GPS面板已实现，开始/继续目前禁用并由公共处理函数再次阻断。仅用户明确点击“检查隐私授权”才查询；拒绝不循环请求，阅读不是同意，官方同意按钮事件也不自动启动定位。getPrivacySetting失败/超时、不可用接口均显示提示；hide/unload/换路线使旧隐私结果失效。禁止用模拟坐标填充真实蓝点。

查询日2026-10-19：微信官方网页直连及网页读取代理未成功；取得官方wechat-miniprogram/api-typings的API说明（commit 6092df9100c73b84e140c20b9a42a8e8799e0660，types/wx/lib.wx.api.d.ts）。它确认辅助API非全部必需、官方同意按钮契约及前台/单次定位区别；不能替代当前账号接口准入、公众平台隐私指引、系统权限和基础库实机确认。

官方说明入口：[getPrivacySetting](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.getPrivacySetting.html)、[requirePrivacyAuthorize](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.requirePrivacyAuthorize.html)、[onNeedPrivacyAuthorization](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.onNeedPrivacyAuthorization.html)、[openPrivacyContract](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/privacy/wx.openPrivacyContract.html)、[getLocation](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.getLocation.html)、[startLocationUpdate](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.startLocationUpdate.html)。[已读取官方API说明镜像](https://github.com/wechat-miniprogram/api-typings/blob/6092df9100c73b84e140c20b9a42a8e8799e0660/types/wx/lib.wx.api.d.ts)。

仍需项目所有者人工核对：当前账号getLocation/startLocationUpdate/onLocationChange准入状态；隐私保护指引确切收集目的/位置条目；app.json单次用途说明是否需同步持续前台用途；设备撤回授权、系统定位关闭后的反馈。本日不登录/修改微信后台，不修改app.json或私人身份配置，不以开发工具运行作为审核通过。

Access定位超时后可检查请求状态；无原始回执不释放资源令牌，不重复定位。迟到回执仅确认单次请求结束，允许再次主动操作；一直无回执时提示关闭并重新进入小程序，不声称固定等待能取消SDK。Native清理失败可主动重试，超时无ACK仍保持阻断；原始回执成功也不自动GPS。停止真实定位失败继续保留owner，结束/暂停/返回必须等物理停止确认。

当前状态：UI_IMPLEMENTED / PLATFORM_PRIVACY_PENDING / ANDROID_REAL_GPS_NOT_TESTED / FIELD_CALIBRATION_PENDING。无后台GPS、位置历史、云写入或生产发布。

## 历史阶段 · V0.3 Day3-R2 接驳同意的当前边界

服务提供方适用法律主体仍须所有者按实际Web API账户协议确认；界面明确写待核实，不能以品牌名代替主体而宣称披露完成。当前getLocation未开通为USER_REPORTED，持续接口已开通同为USER_REPORTED；未登录后台核验。app.json维持单次Access用途：现有隐私指引一致性未确认，真实持续GPS门不开放，不擅自扩展用途或权限。

每次接驳先显示用途、起终点经CloudBase转高德Web API、政策URL与同意/暂不使用。当前法律主体/接口/可访问政策页未齐，同意按钮禁用，处理函数和薄服务重复阻断，不能靠data或直接服务调用发送请求。没有新建web-view或猜测账号业务域名权限；政策阅读页未配置时显示失败并阻断，不把URL文字当作已验证可访问链接。

未来条件获准后，第三方同意与微信通用隐私同意及scope分别检查；拒绝、取消、过期意图零定位/零云请求。用户在已发送之后取消，只失效后续结果，不能撤回已经送出的坐标。微信或高德政策阅读失败时不能强迫同意。隔离测试替换模块依赖中的准入条件，不是实际批准或线上高德通过；生产不导入测试fixture。没有用户位置历史持久化或持续循迹上传。


## 历史阶段 · V0.3 R4 私人运行边界

个人主体、位置接口开通、隐私指引生效和用途一致来自所有者确认；没有代登录后台。仅独立私人副本使用该已获准账号的合法配置，不从旧项目复制身份，不向公开跟踪文件填真实运行身份。公开仓库继续保留占位配置；需要所有者在无Git元数据的私人QA目录核对运行身份及合法云环境。代码拒绝正式版/无法识别的运行版本，不因此宣称审核已通过。

前台GPS实验入口只在主动点击后查隐私及scope.userLocation；隐私响应缺失明确布尔值即失败，拒绝或取消不循环启动，官方同意事件本身不启动定位。不得在DevTools注入模拟位置后宣称真实手机GPS。高德阅读机会仍未验证，Access服务层ACCESS_POLICY_UNAVAILABLE保持；没有web-view、后台GPS、位置历史上传/存储或新增云部署。

# V0.3 当前实施状态

## 2026-11-05 · D4.1 视觉验收与 D5 源码对齐

用户确认 Android 初始 GPS 卡片、两行两列按钮、精简模拟卡片及路线详情的视觉验收通过。运行中、弱定位和偏航界面沿用本地验证证据。正式 GPS 与 Access 许可均为 false，V0.3 处于 RC 阶段。下方各阶段待验结论保留为历史。


## 2026-11-05 · Day8-D4 最终集成与GPS用户界面收口
D3.2已由用户确认新顶部左对齐、008速览/返回、真实ACK_SUCCESS及005跨页IDLE/resources=[]通过；原D3-UI-01关闭。D2M一次194点真实接驳成功继续有效，本轮不重复位置外发或高德请求。
GPS正式卡片删除普通用户可见的会话/SDK/回调计数/B1原因/精度时间/历史投影距离诊断；保留简洁状态、必要按钮和前台停止/不自动恢复/不存位置历史说明。WXML内WXS纯映射只读取followState，Page JS及Native/GPS/B1/授权服务Hash不变；诊断字段与原116组断言完整保留。
“路线进度/沿路线剩余距离”仅在已following、可靠/未过期且near、现有格式有效时显示，来自既有确认cursor及正式路线总长；不把沿线位置或历史maxConfirmed改名为累计已走距离。低质量、偏航、待确认或无效值隐藏；保留“疑似偏离”程度，不提升算法结论。
新增6组UI测试，Follow122/Native44/Page19及公开Runner20项本轮通过。旧Runner首项因005 Import多行源格式断言失败；改用既有显式12文件校验模式，Route/Import深度相等和所有原Hash断言仍保留；补齐gps-release依赖和实际运行日期。发布单行JSON由既有导出校验确认，不修改正式数据。
最终RC从当前正式源码重新构建，GPS=false、Access=false；仅复用已获准的合法本机AppID/cloudEnvId两值，不沿用旧私有Access=true。指纹及逐文件Hash由新候选FINAL_RC_BUILD_MANIFEST.json和桌面D4报告记录，避免源码自引用Hash。D3.1历史目录不变；新卡片Android视觉/新RC设备集成尚未执行，未传代码。
项目所有者承担产品/路线决策和设备现场验收，Codex协助实现、测试、构建和文档；GitHub公开、微信审核与正式开门是独立授权，当前不暂存/提交/Push/部署/发布。其余路线现场、完整终点、低精度专项及系统手势等未覆盖边界继续保留，不为收口补造通过。


## 2026-10-29 · Day6-D4 当前交付边界

高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。

Day6-D3已只读核对实际部署包、控制台截图及用户报告：部署入口除账号绑定和行尾外与本地安全实现同源；客户端invoke允许认证非匿名身份，navigation_limits禁止客户端读写。当前V0.3客户端关闭不等于所有服务端调用路径全局关闭；未调用线上服务，Key有效性、自动日志及实际事务行为仍未验证。

本轮仅在route-detail WXML提前说明接驳暂缓、调整说明层标题，并将未来定位文案限定为准入满足时显示；处理函数和安全契约未改。新文案待最小可视复验；正常浏览、四B1/两Native及真实GPS控制流保留。新文档是未暂存文件，现有87成员清单属于此前候选快照，未自动纳入这两份手册；未来打包需显式评估，不能声称当前导出已包含。

正式005 Android首位置/起点保护/停止、Nearby连续会话进度/暂停恢复及六正式路线离线回放分别成立；正式Route following、进度、正式页暂停恢复、偏航回归、终点和现场校准仍待，硬件停止独立证据UNKNOWN。历史用户设备结果不提升为Codex独立手机操作。

[3分钟/8分钟演示指南](PORTFOLIO_DEMO_GUIDE.md) · [正式GPS现场手册](V03_GPS_FIELD_ACCEPTANCE_RUNBOOK.md)

以下带日期内容为各阶段记录；当前结论以上节为准。

## 2026-10-27 · Day4-D5内部候选整理

V0.2已完成公开；V0.3开发中，当前仅整理内部候选源码、依赖和说明，不具备微信正式公开发布资格。Day3结论为DAY3_BASELINE_CLOSED_WITH_LIMITS，停止后的历史计数对比不是独立20秒回调证据（20S_COUNTER_COMPARISON_NOT_DIAGNOSTIC），不重新开启Day3收口。

正式005页面已有Android真实GPS启动、首位置和对应停止回执证据，远离起点时未错误进入following，重进未观察到自动定位。私人Nearby QA已取得真实following、同冻结路线同连续会话正向进度及暂停/恢复回执；这不能替代正式页面验收，也不证明实际步行距离测量精度。六条正式Route普通/密采样B1离线回放已通过。

正式Route的Android following、沿线进度、正式页面暂停/恢复、现场偏航和终点仍未完成验证；B1阈值仍为CALIBRATION_PENDING。停止回执证明SDK契约层结果，不独立证明硬件GPS停止；停止后的历史observationCount不是迟到回调探针。

真实GPS仅允许开发/体验版本在用户主动操作后进入必要隐私/位置授权，release仍由privateFollowBlock拒绝（RELEASE_GPS_BLOCKED）。高德法律主体与getLocation准入已有OWNER_CONFIRMED，但未由Codex独立登录后台核验；policyPagePath仍为null，真实Access继续阻断（ACCESS_POLICY_PENDING）。

六正式路线、列表/详情、Trail/Waypoint、Native目标、四条B1模拟和008/010原生速览保留；GPS独立入口及隐私授权、质量门、暂停恢复、唯一owner、停止/解绑失败阻断已接入。无后台定位、真实位置历史存储或上传。没有已确认的新P0/P1；现场与平台缺口不能由文档整理消除。

V0.3内部候选成员清单RELEASE_FILES_V03_INTERNAL_CANDIDATE.txt为原82个成员加5个新增依赖，共87项：DECISIONS、PROJECT_STATUS、access-privacy及两个测试helper。原V0.2清单字节保持不变；新清单是另一个构建控制文件，自身不计入87项，不能据此漏掉未来提交范围中的该控制文件。候选包含占位配置，排除私人QA工程、运行身份、GPS快照及原始GPX。

Day4-D4正式D直接回归为Follow77/B1核心12/Page19/Native40及相关路线、导航检查通过；D5不改业务源码，仅执行清单/依赖/文档/保护验证。是否满足下一轮受控Git整理以D5桌面报告实际结果为准；本轮不暂存、不提交、不推送、不部署、不发布。Push和微信发布必须另行授权。

## 历史：2026-10-19 R4准备记录

下文“待设备”“不进入Day4”仅对应当时阶段，现状以上节为准。

2026-10-19 · Day3-R4：真实前台GPS私人QA入口代码准备。既有Day2所有权/停止ACK与R3测试可移植性保留。当前运行身份是公开占位配置，需所有者在独立私人副本配置已获准的同一账号后进入人工验收。实现完成，待DevTools、Android和受控步行验证，不记真实GPS Feature验收完成。

隐私用途与接口开通为OWNER_CONFIRMED；后台与设备未独立核验。真实GPS每次启动仍检查SDK隐私/位置授权、当前Route/B1、前台状态、唯一资源及清理ACK。仅开发/体验版本可进入，不发布。高德Access仍因政策阅读入口未验证而独立阻断。B1阈值CALIBRATION_PENDING；不进入Day4、不提交/推送/部署。


## 2026-10-30 · Day8-D1 前台真实GPS推进

用户重新明确真实GPS为核心：六正式路线完整前台循迹，暂不申请或实现后台定位。锁屏、hide/unload仍安全停止，重进需主动启动。Access暂缓及release门不变，不将展示词精简解释为已获发布资格。

本轮补齐正式页面SDK启动ACK、有效位置数、实际B1阶段/原因及历史已确认沿线距离，区分SDK启动、首位置、起点连续确认和following；20秒保护保持，超时区分没有首位置与有位置但未满足起点/恢复条件。历史确认距离基于maxConfirmed，当前cursor可回退，两者不是累计步行测距。未改B1、正式Route、定位服务或Native几何。

新增两组隔离测试覆盖六路线公共GPS入口与超时分类，修正Day7删按钮后残留的可见性断言；保留清理/互斥负控。Follow、B1、六路线回放、页面、详情和既有性能检查本地通过；不等于手机/正式现场通过。详细实际失败与修复、命令退出码及release路线见桌面Day8-D1报告。

下一步：审核本轮候选后，另行授权合法调试载体传输，先验证正式页面新状态及安全停止；具备合法安全起点条件再依现场手册验证六路线following、进度、暂停恢复、偏航回归和终点。release仅在版本/账号隐私准入、现场证据、清理异常和008/010设备性能均满足并获明确授权后，另轮最小调整项目主动版本门；不得提前放行。后台定位为未来可选增强，本阶段无专项任务。


## 2026-11-01 · Day8-D2B 005正式起点与珍珠湾迁移

按所有者永久变更授权，005起点和ID1珍珠湾采用GCJ-02经度118.114404、纬度24.428810；track从原980顶点循环移位并重复新首点闭合，全部1003原顶点保留，现1004点。原首尾0.445米接缝补入；几何46608.128米，distanceMeters仍46283（原API估算，不是重算几何）。其他20节点坐标/稳定ID不变，沿线顺序及里程改用新几何投影累计。原数据没有独立旧珍珠湾Waypoint，仅旧Start Marker；新起点替换它，新增唯一ID1而非声称删除不存在的节点。

B1阈值、底层GPS、其他五Route均不变；沿用D1/D2未提交代码成果。新增原顶点/其他节点摘要负控及同步005数据Hash，既有回放本地通过不等于手机现场通过。完整轨迹来源和未实地通行核验限制保留。

CloudBase线上未改、未读回，手机仍从routes读取，不能说已加载新005；与V0.2共享环境有风险。后续经批准选择隔离数据方案并读回起点、版本和唯一节点后才适合现场测试。详见现场手册005专项及本轮桌面报告；不自动Git提交、上传或发布。


## 2026-11-01 · Day8-D2C 005节点精简

按用户明确清单永久删除11个唯一匹配Waypoint，21减至10；保留珍珠湾ID1及其余稳定ID，ID允许有间隔，页面展示序号按保留数组生成。1004点完整track、起止、方向、几何长度46608.12763208423米及原API距离口径完全不变。正式JSON与Import同步；私人Android载体本地数据已刷新，旧21节点读回证据不能代表新版。尚待重新编译和获授权的Android数据读回，不表示现场GPS验收完成；不写共享CloudBase。


### 2026-11-01 · D2C补充删除两个节点

按用户追加要求，精确删除ID7“五缘湾过桥后骑行步道”和ID16“中山路”，10减至8节点；其余稳定ID与节点对象保留。1004点完整track、起止、方向、几何长度及全部非Waypoint字段逐项不变。同步Import及私人载体本地数据；Android读回仍待验收，不写共享CloudBase，不上传微信。


### 2026-11-01 · 珍珠湾仅保留起点

按用户反馈，移除重叠的珍珠湾ID1 Waypoint，8减至7节点；保留珍珠湾startPoint及独立ID0起点Marker。1004点track及所有非Waypoint字段不变。保留其他节点稳定ID，起点确认/B1/真实GPS逻辑不改。私人载体本地数据同步，尚待Android重新加载；历史要求保留ID1被本次最新指令替代。


## 2026-11-02 · D2G当前发布准备（本节优先于历史状态）

D2F正式005核心现场已PASS：起点、following、真实短段推进、静止稳定、非零进度暂停恢复及安全停止/重进；无需因C点缺失重返起点。其他现场能力按独立证据记录。
正式云service仍读共享routes，新005仅正式本地/私人覆盖，不能将私人版本直接发布。新增离线六路线JSONL导出与负向检查、发布计划，建议待批准采用独立routes_v03集合；未改数据源运行配置或云端，release GPS及Access继续关闭。详见[V0.3 GPS发布计划](V03_GPS_RELEASE_PLAN.md)。后台定位不在范围，不要求走完六路线作为无依据硬门。


### 已批准的独立集合适配（待云端人工操作）

用户已明确授权本地适配及routes_v03创建/只读权限/六路线导入读回。正式env.js新增公开routeCollection=routes_v03，cloudEnvId占位不变；route-service列表与详情统一checkedCollection，缺失、错误或旧routes配置在数据库调用前拒绝，云读取失败不回落旧数据。真实GPS门与Access不变。四个现有列表/详情/多路线相关检查通过，新导出检查附加错误配置及不回落负控通过。
用户要求不使用Computer Use，已停止，不再调用。云端尚未创建集合或写数据，改为用户图形操作协作。单次导入文件V03_ROUTES_V03_SIX_APPROVED_20261102.jsonl，六个唯一正式ID，SHA256=621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff。现有私人QA配置/读取路径未同步，以免覆盖已验收载体。


### 控制台导入文件扩展名修正（2026-11-02）

用户真实控制台报InvalidParameter / invalid import filename (only support .json or .csv)，截图routes_v03无记录。原文件内容是逐行JSON，但扩展名.jsonl不被该控制台接受；这是本轮导出命名错误，不是权限或Route数据错误。保留原件，新建字节完全相同的.json副本：V03_ROUTES_V03_SIX_APPROVED_20261102.json；SHA-256仍621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff，逐行解析为6个唯一ID，逐个对象与正式JSON相等。无需重建集合或改权限。导出脚本后续单份文件也改用.json后缀（内容仍逐行文档）；原历史包与清单保留，不伪造之前成功。云端重试及读回仍PENDING。


## routes_v03导出精确核对通过（2026-11-02，最新结论）

用户提供恢复后的database_export-f2JqKi86rtd_.json，实际读取为6行JSON文档。导出原文件SHA-256=621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff，与获准六路线导入文件整文件SHA完全相同。六ID唯一且完整，各Route整对象、全部track点序/原值、startPoint、Waypoint、updatedAt逐项与正式JSON及获准包深度相等，无新增/缺失字段。005为1004点/7节点。

结果：SIX_ROUTE_CLOUD_EXPORT_CONTENT_MATCH_PASS。来源为USER_SUPPLIED_CLOUD_EXPORT（用户表示来自routes_v03）+LOCAL_EXACT_COMPARISON；Codex未直接登录抓取数据库，不把导出内容比对升级为客户端SDK实际查询成功、权限独立验证或V0.2云数据独立复验。新集合存在、权限read=true/write=false及导入成功为用户控制台反馈。

此前CLOUD_READBACK_PENDING中的导出内容核对已完成；仍待V03_CLIENT_CLOUD_READ_NOT_TESTED：用无私人005本地覆盖的最新正式service实际读取routes_v03，验证六列表/详情及005地图/B1同源。旧私人载体仍使用既有D2C覆盖，不用于冒充这一数据链已通过。微信调试传输需另行明确批准，本轮没有自动传输。

详细标量核验文件：V03_ROUTES_V03_CLOUD_READBACK_CHECK_20261102.json。没有改原导出或Route源文件，没有Git提交/Push、CloudBase额外写入、release开门或Access启用。


## 2026-11-02 · D2H正式云读取候选本地准备

以正式仓库当前代码构建独立31文件运行候选，不含D2C本地005覆盖或私人配置，集合routes_v03；环境/AppID仍为公开占位，须用户仅在新候选配置正确身份/环境后再真实查询。候选：D2H Android 验收候选。已有旧QA未改。正式service补充schemaVersion/name/updatedAt异常明确拒绝；保留原缺轨迹的文字详情降级和B1无效轨迹阻断，不改变地图/GPS核心。列表/详情、六路线本地模拟、坏配置/查询失败/005缺失/结构异常负控通过；不等于实际SDK云读。17项候选JS语法/WXML离线编译通过。真实平台查询与Android待授权，未上传或发布。


## 2026-11-03 · D2H最终真实云读取与Android候选验收

V03_CLIENT_CLOUD_READ_PASS。正式独立候选不含D2C本地005覆盖，基于route-service实际读取routes_v03：DevTools六列表/详情成功，六个原始Route排序键指纹与本地批准对象相符；Android正确候选六路线地图/节点正常，无自动定位；008/010加载、滚动、速览暂停继续及返回正常。005Android原始Route规范化21e04c0f、track c7fb2d5f、1004点/7节点匹配，静止真实SDK启动/首位置及起点保护自动停止CLEANUP_CONTRACT_CONFIRMED，cleanupPending=false、无活动session；停止20秒及重进均不自动定位。来源分别为用户实际摘要/观察，非Node替代。

活动索引顶点引用瞬时值未直接捕获，停止后NOT_STARTED正常；同源路径由无覆盖候选源码data.route→buildTrailIndex、实际云Route/地图身份和真实B1结果核对，保留动态引用字段UNKNOWN，不假装取得独立快照。Native与真实GPS并发互斥不由单独速览操作升级为设备全覆盖；原有本地互斥负控保留。008/010为用户可见流畅性检查，非长时间帧率/耗电量化。release GPS和真实Access保持关闭，后台定位不在范围。未重做D2F或要求再走220米。


## 2026-11-03 · Day8-D2I偏航回归预检与发布门禁准备
V03_D2I_RELEASE_PREPARATION_READY / FIELD_TEST_READY（仅本机准备，不是现场偏航PASS或release开放）。
新增check-trail-deviation.cjs六组SIMULATED负向/恢复测试；005/008/010均通过。既有B1核心、Follow集成、页面模拟、Native及单元回放通过，六路线Schema/索引/起点和轻量性能检查通过。未发现需修改的确定性业务Bug；没有修改GPS/B1/Native/Page运行代码、六轨迹和阈值。D2H候选运行代码无需因本轮再上传，合法私人配置未改。
真实证据边界：D2F旧载体005核心现场通过；D2H正式云候选六浏览、长路线速览、GPS首位置/起点保护和安全停止通过；该候选following、偏航/回归及Native/GPS冲突设备专项仍待一次集中验证。全终点、其他五条路线现场与硬件独立停止证据未取得，不伪造通过，不要求走完整六路线。
发布门禁只形成默认关闭的最小开放设计，详见V03_GPS_RELEASE_PLAN.md最新节。Access=false、policyPagePath=null、release门仍原样。005/008稀疏段和008零长相邻段记录为数据精细度限制，未改track。
桌面交付审查报告与一次现场runbook；用户不需重做220米或600米，不要求无安全步道时强行偏航。无Computer Use、无云写入/微信传输、无Git暂存提交推送或发布。


## 2026-11-04 · Day8-D2I-FIELD正式云候选现场专项
FORMAL_005_D2I_FIELD_CORE_PASS（USER_SUPPLIED_ANDROID_DIAGNOSTIC + USER_REPORTED）。
一加13/ColorOS16/微信8.0.77，D2H正式routes_v03候选，005 track c7fb2d5f/1004点/7节点；同一连续pageVersion4取得起点following、约50.774米基线增长、偏航suspected持续证据及31秒cursor/max冻结、回归near/连续匹配恢复，再推进cursor约56.721米。P暂停清理契约确认、进度112.399米保留；U主动恢复新版本6，max不补算。
运行GPS时模拟点击未抢占（无反馈记体验观察）；离页重进无自动定位；008 Native→GPS实际交接后起点保护自动停止，清理契约确认。最后20秒无恢复、重进005正常由用户确认。本专项无需再去珍珠湾补测。
RETURN_PENDING瞬间、旧页离页停止原始ACK、Native remove原始ACK、008 following→同页Native、独立物理硬件停止未直接取证，按报告保留UNKNOWN/DEVICE_NOT_TESTED；不冒充全六路线/终点/全部异常设备验收。release GPS及Access继续关闭，后台定位不做。未改业务/路线，未提交/推送/部署/传输/发布。
桌面V03_DAY8_D2I_FIELD_DEVIATION_RECOVERY_ACCEPTANCE_REPORT.md为最终证据入口。下一步可审核并另行授权最小默认关闭Release Gate实现，本轮不自动实施。


## 2026-11-04 · Day8-D2J Release GPS门禁实现（默认关闭）
RELEASE_GATE_IMPLEMENTED_DEFAULT_OFF / RC_LOCAL_PREPARATION，仅本地实现。
新增config/gps-release.js，foregroundReleaseEnabled严格false。Page保留运行身份/环境检查；release必须严格true、routes_v03、六正式ID、必要Schema/节点及B1索引合法才可进入原启动流程。加载路线后更新按钮阻断状态，开始及继续重新检查，内部startFollow也复核。SDK服务增加可选beforeSdkStart，在隐私/位置授权和Native清理之后、实际SDK调用之前复核页面版本/可见状态/claim/许可；失败沿既有stop清理，不创建新会话系统。停止不受许可开关限制。
原POLICY/六Route/005起点与7节点不变，真实Access=false，后台定位不做。AppID正则只检查形状，不代替平台账号审核。D2I-FIELD已通过，不再要求重复005核心现场。
check-trail-follow 104组（新增8组）通过；页面模拟19、Native40、路线详情/列表/多路线/大姆山、routes_v03负控及偏航6组通过，均为Node/Mock。Mock true从未写入生产配置，真实release仍关闭，新代码未上传手机。
精确CRLF修复env.js 2处、route-service.js 49处、check-route-list.cjs124处，原HEAD均LF，正文/逻辑不变，调用级autocrlf=false diff --check通过；保留测试文件原有CRLF样本。
RELEASE_FILES_V03_RC_DEFAULT_OFF.txt是本轮准确成员清单，自身作为构建控制文件不计入其描述成员；旧V02/V03历史清单不改。无Git暂存/提交/推送、无云写入/微信上传/审核/发布，旧D2H候选保持原样，尚未包含本轮门禁。当前平台状态USER_VERIFICATION_REQUIRED。


## 2026-11-05 · D2M Native清理恢复与Access恢复准备
用户调整此前“本阶段暂缓真实接驳”的产品安排，要求纳入V0.3恢复准备；正式Access发布许可仍false，未授权位置外发/云部署/微信新传输。
Native确定性缺口：旧页remove明确失败后，新页没有安全重试入口；stopNative成功未刷新展示状态。现增加跨页清理协调，只对已确认失败且非pending的清理发真实retry；未回执保留锁并拒绝GPS/Access，不强设IDLE；getNavigationResourceSummary仅输出令牌归属/隐藏卸载/清理标量。GPS独占前清理旧Native；Access/原生目标保留合法暂停速览共存，但旧清理异常必须先确认结束。
新增4组对应测试先失败后修复通过；Follow108/Page19/Native40/导航16及相关路由检查通过，WXML离线编译通过。首次中间实现的无效setData和过度清理破坏既有恢复断言，均在本轮收窄修复，原断言不弱化。
设备D2L具体是哪条ACK未到仍UNKNOWN，本地可复现机制不冒充已确认设备根因。新RC尚未构建/传输，RC_DEVICE_REVALIDATION_PENDING。
Access原授权/grant/请求链复用，仅修正阅读成功后与开放条件矛盾的静态提示，并保护旧Native清理异常；私有联调候选配置存桌面，strict true只在候选文件/Mock，不进生产。Mock成功形成独立接驳线，不能写ACCESS_REAL_CALL_PASS。
当前云部署/Key适用性沿用2026-10-29历史证据，不能升级为今天独立核查；本轮原ZIP未找到，无CloudBase登录/工具直接核验，不擅自部署。需用户只读确认新RC所用环境的函数与Key配置状态，再单独批准候选传输及一次真实位置接驳联调。GPS release=false、Access=false、六Route/005数据/B1/底层GPS未改。未Git提交/Push、无真实高德调用。


### 2026-11-05 · D2M Android清理反馈与返回时序修复追加
用户同步读取确认：008存活页面stopNativeOverview后navigationMode=IDLE、resources=[]、无Native会话/清理挂起/错误、展示idle。异步Console无输出不代表SDK未回调。系统顶部返回卸载008后，新005仍观测到旧008 remove超时挂起；此路径设备阻断尚未解决。
本地新增受控onBackTap等待真实Native移除ACK后才执行返回；超时留页且持锁，迟到ACK不自动导航。两项新增用例先复现后通过，Follow110/Native40/Page19及route-detail通过，均为本地替身，不是顶部返回设备修复通过。未修改系统导航栏或伪造卸载ACK，新返回修复尚未同步手机。
用户已分别批准D2M必要私有配置复用、初版候选调试传输及最多一次明确同意后的真实接驳联调；尚未消耗真实规划调用额度。生产Access及release GPS仍false。


### 2026-11-05 · D2M真实步行接驳单次联调通过（USER_REPORTED_ANDROID）
用户在获准的D2M私有候选中主动执行本次规划，读回fj-route-005 accessRoute.status=success、errorCode=null、pointsCount=194、navigationMessage为空、navigationMode=IDLE、resources=[]，并明确确认手机可见接驳蓝线。记录ACCESS_REAL_CALL_PASS，证据为用户Android正常操作、同步页面状态与蓝线观察；不是Mock，也未做独立网络抓包。一次真实联调授权已用于本次操作，不自动重试或继续发起请求。未保存坐标、原始响应或轨迹。
这只证明私有Access=true候选的本次合法位置→CloudBase→高德规划→临时蓝线正常链路，不代表生产配置已开启、所有异常/距离/网络场景均已实测或发布准入通过。生产Access=false、release GPS=false保持。Native系统顶部返回卸载后的清理回执超时仍为RC阻断；底部受控返回修复仅本地通过，尚未传输手机。无Git提交/Push、无云部署或配置修改、无正式微信上传/审核/发布。


## 2026-11-05 · Day8-D2N Native退出候选（待Android复验）
D2M最终真实证据继续有效：005一次真实Access成功、194点、蓝线可见、完成后IDLE/resources=[]（USER_REPORTED_ANDROID）；本轮不重复定位/高德请求。008页面存活清理通过，但系统顶部返回卸载后的remove回执超时未取得设备修复证据。
本轮采用待审核的最小组合方案：仅route-detail使用navigationStyle=custom，顶部“‹ 返回”和底部返回共用既有等待真实remove ACK的退出逻辑；其他页面导航不改。不声称拦截Android系统手势、微信关闭或强杀；这些不可控退出依旧通知清理、未确认则保留owner和明显恢复提示。onUnload不是可阻塞路由销毁的beforeUnload，不能靠返回Promise保证旧MapContext存活。
Native清理记录持有SDK context/等待者/定时器/ACK状态，由模块settleCleanup直接操作，新页面恢复不依赖旧Page方法。pending或超时但无ACK时不重复移除；明确失败后才可重试；success或complete明确removeMarkers:ok才释放；失败、无明确成功的complete均保持保护。重复dispose与动画错误/卸载共享一次移除，迟到/重复ACK不污染新页面。旧Native未释放时新的Native也拒绝抢占；GPS和Access原保护保留。
新增6组Follow和3组Native，原110/40及Page19断言保留；Native历史几何/动画Hash仍为原值，仅显式还原本轮获准的三个清理实现片段再验证，并非更换Hash或忽略断言。WXML/WXSS离线编译通过；GUI/Android尚未验证。
独立候选为 D2N Native 退出验收候选；完整源码指纹与逐文件SHA记录于其D2N_RC_BUILD_MANIFEST.json及桌面D2N报告，避免源码文档自引用Hash。仅复用合法AppID/cloudEnvId两值，私有Access=true、正式Access=false，两侧release GPS=false、routes_v03不变。D2M目录保持原样，未经本轮新许可不传手机代码，不Git暂存/提交/推送。
当前D2N_NATIVE_SYSTEM_EXIT_PARTIAL / ANDROID_REVALIDATION_PENDING：受控顶部替代方案本地通过，需用户审核导航改变并授权最小Android复验；不能宣称原系统箭头或所有系统退出已修复。

D2N最终补充：Native包装器在调用清理前先标记hidden/unloaded，防止同步SDK回执在卸载过程中触发无意义setData；新增该竞态用例，Native最终44组（原40+4）。其余边界和待设备状态不变。

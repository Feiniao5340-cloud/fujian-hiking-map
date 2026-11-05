# V0.3 实施决策

## 2026-11-05 · D4.1 视觉验收与 D5 源码对齐

用户确认 Android 初始 GPS 卡片、两行两列按钮、精简模拟卡片及路线详情的视觉验收通过。运行中、弱定位和偏航界面沿用本地验证证据。正式 GPS 与 Access 许可均为 false，V0.3 处于 RC 阶段。下方各阶段待验结论保留为历史。

## 2026-10-19 · R4 私人前台GPS与高德Access准入分离

背景：所有者确认当前账号持续定位接口及包含前台循迹用途的隐私指引已生效，高德政策阅读入口仍未验证。选择：复用既有真实定位/B1/UI链，公共入口仅在SDK可识别的开发/体验版进入逐次隐私、位置授权及资源检查；Access继续独立阻断。理由：本地位置匹配不依赖高德网络规划，不以第三方阅读问题永久阻断私人GPS准备，也不借GPS恢复放行Access。

影响与验证：不修改B1阈值、正式路线、Native完成门或云函数；保持停止ACK及生命周期隔离。配置事实为OWNER_CONFIRMED；Node隔离验证不等于平台独立审核或手机GPS。私人运行身份仍待所有者配置核对；不得自动发布或进入户外验证。

## 2026-10-27 · D5内部候选与发布资格分离

背景：V0.2已公开，V0.3已有真实前台GPS接入和分层设备证据，但原82项历史清单遗漏5个新增依赖，公开说明停留在旧阶段。选择：保留RELEASE_FILES_V02_DRAFT.txt原字节，另建RELEASE_FILES_V03_INTERNAL_CANDIDATE.txt，精确列出原82项加5项；新控制清单自身不属于所描述的87个成员。只局部同步必要文档，不将私人QA诊断、临时路线或身份配置合入产品。

理由与影响：依赖闭合可支持下一轮经授权的原子Git整理，不代表Push或微信发布获准。正式005的Android首位置/停止、私人Nearby的连续会话进度/暂停恢复、六路线离线回放分别记录，不互相替代；正式路线Android following/进度、正式页面暂停恢复与现场校准仍待。privateFollowBlock继续拒绝release，Access继续因policyPagePath=null阻断。OWNER_CONFIRMED不提升为独立平台审核。

验证：D5以文件集合、require依赖、排除与敏感扫描、diff检查及前后Hash核验为边界；不改产品代码，不重跑无关业务测试，不执行Git暂存/提交/推送或平台操作。前述R4“身份待配置/设备待验证”是历史状态，当前事实见PROJECT_STATUS。

## 2026-10-29 · Day6-D4：真实Access暂缓，保留阅读与安全契约

背景：政策阅读链、三层准入及云端只读边界均有证据，但不能据此自动启用真实接驳。用户明确选择方案A，优先可稳定演示的作品集。

选择：高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。不重开发Access、不关停共享云端；Waypoint卡片提前说明暂缓，保留原按钮与阅读桥接，只改WXML文案。四条B1模拟和008/010 Native性能取舍不变。

影响：阅读不等于同意，客户端禁用不等于全云端禁用；任何未来服务端开关或权限调整先评估V0.2兼容性。新增两份操作手册是计划而非真机PASS，现场短段不能替代全程验收。

验证：仅直接相关本地页面回归及离线WXML编译，具体结果见Day6-D4报告；不新增GPS监听、不改阈值或正式Route、不自动提交/部署/发布。


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


## 2026-11-02 · V0.3数据隔离候选（待批准）

不覆盖共享routes/005；优先独立routes_v03集合配合原route-service统一配置，或用户选择独立环境。此为最小方案候选，尚未创建云资源或改service。先交付本地六文档确定性导入包与SHA/指纹清单，保留V0.2读取路径；GPS正式许可须独立于Access且默认关闭。平台和少量专项验证仍须独立批准，不复制私人QA为产品。细节及授权顺序见V03_GPS_RELEASE_PLAN。


### 已批准的独立集合适配（待云端人工操作）

用户已明确授权本地适配及routes_v03创建/只读权限/六路线导入读回。正式env.js新增公开routeCollection=routes_v03，cloudEnvId占位不变；route-service列表与详情统一checkedCollection，缺失、错误或旧routes配置在数据库调用前拒绝，云读取失败不回落旧数据。真实GPS门与Access不变。四个现有列表/详情/多路线相关检查通过，新导出检查附加错误配置及不回落负控通过。
用户要求不使用Computer Use，已停止，不再调用。云端尚未创建集合或写数据，改为用户图形操作协作。单次导入文件D:\LENOVO\V03_ROUTES_V03_SIX_APPROVED_20261102.jsonl，六个唯一正式ID，SHA256=621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff。现有私人QA配置/读取路径未同步，以免覆盖已验收载体。


## 2026-11-02 · D2H正式云读取候选本地准备

以正式仓库当前代码构建独立31文件运行候选，不含D2C本地005覆盖或私人配置，集合routes_v03；环境/AppID仍为公开占位，须用户仅在新候选配置正确身份/环境后再真实查询。候选目录：E:/CodexData/fujian-hiking-map-v0.3-d2h-cloud-candidate-20261102。已有旧QA未改。正式service补充schemaVersion/name/updatedAt异常明确拒绝；保留原缺轨迹的文字详情降级和B1无效轨迹阻断，不改变地图/GPS核心。列表/详情、六路线本地模拟、坏配置/查询失败/005缺失/结构异常负控通过；不等于实际SDK云读。17项候选JS语法/WXML离线编译通过。真实平台查询与Android待授权，未上传或发布。


## 2026-11-03 · D2H最终真实云读取与Android候选验收

V03_CLIENT_CLOUD_READ_PASS。正式独立候选不含D2C本地005覆盖，基于route-service实际读取routes_v03：DevTools六列表/详情成功，六个原始Route排序键指纹与本地批准对象相符；Android正确候选六路线地图/节点正常，无自动定位；008/010加载、滚动、速览暂停继续及返回正常。005Android原始Route规范化21e04c0f、track c7fb2d5f、1004点/7节点匹配，静止真实SDK启动/首位置及起点保护自动停止CLEANUP_CONTRACT_CONFIRMED，cleanupPending=false、无活动session；停止20秒及重进均不自动定位。来源分别为用户实际摘要/观察，非Node替代。

活动索引顶点引用瞬时值未直接捕获，停止后NOT_STARTED正常；同源路径由无覆盖候选源码data.route→buildTrailIndex、实际云Route/地图身份和真实B1结果核对，保留动态引用字段UNKNOWN，不假装取得独立快照。Native与真实GPS并发互斥不由单独速览操作升级为设备全覆盖；原有本地互斥负控保留。008/010为用户可见流畅性检查，非长时间帧率/耗电量化。release GPS和真实Access保持关闭，后台定位不在范围。未重做D2F或要求再走220米。


## 2026-11-04 · D2J：前台GPS发布许可与定位SDK安全清理分离
选择独立gps-release配置，默认false，严格布尔许可仅用于release准入；develop/trial保持原合法测试。release另查routes_v03、六ID及必要数据/B1合法性；许可不能代替微信隐私、scope授权或现场起点证据。
复用service可选beforeSdkStart，在实际SDK调用之前重查Page当前版本/资源claim及许可。回调仅返回布尔，不产生授权或定位；失败走原有取消与清理。stop/hide/unload不查许可，避免开关关闭锁死资源。启动已发出后的撤回仍沿现有cancel/late ACK契约，不承诺配置翻转可撤回已发出的SDK调用。
验证：新增8组Mock含strict false/缺失/字符串、未知环境、错集合/坏Route、六路线strict true、拒绝隐私/权限、授权期间撤销、恢复重查、Native清理等待、卸载迟到回调。业务发布配置false，未开启release/Access/后台定位。


## 2026-11-05 · D2M旧Native资源确认与接驳恢复范围
不按页面会话为空就释放全局资源令牌。跨页启动GPS时可协调旧页Native清理；已经明确失败的remove可真实重试，pending add/remove必须等待原回执/原超时保护，不重叠请求或伪造成功。Access入口也阻断旧Native未确认清理；不破坏原有暂停Native+临时接驳展示的合法共存。
新增只读脱敏资源摘要供新RC区分旧页pending/failed/无可核实owner状态，未知owner继续阻断。该诊断不是释放锁的入口，不输出坐标或身份。
Access恢复是新的产品决定，现有阅读/明示同意/一次grant/服务端架构不重写；正式发布false保留，桌面私有候选true只用于审批与隔离Mock。真实请求位置经CloudBase到高德须单独授权，云部署/配置变更、微信传输、Git提交与发布各独立审批。


### 2026-11-05 · D2M受控返回先等待Native移除回执
008在页面存活时可成功清理，系统返回卸载后仍有移除超时证据。修复可控返回按钮先导航后清理确认的缺陷：收到真实成功ACK才调用原返回逻辑；超时不导航、不解锁，迟到ACK也不自动返回。系统顶部返回不经过此按钮，尚未获得完整修复，不把局部方案包装为全部生命周期通过。拒绝用强设IDLE、无回执强制释放、页面销毁假定等方式绕开现有保护。


### 2026-11-05 · D2M真实步行接驳单次联调通过（USER_REPORTED_ANDROID）
用户在获准的D2M私有候选中主动执行本次规划，读回fj-route-005 accessRoute.status=success、errorCode=null、pointsCount=194、navigationMessage为空、navigationMode=IDLE、resources=[]，并明确确认手机可见接驳蓝线。记录ACCESS_REAL_CALL_PASS，证据为用户Android正常操作、同步页面状态与蓝线观察；不是Mock，也未做独立网络抓包。一次真实联调授权已用于本次操作，不自动重试或继续发起请求。未保存坐标、原始响应或轨迹。
这只证明私有Access=true候选的本次合法位置→CloudBase→高德规划→临时蓝线正常链路，不代表生产配置已开启、所有异常/距离/网络场景均已实测或发布准入通过。生产Access=false、release GPS=false保持。Native系统顶部返回卸载后的清理回执超时仍为RC阻断；底部受控返回修复仅本地通过，尚未传输手机。无Git提交/Push、无云部署或配置修改、无正式微信上传/审核/发布。


## 2026-11-05 · Day8-D2N Native退出候选（待Android复验）
D2M最终真实证据继续有效：005一次真实Access成功、194点、蓝线可见、完成后IDLE/resources=[]（USER_REPORTED_ANDROID）；本轮不重复定位/高德请求。008页面存活清理通过，但系统顶部返回卸载后的remove回执超时未取得设备修复证据。
本轮采用待审核的最小组合方案：仅route-detail使用navigationStyle=custom，顶部“‹ 返回”和底部返回共用既有等待真实remove ACK的退出逻辑；其他页面导航不改。不声称拦截Android系统手势、微信关闭或强杀；这些不可控退出依旧通知清理、未确认则保留owner和明显恢复提示。onUnload不是可阻塞路由销毁的beforeUnload，不能靠返回Promise保证旧MapContext存活。
Native清理记录持有SDK context/等待者/定时器/ACK状态，由模块settleCleanup直接操作，新页面恢复不依赖旧Page方法。pending或超时但无ACK时不重复移除；明确失败后才可重试；success或complete明确removeMarkers:ok才释放；失败、无明确成功的complete均保持保护。重复dispose与动画错误/卸载共享一次移除，迟到/重复ACK不污染新页面。旧Native未释放时新的Native也拒绝抢占；GPS和Access原保护保留。
新增6组Follow和3组Native，原110/40及Page19断言保留；Native历史几何/动画Hash仍为原值，仅显式还原本轮获准的三个清理实现片段再验证，并非更换Hash或忽略断言。WXML/WXSS离线编译通过；GUI/Android尚未验证。
独立候选路径E:/CodexData/fujian-hiking-map-v0.3-d2n-rc-20261105；完整源码指纹与逐文件SHA记录于其D2N_RC_BUILD_MANIFEST.json及桌面D2N报告，避免源码文档自引用Hash。仅复用合法AppID/cloudEnvId两值，私有Access=true、正式Access=false，两侧release GPS=false、routes_v03不变。D2M目录保持原样，未经本轮新许可不传手机代码，不Git暂存/提交/推送。
当前D2N_NATIVE_SYSTEM_EXIT_PARTIAL / ANDROID_REVALIDATION_PENDING：受控顶部替代方案本地通过，需用户审核导航改变并授权最小Android复验；不能宣称原系统箭头或所有系统退出已修复。

D2N最终补充：Native包装器在调用清理前先标记hidden/unloaded，防止同步SDK回执在卸载过程中触发无意义setData；新增该竞态用例，Native最终44组（原40+4）。其余边界和待设备状态不变。


## 2026-11-05 · Day8-D4 最终集成与GPS用户界面收口
D3.2已由用户确认新顶部左对齐、008速览/返回、真实ACK_SUCCESS及005跨页IDLE/resources=[]通过；原D3-UI-01关闭。D2M一次194点真实接驳成功继续有效，本轮不重复位置外发或高德请求。
GPS正式卡片删除普通用户可见的会话/SDK/回调计数/B1原因/精度时间/历史投影距离诊断；保留简洁状态、必要按钮和前台停止/不自动恢复/不存位置历史说明。WXML内WXS纯映射只读取followState，Page JS及Native/GPS/B1/授权服务Hash不变；诊断字段与原116组断言完整保留。
“路线进度/沿路线剩余距离”仅在已following、可靠/未过期且near、现有格式有效时显示，来自既有确认cursor及正式路线总长；不把沿线位置或历史maxConfirmed改名为累计已走距离。低质量、偏航、待确认或无效值隐藏；保留“疑似偏离”程度，不提升算法结论。
新增6组UI测试，Follow122/Native44/Page19及公开Runner20项本轮通过。旧Runner首项因005 Import多行源格式断言失败；改用既有显式12文件校验模式，Route/Import深度相等和所有原Hash断言仍保留；补齐gps-release依赖和实际运行日期。发布单行JSON由既有导出校验确认，不修改正式数据。
最终RC从当前正式源码重新构建，GPS=false、Access=false；仅复用已获准的合法本机AppID/cloudEnvId两值，不沿用旧私有Access=true。指纹及逐文件Hash由新候选FINAL_RC_BUILD_MANIFEST.json和桌面D4报告记录，避免源码自引用Hash。D3.1历史目录不变；新卡片Android视觉/新RC设备集成尚未执行，未传代码。
项目所有者承担产品/路线决策和设备现场验收，Codex协助实现、测试、构建和文档；GitHub公开、微信审核与正式开门是独立授权，当前不暂存/提交/Push/部署/发布。其余路线现场、完整终点、低精度专项及系统手势等未覆盖边界继续保留，不为收口补造通过。

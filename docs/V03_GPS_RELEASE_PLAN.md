# V0.3 前台GPS发布候选准备

2026-11-02；D2F正式005核心现场PASS，不重复起点/短段测试。release GPS与Access仍关闭，以下是待批准方案而非已上线。

## 最小数据方案
正式route-service当前两处固定collection('routes')，env为占位。旧V0.2仍使用同名共享集合；新版005目前只在正式源码和私人本地覆盖，不曾写共享云。不要直接更新routes/005。
建议同一合法环境中新建独立集合routes_v03，六文档ID仍保留原正式ID，整套导入后读回SHA/语义比对。集合隔离可避免改变旧客户端数据，但不隔离环境级配额/管理员权限；如需更强隔离或配额独立，再选择独立环境，不预建新后端。此选择须用户批准，当前未创建集合或写入。
之后仅让V0.3正式route-service统一通过一个受控集合配置读取列表与详情，配置缺失/非法时明确报错，不静默回落旧routes或QA本地数据。公开候选不包含私人qa-only/route-service-cloud或诊断注入；从正式仓库构建，不复制私人项目。地图和GPS继续使用同一data.route，禁止分别读取两套数据。

## 已实现的离线准备
node scripts/prepare-v03-route-release.cjs 为只读检查；加 --out NEW_DIRECTORY 导出六份单行JSONL与manifest.json，拒绝覆盖已有目录。逐份核对Schema、正式ID、Import解析对象、B1索引、trackSHA及原始/详情指纹。无Cloud SDK/网络/配置读取；不是自动上传工具。
node scripts/check-v03-route-release.cjs 验证导出精确相等、SHA、JSONL、拒绝覆盖及Import不一致在输出前失败。
005现有Import多行格式保留用户已审核字节；导出时仅序列化成单行，不改字段。旧check-route-data默认批次的单行格式断言对该源Import不适用；不要把此格式问题当轨迹失败。后续应明确统一源Import格式或采用本导出入口，不删除原安全断言。
手机routeFingerprint=7013cb0b来自Object.assign增加display字段后的详情Route；原始文档指纹=e939f479。两者不能混比，track=c7fb2d5f共同不变。manifest分别记录，SHA用于严格文件完整性。

## 远程导入前后步骤（均需批准）
1. 用户选择routes_v03集合或独立环境；记录现有V0.2环境/集合，仅保留本机记录，不公开身份。
2. 创建目标集合，按公开路线需求审核客户端只读权限，客户端写禁止；不改变routes权限。权限边界参见https://docs.cloudbase.net/database/security-rules 。
3. 仅导入本地已核验六JSONL；若ID已存在先停止比较，不自动覆盖。
4. 逐条只读取回完整对象，对照manifest验证，再验证六列表和详情实际读取新集合。不得仅凭部署时间认定一致。
5. V0.2仍读routes、005旧数据及浏览行为保持，V0.3统一读新集合；任一不符先回退V0.3集合配置，不改V0.2。新集合保留待诊断，不删用户数据。

## release门与平台
privateFollowBlock只接受有效账号形状及develop/trial，release为项目主动阻断；不是SDK永久不支持正式版。现有开通/隐私有用户历史确认和真机成功，不等于当前审核版全部后台事项独立通过。
未来最小方案：专用默认false的GPS发布许可，加受审核的数据集/版本约束；保留主动启动、隐私检查、scope.userLocation、前台生命周期、owner与清理失败阻断。缺配置fail closed。仅经授权再改实现及测试，当前不添加或开启许可。Access许可完全独立且false。
用户在微信后台仅核对适用类目、前台定位接口开通、隐私用途和版本声明是否仍有效；不申请后台定位。微信开发文档本轮访问失败，不能宣称独立核实所有最新审核条件。腾讯位置服务官方组织维护参考：https://github.com/TencentLBS/tencentmap-miniprogram-skill/blob/main/references/wx_location_api/wx.startLocationUpdate.md 。最终以用户后台实际要求为准，未知项不猜测。

## 最少补充验证与不重复事项
- 必须：新数据源六路线Android读回；008代表最长轨迹的前台加载/持续回调处理与清理观察（不必到岛上，不需进入following）；010正常加载/互斥简查。必要时独立有界本地替身性能补测，不重新全路线回放。
- 必须：一次安全正式步道路段的可靠偏航提示及回归恢复真机证据，可安排一次针对性补测，不重做005起点和已通过短段；无安全条件则保持该项发布验收待完成，不强迫离开步道。
- 必须：候选版前台/后台切换安全停止、隐私拒绝/权限失败可见结果、无调试依赖的同步状态观察；可在任意安全位置，不要求再去起点。
- 低精度/跳点：已有确定性负向与冻结测试，发布前复核证据；自然设备样本可补，不人为造危险环境，不因此要求固定再访。
- 终点：既有六路线回放与真实Page完成确认/过时/取消/重复/停止失败负向证据作为最低工程依据；自然完整终点现场NOT_TESTED须保留。无需将走完全六路线作为硬门；若未来宣传完整终点实测，才需对应现场证据。
- 物理GPS硬件独立停止UNKNOWN不自动阻止基于SDK契约的前台产品；不能宣称硬件级保证。
- DevTools息屏断连属于调试取证问题，不直接修改GPS。版本3→6原因尚不唯一；源码多处stopFollow会递增页面版本，计数不是SDK独立ID；不凭无完整时序推定缺陷。

## 候选与发布授权顺序
本地包和方案审核→授权隔离集合/客户端配置适配→远程只读读回及普通Android候选验证→上述少量专项→候选证据审核→单独授权release门最小改造且默认关闭→正式候选测试→另行授权开门/微信审核发布。可先进入关闭GPS门的内部RC，无需无限期开发；公开GPS版本仍须数据/平台/专项条件通过。
旧87成员清单是历史快照，新增本脚本/文档不自动加入该快照；下轮RC构建需显式形成新成员集合、排除QA和身份配置，并纳入现有两手册。


### 已批准的独立集合适配（待云端人工操作）

用户已明确授权本地适配及routes_v03创建/只读权限/六路线导入读回。正式env.js新增公开routeCollection=routes_v03，cloudEnvId占位不变；route-service列表与详情统一checkedCollection，缺失、错误或旧routes配置在数据库调用前拒绝，云读取失败不回落旧数据。真实GPS门与Access不变。四个现有列表/详情/多路线相关检查通过，新导出检查附加错误配置及不回落负控通过。
用户要求不使用Computer Use，已停止，不再调用。云端尚未创建集合或写数据，改为用户图形操作协作。单次导入文件D:\LENOVO\V03_ROUTES_V03_SIX_APPROVED_20261102.jsonl，六个唯一正式ID，SHA256=621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff。现有私人QA配置/读取路径未同步，以免覆盖已验收载体。


### 控制台导入文件扩展名修正（2026-11-02）

用户真实控制台报InvalidParameter / invalid import filename (only support .json or .csv)，截图routes_v03无记录。原文件内容是逐行JSON，但扩展名.jsonl不被该控制台接受；这是本轮导出命名错误，不是权限或Route数据错误。保留原件，新建字节完全相同的.json副本：D:\LENOVO\V03_ROUTES_V03_SIX_APPROVED_20261102.json；SHA-256仍621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff，逐行解析为6个唯一ID，逐个对象与正式JSON相等。无需重建集合或改权限。导出脚本后续单份文件也改用.json后缀（内容仍逐行文档）；原历史包与清单保留，不伪造之前成功。云端重试及读回仍PENDING。


## routes_v03导出精确核对通过（2026-11-02，最新结论）

用户提供恢复后的database_export-f2JqKi86rtd_.json，实际读取为6行JSON文档。导出原文件SHA-256=621f0b0025fa60ea782a84ddf95f941d8f961de2005839e9326bb3ad2df25cff，与获准六路线导入文件整文件SHA完全相同。六ID唯一且完整，各Route整对象、全部track点序/原值、startPoint、Waypoint、updatedAt逐项与正式JSON及获准包深度相等，无新增/缺失字段。005为1004点/7节点。

结果：SIX_ROUTE_CLOUD_EXPORT_CONTENT_MATCH_PASS。来源为USER_SUPPLIED_CLOUD_EXPORT（用户表示来自routes_v03）+LOCAL_EXACT_COMPARISON；Codex未直接登录抓取数据库，不把导出内容比对升级为客户端SDK实际查询成功、权限独立验证或V0.2云数据独立复验。新集合存在、权限read=true/write=false及导入成功为用户控制台反馈。

此前CLOUD_READBACK_PENDING中的导出内容核对已完成；仍待V03_CLIENT_CLOUD_READ_NOT_TESTED：用无私人005本地覆盖的最新正式service实际读取routes_v03，验证六列表/详情及005地图/B1同源。旧私人载体仍使用既有D2C覆盖，不用于冒充这一数据链已通过。微信调试传输需另行明确批准，本轮没有自动传输。

详细标量核验文件：D:\LENOVO\V03_ROUTES_V03_CLOUD_READBACK_CHECK_20261102.json。没有改原导出或Route源文件，没有Git提交/Push、CloudBase额外写入、release开门或Access启用。


## 2026-11-03 · D2I专项与最小Release Gate方案（未实施开门）
D2H最终V03_CLIENT_CLOUD_READ_PASS覆盖早期未导入/未读取文字。独立routes_v03已由用户导入并真实SDK/Android读取；D2F旧载体核心现场PASS与D2H云候选基础GPS证据分开记录。

本轮仅新增scripts/check-trail-deviation.cjs，六组SIMULATED测试覆盖005/008/010的单次偏离、连续偏航、低精度打断待确认序列、偏航冻结、回归迟滞、回归后推进及偏航期间暂停/远处恢复拒绝。未发现必须修改的业务缺陷，B1/定位服务/Page/Native/路线字节均未变。无需重新传输手机代码。
既有核心12组、Follow集成、页面模拟、Native40组、replay --unit三组均通过；六Route Schema/索引/起点及轻量计算检查通过。六路线全程密采样与交叉矩阵沿用已有证据，不重复跑。
005有30段、008有3段超过200米；这是公开轨迹采样精度限制，不能推断线段沿线所有道路均可通行。008的132个零长相邻段由现有索引跳过，原轨迹保留；009实际末点与起点约130米，不补闭环。
正式GPS公开发布仍须云候选一次偏航/回归设备证据和Native/GPS切换专项；不重复220米、不要求逐一走完六路线。

拟最小改造（本轮只设计）：新增专用GPS许可配置，foregroundReleaseEnabled严格默认false。privateFollowBlock保留有效运行身份/未知环境拒绝；develop/trial维持现有行为；仅release分支在明确许可true且routeCollection===routes_v03、当前routeId属于六路线且Route/index合法时允许进入现有requestFollowStart。许可不是用户同意或平台开通证明；平台确认与候选验收由发布审核证据约束，不能用布尔值冒充。非布尔、缺配置、旧集合、未知环境一律拒绝。start/resume每次检查，启动异步等待后及SDK启动前重核（复用取消/清理机制）；停用许可不应阻断已启动会话的安全停止。
不要固定生产AppID正则当账号授权白名单：现有正则仅形状检查，正式账号归属须构建/平台核对。不要继续永久限定develop/trial，也不要直接删除整个门函数。
其余主动点击→微信隐私→scope.userLocation→资源互斥→SDK→B1→hide/unload停止→旧回调隔离流程不变。Access=false独立，后台接口不新增。配置true须另行批准；本轮未新增许可配置文件、未打开release。
未来直接测试：默认/缺失/字符串true/错误集合/未知环境零启动；release许可true且全部前置满足的隔离Mock允许一次SDK；隐私拒绝/起点不满足/Native未清理仍阻断；恢复重查；许可切换后迟到启动清理；结束始终可用；Access始终false。

平台待用户只读核对：微信公众平台→开发→开发管理→接口设置，startLocationUpdate/onLocationChange及代码实际使用的定位接口保持已开通；设置→服务内容声明→用户隐私保护指引（若菜单改名搜索该标题），位置用途明确为用户主动前台循迹，退出停止，不保存历史。类目以当前后台适用项为准，不申请后台定位。app.json已有scope.userLocation与requiredPrivateInfos，无后台声明。
微信开发文档直接读取本轮失败，不能宣称独立确认全部最新审核要求；腾讯位置服务官方组织参考明确前台接口需位置权限、声明与后台开通，最终以实际账号页面/审核提示为准：https://github.com/TencentLBS/tencentmap-miniprogram-skill/blob/main/references/wx_location_api/wx.startLocationUpdate.md 。

下一步顺序：审核D2I清单→使用未变的D2H云候选完成一次安全集中专项→后台只读确认→单独授权实现默认关闭门禁并测试→受控候选/正式开门另行批准→微信审核发布单独批准。源文档历史CRLF使core.autocrlf=false diff --check退出1，默认diff --check退出0；未来暂存前要精确处理实际行尾，不能忽略白字符或本轮擅自批量改写。


## 2026-11-04 · Day8-D2J Release GPS门禁实现（默认关闭）
RELEASE_GATE_IMPLEMENTED_DEFAULT_OFF / RC_LOCAL_PREPARATION，仅本地实现。
新增config/gps-release.js，foregroundReleaseEnabled严格false。Page保留运行身份/环境检查；release必须严格true、routes_v03、六正式ID、必要Schema/节点及B1索引合法才可进入原启动流程。加载路线后更新按钮阻断状态，开始及继续重新检查，内部startFollow也复核。SDK服务增加可选beforeSdkStart，在隐私/位置授权和Native清理之后、实际SDK调用之前复核页面版本/可见状态/claim/许可；失败沿既有stop清理，不创建新会话系统。停止不受许可开关限制。
原POLICY/六Route/005起点与7节点不变，真实Access=false，后台定位不做。AppID正则只检查形状，不代替平台账号审核。D2I-FIELD已通过，不再要求重复005核心现场。
check-trail-follow 104组（新增8组）通过；页面模拟19、Native40、路线详情/列表/多路线/大姆山、routes_v03负控及偏航6组通过，均为Node/Mock。Mock true从未写入生产配置，真实release仍关闭，新代码未上传手机。
精确CRLF修复env.js 2处、route-service.js 49处、check-route-list.cjs124处，原HEAD均LF，正文/逻辑不变，调用级autocrlf=false diff --check通过；保留测试文件原有CRLF样本。
RELEASE_FILES_V03_RC_DEFAULT_OFF.txt是本轮准确成员清单，自身作为构建控制文件不计入其描述成员；旧V02/V03历史清单不改。无Git暂存/提交/推送、无云写入/微信上传/审核/发布，旧D2H候选保持原样，尚未包含本轮门禁。当前平台状态USER_VERIFICATION_REQUIRED。

后续最短顺序：用户只读核对当前微信平台接口/类目/隐私与环境绑定→审核本轮默认关闭门禁和成员清单→授权精确本地提交→另行批准构建及微信调试传输→受控RC检查→GPS true与审核/发布分别批准。本轮不生成手机RC、不上传，不需再到珍珠湾。

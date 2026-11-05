# V0.3本地测试与V0.2历史证据

## 2026-11-05 · D4.1 当前候选边界（优先于下方历史阶段）

V0.3读取独立routes_v03；005新珍珠湾起点、1004点与7节点不变。005真实following/偏航回归/暂停停止、D3.2顶部返回/布局/清理ACK已有用户Android证据；私人候选一次194点Access蓝线成功，正式GPS及Access许可仍false。
D4仅以WXML内纯展示映射精简GPS卡片，保留底层诊断/事件/算法；新UI本地122组Follow及公开隔离Runner20项通过，D4.1 初始卡片已获用户 Android 视觉确认。Native44及页面19组通过不等于全部系统手势/关闭已设备覆盖。
产品范围仅前台定位，不做后台记录或专业安全导航保证；账号/类目/隐私/正式开门和微信发布需分别核实与授权。最新源码/构建边界见PROJECT_STATUS与V03_GPS_RELEASE_PLAN。以下旧日期的“当前/待验收/暂缓”仅对应该历史阶段，不覆盖本节。


## 2026-10-29 · Day6-D4 当前交付边界

高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。

Day6-D3已只读核对实际部署包、控制台截图及用户报告：部署入口除账号绑定和行尾外与本地安全实现同源；客户端invoke允许认证非匿名身份，navigation_limits禁止客户端读写。当前V0.3客户端关闭不等于所有服务端调用路径全局关闭；未调用线上服务，Key有效性、自动日志及实际事务行为仍未验证。

Day5-D8/D8R相关正式Follow92组属于既有报告证据，下面77组等为对应历史阶段，不混计私人R6I或Day4隔离生命周期组数。本轮只做文案相关的详情、模拟页面回归、修改后WXML离线编译与保护检查；未重跑92组Follow、六路线回放或Android。最新真实退出码见Day6-D4桌面交付报告。

正式005 Android首位置/起点保护/停止、Nearby连续会话进度/暂停恢复及六正式路线离线回放分别成立；正式Route following、进度、正式页暂停恢复、偏航回归、终点和现场校准仍待，硬件停止独立证据UNKNOWN。历史用户设备结果不提升为Codex独立手机操作。

[3分钟/8分钟演示指南](PORTFOLIO_DEMO_GUIDE.md) · [正式GPS现场手册](V03_GPS_FIELD_ACCEPTANCE_RUNBOOK.md)

以下带日期内容为各阶段记录；当前结论以上节为准。

## 2026-10-27 · 当前测试口径

正式工作区Follow77组、B1核心12组、Page19组、Native40组；公开Runner配置20项。Day4-D4已直接执行相关回归并通过，不等于本轮重新执行全量20项Runner。R6I隔离QA的额外诊断/生命周期用例不计入正式D的77组。

正式005页面已有Android真实GPS启动、首位置和对应停止回执证据，远离起点时未错误进入following，重进未观察到自动定位。私人Nearby QA已取得真实following、同冻结路线同连续会话正向进度及暂停/恢复回执；这不能替代正式页面验收，也不证明实际步行距离测量精度。六条正式Route普通/密采样B1离线回放已通过。

正式Route的Android following、沿线进度、正式页面暂停/恢复、现场偏航和终点仍未完成验证；B1阈值仍为CALIBRATION_PENDING。停止回执证明SDK契约层结果，不独立证明硬件GPS停止；停止后的历史observationCount不是迟到回调探针。

下方Day2/Day3/R2/R4与早期组数是历史记录。Windows固定字节Hash失败及组合输入成功也属于历史证据；R3加入text-integrity.cjs，仅在规范CRLF与LF的非换行文本一致时保留原预期SHA校验，拒绝非法/混合换行及非换行篡改。D4直接工作区相关脚本通过，不再以组合输入替代直接结果。本轮仅验证文档、清单、依赖和保护Hash，未重跑无关路线回放、Native或20项Runner。

正式候选必须包含scripts/access-consent-fixtures.cjs与scripts/text-integrity.cjs测试依赖；前者是隔离假定条件，生产不引用。私人运行身份、QA页面、原始GPS快照和临时路线仍排除。

在项目根目录执行：

~~~sh
node scripts/check-public-routes.cjs
node scripts/check-trail-simulation-page.cjs
node scripts/check-native-route-overview.cjs
~~~

公开入口配置20项，当前Page19组、Native40组；期望与实际执行必须分别记录。只使用005/006/008/009/010/011六正式Route的轨迹，局部派生观测是临时虚拟GPS输入，不产生第七条展示路线。原始GPX、Seed/Mock、私人项目配置和私人QA运行夹具不需要也不得加入；正式测试helper按当前候选清单保留。

## Runner覆盖

1. Route结构及六Import对应、列表/详情、地图适配。
2. Navigation云函数/服务/Page的本地模拟、鉴权/限频/超时、Native与Access隔离、Waypoint及迟到响应。
3. Mountain/Multi-route以及离线GPX解析负例；GPX测试仅由正式轨迹派生临时格式样本，不是新的来源数据。
4. B1单元、组合、六路线普通/密采样回放；旧算法预期失败负控制与当前算法合法完成。
5. Trail Follow（早期18组，当前77组）、虚拟模拟引擎、页面、Marker、性能调度和原生状态机。

B1负控制使用docs/evidence/day6-b1-before-progress.txt的经审查历史算法，验证旧问题会真实失败；验证器本身退出0表示“旧失败与当前通过”都符合预期，不是旧算法修复前曾通过。不能删除负控制或弱化断言。

原生专项（早期36组，当前40组）仅验证模拟的回调/状态机/末点严格门：不保证真实微信桥接与地图像素渲染。性能脚本可覆盖六路线独立B1引擎，不表示008/010当前页面也运行B1。

## 历史阶段 · V0.3 Day2新增负控

保留原18组Trail Follow、17组Page与36组Native覆盖；新增同session在隐私/authorize/SDK挂起时共享启动Promise、不同session竞争、各阶段取消/超时与迟到回调、并发stop及解绑失败保留owner测试。Page专项新增六路线真实模式资源门与无效继续不遗留令牌；Native专项新增共享异步移除ACK、移除失败/超时与迟到成功不自动重启。实际组数以本次输出为准，不将历史计数当新成绩。

原“规划中直接继续循迹”断言按Day2明确的新契约收紧：在途Access不能启动GPS，先保留暂停，待真实请求结束后才能继续并清除蓝线；正常Access和后续继续断言保留。010严格备用门、008排除门、原生几何源码守卫、六路线B1负控不删除或放宽。

Windows检出换行可能改变固定SHA/多行源码匹配。需保留直接执行的失败记录；可在系统TEMP使用当前已修改文件的真实字节、未修改文件的同一HEAD原始blob建立隔离测试输入，核对差异仅为检出换行，再执行原脚本。不得修改路线/云配置或放宽Hash断言来绕过；TEMP结果与直接工作区结果分开报告。SDK物理停止、完整Android真实GPS及户外校准仍NOT_TESTED，隐私仍PLATFORM_PRIVACY_PENDING。

## 执行环境与副作用

本轮准备环境Node.js24.19.0；其他Node版本待独立复验。Node测试使用内置模块和本地微信/云SDK替身，不需要真实CloudBase写入、Key、位置或安装生产SDK；只有实际部署云函数才需其package.json依赖。

Runner显式复制测试依赖到系统临时候选，检查六路线与源文件Hash不变；部分GPX解析测试只写系统临时文件。它不是完整项目发布打包器，也不会复制README等全部公开文档。测试会产生临时报告和候选，应按本机工具策略清理，不能自动上传原日志。

Runner JSON中date仍固定为历史2026-10-13，部分脚本打印早期DevTools PENDING；这些是保留的测试文本，不代替本次执行日期或最新用户双端确认。没有修改原测试来把PENDING涂改成PASS。

## 其他检查

对实际所有JS/CJS执行node --check，对所有JSON解析，核对模块引用、页面/资源、Markdown链接、六Route与Import及核心保护Hash。Windows CRLF可用以下调用级规则检查真实空白，不改Git配置或文件：

~~~sh
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
~~~

默认Git检查可能把既有CRLF的CR视为trailing whitespace；应同时保留默认实际结果，独立确认无CR之外的尾空格/Tab，不声称默认检查历史失败已变通过。

人工层级见[验收状态](PORTFOLIO_STATUS.md)；自有环境复现见[运行安全](RUNNING_AND_SECURITY.md)。

## 历史阶段 · V0.3 Day3 证据分层与恢复负控

保留Day2的启动Promise、取消/迟到启动、停止失败/解绑失败、模式排他用例；旧服务/Page联动用例明确直接调用内部startFollow，仅证明隔离逻辑，不绕过公共入口平台门。新增公共开始/继续阻断、官方隐私同意事件与普通tap区分、拒绝/阅读/查询失败、挂起超时/迟到、hide/unload/换路线失效、原始GPS Marker坐标索引补丁、Access超时后原始ACK释放、Native失败重试/无ACK不重叠提交/旧ACK隔离。38组既有Native覆盖保留，动画几何与完成门不改。

只更新获准改动的navigation-service文件Hash，六Route/Import、B1、Map Core等保护值不改。Windows原checkout含CRLF，固定SHA/多行字符串检查可能在直接工作区失败；必须保留真实退出码。可在系统TEMP构造组合输入：已修改文件用当前工作区字节，未修改文件用当前HEAD原始Git blob字节；报告明确叫组合输入回归，不能冒充完整真实工作区集成或微信编译。不得改正式数据Hash来掩盖换行差异。

自动化使用正式轨迹派生观测及隔离wx，不采集真实位置，不访问生产CloudBase。Node PASS不代表微信隐私合规、DevTools编译、Android真实GPS启停或受控户外校准通过；上述真实平台证据本日均未取得。

## 历史阶段 · V0.3 Day3-R2 请求时序测试

新增独立同意负控：原始点击只显示披露；拒绝/关闭/旧代次/路线目标切换/hide/unload/返回零getLocation与callFunction；按privacy→authorize→getLocation→cloud记录顺序；微信隐私拒绝、scope拒绝、接口未开通、SDK失败均零云调用；政策打开失败不放行；一次凭据不复用或改目的地；迟到结果隔离。原51组Follow与40组Native保留，既有Access正常路径在测试助手中显式补上本次同意，不能删除旧断言。

scripts/access-consent-fixtures.cjs仅为隔离wx假定准入条件，主体字符串明确非真实核实结果；生产源码不引用。组合Runner显式复制新增生产配置和测试依赖，不用修改正式路线或云函数Hash；直接Windows换行Hash失败仍记录。仅更新获准修改的navigation-service保护值，其他受保护常量保持。当前UI/状态与服务测试不等于DevTools、Android、真实GPS或高德线上验收；生产主体、单次定位准入与政策入口仍阻断。


## 历史阶段 · V0.3 R4 验证边界

新增公共私人入口负控覆盖运行版本、主动点击、官方隐私事件、位置授权拒绝、缺接口/异常隐私响应、并发、生命周期、真实SDK回调到B1、低精度/跳点/断流冻结、暂停/继续/停止失败及Native清理ACK/Access在途互斥。既有Day2/Day3和R3拒绝零定位/零云调用、换行Hash负控保留。仅对本次明确修改的定位服务重记精确字节Hash；正式Route/Import、云函数、B1及其他常量不变。

所有GPS来自隔离wx回调替身，来源点为正式路线测试资料，不是用户实测。直接Windows工作区Runner复制当前真实字节进入闭合TEMP候选，不混用Git blob替换未改文件。测试通过仍仅NODE层；DEVTOOLS_NOT_TESTED、ANDROID_REAL_GPS_NOT_TESTED、FIELD_CALIBRATION_PENDING、ACCESS_POLICY_PENDING保持。

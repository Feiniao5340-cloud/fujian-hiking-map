# V0.3当前架构（保留V0.2基础）

## 2026-10-29 · Day6-D4 当前交付边界

高德政策阅读按钮及微信指引→补充文档→官方政策阅读链已有用户Android验证；阅读通道、当次明示同意和真实请求许可已解耦。用户已选择方案A：V0.3暂缓真实Access，生产accessRequestsEnabled=false、policyPagePath=null保持。null为历史站内页面字段，不再代表已验证的微信阅读通道缺失；阅读成功不能生成grant或定位。release真实GPS继续由privateFollowBlock阻断。

Day6-D3已只读核对实际部署包、控制台截图及用户报告：部署入口除账号绑定和行尾外与本地安全实现同源；客户端invoke允许认证非匿名身份，navigation_limits禁止客户端读写。当前V0.3客户端关闭不等于所有服务端调用路径全局关闭；未调用线上服务，Key有效性、自动日志及实际事务行为仍未验证。

当前Access调用链保持原有单次grant：阅读只负责可访问性，当次主动同意后仍检查产品硬门、微信隐私与scope，依次定位和云规划。生产硬门未放行时两类请求均为零；不改定位服务、B1或云函数。

正式005 Android首位置/起点保护/停止、Nearby连续会话进度/暂停恢复及六正式路线离线回放分别成立；正式Route following、进度、正式页暂停恢复、偏航回归、终点和现场校准仍待，硬件停止独立证据UNKNOWN。历史用户设备结果不提升为Codex独立手机操作。

[3分钟/8分钟演示指南](PORTFOLIO_DEMO_GUIDE.md) · [正式GPS现场手册](V03_GPS_FIELD_ACCEPTANCE_RUNBOOK.md)

以下带日期内容为各阶段记录；当前结论以上节为准。

## 2026-10-27 · 当前接入与证据

正式页面已具备用户主动开始→微信隐私检查/官方同意事件→再次主动开始→位置授权→唯一前台SDK会话→真实位置回调→B1起点确认/质量/进度→Marker和UI的调用链。隐私同意事件本身不启动GPS。暂停等待停止确认并保留B1标量，继续创建新SDK会话，hide/unload清理且重进不自动恢复。

正式005页面已有Android真实GPS启动、首位置和对应停止回执证据，远离起点时未错误进入following，重进未观察到自动定位。私人Nearby QA已取得真实following、同冻结路线同连续会话正向进度及暂停/恢复回执；这不能替代正式页面验收，也不证明实际步行距离测量精度。六条正式Route普通/密采样B1离线回放已通过。

正式Route的Android following、沿线进度、正式页面暂停/恢复、现场偏航和终点仍未完成验证；B1阈值仍为CALIBRATION_PENDING。停止回执证明SDK契约层结果，不独立证明硬件GPS停止；停止后的历史observationCount不是迟到回调探针。

真实GPS仅允许开发/体验版本在用户主动操作后进入必要隐私/位置授权，release仍由privateFollowBlock拒绝（RELEASE_GPS_BLOCKED）。高德法律主体与getLocation准入已有OWNER_CONFIRMED，但未由Codex独立登录后台核验；policyPagePath仍为null，真实Access继续阻断（ACCESS_POLICY_PENDING）。

Access当前配置为北京高德图强科技有限公司、getLocationApproved=true（所有者确认），可访问政策页仍缺失；单次Access先单独同意，再检查微信隐私/scope，才可定位与调用云函数。当前在政策门处终止。

本文描述V0.3内部候选；V0.2已公开，V0.3尚未发布。下方Day2、Day3及R2/R4小节保留历史演进，当前准入和验证以上节及PROJECT_STATUS为准。

## 数据与调用流

~~~text
首页 -> routes列表 -> route-detail
                      |-- route-service -> wx.cloud -> routes（只读）
                      |-- map-data -> 正式Trail + Start + Waypoint
                      |-- navigation-service -> wx.openLocation（原生目标）
                      |-- Access单独同意/政策门 -> 微信授权 -> 单次wx.getLocation -> planAccessRoute -> 高德Walking -> 临时Access
                      |-- 真实GPS私人入口 -> 隐私/位置授权 -> trail-follow-service -> trail-progress(B1) -> 原始位置Marker/UI
                      |-- 005/006/009/011 -> trail-simulator -> trail-progress(B1)
                      |-- 008/010 -> native-route-overview -> MapContext.moveAlong
~~~

只有路线详情拥有当前选择、Access、模拟会话及地图派生状态。切换路线、hide/unload、重播通过清理及版本/代际检查拒绝旧响应；没有全局状态库、持久化徒步历史或第二套后端。

## Route v1：保留源数据

六套 data/routes/*.json 和同名 -import.json 是同一完整对象；导入版单行仅为CloudBase输入，不能当第七条路线。坐标统一gcj02，客户端不转换；track保持正式顺序、点值和首尾，不为动画补闭环或旋转数组。

根字段：_id、schemaVersion、name、city、district、locationText、coverImage、distanceMeters、estimatedDurationMinutes、difficulty、elevationGainMeters、routeType、summary、description、bestSeason、notice、coordinateSystem、startPoint、track、waypoints、source、updatedAt。字段约束以 scripts/check-route-data.cjs 为可执行准则。

startPoint包含name/latitude/longitude；track项只有latitude/longitude；Waypoint包含id/name/type/latitude/longitude/description/distanceFromStartMeters。source只含infoSource/trackSource/originalCoordinateSystem/conversionMethod/permissionNote/checkedAt。未知值按契约使用null，不补0或个人字段。

距离单位米、估计用时分钟、接驳返回用时秒；算法进度以有序几何累计长度计算，不强等于资料distanceMeters。起点元数据不必等于track[0]，太姥山有前置轨迹，完成点仍是正式最后一点。

## 模块职责

- services/route-service.js：云列表摘要、按ID读取完整Route及错误边界。
- utils/map-data.js：正式几何与Start/Waypoint适配；组合临时Access，不发网络请求、不改Route。
- services/navigation-service.js：Native与单次真实定位接驳；处理拒绝、错误、重入、超时及迟到结果。
- cloudfunctions/planAccessRoute：信任平台上下文、校验APPID/OPENID/SOURCE、事务限频、服务端HTTPS高德请求；Key不进客户端。
- utils/trail-progress.js：纯B1引擎，无wx/网络/持久化，阈值仍需真实校准。
- utils/trail-simulator.js：从正式轨迹派生虚拟观测；调用完整B1，视觉里程与确认进度分离；冻结私有索引的静态校验缓存不改变动态算法。
- utils/native-route-overview.js：只为008/010启用原生分段状态机，包含010第15段严格末点证据备用机制；不输出实时B1资格。
- services/trail-follow-service.js：真实前台GPS唯一owner、共享启动Promise、取消/迟到回调隔离、停止ACK及解绑失败阻断；由私人开发/体验入口调用，不在模拟中调用。

正式Marker与模拟Marker分离，模拟ID=-2、真实位置ID=-1、起点ID=0、业务Waypoint稳定正整数。四个本地图标分别为start/waypoint/location/simulation.png。页面只更新必要模拟显示字段，避免重复发送完整track；正常浏览不依赖模拟。

## 历史阶段 · V0.3 Day2：定位服务与模式资源门（用户入口仍关闭）

`trail-follow-service.createSession().start()`在权限查询之前缓存启动Promise，同一session的并发调用共享结果。`stop()`立即取消业务回调并合并并发清理；SDK启动/停止未回执继续持有唯一owner，迟到启动成功后仍执行停止。解绑抛错保留监听未确认状态，可用不含坐标的`cleanupState`检查并主动重试；取消回调不等于物理资源已释放。原20秒启动等待和8秒停止等待不放宽。

详情页的`claimNavigationMode/releaseNavigationMode`集中仲裁REAL_FOLLOW、B1_SIMULATION、NATIVE_OVERVIEW、ACCESS及NATIVE_TARGET。真实会话/转换与其他模式互斥；已运行B1阻止真实启动，已暂停B1先销毁。Native通过`stopNativeOverview(done)`确认移除，失败/超时不能启动GPS。Access与Native目标操作先等待真实定位停止成功；在途Access令牌不因清除UI、换路线或hide而释放，迟到结果仍须通过原版本校验。

既有非真实操作之间的地图/Access共存保留；`getNavigationMode()`按真实、Access、Native目标、速览、B1的优先级报告资源占用，不表示Access能替代动画控制Marker。不同真实session的最终定位所有权仍由service唯一owner保证。真实循迹暂停的进度标量与已停止SDK资源分开；停止未确认不能切换其他模式。

单次定位超时无法由现有navigation-service确认底层请求已结束，因此保守保留ACCESS阻断，不用迟到回调/清UI伪造取消；当前无自动解除未知请求的产品流程，恢复方案需在开放真实入口前单独核验。Native移除失败同样保留阻断；超时后的迟到移除成功只解除资源占用，不自动启动GPS或新动画。

Day2仅有隔离wx/Node证据。WXML/WXSS与app.json不改，隐私同意交互/平台准入仍待后续核验，B1阈值仍为CALIBRATION_PENDING；没有当前完整Android真实GPS循迹或户外校准PASS。

[模拟机制与限制](SIMULATION.md) · [运行安全](RUNNING_AND_SECURITY.md) · [数据来源](DATA_SOURCE.md) · [测试](TESTING.md)

## 历史阶段 · V0.3 Day3：真实循迹面板与受控恢复（PLATFORM_PRIVACY_PENDING）

新增独立前台实验面板，现有四路线B1模拟和008/010速览保留。公共开始/继续经requestFollowStart阻断；不可用data或测试开关放行。内部startFollow继续复用Day2唯一owner、SDK停止确认及模式互斥；它只在隔离自动化中被直接调用，不代表公共界面已能启用真实定位。定位Marker首次加入后仅发布其经纬度索引补丁，不重发完整Trail或每次全量Marker。B1阈值不变，仍CALIBRATION_PENDING。

隐私采用官方说明中的getPrivacySetting + agreePrivacyAuthorization按钮事件方案，openPrivacyContract仅供阅读；不注册覆盖式onNeedPrivacyAuthorization，也不额外调用非必需requirePrivacyAuthorize。检查和同意均不启动GPS；getPrivacySetting返回false也不能证明账号后台声明/准入通过。未来解除平台门后还须接通用户主动开始→隐私检查/按钮同意→service再次检查隐私→authorize(scope.userLocation)→startLocationUpdate(gcJ-02语义)；本日公共链仍在平台门处终止。app.json保持Day2原值，其仅描述单次Access的用途说明尚须与后台持续前台定位用途一起复核，不可据此放行。

Access UI超时不等于SDK取消。locateOnce可选onSettled仅在原始单次getLocation成功/失败回执后通知，不含坐标；超时Promise已失效，迟到坐标永不写回。超时无回执继续持ACCESS；回执到达释放该请求令牌，不自动GPS。路线规划超时只结束业务等待，旧云结果由timedCall及页面版本屏蔽，不是持续GPS资源。

Native retryNativeOverviewCleanup只在原始dispose已明确失败后重新提交真实removeMarkers；未回执（包括UI超时）不重叠提交。迟到ACK只解除旧资源，不自动开启GPS。重试失败保持阻断并显示检查系统/关闭重新进入小程序说明。动画核心、几何、16段、3米/15米门及010第15段备用门均不变。

## 历史阶段 · V0.3 Day3-R2：本次Access同意与安全阻断

新增config/access-privacy.js记录当前未经确认的法律主体(null)、用户报告未开通的getLocation(false)及未验证的政策阅读页(null)。生产配置不可变，不提供ENV/页面data测试放行开关；生产真实接驳保持阻断，真实循迹固定门也不变。两个定位准入不能混同：所有者反馈startLocationUpdate/onLocationChange已开通，不代表getLocation可用或真实循迹获准启用。

详情先创建绑定页面代次、Route与目标的Access意图，仅展示Web API披露；同意后才等待互斥清理、微信隐私查询/官方按钮事件和位置scope，再取得本次定位并发云请求。拒绝/遮罩关闭/换目标/换路线/hide/unload/返回立即使旧意图失效。非永久布尔同意；不保存同意或位置历史。

navigation-service用内存WeakMap保存本次授权凭据：顺序authorized→locating→located→sent；只允许一次真实定位结果与同一目标发送一次规划。普通对象、旧凭据或换目的坐标不能使用，取消后的迟到回调不更新页面。SDK原始ACK与UI超时继续分开，不假装撤回已发生传输。服务端仍只接收origin/destination，云函数与数据库结构不改。


## 历史阶段 · V0.3 R4：私人前台GPS与Access分离

用户确认当前账号前台定位准入、隐私指引已生效且涵盖单次接驳与主动前台循迹（OWNER_CONFIRMED，非独立平台核验）。公共开始/继续仅在SDK能识别的开发/体验版运行；修改页面data不能越过版本检查。每次用户主动点击后仍须合法Route/B1、前台生命周期、唯一资源令牌、Native清理ACK及微信隐私/位置授权。官方隐私同意事件不自动定位，需要再次主动开始。

本地B1只处理SDK位置流，不上传位置历史；蓝点用SDK原坐标，不吸附正式Track。暂停/退出等待既有清理，恢复使用新鲜位置。高德Access仍独立以policyPagePath=null阻断，不能因GPS实验入口而放行。此为代码/本地测试准备，尚未通过DevTools、Android或户外验证。

# v0.2 可复现本地测试

在项目根目录执行：

~~~sh
node scripts/check-public-routes.cjs
node scripts/check-trail-simulation-page.cjs
node scripts/check-native-route-overview.cjs
~~~

Runner应20/20；Page专项17组；Native回调逻辑专项36组。只使用005/006/008/009/010/011六正式Route的轨迹，局部派生观测是临时虚拟GPS输入，不产生第七条展示路线。原始GPX、Seed/Mock、私人项目配置和QA专用测试夹具不需要也不得加入。

## Runner覆盖

1. Route结构及六Import对应、列表/详情、地图适配。
2. Navigation云函数/服务/Page的本地模拟、鉴权/限频/超时、Native与Access隔离、Waypoint及迟到响应。
3. Mountain/Multi-route以及离线GPX解析负例；GPX测试仅由正式轨迹派生临时格式样本，不是新的来源数据。
4. B1单元、组合、六路线普通/密采样回放；旧算法预期失败负控制与当前算法合法完成。
5. 18组Trail Follow、虚拟模拟引擎、页面、Marker、性能调度和原生状态机。

B1负控制使用docs/evidence/day6-b1-before-progress.txt的经审查历史算法，验证旧问题会真实失败；验证器本身退出0表示“旧失败与当前通过”都符合预期，不是旧算法修复前曾通过。不能删除负控制或弱化断言。

原生专项36组仅验证模拟的回调/状态机/末点严格门：不保证真实微信桥接与地图像素渲染。性能脚本可覆盖六路线独立B1引擎，不表示008/010当前页面也运行B1。

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

# 修改位置导航

4.0新增任务归类：`assignment-groups.js`负责共享校验、关键词和关联规则；`assignment-groups-ui.js`负责可搜索选择器与任务发布表单；`cloud/assignment-groups.cjs`负责既有记录表中的独立任务目录及CAS重试。原`task`相关模块仍负责作业，技术命名保留兼容。

| 想修改的内容                 | 先看哪里                                                                   | 重点验证                                    |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| 任务卡片文字、备注位置、按钮 | `task-views.js`的`taskCard`                                                | 角色、课程/普通任务、停用/完成、字号        |
| 日/周/月视图                 | 同文件`calendarPage`，日期规则在`model.js`                                 | 月/年边界、补交及当天待办/完成              |
| 历史任务列表                 | 同文件`historyResults`，控制器筛选在`app.js`                               | 删除任务的角色差异、多学期                  |
| 发布/编辑任务表单            | `app.js`、`index.html`                                                     | 仅名称必填、单次/周期、学生限制             |
| 修改云端任务规则             | `cloud/task-service.cjs`、`model.js`                                       | revision冲突、备注权限、已有成果保留        |
| 作业提交、反复补交、评分     | `app.js`、`cloud/core.cjs`、`model.js`                                     | 同请求幂等、不同补交独立、双方评分          |
| 资料/试卷列表及筛选栏        | `library-views.js`                                                         | 目录名称/计数、学期、身份、关键词           |
| 资料上传/编辑/删除事件       | `study-ui.js`及`cloud/core.cjs`                                            | 多附件、删目录回根目录、试卷选填            |
| 成绩和评分趋势               | `study-model.js`、`study-ui.js`                                            | 分制换算、日期范围、缺失成绩/排名           |
| 昵称、头像、目标或表格       | `my-page.js`、`my-model.js`                                                | 角色信息隔离、共享字段、矩形合并            |
| 消息与提醒                   | `my-model.js`、`cloud/extras.cjs`                                          | 已读、每轮一次、完成/停用排除               |
| 图片/PDF/Word查看            | `file-viewer.js`、`image-zoom.js`                                          | 下载失败、连续页、双指/按钮缩放、切换与释放 |
| 附件缓存                     | `attachment-cache.js`                                                      | 连接隔离、LRU、配额失败、并发合并           |
| AI点评                       | `cloud/ai-review.cjs`、`review-batches.cjs`、`desktop-review/worker.cjs`   | 在线/领取/失败/退出App、去重与回传          |
| 安卓保存、更新               | `android/android-client.js`、原生`MainActivity.java`、`UpdateManager.java` | 明确点击、失败提示、签名和下载校验          |
| 桌面组件                     | `android/src/cn/c9/studyplan/`的Widget类                                   | 日期、滚动、刷新、备注与停用任务            |
| 样式                         | `styles.css`，仅安卓差异在`android/styles.css`                             | 手机/平板、横竖屏、四字号和五背景           |

## 增加或移动文件

前端保持经典脚本顺序，不能只在一个HTML里加引用：

1. 修改本地入口`index.html`中的脚本区域。
2. 修改`build/assets.cjs`的共同脚本顺序。
3. 在`cloud/server.cjs`的静态白名单和安卓`MainActivity.java`的ASSETS中允许新脚本。
4. 单文件HTML内联入口`cloud/mobile-file.cjs`读取同一清单，检查内联后的脚本语法及依赖顺序。
5. 更新测试VM的装载依赖，不能删掉原有业务断言来绕过缺少模块。

前端脚本引用的是模型/视图模块名；`cloud/public`及安卓assets是生成文件。对服务端新增模块，应同步将文件加入`cloud/package.cjs`，否则本机通过但部署时会找不到模块。

## 选择测试

运行`npm test`会构建所需资源并跑原有回归。对单一后台行为，可先运行对应`cloud/tests/*.test.cjs`，通过后再运行完整检查。

`tests/task-views.test.cjs`比较拆分前后的任务视图输出，`cloud/tests/sync-lists31.test.cjs`覆盖资料筛选/计数和快照等价性，`tests/build-contract.test.cjs`检查HTML区域和平台脚本约束。测试验证行为和必要交付契约，允许重新排版、移动文件及重命名局部变量。

## 发布前

源码整理、云端部署、Netlify网页和安卓APK并不是同一个步骤。保持稳定标签对应原交付，准备新发布时重新构建、核对包内容与签名，按需要增加内部版本号，再单独更新安装包源。

# 部署组件与函数/API清单

## 实际需要部署什么

| 组件         | 是否必需       | 入口                                                                 | 运行位置                          |
| ------------ | -------------- | -------------------------------------------------------------------- | --------------------------------- |
| 主接口函数   | 必需           | `cloud/server.cjs`，启动`node server.cjs`监听9000                    | 阿里云FC Web函数                  |
| 自动备份函数 | 可选           | `cloud/backup-handler.cjs`打包成`index.js`，handler为`index.handler` | 阿里云FC事件函数+定时触发器       |
| 数据存储     | 必需           | `cloud/aliyun.cjs`                                                   | 自己的OSS Bucket+Tablestore两张表 |
| 网页         | 网页使用时需要 | `cloud/build.cjs`或`scripts/build-web.cjs`生成`cloud/public`         | FC同域/自己的静态托管             |
| 安卓App      | 安卓使用时需要 | `android/src/cn/c9/studyplan/MainActivity.java`                      | 手机/平板                         |
| 电脑AI点评   | 可选           | `desktop-review/worker.cjs`                                          | 自己的电脑及本机OpenClaw          |

不要为每个API单独创建一个FC函数。以下API均由同一个主接口函数处理。

## 主要代码职责

任务发布/修改、星期、备注、暂停和排序写入已拆到`cloud/task-service.cjs`，由`core.cjs`注入同一套存储、时钟、权限校验与事件处理，原接口保持不变。

| 文件                                        | 作用                                                     |
| ------------------------------------------- | -------------------------------------------------------- |
| `cloud/server.cjs`                          | HTTP路由、鉴权、CORS、静态资源和错误响应                 |
| `cloud/core.cjs`                            | 任务/提交/评分/资料/快照及备份业务，快照复用和6路记录I/O |
| `cloud/extras.cjs`                          | 个人设置、发布/完成/提醒消息、已读                       |
| `cloud/aliyun.cjs`                          | Tablestore分页及条件更新、OSS分段上传和签名链接          |
| `cloud/ai-review.cjs`、`review-batches.cjs` | 点评请求、在线心跳、领取、去重、结果与批量回传           |
| `model.js`、`study-model.js`、`my-model.js` | 周期、日期、评分、资料、成绩、目标和表格模型             |
| `cloud/runtime-*.js`                        | 将本地界面明确适配为网络读写的构建边界                   |
| `attachment-cache.js`                       | 内存/IndexedDB附件缓存、LRU、并发合并与连接隔离          |
| `file-viewer.js`、`image-zoom.js`           | 只读文件预览、连续PDF及图片/文档缩放                     |

## API

除`/health`与静态网页外，API需要`Authorization: Bearer <自己的访问码>`；角色相关接口带`X-C9-Role: teacher`或`student`。电脑worker的三个API使用独立的电脑专用码。

| 方法与路径                                | 用途                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| GET `/health`                             | 程序版本/特性，不能代替存储检查                                                  |
| GET `/api/check`                          | 表格读取及OSS小文件读写连接检查                                                  |
| GET `/api/snapshot?since=...`             | 全量或增量任务、记录、资料、设置与消息                                           |
| GET `/api/widget`                         | 安卓组件用的简化快照                                                             |
| POST `/api/assignment-groups`             | 双方发布新任务，必填名称、学科和学期；请求体`{group:{id,name,subject,semester}}` |
| POST `/api/tasks`                         | 发布/修改/启停/软删除任务，含revision条件保护                                    |
| POST `/api/tasks/weekdays`                | 双方修改每周完成星期的专用接口                                                   |
| POST `/api/tasks/round-note`              | 老师修改某轮备注                                                                 |
| POST `/api/tasks/pause`                   | 老师暂停/恢复当前轮次                                                            |
| POST `/api/uploads`                       | 开始作业/资料附件上传                                                            |
| POST `/api/uploads/{id}/parts/{number}`   | 上传一段二进制内容                                                               |
| POST `/api/uploads/{id}/complete`         | 确认上传完成                                                                     |
| POST `/api/submissions`                   | 提交指定轮次作业；支持请求幂等与周期反复提交                                     |
| POST `/api/grades`                        | 老师评分，带旧评分版本校验                                                       |
| GET `/api/images/{id}`、`/api/files/{id}` | 鉴权读取原图和文件                                                               |
| POST `/api/library/save`                  | 新增/修改资料、试卷、文件夹                                                      |
| POST `/api/library/delete`                | 删除资料/试卷/文件夹，目录删除后内容回根目录                                     |
| POST `/api/preferences/my`                | 角色头像昵称、共享目标及录取表格                                                 |
| POST `/api/preferences/order`             | 按角色保存任务顺序                                                               |
| POST `/api/messages/read`                 | 自己角色的消息已读                                                               |
| POST `/api/backup`                        | 老师触发备份，返回OSS备份键                                                      |
| POST `/api/ai/review`                     | 双方发起具体提交的点评                                                           |
| GET `/api/ai/review?jobId=...`            | 查询点评状态                                                                     |
| POST `/api/ai/worker/poll`                | 电脑心跳及领取任务                                                               |
| POST `/api/ai/worker/result`              | 电脑回传结果/错误                                                                |
| POST `/api/ai/worker/batch`               | 电脑批量回传，支持待回传内容恢复                                                 |

请求体以`cloud/tests/`内的合成示例和当前`server.cjs`为准。不要跳过task/grade revision或自行伪造完成时间。协议版本仍为1.6.0，当前build55；App显示版本单独维护。

## 周期及提醒执行

每日、每周、每月按北京时间计算。自动打卡和到期提醒由快照同步触发维护，本版本没有独立的后台定时提醒调度器。备份事件函数只负责备份，不负责实时推送；无需为了当前规则额外部署一个“提醒函数”。

# 阿里云部署教程

本教程对应公开版1.0、接口build 1。请使用自己的账号、域名、访问码与存储资源。示例域名不能直接连接，代码仓库不提供公共共享后台。

本次新增`C9_STORAGE_WARN_GB=1`容量提醒及Bucket级`oss:GetBucketStat`只读权限。未完成上传分片3天清理和费用告警需在阿里云单独启用，具体步骤见[存储维护与告警](STORAGE_MAINTENANCE.md)。不限制上传数量，不清理已完成作业附件。

## 1. 准备部署包

安装Node.js 22及Git，在仓库根目录执行：

```sh
npm ci
npm ci --prefix cloud --ignore-scripts
npm test
npm run package:cloud
```

在`cloud/release/`得到：

| 文件                                   | 用途                                                      |
| -------------------------------------- | --------------------------------------------------------- |
| `Accompany Learning云端接口部署包.zip` | 主Web函数，含SDK与网页资源                                |
| `Accompany Learning云端界面.zip`       | 独立网页资源；可作为同域静态界面，或按网页教程配置Netlify |
| `Accompany Learning自动备份函数.zip`   | 可选Node.js定时备份函数                                   |

上传主ZIP时，根目录应直接包含`server.cjs`、`core.cjs`、`extras.cjs`、`aliyun.cjs`、`node_modules/`、`public/`，不应额外包一层仓库目录。不要上传`.git`或签名。

## 2. 创建存储

建议主函数、OSS及Tablestore统一地域，例如华东1杭州`cn-hangzhou`。

1. 创建私有OSS Bucket，阻止公共访问。无需设置公共读。
2. 创建Tablestore实例，记录实例名和HTTPS Endpoint；使用宽表模型。
3. 创建以下两张表，主键类型及顺序必须一致：

| 表名         | 主键                                       |
| ------------ | ------------------------------------------ |
| `c9_tasks`   | `task_id`：STRING                          |
| `c9_records` | `task_id`：STRING，然后`round_key`：STRING |

表TTL设为永久（-1），最大版本数1，无自增主键。属性列`payload`与`revision`由程序写入，不用预建。学习资料、个人设置、消息已读与AI元数据也保存在记录表中的内部命名空间，不用额外建表。

本方案使用Tablestore公网HTTPS Endpoint，需允许函数网络访问；OSS默认走同地域内网。网络环境不通时，可先将`C9_OSS_INTERNAL=false`回退公网排查。权限鉴权仍然保留。

费用依账号资源和使用量产生，优惠券适用范围请在自己的控制台确认。此项目不承诺免费额度或固定月费。

## 3. 配置函数执行角色

创建以函数计算为可信服务的RAM角色。信任策略见`cloud/function-role-trust.json`。

将`cloud/function-permissions.example.json`中的账号UID、地域、实例名及Bucket名替换为自己的值，建立自定义策略并授权给该角色。策略仅需要：

- 指定两张表：`ots:GetRow`、`ots:GetRange`、`ots:PutRow`。
- 指定Bucket内对象：`oss:GetObject`、`oss:PutObject`。

程序通过函数角色获得临时STS凭据。不将主账号长期AccessKey写入代码、网页或APK。若独立于FC调试真实存储，也需要自行提供有效的临时三元组；本机演示不需要云密钥。

## 4. 创建主函数

在FC创建Web函数（非只处理事件的普通handler），运行环境选择自定义Debian12并配置可用Node.js 22层。Node实际路径按运行环境确认。

| 项目     | 建议值                                                              |
| -------- | ------------------------------------------------------------------- |
| 名称     | `accompany-learning-api`，可自行命名                                |
| 代码     | 主接口ZIP                                                           |
| 启动命令 | `/var/fc/lang/nodejs22/bin/node server.cjs`，须与实际运行时路径一致 |
| 监听端口 | 9000，代码支持平台`FC_CUSTOM_LISTEN_PORT`                           |
| 内存     | 512MB作为双人使用起点，按运行情况调整                               |
| 超时     | 60秒                                                                |
| 最小实例 | 0；冷启动可能增加首次等待                                           |
| 网络     | 允许访问实际OSS/Tablestore Endpoint                                 |
| 函数角色 | 上一步的限定资源角色                                                |

如果所选环境Node路径不同，应改启动命令；不要用不存在的路径或把`npm install`写成启动命令。依赖已经打包。

## 5. 配置环境变量

依据`cloud/environment.example.json`逐项填写。随机码可在本机运行下面命令生成；执行两次分别用于App与AI电脑端，生成结果不要提交到仓库：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| 变量                     | 含义                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `C9_ACCESS_TOKEN`        | App连接用随机访问码，至少32字符                                               |
| `C9_TABLESTORE_INSTANCE` | 实际Tablestore实例名                                                          |
| `C9_TABLESTORE_ENDPOINT` | 实际HTTPS Endpoint                                                            |
| `C9_TASK_TABLE`          | `c9_tasks`                                                                    |
| `C9_RECORD_TABLE`        | `c9_records`                                                                  |
| `C9_OSS_REGION`          | 如`oss-cn-hangzhou`                                                           |
| `C9_OSS_BUCKET`          | 实际私有Bucket名                                                              |
| `C9_OSS_INTERNAL`        | 同地域内网可达时`true`                                                        |
| `C9_ALLOWED_ORIGINS`     | 跨域界面来源，用英文逗号连接；安卓通常为`https://localhost`，应以实际来源为准 |
| `C9_AI_WORKER_TOKEN`     | 可选AI电脑独立随机码，必须与App访问码不同；不用AI可删除此项                   |
| `TZ`                     | `Asia/Shanghai`                                                               |

不要原样使用示例中的`GENERATE_...`占位文字。CORS应列出自己实际使用的来源，网页通过同域代理访问时不需要为该代理添加浏览器跨域授权。本地file调试如确有需要可添加来源`null`；不要无必要开放通配来源。

## 6. 配置HTTPS入口并检查

创建公网HTTPS HTTP触发器，允许GET、POST、OPTIONS。触发器层使用匿名入口，应用层仍会对`/api/*`校验访问码；健康接口`/health`是公开的。

浏览器访问`https://自己的接口地址/health`，应有：

```json
{"ok":true,"service":"Accompany Learning","version":"1.6.0","build":56,"features":{"snapshotOptimized":true}}
```

实际结果还有其他features和时间字段。`version`是后端协议号，与安卓显示4.0不同。健康接口不读写存储，不能单凭ok证明存储权限正常；在App“连接并保存”时会进一步校验两张表和OSS。

默认FC域名可能对网页和下载响应施加平台限制。网页可按[Netlify教程](DEPLOY_WEB.md)独立托管；APK使用自己的静态更新站点，不用FC默认域名分发。正式域名、备案及联网App合规事项按自己的部署地点和使用方式核实。

## 7. 双设备验收

使用自己的前端/APK填入同一接口与访问码，两台设备分别选老师和学生，检查发布、提交图片、评分、查看历史与资料同步。测试会产生自己的云端记录，建议使用可辨认的测试名称。

检查自动打卡、周期补交、停用当天隐藏、文件预览和消息。AI与备份可之后再启用。

## 8. 可选每日备份函数

在主接口验收后，创建事件函数：

| 项目     | 值                                                                |
| -------- | ----------------------------------------------------------------- |
| 函数名   | `accompany-learning-backup`                                       |
| 运行时   | Node.js20或更新的受支持Node事件运行时，需支持fetch                |
| 代码     | 自动备份ZIP                                                       |
| 入口     | `index.handler`                                                   |
| 超时     | 60秒                                                              |
| 环境变量 | `C9_BACKUP_ENDPOINT`为主接口根地址；`C9_ACCESS_TOKEN`与主接口一致 |
| 网络     | 可访问主接口HTTPS入口                                             |

先手动调用确认ok，再配置定时触发器。若调度采用UTC，`0 0 18 * * *`代表UTC每天18点，即北京时间次日02:00；若控制台提供时区选项，请按所选时区检查下次触发时间，避免偏移。

备份存入同一Bucket的`backups/`。内容为任务、记录索引、评分、个人设置和资料索引；附件仍依赖原对象，不能代替整桶或跨账号备份。不要给`assets/`、`submissions/`设置误删原文件的自动过期规则。

## 排错及升级

| 现象                 | 优先检查                                                  |
| -------------------- | --------------------------------------------------------- |
| 401/403              | App访问码、电脑专用码是否混用；CORS；触发器或平台访问策略 |
| 启动失败             | ZIP根目录、Node路径、监听端口                             |
| 存储连接失败         | 执行角色、主键类型和顺序、地域、实例/Bucket名、网络       |
| 图片可见而PDF/Word慢 | 首次需下载完整文件并解析；大文件耗时不只来自服务器        |
| 点评离线             | 电脑服务、OpenClaw、独立码与心跳；不需要关闭应用等待      |
| 已部署但行为未变     | `/health`的build、实际接口地址；前端和安卓是否也更新      |

升级原实例前保存配置并备份。上传新主接口ZIP后保留原环境变量、执行角色、OSS和两张表，不新建空表覆盖已有配置。

官方参考：[自定义运行时](https://help.aliyun.com/zh/functioncompute/custom-runtime/)、[函数访问角色](https://help.aliyun.com/zh/functioncompute/grant-function-compute-permissions-to-access-other-alibaba-cloud-services)、[定时触发器](https://help.aliyun.com/zh/functioncompute/time-triggers)、[OSS创建](https://help.aliyun.com/zh/oss/user-guide/create-buckets)。界面及运行时选项可能调整，以实际控制台为准。

## 可选：应用关闭后的系统通知

参见 [系统推送配置](SYSTEM_PUSH.md)。新接口的 `/health` 中 `features.systemPush` 表示接口代码已包含推送能力，不代表平台账号已配置或设备已收到通知。
新增环境变量 `C9_PUSH_APPS` 为包名到 EMAS AppKey 的JSON映射；`C9_PUSH_JOB_TOKEN` 为独立随机触发码；`C9_PUSH_VIVO_TEST` 为未上架测试设备模式。需额外部署 `system-push-timer.zip` 每分钟触发，且配置华为、vivo厂商通道及 `mpush:Push` 权限。

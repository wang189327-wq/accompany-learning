# Accompany Learning v1.3 部署教程

华为推送已接入。发布标签 v1.3，应用显示版本 1.3，Android versionCode 8，云端 build 1。本版未修改云端接口协议。

发布包包含源码、带推送 SDK 的通用 APK、主接口函数、定时推送函数、可选备份函数和网页包。所有使用者部署自己的服务、创建自己的平台应用并填写自己的配置。通用 APK 没有预置平台密钥；要启用华为系统推送，需要完成下述本地配置并重新构建 APK。只在 App 中填写云端地址和访问码，不会自动补齐平台 SDK 参数。

## 1. 部署主接口

下载 `accompany-learning-cloud-api-v1.3.zip`，上传到阿里云函数计算，使用 Node.js 22 或更新的运行时。它包含依赖及网页静态资源，不需要在函数中重新安装依赖。HTTP 启动入口与命令按 [阿里云部署说明](DEPLOY_ALIYUN.md) 配置。

继续使用现有表与对象存储配置；完整环境变量示例在源码 `cloud/environment.example.json`。基础服务需要独立访问码、表格存储和 OSS 权限，详见项目 README。升级现有服务时备份环境变量，替换函数代码，不清空表或存储桶。

新增部署者自己的推送参数：

| 环境变量                  | 填写内容                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `C9_PUSH_APPS`            | JSON 字符串，例如 `{"app.accompany.learning":"你的数字AppKey"}`，AppKey 必须用引号包裹 |
| `C9_PUSH_JOB_TOKEN`       | 至少 32 字符的独立随机触发码，与 App 连接访问码不同                                    |
| `C9_PUSH_HUAWEI_CATEGORY` | 平台申请通过、适用于实际业务的消息分类；按平台要求填写                                 |

`C9_` 是现有接口兼容的环境变量前缀，不需要改名。函数执行角色授权 `mpush:Push`，限定到自己的应用资源，参考 `cloud/push-permissions.example.json`。函数计算使用执行角色的临时凭据；不要把 RAM AccessKey 或华为 Client Secret 放进客户端源码或 APK。

部署后 `/health` 应返回 build 1。App 与学生网页连接同一套云端数据。设备注册接口为 `POST /api/push/devices`，状态接口为 `GET /api/push/status`；两者使用 App 的访问码。设备按包名、安装标识和老师/学生身份绑定。

## 2. 部署定时推送函数

上传 `accompany-learning-push-timer-v1.3.zip` 到独立 Node.js 函数，处理入口为 `index.handler`，不需要第三方依赖。

- `C9_PUSH_ENDPOINT`：自己的主接口 HTTPS 根地址。
- `C9_PUSH_JOB_TOKEN`：与主接口相同的独立触发码。
- 设置每分钟触发一次，超时 60 秒，避免同一调度重叠。

该函数调用主接口 `/api/push/dispatch`。学生在网页提交作业后，服务器生成老师消息；定时函数筛选已绑定的老师设备，并通过 EMAS 的华为通道发送系统通知。老师不必保持 App 前台运行。发送周期通常带来最多约一分钟的调度等待；平台、网络和系统策略也会影响送达时间。

## 3. 创建对应平台应用

1. 在 EMAS 创建包名为 `app.accompany.learning` 的 Android 应用，取得此应用的 AppKey 和 SDK AppSecret。
2. 在华为开发者平台创建相同包名的应用，开通 Push Kit，登记实际 APK 签名的 SHA-256 指纹。
3. 在 EMAS 的华为通道配置该应用的 AppID、Client Secret，并按平台要求配置回执，阿里云提供的回执地址为 `https://amspush-ack.aliyuncs.com/hw/`。
4. 每个部署者使用自己的账号与应用。不要使用其他项目的包名、密钥或服务器地址。

EMAS SDK AppSecret 是客户端 SDK 初始化参数，配置后的自建 APK 会包含它；它与 RAM 密钥、华为 Client Secret 不同。仓库及本发布通用 APK 均不携带任何人的真实 AppSecret。部署者不要将配置后的私有 APK 或本地参数文件误上传到公开仓库。

## 4. 本地填写参数并重新构建

环境要求：Node.js 22+、JDK 21、Gradle 8.11.1、Android SDK Platform 35 和 Build Tools 35.0.0。工具可放在源码之外。不要直接用普通 `android/build-apk.ps1` 构建需要系统推送的版本；该入口不包含推送 SDK。

在源码根目录运行：

```powershell
npm ci
npm ci --prefix cloud --ignore-scripts
Copy-Item android/push/push.example.properties android/push/push.local.properties
```

在本地配置文件中填写自己的 `emasAppKey`、`emasAppSecret` 和 `huaweiAppId`。此文件已加入 Git 忽略规则。SDK 参数通过 Android 字符串资源引用，避免数字 AppKey 被错误当作整数；这不等于加密密钥。

使用自己的签名目录，包含 `accompany-release.p12`、别名 `accompanyrelease` 及仅保存在本地的 `credentials.json`（字段 `password`）。首次部署可参考普通构建脚本生成签名；后续更新必须保留同一签名。自行签名的应用不能直接覆盖不同签名的通用 APK；迁移前先备份，优先从首次安装就使用自己的构建。

```powershell
$env:JAVA_HOME = '你的JDK21目录'
$env:ACCOMPANY_SIGNING_ROOT = '自己的签名目录'
powershell -NoProfile -ExecutionPolicy Bypass -File android/build-push.ps1 `
  -GradleHome '你的Gradle8.11.1目录' `
  -SdkRoot '你的AndroidSDK目录' -Configuration Release
```

产物为 `android/release/accompany-learning-v1.3.apk` 和相邻 SHA-256 文件。脚本拒绝覆盖已有同名 APK；先将历史产物归档到其他目录。重新发布自用更新时，必要时用配置项 `pushVersionCode` 设置更大的版本码，不得降低。

维护通用公开发行时才使用 `-Distribution` 开关：该模式拒绝存在 `push.local.properties`，保留 SDK 和全部推送代码，不带个人平台参数。部署者要启用推送时应使用上面的配置构建，不带此开关。

## 5. 连接老师 Android 与学生网页

老师安装自己的配置版 APK，在 App 中填写主接口或代理网站地址及访问码，选择老师身份，然后在“我的 → 设置 → 消息通知”启用并允许系统通知。学生网页连接同一服务，选择学生身份并提交作业。服务器按老师角色发送通知，点击后打开对应作业；通知不显示作业正文和评分。

设备切换身份后更新绑定；停止推送需要联网解除绑定。系统强行停止应用、关闭通知权限、省电限制或平台参数不匹配均会影响通知。注册前的历史消息不补推；已读消息不推送；重试有去重记录，但网络结果不明确时仍可能重复。

## 6. 网页与备份包

`accompany-learning-web-v1.3.zip` 是可自行托管的静态网页包，首次连接填写自己的 HTTPS 主接口及访问码。需要 Netlify 同源代理时，在源码中填写本地 `public-config.local.json` 后执行 `npm run build:web`，上传 `cloud/public`；具体配置见 `deploy/`。公开网页包不会预置任何部署者的代理地址。

`accompany-learning-backup-v1.3.zip` 是可选自动备份函数，按原备份教程配置自己的接口和访问码。备份函数不替代定时推送函数。

下载后使用 `SHA256SUMS.txt` 核对文件。历史 v1.0、v1.1、v1.2 发布资产继续保留。

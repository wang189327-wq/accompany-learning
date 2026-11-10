# 应用关闭后的系统通知

此功能使用阿里云移动推送（EMAS），并接入华为、vivo厂商辅助通道。应用内消息保留为记录来源，系统通知只负责提醒；通知失败不影响作业提交。网页不具备这套安卓系统推送能力。

## 当前交付和验收边界

用户当前设备为 vivo X100s Pro、华为 MatePad 11.5S / HarmonyOS 4.2。尚未开通 EMAS，因此不预填任何真实推送凭据。未配置时，客户端明确显示“推送平台尚未配置”；普通 APK 构建不包含厂商 SDK，请使用下面的推送专用构建入口。真实后台、退出、锁屏送达必须在账号配置完成后实机验证。

## 1. 创建平台应用

1. 在阿里云 EMAS 创建 Android 应用。C9 包名为 `cn.c9.studyplan`，Accompany Learning 为 `app.accompany.learning`，需要各自创建应用。Accompany Learning 自用版和公开版包名相同，可以使用同一应用配置，但其他部署者必须创建自己的应用。
2. 在华为开发者平台创建对应包名应用，开通 Push Kit，配置实际签名的 SHA-256 指纹。在 EMAS 厂商通道中配置华为 AppID、Client Secret；回执地址为 `https://amspush-ack.aliyuncs.com/hw/`。
3. 在 vivo 开放平台创建对应应用并申请推送。未上架应用通常只有测试权限，需要把这台 vivo 手机的 regId 登记为测试设备。在 EMAS 配置 vivo AppID、AppSecret和回执；回执地址为 `https://amspush-ack.aliyuncs.com/vivo/`。同时申请通知通道 `c9_messages`。测试模式见云端参数 `C9_PUSH_VIVO_TEST=true`，未登记设备不能据此获得正式推送权限。
4. 不把云端 RAM AccessKey、华为 Client Secret、vivo MasterSecret 放进 APK。SDK 使用的 EMAS AppKey/AppSecret 与 vivo AppKey 是 SDK 客户端参数，不是云端 RAM 凭据；按 SDK 设计会随 APK 分发，勿将私有配置文件公开到仓库。

## 2. 构建带推送SDK的安卓APK

需要 JDK 21、Gradle 8.11.1、Android SDK Platform 35 / Build Tools 35.0.0。正常源码已经包含预生成图标。固定 SDK 为阿里云 3.10.1，华为、vivo扩展均为3.10.1，官方版本关系见文末。

1. 将 `android/push/push.example.properties` 复制为同目录的 `push.local.properties`，填写两个 EMAS 参数、华为AppID和vivo的AppID/AppKey。这个文件已加入Git忽略规则。
2. 按原构建说明准备 Node 依赖，执行 `npm ci`、`npm ci --prefix cloud --ignore-scripts`。
3. 设置 `C9_EXISTING_SIGNING_ROOT` 为原签名目录。C9需要`c9-release.p12`、别名`c9release`；Accompany Learning需要`accompany-release.p12`、别名`accompanyrelease`。密码从该目录的`credentials.json`读取，私钥不复制到源码。
4. 执行：`powershell -NoProfile -ExecutionPolicy Bypass -File android/build-push.ps1 -GradleHome "你的Gradle目录" -SdkRoot "你的AndroidSDK目录" -Configuration Release`。
5. 输出为 `android/release/study-push-release.apk` 和SHA-256文件。推送包版本码在原Manifest基础上递增；Accompany Learning两版最低为8、C9最低为2，显示版本沿用原值。已发布更高版本时可通过pushVersionCode配置继续递增。正式发布前仍需核对实际APK包名、版本、原签名和资源。`Debug`模式可以检查SDK编译，但调试签名不能覆盖已有正式应用。

## 3. 部署主接口

使用本版重新生成的主接口部署包；原有表和文件继续使用。增加环境变量：

| 环境变量                                            | 用途                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `C9_PUSH_APPS`                                      | JSON字符串，例如`{"cn.c9.studyplan":"C9的EMAS-AppKey","app.accompany.learning":"Accompany的EMAS-AppKey"}`；只填写该后端允许的应用 |
| `C9_PUSH_JOB_TOKEN`                                 | 独立随机字符串，至少32字符，不与用户访问码相同                                                                                    |
| `C9_PUSH_VIVO_TEST`                                 | 未上架测试设备模式填`true`；正式权限按平台要求配置                                                                                |
| `C9_PUSH_HUAWEI_CATEGORY` / `C9_PUSH_VIVO_CATEGORY` | 申请通过的厂商消息分类，按平台要求设置，不冒用未经授权的分类                                                                      |

函数执行角色增加 `mpush:Push` 权限；资源为 `acs:mhub:*:你的账号ID:app/对应AppKey`，示例见 `cloud/push-permissions.example.json`。通过函数计算传入的临时角色凭据调用推送接口。非函数计算环境可以配置`C9_PUSH_ACCESS_KEY_ID`、`C9_PUSH_ACCESS_KEY_SECRET`及可选`C9_PUSH_SECURITY_TOKEN`，使用只允许推送的独立RAM身份，不在客户端填写。

新增接口：用户访问码保护的`GET /api/push/status`、`POST /api/push/devices`；独立触发码保护的`POST /api/push/dispatch`。设备按安装ID、包名和当前身份绑定，身份变化后不再向该设备发送旧身份的新通知。关闭推送需要联网提交解除绑定；系统通知权限可以直接在系统设置关闭。

## 4. 配置定时触发

部署包`system-push-timer.zip`可直接上传为Node.js函数，处理入口`index.handler`，不需要第三方依赖。环境变量：`C9_PUSH_ENDPOINT`填主接口HTTPS根地址，`C9_PUSH_JOB_TOKEN`填主接口对应独立触发码。可运行`scripts/copy-push-token.ps1`一次生成独立触发码并复制到剪贴板，同一值填入两个函数。配置每分钟触发一次，超时60秒，避免并发触发。应用关闭后由这个函数生成到期提醒并发送通知；通知延迟通常包含最多一个调度周期，不能表述为实时长连接聊天服务。

注册设备前的历史消息不补推；已读消息不推送。通知默认只显示消息标题和“你有一条新的作业消息，点击查看”，不在锁屏暴露作业正文或评分。每设备每消息有发送凭据与重试等待；网络结果不明确时可能重复，稳定通知标识用于替换相同通知，不承诺分布式严格一次送达。发送凭据占用记录表存储，需按实际消息量维护。

## 5. 两台设备实机验收

安装推送正式包，进入“我的→设置→消息通知”启用并允许系统通知。首次登记需联网。在“消息通知→设备／系统设置→复制推送设备信息”取得vivo regId，粘贴到vivo平台的测试设备列表，勿发送到聊天。随后测试老师发布/修改作业、学生提交、设置临近截止提醒。分别验证前台、退到桌面、正常关闭进程、锁屏；点击通知应打开对应作业，且不绕过学生端删除可见性。切换角色后验证旧身份停止收到新通知。同角色多设备独立接收。

系统强行停止、关闭通知权限、省电策略、厂商测试设备权限未批准或网络断开可能阻止通知。开通平台配置前不应宣称QQ式离线推送已验收。SDK 注册成功和云端返回 MessageId 也不等于设备真实显示成功。

官方资料：

- https://help.aliyun.com/zh/document_detail/434660.html
- https://help.aliyun.com/zh/document_detail/434659.html
- https://help.aliyun.com/zh/document_detail/434678.html
- https://help.aliyun.com/zh/document_detail/434679.html
- https://help.aliyun.com/zh/document_detail/2860774.html

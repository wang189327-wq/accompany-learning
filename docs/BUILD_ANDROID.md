# Windows构建安卓APK

华为推送构建请优先按 [v1.3 部署教程](DEPLOY_V1_3.md) 使用 `android/build-push.ps1`。本页普通构建入口用于不包含推送 SDK 的客户端。

需要Node.js22+、PowerShell及官方Android构建工具和JDK。此项目沿用原生Java+WebView构建脚本，无需把私钥上传到GitHub。

1. 在仓库根目录安装依赖：`npm ci`和`npm ci --prefix cloud --ignore-scripts`。
2. 需要预设接口/更新源时，填写被忽略的`public-config.local.json`；不预设接口时，用户首次在App连接设置输入自己的接口。
3. 执行`powershell -NoProfile -ExecutionPolicy Bypass -File android/setup-tools.ps1`。脚本从Google和Microsoft官方地址下载并校验工具，放在被忽略的`android/tools/`，不修改系统PATH。下载失败时按具体错误检查网络和官方下载地址。
4. 执行`powershell -NoProfile -ExecutionPolicy Bypass -File android/build-apk.ps1`。

输出为`android/release/accompany-learning-v1.3.apk`及SHA256.txt。构建时会先生成云端网页和PublicConfig.java，后者包含公开的地址配置，不包含访问码。

## 签名

首次构建且未指定签名时，脚本在被忽略的`android/signing/`生成自己的PKCS12和随机密码文件。请离线备份两者；不要推送、上传到Issue或加入部署ZIP。

已有App要覆盖安装，应指定原签名目录，例如PowerShell：

```powershell
$env:C9_EXISTING_SIGNING_ROOT='E:\my-private-signing'
powershell -NoProfile -ExecutionPolicy Bypass -File android/build-apk.ps1
```

目录中需要脚本约定的`accompany-release.p12`、`credentials.json`及`accompanyrelease`别名。保留这些内部名称是兼容选择。仓库不提供作者原私钥，其他人无法用新签名更新作者已安装的APK。

可用`C9_BUILD_TOOLS_ROOT`指定自己的工具根目录，该目录包含jdk、build-tools、platform三个子目录。不要将特定电脑路径写入源码。

## 自行派生应用

当前包名为`app.accompany.learning`及对应provider/Java路径，显示名已改为“Accompany Learning”。若需要与其他派生版本同时安装，应同步修改manifest、Java包名和provider authority，并重跑测试；不要只改一个包名字符串。

最低安卓8（API26），目标API35。可在支持APK的设备上测试；不同HarmonyOS/设备环境需要实机确认。APK构建成功不等于所有系统安装、相册和桌面组件均已验收。

## 检查

运行`npm test`和构建后的`npm run test:apk`。检查安装包应用名、版本、原签名、全部资源，然后在自己的手机和平板分别测试首次连接、提交、图片保存、文件预览、小组件和横竖屏。

公开仓库CI执行源码检查；本版本不在CI中接触作者签名或自动发布安卓更新。

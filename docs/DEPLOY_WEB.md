# 网页部署与安卓更新

## Netlify网页

先按[阿里云教程](DEPLOY_ALIYUN.md)完成自己的主接口。然后复制`public-config.example.json`为`public-config.local.json`，填写：

```json
{
  "apiEndpoint": "https://api.example.com",
  "updateManifestUrl": "https://study.example.com/updates/latest.json"
}
```

将示例替换为自己真实的接口和网站。更新源可留空；这个配置文件被Git忽略。也可通过环境变量`C9_API_ENDPOINT`、`C9_UPDATE_MANIFEST_URL`配置，环境变量优先。

执行：

```sh
npm run build:web
```

登录自己的Netlify账号，新建站点或打开自己的站点，在Deploys手动上传生成的`cloud/public/`目录。生成的`_redirects`把`/api/*`和`/health`代理到自己的FC；浏览器连接默认使用网页同源地址，访问码仍由用户输入。`_headers`设置不缓存及基本浏览器策略。

也可关联GitHub仓库：构建命令`npm ci && npm ci --prefix cloud --ignore-scripts && npm run build:web`，发布目录`cloud/public`。在Netlify构建环境设置`C9_API_ENDPOINT`；它是接口地址，不是访问码。不要把访问码设成前端构建变量。

发布后确认根地址显示“Accompany Learning”，`/health`代理正常。两台设备使用同一网站和访问码即可同步。仅上传源码中的index.html会缺脚本，必须上传构建后的完整目录。

## 其他静态托管

本项目需要后端，GitHub源码公开或GitHub Pages本身不会创建阿里云接口。其他静态托管需自行处理API同源代理或CORS，不可直接照搬Netlify的`_redirects`语法。

## 安卓App内更新

1. 使用自己的签名构建APK；构建前配置`updateManifestUrl`。未配置时“检查更新”会提示未配置，不连接作者站点。
2. 更新清单和APK必须HTTPS同主机、默认端口，无凭据/查询/片段。APK路径为`/updates/accompany-learning-v版本号.apk`；不接受跳转到第三方下载源。
3. 每次实际升级提高`android/AndroidManifest.xml`中的versionCode，保持原包名和签名；versionName为显示号。当前公开源码为1.0、版本码1，后续升级应递增版本码。
4. 构建后生成更新文件，例如：

```sh
node scripts/make-update.cjs android/release/accompany-learning-v1.0.apk https://study.example.com 1.0 1
```

此命令按实际APK计算大小和SHA-256，写入`cloud/public/updates/latest.json`及对应APK。命令参数必须与APK的实际版本一致；安装前原生端还会再次检查。

5. 将更新文件连同网页目录重新部署。手机“我的 → 设置 → 检查更新”下载后，经用户点击由安卓系统安装。

先运行`npm run build:web`，再运行make-update；重复从干净目录构建网页时应重新放入更新文件。`npm run package:cloud`不会自动向Netlify或GitHub发布。

GitHub Releases可以分发APK供手动下载，但其附件地址会发生跳转，不符合当前App内固定同源下载策略。要使用App内更新，请按本节使用自己的静态HTTPS更新站点。

## 验收

- 检查latest.json的版本、内部号、大小及SHA-256。
- 下载远端APK计算哈希，与本地一致。
- 旧包和新包必须同签名；不同人自行编译的签名不能互相覆盖。
- 手机及平板分别实测安装和数据保留，网页验证不能替代系统安装验证。

官方参考：[Netlify重定向与代理](https://docs.netlify.com/routing/redirects/)、[部署方式](https://docs.netlify.com/site-deploys/create-deploys/)。

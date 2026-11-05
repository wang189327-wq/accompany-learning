# 可选：电脑OpenClaw作业点评

不配置AI时，任务、评分、资料和成绩功能仍正常；点击点评会提示电脑服务未在线。此方案需要自己的电脑、已配置并可处理图片的OpenClaw模型、以及与主函数一致的电脑专用码。模型费用及可用性由自己的服务提供方决定。

## 初始化

1. 按OpenClaw自己的安装文档配置网关和模型，先在其聊天界面发送一份合成作业图片，确认可以识别并回复。
2. 在仓库根目录运行：

```sh
node desktop-review/init-private.cjs https://api.example.com
```

替换为自己的HTTPS接口根地址。脚本在当前用户目录`.c9-study-plan/review-worker.json`生成独立随机workerToken，不放入仓库。若配置已存在会保留，不覆盖旧账号信息。

3. Windows运行`desktop-review/复制电脑专用访问码.ps1`，将剪贴板值粘贴到主函数环境变量`C9_AI_WORKER_TOKEN`，保留原`C9_ACCESS_TOKEN`不变，然后重新部署配置。不要把该值发到Issue、聊天或App访问码栏。
4. 确认配置文件中`gateway`为自己的本机OpenClaw地址（默认`http://127.0.0.1:18789`），`agent`为已存在且支持图片的agent（默认`c9-review`，不存在则改为自己的agent ID）。
5. 如果自己已经在云端生成电脑专用码，可使用`desktop-review/configure.ps1 -Endpoint https://api.example.com`交互配置；它会写入当前用户私有文件。已有自定义配置应先备份，避免覆盖自己的gateway/agent选择。
6. 运行`node desktop-review/worker.cjs`，或Windows双击“启动点评服务.cmd”。保持电脑、网关和网络在线，不要重复启动。

## 网关认证

服务从自己的`.openclaw/openclaw.json`解析网关认证；不读取模型提供方的API Key。网关认证为普通字符串时直接使用；如使用SecretRef，应设置`OPENCLAW_ROOT`为自己的OpenClaw包安装目录，以加载该版本的SecretRef解析模块。OpenClaw内部模块路径可能随版本变化，遇到解析失败应按自己的版本核实。

也可在私有worker配置中设置`gatewayToken`；它属于敏感凭据，不应提交。网关仅允许HTTP本机回环地址，避免将本机认证发给远程服务。

## 工作方式

- 老师和学生都可以发起点评，电脑领取后显示正在点评。
- 请求发送到云端后，退出App不会取消已经被电脑领取的工作；结果成功回传后重新同步即可查看。
- 离线不排队；未领取请求会过期。模型限流、超时或保存失败会给出失败状态，成功结果按提交编号保存，避免同一提交重复调用。
- 每次补交有独立提交编号，点评对应具体一次提交，不覆盖作业和评分。
- 点评要求题目不完整时简要列出无法点评的题号，不展开猜测。
- Windows待回传内容在`%LOCALAPPDATA%/C9StudyPlan/review-outbox`，配置和服务锁在用户目录`.c9-study-plan`。这些位置不属于公开源码归档。

将真实学生作业发送到模型前，应确认双方同意相应服务的数据处理方式。自动化测试仅使用合成图片和模拟模型，不证明你的模型、套餐和网络一定可用。

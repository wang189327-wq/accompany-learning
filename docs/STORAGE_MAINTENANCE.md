# 存储维护与告警启用

当前交付默认：未完成上传分片超过3天清理；容量达到1GB（1,000,000,000字节）提醒；不限制上传数量。正常作业、历史成果、学习资料、试卷及已完成附件不设置自动到期。`uploads/`元数据和已完成但未关联的附件也不自动删除，避免误删引用。

这些是待启用配置，本地打包或更新APK不会自动改变阿里云Bucket和费用中心。费用、容量与分片清理是三个独立设置。

## 1. 更新主函数和容量读取权限

上传本版主接口ZIP，保留原环境变量、函数角色和两张表。将角色的原权限保留，并增加Bucket级只读权限：

```json
{"Effect":"Allow","Action":["oss:GetBucketStat"],"Resource":["acs:oss:*:*:自己的Bucket名"]}
```

函数环境变量`C9_STORAGE_WARN_GB=1`，可以改成其他正数。客户端“我的”设置下方会在进入页面时检查容量，达到阈值显示提醒，不阻断上传。后端缓存10分钟，OSS统计自身也不是实时，可能延迟超过一小时；界面展示统计时间。读取失败明确显示不可用，不显示为0。此数据不是账单，不用于推算精确费用。

接口`GET /api/storage/status`需要原访问码和老师/学生角色。`/health`应显示`build:1`、`storageMonitor:true`、`explicitErrors:true`、`generatedAssets:true`；这些能力标识不代表已启用Bucket生命周期。

## 2. 配置仅清理未完成分片的生命周期

在OSS控制台打开自己的Bucket → 数据管理 → 生命周期。先查看、导出现有规则；如已有重叠的分片清理规则，应编辑/合并已有规则，不重复添加冲突规则。

分别为`assets/`和`library-files/`前缀设置“清理未完成Multipart上传/碎片”，保留3天。不要勾选当前版本对象过期、历史版本对象删除或删除标记清理。保存后再次检查前缀、3天以及动作仅为分片清理。正式已完成文件不受AbortMultipartUpload影响。

`cloud/lifecycle-example.xml`是仅包含这两个规则的示例，不能不看旧规则就整份覆盖已有Bucket策略。

### 管理员工具（可选）

主部署ZIP中带`maintenance.cjs`和`lifecycle-maintenance.cjs`。在安全管理员终端解压该ZIP，设置自己的临时STS凭据及`C9_OSS_REGION`、`C9_OSS_BUCKET`，先运行：

```sh
node maintenance.cjs
```

默认只预览并保存原始XML和拟写入XML到本地`maintenance-results/时间戳/`。临时管理员角色仅需目标Bucket的`oss:GetBucketLifecycle`和`oss:PutBucketLifecycle`；这些写权限不需要加给日常App函数。不要使用主账号长期密钥，也不要把凭据发到聊天或提交Git。

核对生成的两份XML后，在未进行其他生命周期编辑的情况下，明确执行：

```sh
node maintenance.cjs --apply
```

工具保留非本工具规则原始XML，仅更新专用分片规则；发现重叠、同名混有其他动作、无法识别XML、检查期间策略变化或写后不一致会停止/报错。应用前保存原始配置，应用后再次读取核对，不自动回滚其他并发修改。Bucket策略不提供本工具可用的原子CAS，操作期间不要同时编辑策略。

`C9_ABORT_DAYS`可调整管理员工具的天数，默认3；`C9_MAINTENANCE_BACKUP_DIR`可指定新的备份目录。只改函数环境变量不会自动修改Bucket策略。运行管理员工具和在控制台设置二选一即可。

## 3. 配置费用告警

在阿里云“费用与成本/费用中心”找到预算管理或费用预警，创建自己的月度预算，范围包含OSS、函数计算和Tablestore；金额由实际账单及个人预算决定。设置实际支出达到80%和100%的告警，选择并验证自己的短信/邮件联系人；如有资源包，再设置余量预警。

容量1GB提醒不等于费用上限：请求数、流量、函数调用、表存储等另行计费。软件不读账号账单、不假装已开通费用告警。启用后检查控制台告警状态和通知联系人。

官方依据：[GetBucketStat](https://help.aliyun.com/en/oss/developer-reference/getbucketstat)、[生命周期](https://www.alibabacloud.com/help/en/oss/developer-reference/manage-lifecycle-rules-3)、[费用告警](https://www.alibabacloud.com/help/en/user-center/cost-alert)。

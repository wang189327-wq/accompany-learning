# 作业与任务分层 Implementation Plan

**Goal:** 在保留既有功能和数据的基础上交付4.0，新增任务分组与可搜索关联。

**Architecture:** 保留既有作业task ID、轮次与提交协议，新增独立任务集合（record命名空间存储）及可空assignmentGroupId。共享模型与选择器负责校验和关键词匹配；本地、云端、备份和安卓使用同一数据语义。

**Tech Stack:** 现有JavaScript、Node.js、IndexedDB、Tablestore、安卓Java；不引入新框架。

**Spec:** ../specs/2026-11-06-assignment-groups-v4-design.md

## Global Constraints

- 既有数据不自动关联任务；已有字段缺省保留，显式null才解除关联。
- 不改变角色、成果、评分、AI、周期及默认打卡规则；内部轮次保留，界面隐藏编码。
- 公开源码与自用配置分离；不部署现用阿里云或Netlify，不删除旧交付。
- 4.0使用递增内部编号和原签名；两个U盘目录与GitHub源码校验一致。

## Review Focus

- 旧客户端保存不能丢关联；未知任务ID不可保存；同名靠ID区别。
- 旧备份、增量快照和离线缓存继续可用，新任务不可进入作业打卡遍历。
- 输入关键词不等于已选任务；候选可点选、键盘操作、可重置。
- 长名称、大字号和手机/平板竖屏筛选不挤压已有输入框。
- 隐藏轮次后仍可区分历史未完成周期，评分与补交记录不丢失。

## Tasks

- [x] 共享assignment-groups.js：validate/filter/resolve/关联校验；cloud/assignment-groups.cjs：record集合CAS；接入快照、备份、写入接口；测试旧客户端、并发及非法关联。
- [x] 新增可搜索任务选择器和发布任务表单；本地preferences持久化及云端适配；作业发布/修改和作业档案筛选；测试选择、交集和清空。
- [x] 用户可见原任务文案改作业，隐藏轮次编码保留日期；更新小组件与双端角色流程；回归旧业务测试并新增4.0页面检查。
- [x] 同步构建脚本/版本/部署说明，构建公开版和自用版，格式、完整测试、浏览器、资源及公开扫描；独立审阅关键兼容路径。
- [x] 发布GitHub，校验远端提交；分别更新GitHub源码副本和自用4.0完整交付，保存报告、原签名核对及SHA-256清单。

Each task cycle: first add behavior assertions, confirm failure, implement the boundary, rerun focused and full regression, commit verified changes. Physical-device installation remains distinct from local browser/bridge checks.

# 名称与源码对应

| 位置或标识               | 名称                                   | 作用                               |
| ------------------------ | -------------------------------------- | ---------------------------------- |
| 软件显示名               | Accompany Learning                     | 公开软件名称                       |
| GitHub仓库及本地工程目录 | accompany-learning                     | 同一个公开工程，由Git提交对应      |
| 自用交付                 | C9学习计划                             | 由公开工程派生，使用自己的地址配置 |
| 安卓包名                 | app.accompany.learning                 | 保留以兼容既有应用和数据           |
| 更新文件名前缀           | accompany-learning-v / c9-study-plan-v | 保留以兼容对应更新客户端           |

显示名称和仓库名称不需要相同。`project-info.json`记录对应关系；保留的内部标识不是另一套业务代码。

## 一份源码，两种交付

公开工程是维护入口。修改、测试并提交后，再生成自用源码，不分别维护两套业务逻辑：

```sh
node scripts/derive-personal.cjs ../personal-build /path/to/own-config.json
```

配置格式与`public-config.example.json`一致，只包含自己的HTTPS接口及更新地址，不包含访问码。新目录必须不存在；工具不会覆盖旧交付。构建自用版本时仍须安装其依赖，并通过环境变量指定自己保管的原签名和构建工具。

派生目录的`personal-origin.json`记录上游提交和派生源码哈希。安卓构建完成后自动生成`verification-results/build-identity.json`，记录对应提交、版本、实际APK哈希和构建时间。不能把这些本机构建记录称为实机验收。

## U盘建议布局

```text
项目归档/
├─ 开源工程/accompany-learning/  # GitHub对应源码与公开交付
├─ C9学习计划/                   # 自用交付、历史版本、原签名与工具
└─ 00-目录入口.html              # 使用相对路径的本地索引
```

目录入口需要在目录改名后检查链接。历史发布记录保留原文；当前路径以最新入口为准。公开工程中的`delivery/`、依赖、构建产物和签名目录均不提交GitHub。

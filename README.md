# Personal DSH Plugins

个人 DSH 插件集合，也是这些插件的开发与更新仓库。仓库只保存源码、构建产物与测试；实际运行时由 DSH 从当前 profile 的默认插件目录加载，因此这里不记录本机路径、端口、账号或其它环境数据。

| 插件 | 作用 | 说明 |
|:--|:--|:--|
| [dsh-token-usage](dsh-token-usage/README.md) | 按会话 / 项目汇总 token 用量，含趋势图 | 零模型调用，只读本机 `~/.dsh` 日志，仅回环地址可访问 |
| [conversation-notebook](conversation-notebook/README.md) | 每个对话一份右侧栏记事本，手动编辑、输入即保存 | 不读对话正文、不调用模型；存本机浏览器 localStorage |

每个插件目录都是独立的 Node 包，可单独复制、安装或发布，互不依赖。

## 开发与测试

需要 Node.js 24+（DSH 桌面版自带运行时）。两个插件都没有 npm 依赖。

```powershell
# dsh-token-usage：无构建步骤
cd dsh-token-usage
node --test *.test.mjs

# conversation-notebook：改 src/ 后必须重新生成 dist/
cd conversation-notebook
node build.mjs
node --test tests/*.test.mjs
```

## 部署到 DSH

`scripts/deploy.mjs` 会把两个插件复制到当前 profile 的默认插件目录 `<profile>/created-plugins`。它从环境变量 `DSH_PROFILE_DIR` 读取 profile 目录，不写死任何本机路径；找不到该变量时会直接报错退出。请在 DSH 会话的 shell 中运行（该变量由 DSH 注入）。

```powershell
node scripts/deploy.mjs
```

首次启用（每台机器、每个 profile 只需一次）：

1. **conversation-notebook**：在 DSH 的「插件」页用「添加插件」选择部署后的目录 `created-plugins/e1727a2d-8dfb-4483-8fd4-2a5078b2229e`。之后的更新只需再次运行部署脚本，再刷新页面。
2. **dsh-token-usage**：在 profile 的 `cordis.patch.yml` 末尾 `insert` 一条指向部署目录的 file URL 条目，然后重启 DSH：

   ```yaml
   - insert:
       - id: token-usage
         name: file:///<profile>/created-plugins/dsh-token-usage/index.mjs
   ```

   之后的更新只需运行部署脚本，再重启 DSH。

更新流程：在仓库改代码 → 跑测试 → `node scripts/deploy.mjs` → 按插件说明刷新页面或重启 DSH。

## 安全说明

- 仓库不包含密钥、令牌、账号、邮箱或本机绝对路径；插件配置只从运行环境读取。
- `dsh-token-usage` 只读取本机 DSH 数据目录，页面与 API 仅允许回环地址且拒绝跨源请求，没有写入接口。
- `conversation-notebook` 只使用当前浏览器的 localStorage，不读取对话正文、不上传数据。
- 提交前可用 `git grep` 自查绝对路径、端口、密钥等痕迹；本仓库的 `.gitignore` 已排除 `node_modules/`、`verification/`、`*.log` 与环境文件。

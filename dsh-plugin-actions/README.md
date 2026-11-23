# Plugin actions

在 DeepSeek Harness 的 **插件 / Plugins** 管理器里，为每个插件的详情页加一个 **打开所在文件夹 / Open containing folder** 动作，直接在系统文件管理器里定位该插件的安装目录。

## 为什么需要

DSH 的插件页只为每个插件提供开关和卸载。装的是本地目录或 link 时，想知道文件到底在哪儿，只能自己翻 `<profile>/node_modules`。这个插件在插件详情页的动作区加一个按钮，点一下就在系统文件管理器里打开该插件的安装目录。

## 行为

- 位置：插件详情页标题下方动作区（`plugins.detail.actions`），在页面自己的开关和卸载之前。
- 解析：Host 以 profile 的 `package.json` 为锚点解析 `<包名>/package.json`，取它所在目录；link 安装会跟随到真实目录。
- 打开：Windows 用 `explorer.exe`，macOS 用 `open`，Linux 用 `xdg-open`；参数直接传给可执行文件，不经过 shell。
- 失败：内置插件（装在 `app.asar` 里）或无法解析的包，按钮下方给出说明，不会打开空路径。
- 请求体上限 8 KiB；只接受合法包名，非法请求返回 400/413/404，不会把用户输入拼进路径。
- 边界：不调用模型、不读对话内容、不上传数据；只按包名打开本机目录。

## 安装

按目录安装：

```sh
dsh plugin --profile <profile> add ./Personal_DSH_Plugins/dsh-plugin-actions
```

或在 **插件 → 添加插件** 里选中 `dsh-plugin-actions/` 目录，或添加本仓库的插件索引后在「发现」页安装。安装后打开任意插件的详情页，应能看到「打开所在文件夹」。

当前版本 `1.0.1`，各版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

```powershell
node --test dsh-plugin-actions/tests/*.test.mjs
```

## 已知限制

- 只覆盖插件详情页；插件列表卡片上没有按钮，因为 DSH 的插件页目前只声明了详情页动作槽位（`plugins.detail.actions`），没有卡片级槽位。
- 内置插件位于 `app.asar`，文件管理器无法打开归档内路径，因此不提供该动作。

## 许可

[MIT](../LICENSE)。图标为本仓库原创 SVG。

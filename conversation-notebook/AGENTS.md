# AGENTS.md — conversation-notebook

给后续维护此插件的智能体看的操作手册，动手前先读完。

## 1. 功能和数据边界

- DSH 右侧栏「对话记事本」：每个对话一份独立纯文本笔记，只由用户手动维护。
- 不读对话正文、不调用模型、不注入上下文、不提供代理读写工具。
- Host 通过 `ctx.connection.fetch.register` 提供已认证、owner-only 的 `/api/conversation-notebook/{read,write,import}` POST 路由。不能替换成绕过 Connection 的公开 webServer 路由。
- 磁盘数据默认 `~/.dsh/conversation-notebook/`；Host 的 `DSH_HOME` 可改变根目录。数据不能放入会被部署覆盖的插件目录，也不随归档/卸载/关闭标签删除。
- 无第三方依赖；Client 只使用宿主 React 和普通 Fetch。Desktop 的 `dsh-app://app/api/...` 会转发给已认证 Host。

## 2. 文件地图

- `src/client.js`：槽位、主题样式、中英文文案、迁移协调、注册与清理。
- `src/notes-store.js`：异步草稿/保存/重试/冲突状态机、旧浏览器命名空间扫描。
- `src/host.js`：Connection 路由、输入与请求体限制、数据目录。
- `src/disk-store.js`：真实 JSON 文件、临时写入/同步/重命名、版本检查、跨进程文件锁和旧值备份。
- `build.mjs`：将状态机内联进 `dist/client.js`；复制 Host 和磁盘模块至 `dist/`。源码变更必须重建。
- `tests/*.test.mjs`：状态机、迁移、磁盘失败路径与并发、Host 路由、清理和独立打包。
- `locale/{zh,en}.json`：插件页面的标题与描述。

## 3. 部署和生效

- 开发源不等于运行目录。当前插件目标为 `<DSH_PROFILE_DIR>/created-plugins/e1727a2d-8dfb-4483-8fd4-2a5078b2229e`。
- 仓库根 `scripts/deploy.mjs` 支持批量部署，但只改本插件时应使用 `--only conversation-notebook`，勿覆盖无关插件。
- `package.json` 的 `link:` 指向部署目录。仅 Client 变更可刷新页面；Host 变更需重启 DSH。不能承诺未重启的进程已经使用新版后端。
- 更新时保留磁盘数据目录。复制插件目录不包含笔记备份。

## 4. 槽位契约

- 仍使用 `sidebarRightTabs.register` 的独立 kind、guide 入口与 keyed 槽位 `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`，key 等于 tab 类型 ID。
- 槽位注册指定 `locale: NS`；组件保留 `props.t ?? boundT` 兜底。
- 只用宿主主题令牌；勿给容器加比侧栏更亮的 `bg-layer-1`。
- 卸载先摘 beforeunload，再按 kind 精确关闭本插件所有标签（单个失败不能中断），最后摘槽位、tab 类型、locale、store。已有保存请求继续完成。

## 5. 不能破坏的数据行为

- 读取期间/读取失败/重试期间禁止输入；绝不能把未知笔记当作空白覆盖。
- 保存状态只有在后端完成持久化后才显示已保存；失败保留最新草稿，提供显式重试。
- 空文本为有效的已有记录，带修订号；显示 empty，不能用无文件语义替代。
- 重试先进入 retrying，重复点击共用 pending promise。连续输入必须串行并合并中间草稿，旧请求成功不能误标新草稿已保存。
- 写入必须带 expectedRevision，冲突保留草稿；加载新版本须用户明确确认替换草稿。
- 所有 write/import 事务都要持跨进程锁；只能回收确认已死 PID 的锁，不能仅按 mtime 强行打破活锁。损坏锁/残留 reaper 保守失败，不冒险覆盖笔记。
- 旧 key 为 `ID + ':v1:session:' + encodeURIComponent(sessionId)`。只扫描本插件命名空间，不读其他键的值。迁移所有旧记录，包括归档和未打开的对话。
- 迁移成功前绝不能删除旧值；当前实现成功后也保留。已有磁盘内容不同则保留 canonical，并把旧文本原子备份到 legacy-backups。
- 单条迁移失败不应中止其他条目；该对话仍阻止编辑，其他对话可用，UI 显示全局迁移警告并允许重试。
- 单条笔记上限16MiB UTF-8，兼容旧浏览器配额；以后调整上限须考虑无损迁移和读取已有记录。

## 6. 验证

- 源码或文案变更后，运行 build 和全部 tests（使用 DSH 自带 Node/Electron Node，`ELECTRON_RUN_AS_NODE=1`）。
- 存储变更须覆盖失败不覆盖、重试、迁移冲突与跨进程CAS。
- 没有浏览器控制时不得声称真实视觉或当前浏览器旧笔记迁移已验收；构建、测试、部署与真正重启后的激活须分开说明。
- 版本在 `package.json`；改动本目录后按仓库根 `AGENTS.md` 第 8 节升版本并更新 `CHANGELOG.md`，不要沿用旧版本号发布新内容。

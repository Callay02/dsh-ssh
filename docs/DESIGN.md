# DSH SSH 插件设计

## 1. 目标

让 DeepSeek Harness 成为一个可以操作远程服务器的入口：

1. **Agent 可编程控制**：列连接、执行命令、读写远程文件。
2. **人类可交互**：多连接管理、真正的交互式终端、SFTP 文件浏览/上传/下载。
3. **不破坏 DSH 的安全模型**：浏览器请求沿用 DSH 的认证；本地文件访问受 Session 工作区约束；凭据不回传浏览器。

非目标（v1）：端口转发、跳板机、远程桌面、多用户共享连接、云端凭据托管。

## 2. 总体架构

```text
┌────────────────────────── Browser (Web / Desktop renderer) ─────────────────────────┐
│  client.js  (React + xterm.js, bundled by esbuild)                                   │
│    ┌──────────────┐   ┌────────────────┐   ┌──────────────────────────────┐          │
│    │ 连接管理 UI  │   │ 终端 (xterm)   │   │ SFTP 文件浏览器               │          │
│    └──────┬───────┘   └──────┬─────────┘   └──────────────┬───────────────┘          │
│           └────────── fetch('/api/ssh…') + Cookie ───────┘                            │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ DSH /api（浏览器签名 Cookie + Host/Origin 校验）
┌───────────────────────────────────────▼──────────────────────────────────────────────┐
│ Host 进程 (Cordis plugin)                                                             │
│  index.js ── apply(ctx)                                                               │
│    ├── SshManager (host/manager.js)                                                   │
│    │     ├── ProfileStore  $DSH_HOME/ssh/connections.json (0600)                     │
│    │     ├── ssh2.Client 连接池（每连接一个 TCP/SSH 会话）                            │
│    │     ├── exec()       channel.exec                                                │
│    │     ├── SFTP          channel.sftp（复用）                                       │
│    │     └── Terminal      channel.shell + 环形缓冲 + 等待者                          │
│    ├── registerRoutes()  /api/ssh, /api/ssh/terminal, /files, /upload, /download      │
│    └── registerTools()   ssh_list / ssh_connect / ssh_exec / ssh_files / upload / download │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ SSH2 / SFTP
                                  ┌─────▼──────┐
                                  │ Remote SSH │
                                  └────────────┘
```

### 为什么是“Host 插件 + 客户端插件”而不是独立服务

- Host 进程已经拥有 DSH 的 Cordis 生命周期、工具注册、认证后的 `/api` 通道与配置文件目录，插件可以直接复用，不需要再开端口、再做一套认证。
- 客户端把 SSH 注册成**右侧栏标签页**（`sidebarRightTabs` + `sidebar.right.pane.tab`）：右侧栏采用 push 模式，终端打开时主对话自动让出宽度但始终可见，收起侧栏也不会中断终端。
- 不引入第三方守护进程；SSH 连接归属于 DSH 进程，DSH 退出即释放。

## 3. Host 设计

### 3.1 插件入口

```js
export const name = 'ssh'
export const inject = ['tools']       // 没有工具服务则不激活
export function apply(ctx, config) {
  const manager = new SshManager(config)
  ctx.effect(() => () => manager.dispose(), 'ssh: manager')
  registerTools(ctx, manager)
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => registerRoutes(connectionCtx, manager), 'ssh: web routes')
  })
}
```

要点：

- 不 import 任何 `@deepseek-ai/*` 包。这样本地 `link:` 安装不会因为 Node 的包解析规则而找不到 DSH 内部依赖；工具定义直接使用 Cordis `ctx.tools.register()` 接受的原始结构（JSON Schema + `output.render`）。
- `connection` 服务在插件 `apply` 时可能尚未就绪（Web bundle 后加载），因此用 `ctx.inject(['connection'], …)` 延迟挂载路由。实测未延迟时路由不生效。
- 管理器与路由都绑定在插件 effect 上，HMR 卸载/重载时断开所有 SSH 连接并清理定时器。

### 3.2 连接状态机

```text
disconnected ──connect()──> connecting ──ready──> connected
      ▲                        │                     │
      │                        └──error──> error     │
      ├──────── disconnect() ────────────────────────┘
      └──────── server close / error ────────────────┘
```

- 每个 profile 对应一个 `ssh2.Client`，保存在 `states: Map<id, State>`。
- `ensureState()`：已连接直接复用；正在连接则等待同一个 Promise；否则发起新连接。
- `connect()` 幂等：并发调用共享 `state.connecting`。
- 连接断开时把所有终端标记为 exited，并唤醒所有轮询等待者。
- 用户主动断开与服务器异常断开分开记录（`manualClose`），避免把主动断开显示成错误。
- keepalive 默认 15s，握手超时默认 20s。

### 3.3 数据模型

```jsonc
// $DSH_HOME/ssh/connections.json   (mode 0600)
{
  "version": 1,
  "connections": [
    {
      "id": "uuid",
      "name": "web-1",
      "host": "10.0.0.12",
      "port": 22,
      "username": "deploy",
      "auth": "key",                    // password | key | agent
      "privateKeyPath": "~/.ssh/id_ed25519",
      "password": "…",                  // 可选；仅 password 认证
      "passphrase": "…",                // 可选；仅 key 认证
      "hostFingerprint": "ab4c…",       // TOFU 固定的 SHA256（hex）
      "defaultDir": "/var/www",
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

对外投影 `publicProfile()` 只暴露 `hasPassword` / `hasPassphrase`，从不返回 `password` / `passphrase`。

更新语义：

- `password` / `passphrase` 传非空字符串才覆盖；留空保持。
- `clearPassword` / `clearPassphrase` 显式清除。
- 修改连接相关字段会先断开现有连接（v1 的保守策略）。
- `resetHostKey` 删除固定指纹，下次连接重新 TOFU。

### 3.4 Agent 工具

| 工具 | Host 调用 | 备注 |
| --- | --- | --- |
| `ssh_list` | `manager.list()` | 名称、状态、指纹、错误 |
| `ssh_connect` | `connect()` / `disconnect()` | 预连接或释放 |
| `ssh_exec` | `manager.exec()` | 超时、`pty`、输出上限、AbortSignal |
| `ssh_files` | `manager.listRemote()` | 最多显示 200 项 |
| `ssh_upload` | `uploadFile()` / 递归 | 本地路径必须在 Session 工作区内 |
| `ssh_download` | `downloadStream()` / 递归 | 本地路径必须在 Session 工作区内 |

本地路径约束由 `sessionRoot()` + `resolveInside()` 实现：

- 根目录取 `ctx.workingDirectory.ensure(agent)`，取不到时退回 `process.cwd()`。
- 绝对路径必须落在根目录内；相对路径以根目录解析。
- 这样 Agent 不能借 SSH 插件绕过 DSH 的文件沙箱读写本机任意文件。

目录传输限制 1000 文件，跳过 `.git` / `node_modules`，对符号链接不递归（只处理目录/普通文件）。

### 3.5 HTTP API

所有路由注册在 DSH 的 `ctx.connection.fetch` 上，路径位于 `/api` 之后，因此自动继承浏览器 Cookie 认证、Host/Origin 校验和请求体上限。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/ssh?op=list` | 连接列表 |
| `POST` | `/api/ssh` | `save` / `delete` / `connect` / `disconnect` / `test` / `mkdir` / `remove` / `rename` / `terminal.*` |
| `GET` | `/api/ssh/terminal?op=poll&terminal=&cursor=&wait=` | 长轮询终端输出 |
| `GET` | `/api/ssh/metrics?connection=` | 远端 CPU / 内存 / 网络指标 |
| `GET` | `/api/ssh/files?connection=&path=` | SFTP 列目录 |
| `POST` | `/api/ssh/upload?connection=&path=` | 原始字节流上传（streaming request body） |
| `GET` | `/api/ssh/download?connection=&path=` | 流式下载，`Content-Disposition: attachment` |
| `GET` | `/api/ssh/archive?connection=&path=` | 远端文件夹 `tar.gz` 流式下载 |

约定：

- 成功 `{ ok: true, ... }`；失败 HTTP 400 + `{ ok: false, error: "..." }`。
- 名称/路径不放进 JSON 嵌套，而用 query 参数，便于浏览器直接 `fetch`/`<a download>`。
- 上传使用 `requestBody: 'streaming'`，`Readable.fromWeb(request.body)` 直接 pipe 到 SFTP 写流，不落本地临时文件。
- 下载直接返回 SFTP 读流，`content-length` 来自 `stat`。
- 文件夹打包用 `COPYFILE_DISABLE=1 tar -czf - -C <parent> -- <base>`，stdout 直接作为 HTTP 响应；路径用单引号转义，远端没有 `tar` 时在开始流式响应前返回 400。

### 3.6 交互终端协议

不使用 WebSocket，避免额外的鉴权与帧协议；用长轮询：

```text
Client                                   Host
  │  POST terminal.open  ───────────────▶ 创建 ssh2 shell channel
  │  ◀──────────── { terminalId }         建立环形缓冲
  │
  │  GET terminal?cursor=N&wait=8000 ───▶ 有数据立即返回；否则挂起最多 8s
  │  ◀──────────── { data, cursor, … }
  │  term.write(data)
  │
  │  POST terminal.input {data} ─────────▶ stream.write(data)
  │  POST terminal.resize {cols,rows} ───▶ stream.setWindow(rows, cols)
```

缓冲与游标：

- 每个终端维护 `chunks: string[]` + `start`/`end` 绝对字符偏移，最多 `maxTerminalChars`（默认 512K）。
- 客户端游标落后于 `start` 时返回 `reset: true` 和当前可见缓冲，前端 `term.reset()` 后重写，避免花屏。
- 单次响应最多 128K 字符，剩余下一轮继续。
- 终端退出后保留 10 分钟，供前端读取最后输出；连接断开时立即唤醒等待者。

并发与资源：

- 每个连接最多 `maxTerminals` 个 shell；侧栏同时只激活一个终端轮询，避免浏览器 6 连接上限。
- 隐藏的终端不轮询，Host 缓冲输出；重新激活时从旧游标继续。
- 关闭标签会 `channel.close()`；收起侧栏不会关闭终端。

### 3.7 远程指标

终端上方状态条的数据来自一条便携 shell 探针，通过现有 SSH 会话执行，不额外开放端口：

- **Linux**：`/proc/stat` 的 CPU 总/空闲 tick 做差分；`/proc/meminfo` 的 `MemTotal`/`MemAvailable` 计算占用；`/proc/net/dev` 汇总非 `lo` 网卡的 rx/tx 字节。
- **macOS**：`sysctl` 取内存总量，`vm_stat` 估算已用内存，`top`（不可用时退回 `ps`）取 CPU，`netstat -ibn` 汇总网卡计数。
- **其它 Unix**：探针可能只返回部分字段，缺失项在 UI 显示 `—`，不会阻断终端。

采样策略：

- 客户端每 2 秒请求一次，仅在连接已连接且终端可见时轮询。
- Host 缓存 900 ms 并合并并发请求；一次采样失败缓存错误值，UI 只显示 `—`/tooltip，不弹 toast。
- CPU 和网速都需要前后两次采样做差分，因此第一帧显示 `—`，第二帧开始有值。
- 指标采样不会自动建立连接；连接未建立时直接返回 `connected:false`。
- 指标只进出 UI，不写入 Session 事件，不占用模型上下文。

### 3.8 主机密钥固定（TOFU）

```js
hostHash: 'sha256',
hostVerifier(hash) {
  state.fingerprint = hash
  state.mismatch = Boolean(profile.hostFingerprint) && profile.hostFingerprint !== hash
  return !state.mismatch
}
```

- 首次连接成功写入 `hostFingerprint`（hex，UI 显示为 SHA256）。
- 后续不一致 → `hostVerifier` 返回 false → 连接失败；错误信息提示在编辑连接里重置。
- 这能防御 DNS 劫持/中间人替换主机密钥，但首次连接仍需用户判断指纹。

## 4. Client 设计

### 4.1 加载与渲染

- `package.json` 的 `dsh.client` 声明 `platform: web`、`immediately: true`，并依赖 `@deepseek-ai/dsh-client-ui-layout`、`@deepseek-ai/dsh-client-ui-sidebar-right` 与 `@deepseek-ai/dsh-client-locale` 的加载顺序。
- `client/build.mjs` 用 esbuild 打成 CJS，再把 `module.exports` 包进
  `window.__ModuleLoader__.load({ id, factory(require) { … } })`，与 DSH 自带客户端插件的产物格式一致。
- React 作为 external，由模块表提供；xterm 与 FitAddon 打进 bundle（由于 DSH 没有把 `@xterm/xterm` 暴露到模块表）。
- 样式在 `apply(ctx)` 中用 `ctx.effect` 插入 `<style>`，卸载时移除；xterm 的 CSS 也在同一份文本里。

### 4.2 槽位选择：右侧栏标签页

客户端使用 DSH 右侧栏的公开扩展点：

1. `ctx.sidebarRightTabs.register({ id, kind: 'ssh', multiple: false, keepMounted: true, title, guide })`
   —— 注册一个页面型标签。`guide` 让右侧栏的 **+** 菜单出现“SSH 终端”卡片，和内置的“工作区文件 / 终端 / 浏览器”并列。
2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, SshTabBody)`
   —— 标签正文：连接选择、终端、SFTP。
3. `shell.overlay` 中的 `ssh-launcher` 悬浮按钮 —— 首次入口。它读取 `ctx.sidebarRight.mounted`，没有会话时隐藏；SSH 标签一旦挂载就自动隐藏，避免遮住终端底栏。

右侧栏的 push 模式会把主对话列压缩到左侧，而不是覆盖它，因此“终端在右、对话在左”是原生布局，不需要在插件里重写聊天 UI，也不需要 iframe。

`keepMounted: true` 让标签在切换、收起侧栏、切换会话时保持挂载，xterm 实例、标签页、文件路径都不丢。标签的 `tab.visible` 为 false 时暂停终端轮询，Host 端的环形缓冲继续积累；展开后从旧游标继续读取。刷新页面后通过 `terminal.list` 只恢复仍然存活的 Host 终端（已退出的尾部不恢复）。显式关闭标签会调用 `closeTerminal` 释放它的 shell。

### 4.3 状态与交互

- 连接列表每 10 秒刷新一次，获取 Agent/其它窗口造成的状态变化；当前连接 ID 存在 `localStorage`（`dsh.ssh.activeConnection`）。
- 侧栏顶部是连接下拉框和图标操作（新建、刷新、编辑、删除）；第二行显示地址、状态、连接/断开、终端和文件入口。
- 连接编辑表单支持测试连接；编辑时密码/口令留空表示保持原值，可勾选清除；删除连接前弹出确认。
- 文件页在侧栏里使用 compact 布局：隐藏“修改时间”列、缩小操作列，上传/新建目录改为图标按钮，仍支持双击目录、路径栏、拖拽上传、下载、重命名、删除。
- 文件入口是第二行中 **+ 终端** 右侧的文件夹按钮，带“文件/ Files”文字；标签栏末尾不再重复 Files 标签。
- 目录行也有下载按钮：调用 `/api/ssh/archive` 打包当前目录为 `<name>.tar.gz`。
- 上传用 XHR 的 `upload.onprogress`，下载用 XHR 的 `onprogress` 并先收成 Blob 再保存；文件页显示文件名、百分比/已传输字节、进度条和取消按钮。文件夹归档没有 `Content-Length`，使用不确定进度动画。
- 终端标签页 + `+` 新建；关闭标签会结束远程 shell；退出后显示“重新打开”。文件入口只保留在第二行的文件夹图标，标签栏末尾不再重复一个 Files 标签。
- 终端上方状态条显示连接状态、↓/↑ 网速、CPU 和内存百分比；数据每 2 秒刷新，收起侧栏/切到文件页时停止轮询。
- 收窄侧栏时终端自动 resize；收起侧栏再展开，终端输出从 Host 缓冲恢复。

### 4.4 主题

所有颜色来自 `--dsw-alias-*` 令牌。xterm 主题从 `getComputedStyle(document.body)` 读取（这些令牌挂在 `body` 上，而不是 `document.documentElement`），因此在浅色主题下终端是白底黑字，深色主题自动适配。

### 4.5 语言

- 客户端 `inject` 加入 `locale`；`apply` 读取 `ctx.locale.getSnapshot().active` 并 `ctx.locale.subscribe(...)`，把语言写入插件自己的轻量 store。
- `t(en, zh)` 读取该 store；`useLocale()` 用 `useSyncExternalStore` 订阅，组件在 Settings → General 切换语言时原地重渲染，无需刷新。
- 外部语言（非 `zh`）回退英文；插件元数据继续走 `locale/en.json`、`locale/zh.json`，由 Plugin Manager 自己解析。

## 5. 生命周期

| 事件 | 行为 |
| --- | --- |
| 插件加载 | 创建 manager，注册工具；等待 `connection` 后注册路由 |
| 插件卸载 / HMR | `manager.dispose()`：关闭所有 shell、SSH 客户端、清理定时器 |
| 连接断开 | 该连接终端全部 exit，轮询返回最终状态 |
| 删除连接 | 先断开，再删除本地凭据文件条目 |
| 收起右侧栏 | 标签保持挂载；`tab.visible=false` 时暂停轮询，Host 缓冲继续 |
| 展开右侧栏 | 从旧游标继续轮询，终端恢复 |
| 关闭 SSH 标签 | 释放该标签拥有的远程 shell |
| 页面刷新 | Host 终端继续；客户端通过 `terminal.list` 只恢复仍存活的终端 |
| Host 重启 | 连接与终端全部丢失，客户端显示空状态 |

## 6. 安全取舍

| 决策 | 原因 | 代价 |
| --- | --- | --- |
| 凭据存本地 JSON 0600 | 无需引入系统钥匙串依赖，跨平台 | 明文密码风险；文档建议用 key/agent |
| TOFU 而非 known_hosts 文件 | 与插件自包含数据模型一致 | 首次连接无第三方校验 |
| `/api` 认证复用浏览器 Cookie | 不开新端口、不新增认证 | 仅同源页面可用；API 客户端需要 DSH Cookie |
| 长轮询而非 WebSocket | 避免重复实现鉴权/帧协议 | 延迟略高，不能承载高帧率程序 |
| Agent 本地路径限制在工作区 | 不绕过 DSH 沙箱 | 不能直接上传工作区外文件 |
| 远程路径不限制 | 远程本来就是一个完整 Shell | 需要用户只配置可信服务器 |

## 7. 验证情况

本机 macOS 已执行：

1. **Host 管理器集成测试**（真实本地 sshd，`127.0.0.1:2222`）：连接、TOFU、exec stdout/stderr/exit code/timeout、终端 open/write/poll、SFTP list/mkdir/upload/download/stat/remove、testProfile、disconnect，全部通过。
2. **HTTP 路由测试**（mock route registry）：七个路由、JSON 操作、终端轮询、原始流上传、流式下载、文件夹打包、指标与错误响应，全部通过。
3. **浏览器端到端**（Playwright + 已登录 Cookie）：在真实页面中点击浮动按钮打开右侧栏 SSH、连接本地测试服务器、打开终端输入命令、收起/展开侧栏后输出仍在、切换文件页、上传与下载、编辑连接、删除测试连接；主对话在左侧全程可见；无 console error。
4. **侧栏指南**：右侧栏 **+** 菜单中确认出现“SSH 终端”卡片，点击后正确打开 SSH 标签。
5. **Agent 工具端到端**：在本次会话中实际调用 `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_files` / `ssh_download` / `ssh_connect`，完成命令执行与文件往返（字节一致）。
6. **远程指标**：解析器覆盖 Linux/macOS 样本与 CPU/网速差分；真实 macOS sshd 上验证 `platform`、内存、CPU 与网速字段。
7. **文件夹打包**：HTTP 路由测试生成带空格路径的目录并解压 `.tar.gz`；UI 测试点击目录下载并确认 gzip 头与成员。
8. **传输进度**：UI 测试用 XHR 完成上传/下载与归档下载，确认文件落盘与下载事件。
9. **语言切换**：客户端测试注入 en → zh 的 locale 变更，验证 Launcher 文案原地从英文切到中文。
10. **客户端 bundle 服务**：从桌面实例 boot graph 中确认 `@local/dsh-ssh` 条目存在，combo 资源 200、约 535 KiB，loader id 正确。

未自动化验证：深色主题、Windows/Linux、跳板机、超大文件（>2 GiB）、断网重连矩阵、多窗口同时操作同一终端。

> UI 测试只创建/删除名为 `verify-local` 的临时连接，指向本机临时 sshd。连接存储的写操作会先重新读取磁盘文件，避免并行窗口或 HMR 的旧内存快照覆盖其它连接。

## 8. 后续工作

- 用 WebSocket/双工流替换长轮询，降低输入延迟。
- 凭据接入系统钥匙串（macOS Keychain / Windows Credential Manager / libsecret）。
- 支持 ProxyJump、端口转发、SFTP 目录直传与断点续传。
- 远程文件编辑器（读取/保存小文件）。
- 连接分组、标签、只读连接、命令审计。
- 为终端增加可选的“Agent 也能看到终端输出”能力（需要明确的权限与日志设计）。

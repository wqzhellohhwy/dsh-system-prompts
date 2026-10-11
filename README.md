# dsh-system-prompts

> **DSH 的系统提示词管理器**：在设置面板里新增 / 编辑 / 排序 / 删除**多条** system 提示词段，保存即生效。
> 随包预置一条「用简体中文思考」——也就是 1.x 的全部功能，现在你可以改它、也可以再加别的。

<p align="center">
  <b>设置面板 →「系统提示词」→ 管理页面</b><br>
  <sub>每条提示词 = 一个独立的 system 提示词段，按顺序拼在 harness 身份之后、部署 persona 之前。</sub>
</p>

---

## 这是什么

DSH 的 system 提示词不是一份静态文件，而是**运行时按 order 拼装**的：各插件往
`ctx.systemPrompt` 注册自己的段，按顺序值升序拼接后，作为 **system 角色消息**写进会话历史。

本插件把这件事变成一个**可在界面上管理的列表**：

- 设置面板左侧多出一项「**系统提示词**」，点进去就是管理页面；
- 每条提示词有：标题（仅用于辨认）、正文、启用开关、顺序、删除；
- 支持**新增任意多条**、上下移动、批量保存；
- **保存后立即生效**——当前会话的下一轮请求就带上新内容，**不需要重启 DSH**。

### 1.x → 2.0 的变化

| | 1.x（语言钩子） | 2.0（系统提示词管理） |
|---|---|---|
| 段数 | 固定 1 段 | 任意多条，可增删 |
| 配置方式 | 改 profile 的 `cordis.patch.yml` | 设置面板里点（仍兼容旧的 config 写法） |
| 生效方式 | 改配置后**重启实例** | **保存即生效** |
| 默认行为 | 注入「用中文思考」 | 同左（预置为第一条，可改可删） |

升级到 2.0 不会改变默认行为：首次运行会把「用中文思考」那一条写进配置文件。

---

## 安装

```powershell
# 方式 A：本地目录 link（开发/改完即生效）
dsh plugin --profile web add "link:D:/dsh-plugins/dsh-system-prompts"

# 方式 B：直接从 GitHub 装
dsh plugin --profile web add "github:wqzhellohhwy/dsh-system-prompts"

# 方式 C：装了 dsh-super-injector 的环境，运行时热装配（免重启）
dev_install_package  <本仓库绝对路径>  profile=<你的 profile>
```

装完重启该入口（桌面版 = 完全退出重开；web 端 = 重启后刷新页面 Ctrl+F5），
设置面板就会出现「系统提示词」。

> 桌面版（Electron）用的是 `desktop` profile，而 `dsh plugin --profile desktop` 会被 CLI 拒绝
> （该 profile 由桌面应用专属管理），需要走桌面版自己的插件界面。

### ⚠️ 从旧名 `dsh-thinking-language` 升级

本插件原名 **`dsh-thinking-language`**，因 2.0 起已泛化为系统提示词管理器而更名。
GitHub 仓库已重命名（旧地址自动 301 跳转，老链接仍可用），**包名变了**，所以
profile 里的装配 id 与依赖名也要跟着改：

```powershell
# 1) 依赖名 + profile 的 bundles 列表：dsh-thinking-language → dsh-system-prompts
#    （改 <DSH_HOME>/profiles/<你的 profile>/package.json 的 dependencies 与 dsh.profile.bundles）
# 2) node_modules 里的 junction 重建为新名
# 3) 重启该入口
```

**不需要迁移数据**：配置文件名仍是 `<DSH_HOME>/system-prompts.json`，
默认条目 id 仍是 `thinking-language`，段名与设置页 id 也都没动——
换句话说，改名只影响「包怎么被装上」，不影响「已经配好的提示词」。

---

## 用法

1. 打开 **设置** → 左侧「**系统提示词**」；
2. 「＋ 新增提示词」加一条，填标题与正文；
3. 用卡片上的「启用 / 停用」开关控制这一条是否注入，用 ▲▼ 调顺序，用「删除」移除（两步确认）；
4. 点「**💾 保存并生效**」。状态栏显示「✅ 已保存并生效」即完成。

页面底部还会实时显示**当前组装出来的段序**（如
`harness:identity | system-prompt:xxx | deployment:persona-prefix | …`），
用来核对到底注入了什么、排在哪儿。

几个约定：

- **正文留空的条目不注册**（页面上会给黄色提示）；
- **顺序**：第 i 条的 order = 基线 + i（i 是列表下标）。默认基线 `-900`，
  即紧跟 harness 身份（`-1000`）、排在所有部署 persona（`0`）之前。
  用下标而不是"启用条目的序号"，是为了让停用某一条时后面的段不平移——提示词前缀保持稳定，
  不破坏 KV 缓存的复用位置。
- **总开关**停用后一条都不注册（依赖仍在，随时开回来）。
- **恢复默认**回到出厂状态（只留「用中文思考」那一条，两步确认）。

---

## 配置文件

运行时权威是：

```
<DSH_HOME>/system-prompts.json      # DSH_HOME 缺省 ~/.dsh
```

```json
{
  "version": 2,
  "enabled": true,
  "order": -900,
  "prompts": [
    { "id": "thinking-language", "title": "思考语言：简体中文", "text": "…", "enabled": true }
  ]
}
```

- 写入是原子的（先写 `.tmp` 再 rename），半截文件不会污染状态；
- 文件损坏时回落内置默认，**不覆盖**坏文件（保留现场）；删掉该文件即恢复出厂；
- `id` 只允许 `[A-Za-z0-9._-]`，段名是 `system-prompt:<id>`，同层重名会被 host 自动改号。

### profile 里的 config（仅首次初始化时生效）

```yaml
- id: system-prompts
  name: dsh-system-prompts
  config:
    language: ja        # 首次初始化时，预置那条换成日文
    # text: 自定义正文   # 给了就完全覆盖语言模板
    # enabled: false    # 首次初始化即为停用
```

⚠️ **已经生成过 `system-prompts.json` 的机器上，改这里没有任何效果**——那是 1.x 的写法，
2.0 只为平滑升级保留了首次初始化的兼容。之后请一律用设置面板。

---

## 它做什么 / 不做什么

**做**

- 注册 `system-prompt:<id>` 形式的 system 提示词段，内容与顺序由设置页决定；
- 保存即生效（`section()` 返回 disposer，改动时先撤销全部再按新列表重建）；
- 通过宿主 webserver 暴露 `/system-prompt/api`（设置页同源 fetch 读写）。

**不做**

- 不读取、不替换、不改写任何**别人的**段（纯追加）；
- 不碰工具面、不注册工具、不改运行时上下文；
- 不翻译代码：提示词里怎么写就怎么注入，标识符、路径、命令名保持原样。

---

## HTTP API（自检 / 脚本化用）

挂在宿主 webserver 上（桌面版即 GUI 那个端口）：

```powershell
# 读当前状态：配置 + 实际注册的段 + 组装后的段序
curl http://127.0.0.1:<port>/system-prompt/api/state

# 保存（整体替换；enabled / order / prompts）
curl -X POST http://127.0.0.1:<port>/system-prompt/api/state `
  -H "content-type: application/json" `
  -d '{"enabled":true,"order":-900,"prompts":[{"id":"demo","title":"示例","text":"Always answer briefly.","enabled":true}]}'

# 恢复默认
curl -X POST http://127.0.0.1:<port>/system-prompt/api/reset
```

`state` 返回里有两个字段专门用于**验证生效**：

- `live`：当前真正注册上的段（id / 段名 / order）；
- `sections`：`systemPrompt.assemble()` 组装出来的**完整段序**（含官方各段）。

---

## 开发与验证

`lib/index.js`（host）与 `lib/client.js`（client）都是**手写 JS，无需构建**：
client 半走的是 DSH 页面的模块协议 `window.__ModuleLoader__.load({ id, factory })`，
内部用 `React.createElement`（不依赖 JSX 转译），改完直接生效。

`scripts/render-harness.mjs` 是一个**不打开浏览器**的组件级回归脚本：mock
`window.__ModuleLoader__` / `document` / `fetch`，用 `react-test-renderer` 真跑一遍
「加载 → 渲染 → 新增 → 编辑 → 保存 → 删除 → 总开关 → 恢复默认」（36 项断言）：

```powershell
npm i --no-save react@18.3.1 react-test-renderer@18.3.1
node scripts/render-harness.mjs
```

改了 client 界面后跑一次，比盯着页面刷新快。依赖不写进 `package.json`（只在本地临时装）。

**热重载（装了 dsh-super-injector 时）**：`dev_reload_package dsh-system-prompts`
重建 host fiber 即可。注意 client 半还有一层 **pkgMeta 缓存**：
包在 client-modules 首次扫描时若没有 `dsh.client` 声明，结果会被进程级缓存，
加了声明必须「清缓存 + 重扫」才会被重新识别（`~/.dsh/super-injector/` 下的自愈日志会记录此事）。

---

## 兼容性

| 项 | 要求 |
|---|---|
| Node | `>= 22.19`（DSH 自身的要求） |
| `@deepseek-ai/dsh-system-prompt` | `>= 0.1.0-rc.6 < 2`（peer，optional） |
| `@deepseek-ai/cordis` | `>= 4.0.0-rc < 5`（peer，optional） |
| DSH 版本 | 已在 **0.2.0-rc.2** 上实测；peer 范围刻意放宽 |

---

## 常见问题

**Q：改了没反应？**
正文改完要点「💾 保存并生效」。保存成功后是**下一轮请求**生效（已经在跑的那一轮不会变）。
页面底部的段序就是当时的真实状态。

**Q：为什么 `AGENTS.md` 里写「必须用中文思考」不管用？**
`AGENTS.md` 由 `dsh-agent-instructions` 收集，落地成一条 **user 角色**的 `<system-reminder>` 快照
——它是"建议"，不是"不变量"。而"用哪种语言推理"是模型的底层行为，需要落在 **system 角色**里。
本插件的预置条目就是干这个的。

**Q：同一个 profile 装两次会怎样？**
**不要这么干。** `systemPrompt` 把段名当唯一键，同名重复注册会被直接拒绝
（`prompt section "..." is already registered`）。本插件内部对同一次保存的列表做了去重，
但两个**插件实例**各注册一份同名段仍会互相顶掉。

**Q：`order` 能排到别的段后面吗？**
能。把基线顺序改成比目标段更大的值即可（例如 `10300`）。官方段序在设置页底部可见。

**Q：会拖慢请求吗？**
每轮多几段固定文本，属于固定成本。默认位置在提示词**最前面**，前缀稳定，不破坏 KV 缓存复用。

**Q：`system-prompt:xxx` 这些段是在哪一段被消费的？**
作为 **system 角色消息**写进会话历史；DSH 也会把组装好的 system 提示词原样写进会话日志，
导出即可逐字核对。

---

## 许可证

[MIT](LICENSE) © 2026 wqzhellohhwy

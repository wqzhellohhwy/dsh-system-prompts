/**
 * dsh-system-prompts v2 — **系统提示词管理器**（host 半）。
 *
 * ## 从「语言钩子」到「系统提示词管理」
 *
 * v1 只做一件事：往 system 提示词注册**一段**写死的语言约束。v2 把这件事
 * 泛化成一个**可增删的提示词列表**：每条提示词 = 一个独立的 system 提示词段，
 * 用户可以在 DSH 设置面板里新增 / 编辑 / 排序 / 删除，保存即生效。
 *
 * v1 的语言约束没有被丢掉，而是变成**默认预置的第一条**（`thinking-language`），
 * 因此升级行为向后兼容：装回来还是「用中文思考」，只是现在可以改。
 *
 * 注：`thinking-language` 这个**默认条目 id 故意保留**——它是用户配置文件
 * `<DSH_HOME>/system-prompts.json` 里的持久键，改名会让老配置的条目错位。
 *
 * ## 为什么能"即时生效"
 *
 * `systemPrompt.section(section)` 的返回值是**精确的 cordis effect disposer**
 * （见服务契约：`section(section: PromptSection): () => void`，
 * "returns the exact Cordis effect disposer"），并会广播 `system-prompt/change`。
 * 所以每次改动只要「先把所有段 dispose 掉、再按当前列表重新注册」，
 * 下一轮模型请求就是新的提示词——**不需要重启实例**。
 *
 * 段名唯一性由我们保证：一条提示词一个段名（`system-prompt:<id>`），
 * 同一层内重名会抛错，所以 sync 必须「先清后建」串行完成。
 *
 * ## 顺序（order）语义
 *
 * 全局 `order` 是**基线**（默认 `-900`：紧跟 harness 身份 `-1000`，在所有
 * 部署 persona 之前）。第 i 条提示词注册为 `base + i`——索引取的是**列表下标**，
 * 而不是"已启用条目的序号"，这样开关某一条不会让后面的段整体平移，
 * 提示词前缀保持稳定，不破坏 KV 缓存的复用位置。
 *
 * ## 持久化
 *
 * `<DSH_HOME>/system-prompts.json`（DSH_HOME 缺省 `~/.dsh`）。原子写：
 * 先写 `.tmp` 再 rename，避免半截文件。没有配置文件时按内置默认初始化一次。
 *
 * ## HTTP API（挂在宿主 webserver 上，client 设置页同源 fetch）
 *
 *   GET  /system-prompt/api/state   读当前配置 + 实际注册的段 + 组装后的段序
 *   POST /system-prompt/api/state   保存（enabled / order / prompts）并立即重新注册
 *   POST /system-prompt/api/reset   恢复出厂默认（保留语言约束那一条）
 *
 * ## 失败模式
 *
 * - 没有 `webServer`：提示词照常注入，只是没有设置页（等它就绪再挂路由）。
 * - 没有 `systemPrompt`：cordis 的 `inject` 闸门让插件根本不激活。
 * - 单条提示词注册失败（如正文为空、id 非法同名）：只记在该条的 error 上，
 *   不影响其他条目。错误通过 API 暴露给设置页。
 *
 * @module dsh-system-prompts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

/** 插件名（与 package.json 的 name 一致）。 */
export const name = 'dsh-system-prompts'

/** 只有挂了 system 提示词注册表才可用。 */
export const inject = ['systemPrompt']

/** HTTP 路由前缀（client 设置页按同源相对路径访问）。 */
const API_PREFIX = '/system-prompt/api'

/** 配置文件基名，落在 `<DSH_HOME>/` 下。 */
const CONFIG_BASENAME = 'system-prompts.json'

/** 段名前缀：一条提示词一个段。 */
const SECTION_PREFIX = 'system-prompt:'

/** 默认基线顺序：紧跟 harness 身份（-1000），在所有部署 persona（0）之前。 */
const DEFAULT_ORDER = -900

/** 默认预置提示词的稳定 id（= v1 的语言约束，升级后仍按老样子生效）。 */
const DEFAULT_ID = 'thinking-language'

/** 默认预置提示词的标题（只影响设置页显示）。 */
const DEFAULT_TITLE = '思考语言：简体中文'

/** id 合法性：进段名，所以限制在安全字符集内。 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * 语言标识 → 给模型看的措辞。
 *
 * 只在**生成默认预置条目**时用得上（v1 兼容路径）；用户自己的提示词是自由文本。
 */
const LANGUAGE_LABELS = {
  zh: 'Simplified Chinese (简体中文)',
  'zh-cn': 'Simplified Chinese (简体中文)',
  'zh-hans': 'Simplified Chinese (简体中文)',
  'zh-sg': 'Simplified Chinese (简体中文)',
  'zh-tw': 'Traditional Chinese (繁體中文)',
  'zh-hant': 'Traditional Chinese (繁體中文)',
  'zh-hk': 'Traditional Chinese (繁體中文)',
  en: 'English',
  'en-us': 'English',
  'en-gb': 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  ru: 'Russian (Русский)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  it: 'Italian (Italiano)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिन्दी)',
}

/**
 * 由语言标识生成约束文本（v1 的原措辞，逐字保留）。
 *
 * @param language - 语言标识或自由文本（如 `zh-CN`、`日本語`）。
 * @returns 一段可直接放进 system 提示词的英文约束。
 */
function buildLanguageText(language) {
  const raw = String(language ?? '').trim() || 'zh-CN'
  const label = LANGUAGE_LABELS[raw.toLowerCase()] ?? raw

  const head = /^en\b/i.test(raw)
    ? `Write your reasoning and your answers in ${label}.`
    : `Reason and answer in ${label}. Your internal reasoning, plans, intermediate notes and user-facing prose must be written in ${label}, not English.`

  return `${head} Keep code, identifiers, file paths, command names, config keys, and verbatim command or tool output in their original form.`
}

/** DSH 家目录（与 dsh-tool-manager 等生态插件同一约定）。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 配置文件绝对路径。 */
function configPath() {
  return join(dshHome(), CONFIG_BASENAME)
}

let idSeq = 0

/** 生成一个稳定可读的条目 id。 */
function makeId() {
  idSeq += 1
  return `p-${Date.now().toString(36)}-${idSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** 内置默认配置（工厂函数，避免共享引用）。 */
function defaultConfig() {
  return {
    version: 2,
    enabled: true,
    order: DEFAULT_ORDER,
    prompts: [
      {
        id: DEFAULT_ID,
        title: DEFAULT_TITLE,
        text: buildLanguageText('zh-CN'),
        enabled: true,
      },
    ],
  }
}

/** 把任意来源的条目规整成合法形状；`id` 非法就补一个。 */
function normalizePrompt(raw, seen) {
  const src = raw && typeof raw === 'object' ? raw : {}

  let id = typeof src.id === 'string' ? src.id.trim() : ''
  if (!ID_RE.test(id) || seen.has(id)) id = makeId()
  seen.add(id)

  return {
    id,
    title: typeof src.title === 'string' ? src.title.slice(0, 200) : '',
    text: typeof src.text === 'string' ? src.text : '',
    enabled: src.enabled !== false,
  }
}

/** 把任意来源的配置规整成合法形状。 */
function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const seen = new Set()
  const prompts = Array.isArray(src.prompts) ? src.prompts.map((p) => normalizePrompt(p, seen)) : []
  const order = Number.isFinite(src.order) ? Number(src.order) : DEFAULT_ORDER

  return {
    version: 2,
    enabled: src.enabled !== false,
    order,
    prompts,
  }
}

/**
 * 读配置。
 *
 * 文件不存在（首次安装）→ 写入内置默认并返回；文件损坏 → 回落默认，
 * 且**不覆盖**磁盘上的坏文件（保留现场供排查），只是本轮内存里用默认值。
 */
function readConfig(logger, fallbackLanguage, fallbackText) {
  const path = configPath()
  try {
    if (!existsSync(path)) {
      const fresh = defaultConfig()
      if (typeof fallbackText === 'string' && fallbackText.trim() !== '') {
        fresh.prompts[0].text = fallbackText
      } else if (typeof fallbackLanguage === 'string' && fallbackLanguage.trim() !== '') {
        fresh.prompts[0].text = buildLanguageText(fallbackLanguage)
      }
      writeConfig(fresh, logger)
      return fresh
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return normalizeConfig(parsed)
  } catch (e) {
    logger?.warn?.(`[system-prompt] 读取配置失败，使用内置默认：${String(e?.message ?? e)}`)
    return defaultConfig()
  }
}

/** 原子写配置。 */
function writeConfig(cfg, logger) {
  const path = configPath()
  const tmp = `${path}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
    return true
  } catch (e) {
    logger?.warn?.(`[system-prompt] 写入配置失败：${String(e?.message ?? e)}`)
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    } catch {
      /* 尽力清理，失败不影响主流程 */
    }
    return false
  }
}

/** 读请求体（JSON）。 */
async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

/** 统一的 JSON 响应。 */
function sendJson(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/**
 * 注册插件。
 *
 * @param ctx - cordis 上下文（硬依赖 `systemPrompt`；`webServer` 与 `logger` 可选）。
 * @param config - 可选。只用于 **v1 兼容**：`text` / `language` / `enabled`
 *   会在**首次初始化配置文件**时作为默认预置条目的内容；此后一切以配置文件为准。
 */
export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const logger = ctx.get?.('logger')

  const systemPrompt = ctx.systemPrompt ?? ctx.get?.('systemPrompt')
  if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
    logger?.warn?.('[system-prompt] systemPrompt 服务不可用，插件不激活')
    return
  }

  /** 首次安装（还没有配置文件）——用于 v1 兼容的默认值。 */
  const firstRun = !existsSync(configPath())

  /** 内存里的权威配置（与磁盘同构）。 */
  let state = readConfig(logger, cfg.language, cfg.text)

  /** v1 兼容：老配置里 `enabled: false` 且是首次初始化 → 保持停用（不注册段）。 */
  if (firstRun && cfg.enabled === false) {
    state = { ...state, enabled: false }
    writeConfig(state, logger)
  }

  /**
   * 每个条目 id → { name, order, dispose, error }。
   * `dispose` 就是 `systemPrompt.section()` 返回的那个 effect disposer。
   */
  const live = new Map()

  /** 先清后建：把当前实际注册的段全部撤掉。 */
  function disposeAll() {
    for (const entry of live.values()) {
      try {
        entry.dispose()
      } catch (e) {
        logger?.warn?.(`[system-prompt] 撤销段 ${entry.name} 失败：${String(e?.message ?? e)}`)
      }
    }
    live.clear()
  }

  /**
   * 按当前配置重新注册全部段。
   *
   * 顺序值取 `base + 列表下标`（**不是**启用条目的序号）：停用某条不会让
   * 后面的段整体平移，提示词前缀保持稳定。
   */
  function sync() {
    disposeAll()
    if (!state.enabled) return

    const base = Number.isFinite(state.order) ? Number(state.order) : DEFAULT_ORDER

    state.prompts.forEach((prompt, index) => {
      if (!prompt.enabled) return
      if (String(prompt.text ?? '').trim() === '') {
        return
      }
      const sectionName = SECTION_PREFIX + prompt.id
      try {
        const dispose = systemPrompt.section({
          name: sectionName,
          order: base + index,
          text: prompt.text,
        })
        live.set(prompt.id, { name: sectionName, order: base + index, dispose, error: null })
      } catch (e) {
        live.set(prompt.id, {
          name: sectionName,
          order: base + index,
          dispose: () => {},
          error: String(e?.message ?? e),
        })
      }
    })
  }

  /** 落盘 + 立即生效。 */
  function commit(next) {
    state = normalizeConfig(next)
    const saved = writeConfig(state, logger)
    sync()
    return saved
  }

  // 初次注册（生命周期由本 fiber 决定：fiber dispose 时逐个撤销）
  sync()
  ctx.effect(() => () => disposeAll(), 'dsh-system-prompts: dispose live sections')

  /** 给设置页看的完整视图。 */
  async function stateView() {
    const liveList = []
    const errors = {}
    for (const [id, entry] of live.entries()) {
      liveList.push({ id, name: entry.name, order: entry.order })
      if (entry.error) errors[id] = entry.error
    }

    let sections = null
    try {
      const assembled = await systemPrompt.assemble()
      sections = (assembled?.sections ?? [])
        .map((s) => (typeof s?.name === 'string' ? s.name : null))
        .filter((n) => n !== null)
    } catch (e) {
      errors.__assemble = String(e?.message ?? e)
    }

    return {
      ok: true,
      enabled: state.enabled,
      order: state.order,
      prompts: state.prompts,
      live: liveList,
      errors,
      sections,
      sectionPrefix: SECTION_PREFIX,
      configPath: configPath(),
      /** 给设置页显示用的位置提示（-900 落在哪两个官方段之间）。 */
      orderHint: 'harness:identity(-1000) / deployment:persona-prefix(0)',
    }
  }

  /** HTTP 处理器。 */
  async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      const method = String(req.method ?? 'GET').toUpperCase()

      if (method === 'GET' && (path === '/' || path === '/state')) {
        return sendJson(res, 200, await stateView())
      }

      if (method === 'POST' && path === '/state') {
        const body = await readJsonBody(req)
        const next = {
          enabled: body?.enabled !== false,
          order: Number.isFinite(body?.order) ? Number(body.order) : DEFAULT_ORDER,
          prompts: Array.isArray(body?.prompts) ? body.prompts : [],
        }
        const saved = commit(next)
        const view = await stateView()
        return sendJson(res, saved ? 200 : 500, { ...view, ok: saved, saved })
      }

      if (method === 'POST' && path === '/reset') {
        const saved = commit(defaultConfig())
        const view = await stateView()
        return sendJson(res, saved ? 200 : 500, { ...view, ok: saved, saved })
      }

      return sendJson(res, 404, { ok: false, error: `not found: ${method} ${path}` })
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  }

  /**
   * 挂 HTTP 路由。
   *
   * 宿主里 `webServer` 可能比本插件晚就绪，所以先试一次，失败就轮询等待
   * （最多约 20 秒）。拿不到也不影响提示词注入本身。
   */
  let attached = false
  let timer = null

  function attach() {
    if (attached) return true
    const webServer = ctx.get?.('webServer')
    if (!webServer || typeof webServer.register !== 'function') return false
    ctx.effect(
      () => webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
      'dsh-system-prompts: http api',
    )
    attached = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    logger?.info?.(`[system-prompt] API: ${API_PREFIX} (state|reset)`)
    return true
  }

  if (!attach()) {
    let attempts = 0
    timer = setInterval(() => {
      if (attach() || ++attempts > 100) {
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
    }, 200)
    ctx.effect(() => () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }, 'dsh-system-prompts: stop webServer wait')
  }

  logger?.info?.(
    `[system-prompt] 已注册 ${live.size} 段（共 ${state.prompts.length} 条，enabled=${state.enabled}）：${[...live.values()]
      .map((e) => e.name)
      .join(', ') || '（空）'}`,
  )
}

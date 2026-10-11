import type { Context } from '@deepseek-ai/cordis'

/** 插件名。 */
export declare const name = 'dsh-system-prompts'

/** 服务闸门：只有挂了 system 提示词注册表才激活。 */
export declare const inject: ['systemPrompt']

/** 单条系统提示词。 */
export interface PromptEntry {
  /** 稳定标识；段名为 `system-prompt:<id>`。合法字符 `[A-Za-z0-9._-]`，1-64 位。 */
  id: string
  /** 标题（只用于设置页显示）。 */
  title: string
  /** 提示词正文，原样注入 system 角色。留空则不注册这一段。 */
  text: string
  /** 是否注册（默认 `true`）。 */
  enabled: boolean
}

/** 落盘到 `<DSH_HOME>/system-prompts.json` 的配置形状。 */
export interface SystemPromptsConfig {
  /** 配置版本，当前为 2。 */
  version: 2
  /** 总开关：`false` 时一条都不注册。 */
  enabled: boolean
  /** 基线顺序值；第 i 条的 order = `order + i`。默认 `-900`。 */
  order: number
  /** 提示词列表，顺序即注册顺序。 */
  prompts: PromptEntry[]
}

/**
 * 插件配置。
 *
 * v2 起**运行时权威是配置文件**（设置面板里改）；这里的字段只在
 * **首次初始化配置文件**时用作默认值，用于兼容 v1 的 profile 覆盖写法。
 */
export interface Config {
  /** 首次初始化时是否启用（`false` 则初始为停用）。 */
  enabled?: boolean
  /** 首次初始化时默认预置条目的语言（`zh-CN` / `ja` … 或自由文本）。 */
  language?: string
  /** 首次初始化时默认预置条目的正文（给了就完全覆盖语言模板）。 */
  text?: string
}

/** 注册系统提示词管理器：首次读取/初始化配置，注册全部段，并挂上 `/system-prompt/api` 路由。 */
export declare function apply(ctx: Context, config?: Config): void

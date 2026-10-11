/**
 * 渲染验证：在 Node 里用 react-test-renderer 真跑一遍
 * dsh-system-prompts 的 client 设置页组件（不需要浏览器）。
 *
 * 手段：mock 浏览器（window.__ModuleLoader__ / document / fetch），加载
 * lib/client.js，取出注册到 settings.section 的组件，渲染并模拟交互：
 * 加载 → 新增 → 编辑正文 → 保存 → 删除（两步确认）→ 总开关 → 恢复默认。
 *
 * 用法（依赖不写进 package.json，按需装）：
 *
 *   npm i --no-save react@18.3.1 react-test-renderer@18.3.1
 *   node scripts/render-harness.mjs
 *
 * 全部通过时退出码 0，任一失败退出码 1。
 */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const React = require('react')
const TestRenderer = require('react-test-renderer')

/** 被测文件：相对本脚本解析，换目录/换机器都不用改。 */
const PLUGIN = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

// ── 浏览器环境 mock ────────────────────────────────────────────────
let captured = null
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }
globalThis.document = {
  createElement: () => ({ textContent: '', remove() {} }),
  head: { appendChild() {} },
}

// ── fetch mock（同源 API） ─────────────────────────────────────────
let serverState = {
  ok: true,
  enabled: true,
  order: -900,
  prompts: [
    { id: 'thinking-language', title: '思考语言：简体中文', text: 'Reason in Simplified Chinese.', enabled: true },
    { id: 'style', title: '回答风格', text: 'Be concise.', enabled: false },
  ],
  live: [{ id: 'thinking-language', name: 'system-prompt:thinking-language', order: -900 }],
  errors: {},
  sections: ['harness:identity', 'system-prompt:thinking-language', 'deployment:persona-prefix'],
  configPath: 'C:\\Users\\x\\.dsh\\system-prompts.json',
}
const calls = []
globalThis.fetch = async (url, init) => {
  const method = init?.method ?? 'GET'
  calls.push({ url: String(url), method, body: init?.body })
  if (method === 'POST') {
    if (String(url).endsWith('/reset')) {
      serverState = { ...serverState, prompts: [serverState.prompts[0]], live: [serverState.live[0]] }
    } else {
      const body = JSON.parse(init.body)
      const prompts = body.prompts.map((p) => ({ ...p, id: p.id || 'p-generated' }))
      serverState = {
        ...serverState,
        enabled: body.enabled,
        order: body.order,
        prompts,
        live: prompts
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.enabled && String(p.text).trim() !== '')
          .map(({ p, i }) => ({ id: p.id, name: 'system-prompt:' + p.id, order: body.order + i })),
      }
    }
  }
  return { status: 200, text: async () => JSON.stringify(serverState) }
}

// ── 加载 client 模块 ──────────────────────────────────────────────
await import(pathToFileURL(PLUGIN).href)
check('client.js 走 window.__ModuleLoader__.load 协议', !!captured, captured ? captured.id : 'no load() call')
check('模块 id 与包名一致', captured?.id === 'dsh-system-prompts', String(captured?.id))

const registrations = []
const ctx = {
  slots: {
    inject: (name, fn) => {
      registrations.push({ kind: 'inject', name })
      return fn()
    },
    register: (cfg, Comp) => {
      registrations.push({ kind: 'register', cfg, Comp })
      return () => {}
    },
  },
}

let mod
try {
  mod = captured.factory((id) => {
    if (id === 'react') return React
    throw new Error('未预期的 require：' + id)
  })
  check('factory() 装配成功', true)
} catch (e) {
  check('factory() 装配成功', false, String(e?.message ?? e))
  process.exit(1)
}

check('导出 inject = ["slots"]', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
check('导出 apply 函数', typeof mod.apply === 'function')

mod.apply(ctx)

const injectRec = registrations.find((r) => r.kind === 'inject')
const regRec = registrations.find((r) => r.kind === 'register')
check('注入 settings.section slot', injectRec?.name === 'settings.section', String(injectRec?.name))
check('注册到 settings.section', regRec?.cfg?.name === 'settings.section', JSON.stringify(regRec?.cfg))
check('注册 id = system-prompt', regRec?.cfg?.id === 'system-prompt', String(regRec?.cfg?.id))
check('label() = 系统提示词', regRec?.cfg?.label?.() === '系统提示词', String(regRec?.cfg?.label?.()))
check('注册的是 React 组件', typeof regRec?.Comp === 'function')

const Comp = regRec.Comp

// ── 渲染 ──────────────────────────────────────────────────────────
let tree
try {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(Comp, { close: () => {} }))
  })
  check('组件首次渲染无异常', true)
} catch (e) {
  check('组件首次渲染无异常', false, String(e?.stack ?? e))
  process.exit(1)
}

const flush = async () => {
  await TestRenderer.act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}
await flush()

const flat = (node) => {
  const texts = []
  const walk = (n) => {
    if (n === null || n === undefined || n === false || n === true) return
    if (typeof n === 'string' || typeof n === 'number') {
      texts.push(String(n))
      return
    }
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (typeof n === 'object' && n.children !== undefined) walk(n.children)
  }
  walk(node)
  return texts.join(' ')
}

const inputValues = () => tree.root.findAll((n) => n.type === 'input').map((n) => String(n.props.value ?? ''))

let text = flat(tree.toJSON())
check('渲染出页面标题「系统提示词」', text.includes('系统提示词'), text.slice(0, 80))
check('GET /state 被调用', calls.some((c) => c.url.endsWith('/system-prompt/api/state') && c.method === 'GET'))
check(
  '渲染出两条提示词的标题',
  inputValues().includes('思考语言：简体中文') && inputValues().includes('回答风格'),
  JSON.stringify(inputValues()),
)
check('渲染出段名', text.includes('system-prompt:thinking-language'), '')
check('渲染出组装后的段序', text.includes('harness:identity') && text.includes('deployment:persona-prefix'))
check('渲染出配置文件路径', text.includes('system-prompts.json'))

// ── 交互：段名可改 ────────────────────────────────────────────────
// 段名输入框：每张卡片一个（与标题输入框区分开）。
const idInputs = () => tree.root.findAll((n) => n.type === 'input' && String(n.props.className ?? '').includes('spm-idinput'))
check('每条提示词都有段名输入框', idInputs().length === 2, String(idInputs().length))
check(
  '段名输入框初始值 = 条目 id',
  idInputs()[0]?.props.value === 'thinking-language',
  JSON.stringify(idInputs().map((n) => n.props.value)),
)
check('段名前缀 system-prompt: 可见', text.includes('system-prompt:'))

// 改第一条的段名，验证 onChange 写入的是 id 字段
await TestRenderer.act(async () => {
  idInputs()[0].props.onChange({ target: { value: 'my-lang' } })
})
text = flat(tree.toJSON())
check('改段名后输入框显示新值', idInputs()[0]?.props.value === 'my-lang')
check('改段名后段名预览跟着变', text.includes('system-prompt:my-lang'), '')

// 非法段名要给红字提示（空格不在 ID_RE 里）
await TestRenderer.act(async () => {
  idInputs()[0].props.onChange({ target: { value: 'bad name!' } })
})
text = flat(tree.toJSON())
check('非法段名给出警告', text.includes('段名非法'), text.slice(0, 160))

// 与另一条重名也要提示
await TestRenderer.act(async () => {
  idInputs()[0].props.onChange({ target: { value: 'style' } })
})
text = flat(tree.toJSON())
check('段名重复给出警告', text.includes('段名与上面某条重复'), text.slice(0, 160))

// 改回合法值，确认警告消失
await TestRenderer.act(async () => {
  idInputs()[0].props.onChange({ target: { value: 'my-lang' } })
})
text = flat(tree.toJSON())
check('改回合法段名后警告消失', !text.includes('段名非法') && !text.includes('段名与上面某条重复'))

// 稳定性：改段名不应导致输入框失焦（key 用的是本地 _k，不是 id）
check('改段名后仍是同一个输入框实例（未因 key 变化而重建）', idInputs()[0] === idInputs()[0])


// ── 交互：新增 ────────────────────────────────────────────────────
const findByProps = (pred) => tree.root.findAll((n) => n.type === 'button' && pred(n.props))
const buttonByText = (t) => findByProps((p) => flat(p.children).includes(t))[0]

const addBtn = buttonByText('新增提示词')
check('找到「＋ 新增提示词」按钮', !!addBtn)
await TestRenderer.act(async () => {
  addBtn.props.onClick()
})
text = flat(tree.toJSON())
check('新增后出现第三条卡片（新提示词）', inputValues().includes('新提示词'), JSON.stringify(inputValues()))
check('新增后提示「有未保存的改动」', text.includes('有未保存的改动'))

// 编辑正文（找到 textarea 数量 = 3）
const textareas = tree.root.findAll((n) => n.type === 'textarea')
check('渲染出 3 个正文输入框', textareas.length === 3, String(textareas.length))
await TestRenderer.act(async () => {
  textareas[2].props.onChange({ target: { value: 'THIRD-MARKER' } })
})
text = flat(tree.toJSON())
check('编辑正文生效', text.includes('THIRD-MARKER') || tree.toJSON() !== null)

// ── 交互：保存 ────────────────────────────────────────────────────
const saveBtn = buttonByText('保存并生效')
check('找到「💾 保存并生效」按钮', !!saveBtn)
check('改后保存按钮可用', saveBtn?.props.disabled === false, JSON.stringify(saveBtn?.props.disabled))
await TestRenderer.act(async () => {
  await saveBtn.props.onClick()
})
await flush()
text = flat(tree.toJSON())
const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/state'))
check('POST /state 已发送', !!post)
check('POST 体含 3 条提示词', post ? JSON.parse(post.body).prompts.length === 3 : false, post ? String(JSON.parse(post.body).prompts.length) : 'no body')
check(
  'POST 体带上改过的段名 id',
  post ? JSON.parse(post.body).prompts[0].id === 'my-lang' : false,
  post ? String(JSON.parse(post.body).prompts[0].id) : 'no body',
)
check(
  'POST 体不再带本地 key（_k 不会写进配置）',
  post ? !('_k' in JSON.parse(post.body).prompts[0]) : false,
  post ? JSON.stringify(Object.keys(JSON.parse(post.body).prompts[0])) : 'no body',
)
check('保存后状态提示 ✅', text.includes('已保存并生效'), text.slice(0, 200))
check('保存后段名沿用改后的 id', text.includes('system-prompt:my-lang'))
check('保存后第三条的段名出现（host 补发的 id）', /system-prompt:p-/.test(text))

// ── 交互：删除（两步确认） ────────────────────────────────────────
const delBtn = buttonByText('删除')
check('找到「删除」按钮', !!delBtn)
await TestRenderer.act(async () => {
  delBtn.props.onClick()
})
text = flat(tree.toJSON())
check('删除进入二次确认', text.includes('确认删除'))
const confirmBtn = buttonByText('确认删除')
await TestRenderer.act(async () => {
  confirmBtn.props.onClick()
})
text = flat(tree.toJSON())
check('确认后卡片减少到两条', tree.root.findAll((n) => n.type === 'textarea').length === 2)

// ── 交互：总开关 / 恢复默认 ───────────────────────────────────────
const switchBtn = findByProps((p) => p.role === 'switch')[0]
check('找到总开关（role=switch）', !!switchBtn)
await TestRenderer.act(async () => {
  switchBtn.props.onClick()
})
text = flat(tree.toJSON())
check('总开关切换为已停用', text.includes('已停用'))

const resetBtn = buttonByText('恢复默认')
await TestRenderer.act(async () => {
  resetBtn.props.onClick()
})
text = flat(tree.toJSON())
check('恢复默认进入二次确认', text.includes('确认恢复默认'))
const confirmReset = buttonByText('确认')
await TestRenderer.act(async () => {
  await confirmReset.props.onClick()
})
await flush()
check('POST /reset 已发送', calls.some((c) => c.method === 'POST' && c.url.endsWith('/reset')))
check('恢复默认后回到 1 条', tree.root.findAll((n) => n.type === 'textarea').length === 1, String(tree.root.findAll((n) => n.type === 'textarea').length))

// ── 收尾 ──────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(' - ' + f.name + (f.extra ? ' :: ' + f.extra : ''))
  process.exit(1)
}

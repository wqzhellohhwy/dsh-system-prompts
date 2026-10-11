/**
 * dsh-system-prompts v2 — **系统提示词管理器**（client 半）。
 *
 * 在 DSH 设置面板注册一个「系统提示词」页（`settings.section` slot）：
 * 列出所有提示词条目，可新增 / 编辑正文与标题 / 上下移动 / 启用停用 / 删除，
 * 还可以调整全局总开关与基线顺序，保存后立即生效。
 *
 * ## 为什么是这种打包形状
 *
 * DSH 的 client 插件不是 import 进来的，而是由页面用
 * `window.__ModuleLoader__.load({ id, factory })` 装配：factory 拿到一个
 * `require`，可以解析 `react` 等宿主提供的共享模块。因此本文件**不用构建工具**，
 * 手写这一段壳 + `React.createElement`（不依赖 JSX 转译），改完直接生效。
 *
 * ## 契约要点（踩过的坑，别改）
 *
 * - 组件必须是真正的 React 组件：`{ render() {} }` 那种纯 DOM 形状会让 slot
 *   报 active:false、页面空白。
 * - `dsh.client` 声明写在 package.json（platform/inject/immediately），
 *   本文件只负责导出 `apply` 与 `inject`。
 * - 数据通道是同源 HTTP：host 半在 `/system-prompt/api` 上注册了 prefix 路由。
 */
window.__ModuleLoader__.load({
  id: 'dsh-system-prompts',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    /** host 半注册的 API 前缀。 */
    const API = '/system-prompt/api'

    /** 与 host 半的 ID_RE 保持一致：段名里 id 的合法字符集。 */
    const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

    const styles = `
.spm-page{font-size:14px;line-height:1.6;padding:14px 16px;max-width:900px;color:var(--dsw-alias-label-primary)}
.spm-page h3{margin:0 0 6px;font-size:16px;color:var(--dsw-alias-label-primary)}
.spm-desc{color:var(--dsw-alias-label-secondary);margin:0 0 12px;font-size:13px;line-height:1.6}
.spm-desc b{color:var(--dsw-alias-label-primary)}
.spm-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;position:sticky;top:8px;z-index:30}
.spm-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.spm-btn{background:var(--dsw-alias-state-business-primary);color:#fff;border:1px solid transparent;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit;white-space:nowrap}
.spm-btn.ghost{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.spm-btn.danger{background:transparent;border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.spm-btn.mini{padding:2px 8px;font-size:12px}
.spm-btn:disabled{opacity:.4;cursor:not-allowed}
.spm-switch{border:none;border-radius:999px;padding:2px 10px;cursor:pointer;font-size:12px;font-family:inherit;line-height:1.5;white-space:nowrap}
.spm-switch.on{background:#16a34a;color:#fff}
.spm-switch.off{background:#6b7280;color:#fff}
.spm-input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit}
.spm-num{width:96px}
.spm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1)}
.spm-card.off{opacity:.6}
.spm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.spm-title{flex:1 1 220px;min-width:160px}
.spm-seg{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace}
.spm-idwrap{display:flex;align-items:center;gap:4px;flex:1 1 260px;min-width:220px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.spm-idwrap.bad .spm-idinput{border-color:var(--dsw-alias-state-error-primary)}
.spm-idlabel{white-space:nowrap}
.spm-idprefix{font-family:ui-monospace,Consolas,monospace;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.spm-idinput{flex:1 1 auto;min-width:90px;font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:4px 6px}
.spm-idnote{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.spm-actions{display:flex;gap:4px;margin-left:auto}
.spm-text{width:100%;box-sizing:border-box;min-height:90px;resize:vertical;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:8px;font-size:13px;line-height:1.55;font-family:ui-monospace,Consolas,monospace}
.spm-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.spm-err{color:var(--dsw-alias-state-error-primary);font-size:12px}
.spm-status{font-size:13px;color:var(--dsw-alias-state-success-primary)}
.spm-status.err{color:var(--dsw-alias-state-error-primary)}
.spm-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:10px;line-height:1.7}
.spm-live{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:12px;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;word-break:break-all;line-height:1.8}
.spm-code{font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-brand-primary)}
.spm-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:10px 0}
`

    /** 前端本地生成条目标识（host 侧会再次校验，非法/重名会补发）。 */
    function nextId() {
      return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    /**
     * React 列表 key 专用：与 `id` 无关的稳定标识。
     * 不能让 `key` 直接取 `id`——用户改段名时 id 会逐字符变化，
     * key 一变 React 就重建 DOM，输入框当场失焦，根本没法连续输入。
     */
    let localKeySeed = 0
    function nextLocalKey() {
      localKeySeed += 1
      return 'k' + localKeySeed
    }

    /** 给（可能来自 host、没有本地 key 的）条目补齐稳定 key，保持已有序。 */
    function withKeys(list) {
      return (Array.isArray(list) ? list : []).map((p) => ({
        ...p,
        _k: p && typeof p === 'object' && p._k ? p._k : nextLocalKey(),
      }))
    }

    async function readJson(res) {
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`)
      }
    }

    function SystemPromptPage() {
      const [loaded, setLoaded] = useState(false)
      const [busy, setBusy] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState('')
      const [statusErr, setStatusErr] = useState(false)

      const [enabled, setEnabled] = useState(true)
      const [order, setOrder] = useState(-900)
      const [prompts, setPrompts] = useState([])

      const [live, setLive] = useState([])
      const [sections, setSections] = useState(null)
      const [errors, setErrors] = useState({})
      const [configPath, setConfigPath] = useState('')

      const [confirmDelete, setConfirmDelete] = useState(null)
      const [confirmReset, setConfirmReset] = useState(false)

      // 样式注入（挂在 head 上，卸载时移除）
      useEffect(() => {
        const style = document.createElement('style')
        style.textContent = styles
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, [])

      /** 把 host 返回的视图写进本地状态。 */
      const adopt = useCallback((body) => {
        if (!body || body.ok !== true) throw new Error(body?.error ?? '未知错误')
        setEnabled(body.enabled !== false)
        setOrder(Number.isFinite(body.order) ? body.order : -900)
        setPrompts(withKeys(body.prompts))
        setLive(Array.isArray(body.live) ? body.live : [])
        setSections(Array.isArray(body.sections) ? body.sections : null)
        setErrors(body.errors && typeof body.errors === 'object' ? body.errors : {})
        setConfigPath(typeof body.configPath === 'string' ? body.configPath : '')
      }, [])

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/state`)
          adopt(await readJson(res))
          setStatus('')
          setStatusErr(false)
        } catch (e) {
          setStatus('⚠️ 无法连接 host API（' + API + '）：' + String(e?.message ?? e))
          setStatusErr(true)
        } finally {
          setLoaded(true)
        }
      }, [adopt])

      useEffect(() => {
        void load()
      }, [load])

      const save = useCallback(async () => {
        setBusy(true)
        try {
          const res = await fetch(`${API}/state`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // `_k` 只是 React 列表 key，不能写进配置文件。
            body: JSON.stringify({
              enabled,
              order,
              prompts: prompts.map(({ _k, ...rest }) => rest),
            }),
          })
          const body = await readJson(res)
          adopt(body)
          if (body?.saved === false || body?.ok === false) {
            setStatus('❌ 已注册但写盘失败（重启后可能丢失），请检查配置文件权限')
            setStatusErr(true)
          } else {
            setDirty(false)
            setStatus('✅ 已保存并生效：当前会话下一轮请求即带上新提示词')
            setStatusErr(false)
          }
        } catch (e) {
          setStatus('❌ 保存失败：' + String(e?.message ?? e))
          setStatusErr(true)
        } finally {
          setBusy(false)
        }
      }, [adopt, enabled, order, prompts])

      const reset = useCallback(async () => {
        setBusy(true)
        try {
          const res = await fetch(`${API}/reset`, { method: 'POST' })
          const body = await readJson(res)
          adopt(body)
          setDirty(false)
          setConfirmReset(false)
          setStatus('✅ 已恢复默认（保留「思考语言」那一条）')
          setStatusErr(false)
        } catch (e) {
          setStatus('❌ 恢复默认失败：' + String(e?.message ?? e))
          setStatusErr(true)
        } finally {
          setBusy(false)
        }
      }, [adopt])

      const touch = () => {
        setDirty(true)
        setStatus('有未保存的改动')
        setStatusErr(false)
      }

      const addPrompt = () => {
        setPrompts((prev) => [
          ...prev,
          { _k: nextLocalKey(), id: nextId(), title: '新提示词', text: '', enabled: true },
        ])
        touch()
      }

      const patchPrompt = (index, patch) => {
        setPrompts((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
        touch()
      }

      const removePrompt = (index) => {
        setPrompts((prev) => prev.filter((_, i) => i !== index))
        setConfirmDelete(null)
        touch()
      }

      const move = (index, delta) => {
        setPrompts((prev) => {
          const target = index + delta
          if (target < 0 || target >= prev.length) return prev
          const next = [...prev]
          const tmp = next[index]
          next[index] = next[target]
          next[target] = tmp
          return next
        })
        touch()
      }

      /** 某条提示词实际注册出来的段名（保存后才有；host 会补发新 id）。 */
      const liveOf = (id) => live.find((entry) => entry.id === id)

      /** 该 id 在列表里是否重复（重复会被 host 自动改号）。 */
      const isDupId = (id, index) =>
        prompts.some((p, i) => i !== index && String(p.id ?? '').trim() === String(id ?? '').trim())

      if (!loaded) {
        return h('div', { className: 'spm-page' }, h('p', { className: 'spm-hint' }, '加载中…'))
      }

      const activeCount = prompts.filter((p) => p.enabled && String(p.text ?? '').trim() !== '').length

      return h(
        'div',
        { className: 'spm-page' },
        h('h3', null, '系统提示词'),
        // 一行说清「怎么生效 + 什么要保存」，两件事合并不占两段。
        h(
          'p',
          { className: 'spm-desc' },
          '每一条都是一个独立的 system 提示词段，按顺序拼在 harness 身份之后、部署 persona 之前。',
          h('b', null, '改完点「💾 保存并生效」'),
          '，当前会话的下一轮请求即带上新内容，不需要重启 DSH。',
        ),

        h(
          'div',
          { className: 'spm-bar' },
          h(
            'button',
            {
              className: 'spm-switch ' + (enabled ? 'on' : 'off'),
              role: 'switch',
              'aria-checked': enabled,
              onClick: () => {
                setEnabled(!enabled)
                touch()
              },
              title: enabled ? '点击停用全部提示词注入' : '点击启用提示词注入',
            },
            enabled ? '已启用' : '已停用',
          ),
          h('span', { className: 'spm-label' }, '基线顺序'),
          h('input', {
            className: 'spm-input spm-num',
            type: 'number',
            value: order,
            onChange: (e) => {
              const v = Number(e.target.value)
              setOrder(Number.isFinite(v) ? v : 0)
              touch()
            },
            title: '第 i 条提示词的 order = 基线 + i；默认 -900（紧跟 order -1000 的 harness 身份）',
          }),
          h('button', { className: 'spm-btn ghost', onClick: addPrompt }, '＋ 新增提示词'),
          h(
            'button',
            { className: 'spm-btn', onClick: () => void save(), disabled: busy || !dirty },
            busy ? '保存中…' : '💾 保存并生效',
          ),
          confirmReset
            ? h(
                'span',
                { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } },
                h('span', { className: 'spm-label' }, '确认恢复默认？'),
                h('button', { className: 'spm-btn mini danger', onClick: () => void reset() }, '确认'),
                h('button', { className: 'spm-btn mini ghost', onClick: () => setConfirmReset(false) }, '取消'),
              )
            : h(
                'button',
                { className: 'spm-btn ghost', onClick: () => setConfirmReset(true) },
                '恢复默认',
              ),
          status
            ? h('span', { className: 'spm-status' + (statusErr ? ' err' : '') }, status)
            : null,
        ),

        prompts.length === 0
          ? h('div', { className: 'spm-empty' }, '还没有提示词——点「＋ 新增提示词」加一条。')
          : null,

        prompts.map((p, index) => {
          const rawId = String(p.id ?? '')
          const id = rawId.trim()
          const idBad = !ID_RE.test(id)
          const idDup = !idBad && isDupId(id, index)
          const entry = liveOf(p.id)
          const err = errors[p.id]
          return h(
            'div',
            { className: 'spm-card' + (p.enabled ? '' : ' off'), key: p._k ?? p.id },
            h(
              'div',
              { className: 'spm-head' },
              h(
                'button',
                {
                  className: 'spm-switch ' + (p.enabled ? 'on' : 'off'),
                  role: 'switch',
                  'aria-checked': p.enabled,
                  onClick: () => patchPrompt(index, { enabled: !p.enabled }),
                  title: p.enabled ? '点击停用这一条' : '点击启用这一条',
                },
                p.enabled ? '启用' : '停用',
              ),
              h('input', {
                className: 'spm-input spm-title',
                value: p.title ?? '',
                placeholder: '标题（只在本页显示，便于辨认）',
                onChange: (e) => patchPrompt(index, { title: e.target.value }),
              }),
              h(
                'label',
                {
                  className: 'spm-idwrap' + (idBad || idDup ? ' bad' : ''),
                  title:
                    '段名 = system-prompt:<这里填的值>。' +
                    '允许 A-Z a-z 0-9 . _ -，首字符须为字母或数字，最长 64 位。' +
                    '改完点「保存并生效」才写入。',
                },
                h('span', { className: 'spm-idlabel' }, '段名'),
                h('span', { className: 'spm-idprefix' }, 'system-prompt:'),
                h('input', {
                  className: 'spm-input spm-idinput',
                  value: rawId,
                  placeholder: 'thinking-language',
                  spellCheck: false,
                  'aria-invalid': idBad || idDup,
                  onChange: (e) => patchPrompt(index, { id: e.target.value }),
                }),
              ),
              // 只在「有未保存改动」时提示。
              // 不加「已生效」那种常驻状态——它是默认态，绝大多数时候都在显示，
              // 没有信息量，只是噪音。
              dirty
                ? h(
                    'span',
                    {
                      className: 'spm-idnote',
                      title:
                        '改段名不实时生效：输入只是改本页的草稿。' +
                        '点顶部「💾 保存并生效」后才会写盘并重新注册提示词段，' +
                        '当前会话的下一轮请求即带上新段名（不需要重启 DSH）。',
                    },
                    '⏳ 未保存',
                  )
                : null,
              h('span', { className: 'spm-seg' }, 'order ' + (order + index)),
              h(
                'div',
                { className: 'spm-actions' },
                h(
                  'button',
                  {
                    className: 'spm-btn mini ghost',
                    onClick: () => move(index, -1),
                    disabled: index === 0,
                    title: '上移',
                  },
                  '▲',
                ),
                h(
                  'button',
                  {
                    className: 'spm-btn mini ghost',
                    onClick: () => move(index, 1),
                    disabled: index === prompts.length - 1,
                    title: '下移',
                  },
                  '▼',
                ),
                confirmDelete === p.id
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'button',
                        { className: 'spm-btn mini danger', onClick: () => removePrompt(index) },
                        '确认删除',
                      ),
                      h(
                        'button',
                        { className: 'spm-btn mini ghost', onClick: () => setConfirmDelete(null) },
                        '取消',
                      ),
                    )
                  : h(
                      'button',
                      {
                        className: 'spm-btn mini danger',
                        onClick: () => setConfirmDelete(p.id),
                        title: '删除这一条',
                      },
                      '删除',
                    ),
              ),
            ),
            h('textarea', {
              className: 'spm-text',
              value: p.text ?? '',
              placeholder: '提示词正文（原样注入 system 角色；留空则不注册这一段）',
              spellCheck: false,
              onChange: (e) => patchPrompt(index, { text: e.target.value }),
            }),
            h(
              'div',
              { className: 'spm-meta' },
              // 「段名」本身已经在上面那个输入框里了，这里不再重复显示。
              // 只有 host 兜底改了号（实际注册名 != 你填的 id）时才提示——
              // 那是唯一能暴露"你填的名字被换掉了"的地方，不能省。
              entry && entry.id !== id
                ? h('span', null, '⚠️ 实际注册为 ', h('span', { className: 'spm-code' }, entry.name))
                : null,
              idBad
                ? h('span', { className: 'spm-err' }, '⚠️ 段名非法：只能用 A-Z a-z 0-9 . _ -，首字符须为字母或数字，1-64 位；保存时 host 会自动改号')
                : null,
              idDup
                ? h('span', { className: 'spm-err' }, '⚠️ 段名与上面某条重复；保存时 host 会自动改号')
                : null,
              p.enabled && String(p.text ?? '').trim() === ''
                ? h('span', { className: 'spm-err' }, '⚠️ 正文为空，保存后不会注册这一段')
                : null,
              err ? h('span', { className: 'spm-err' }, '⚠️ ' + err) : null,
            ),
          )
        }),

        h(
          'div',
          { className: 'spm-hint' },
          h('div', null, `当前已注册 ${live.length} 段（列表里 ${activeCount} 条会注册）` + (enabled ? '' : '；总开关处于「已停用」')),
          sections
            ? h(
                'div',
                { className: 'spm-live' },
                '组装后的 system 提示词段序：',
                h('br'),
                sections.join('  |  '),
              )
            : h('div', { className: 'spm-live' }, '（无法读取当前组装结果：assemble() 未返回 sections）'),
          configPath ? h('div', null, '配置文件：', h('span', { className: 'spm-code' }, configPath)) : null,
          h(
            'div',
            null,
            '顺序规则：第 i 条的 order = 基线 + i（i 为列表下标，停用某条不会让后面的段平移）。默认 -900 紧跟在 harness 身份（-1000）之后、部署 persona（0）之前。',
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'system-prompt',
            order: 15,
            label: () => '系统提示词',
          },
          SystemPromptPage,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

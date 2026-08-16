/**
 * MatDEM 5.11 集成插件 — Client 半部（DSH 动态 Cordis 插件）
 * matdem-1 / pkg-11 (final4 mtime detection)
 *
 * 功能：在 DSH 运行卡片中渲染 MatDEM 控制面板：
 *  - 状态行（安装 / MCR / 运行中 / GPU）
 *  - 按钮：启动 MatDEM、刷新状态、脚本列表、结果列表、读取输出、关闭
 *  - 脚本列表（点击"运行"一键在 GUI 中执行）
 *  - 结果文件列表、输出文本区
 * 与 Host 半部通过 harness.handle / host.call 私有 RPC 通信。
 */
return {
  async apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
.md-panel { font-size: 12px; line-height: 1.5; }
.md-panel .md-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; flex-wrap: wrap; }
.md-panel button { font-size: 12px; padding: 2px 8px; cursor: pointer; border-radius: 4px; border: 1px solid var(--dsh-border, #8888); background: var(--dsh-surface, #00000011); color: inherit; }
.md-panel button:disabled { opacity: 0.5; cursor: default; }
.md-panel .md-list { max-height: 160px; overflow: auto; border: 1px solid var(--dsh-border, #8884); border-radius: 4px; padding: 4px; margin-top: 4px; }
.md-panel .md-item { display: flex; justify-content: space-between; gap: 8px; padding: 1px 2px; }
.md-panel .md-item:hover { background: var(--dsh-border, #8882); }
.md-panel .md-pre { max-height: 140px; overflow: auto; white-space: pre-wrap; font-family: monospace; font-size: 11px; background: var(--dsh-surface, #00000011); border-radius: 4px; padding: 6px; margin-top: 4px; }
.md-panel .md-hint { opacity: 0.7; }
.md-panel .md-ok { color: #3a9; }
.md-panel .md-bad { color: #c33; }
`)

    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      function MatdemPanel(props) {
        const [status, setStatus] = React.useState(null)
        const [scripts, setScripts] = React.useState(null)
        const [results, setResults] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [msg, setMsg] = React.useState('')
        const [output, setOutput] = React.useState('')

        const call = function (method, args) {
          setBusy(true)
          setMsg('')
          return host.call(method, args || {}).catch(function (err) {
            setMsg(String((err && err.message) || err))
            return null
          }).finally(function () { setBusy(false) })
        }

        const refresh = function () {
          call('md-status', {}).then(function (r) { if (r) setStatus(r) })
        }

        React.useEffect(function () { refresh() }, [])

        const launch = function () {
          call('md-launch', { enterMain: true }).then(function (r) { if (r) setStatus(function (s) { return Object.assign({}, s, r) }) })
        }
        const loadScripts = function () {
          call('md-scripts', {}).then(function (r) { if (r) setScripts(r.scripts) })
        }
        const loadResults = function () {
          call('md-results', {}).then(function (r) { if (r) setResults(r.results) })
        }
        const runOne = function (path) {
          call('md-run', { script: path, wait: true, timeoutMs: 90000 }).then(function (r) {
            if (r) setOutput((r.output || '') + '\n[status: ' + r.status + ']')
            loadResults()
          })
        }
        const readOut = function () {
          call('md-output', {}).then(function (r) { if (r) setOutput(r.output) })
        }
        const closeAll = function () {
          call('md-close', {}).then(function () { refresh() })
        }

        const s = status || {}
        const envBad = s.found === false
        const mcrOk = s.mcr && s.mcr.version

        return React.createElement('div', { className: 'md-panel' },
          React.createElement('div', { className: 'md-row' },
            React.createElement('strong', null, 'MatDEM 5.11'),
            React.createElement('span', { className: envBad ? 'md-bad' : 'md-ok' }, envBad ? '未找到安装目录' : '已安装'),
            React.createElement('span', { className: mcrOk ? 'md-ok' : 'md-bad' }, mcrOk ? 'MCR ' + s.mcr.version : 'MCR 缺失'),
            React.createElement('span', { className: s.running ? 'md-ok' : 'md-hint' }, s.running ? '● 运行中' : '○ 未运行'),
            s.gpu ? React.createElement('span', { className: 'md-hint' }, 'GPU: ' + s.gpu) : null
          ),
          React.createElement('div', { className: 'md-row' },
            React.createElement('button', { disabled: busy, onClick: launch }, '启动 MatDEM'),
            React.createElement('button', { disabled: busy, onClick: refresh }, '刷新状态'),
            React.createElement('button', { disabled: busy, onClick: loadScripts }, '脚本列表'),
            React.createElement('button', { disabled: busy, onClick: loadResults }, '结果列表'),
            React.createElement('button', { disabled: busy, onClick: readOut }, '读取输出'),
            React.createElement('button', { disabled: busy, onClick: closeAll }, '关闭 MatDEM')
          ),
          msg ? React.createElement('div', { className: 'md-bad' }, String(msg)) : null,
          scripts ? React.createElement('div', { className: 'md-list' },
            React.createElement('div', { className: 'md-hint' }, '脚本 (点击运行执行):'),
            scripts.slice(0, 20).map(function (sc) {
              return React.createElement('div', { className: 'md-item', key: sc.path },
                React.createElement('span', null, sc.path + ' (' + sc.size + ' B)'),
                React.createElement('button', { disabled: busy, onClick: function () { runOne(sc.path) } }, '运行')
              )
            })
          ) : null,
          results ? React.createElement('div', { className: 'md-list' },
            React.createElement('div', { className: 'md-hint' }, '结果文件:'),
            results.slice(0, 10).map(function (r) {
              return React.createElement('div', { className: 'md-item', key: r.path },
                React.createElement('span', null, r.path + ' (' + r.size + ' B)'))
            })
          ) : null,
          output ? React.createElement('div', { className: 'md-pre' }, String(output)) : null
        )
      }
    ))
  }
}

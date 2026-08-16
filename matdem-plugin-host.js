/**
 * MatDEM 5.11 集成插件 — Host 半部（DSH 动态 Cordis 插件）
 * matdem-1 / pkg-12 (final5: 模态对话框自动关闭 + 文件行OCR归一化)
 *
 * 功能：把本机 MatDEM 5.11 离散元程序接入 DSH。
 *  - matdem_status      环境检测（目录/MCR 9.14/GPU/运行状态）
 *  - matdem_launch      启动 GUI 并自动进入主程序窗口
 *  - matdem_scripts     列出 .m 脚本（根目录 + examples*）
 *  - matdem_read_script / matdem_write_script  读写脚本
 *  - matdem_run_script  全自动 GUI 运行（文件管理器→载入→运行→完成检测）
 *  - matdem_output      OCR 读取输出消息条
 *  - matdem_results     列出结果文件（PNG / TempModel .mat）
 *  - matdem_close       强杀 MatDEM 进程
 *
 * 依赖：matdemctl.ps1（同目录），Windows PowerShell 5.1，MATLAB Runtime R2023a (9.14)
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const fsService = ctx.get('fs')
    if (subprocess === undefined || fsService === undefined) {
      console.log('matdem: subprocess/fs unavailable, disabled')
      return
    }

    // ---------- helpers ----------
    const join = function () {
      return Array.prototype.join.call(arguments, '\\')
    }
    const norm = function (s) {
      return String(s || '').replace(/\s+/g, '').toLowerCase()
    }
    // normalize a file/folder name from OCR: map common OCR confusions
    // (囗/〇/○ -> 0, 。/．/· -> ., ℃ -> c, full-width digits) and drop the
    // remaining non-ASCII junk, then lowercase. Only for panel rows; UI text
    // like 运行以上命令 must keep CJK and go through norm() instead.
    const fileNorm = function (s) {
      let t = String(s || '')
      t = t.replace(/[〇○囗口]/g, '0')
      t = t.replace(/[。．·]/g, '.')
      t = t.replace(/℃/g, 'c')
      t = t.replace(/＿/g, '_')
      t = t.replace(/[\uff10-\uff19]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0) })
      t = t.replace(/[^a-z0-9._\-]/g, '')
      return t.toLowerCase()
    }
    const stripM = function (s) {
      return s.replace(/([\s_\-]*m)$/, '')
    }
    const levenshtein = function (a, b) {
      if (a === b) return 0
      const la = a.length
      const lb = b.length
      if (!la) return lb
      if (!lb) return la
      let row = new Array(lb + 1)
      for (let j = 0; j <= lb; j++) row[j] = j
      for (let i = 1; i <= la; i++) {
        let prev = row[0]
        row[0] = i
        for (let j = 1; j <= lb; j++) {
          const cur = row[j]
          row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
          prev = cur
        }
      }
      return row[lb]
    }
    const PWSH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const TASKKILL = 'C:\\Windows\\System32\\taskkill.exe'
    const REG = 'C:\\Windows\\System32\\reg.exe'
    const scratchDir = 'E:\\matdem\\.dsh-matdem'

    let matdemDir = null
    let detectPromise = null
    let launchedHandle = null

    const detectDir = async function () {
      if (detectPromise) return detectPromise
      detectPromise = (async function () {
        const roots = [
          'E:\\matdem\\MATDEM5.11\\MatDEM\\MatDEM5.11(Win&Linux)',
          'E:\\matdem', 'D:\\matdem', 'C:\\matdem'
        ]
        for (let i = 0; i < roots.length; i++) {
          const r = roots[i]
          try {
            const t = await fsService.resolve(r)
            const st = await fsService.stat(t)
            if (!st || st.type !== 'directory') continue
            const exe = await fsService.stat(await fsService.resolve(join(r, 'MatDEM.exe')))
            if (exe && exe.type === 'file') return r
          } catch (e) { /* next */ }
        }
        try {
          const rootT = await fsService.resolve('E:\\matdem')
          const entries = await fsService.listDir(rootT)
          for (let i = 0; i < entries.length; i++) {
            const e = entries[i]
            if (e.type !== 'directory') continue
            try {
              const exe = await fsService.stat(await fsService.resolve(join('E:\\matdem', e.name, 'MatDEM.exe')))
              if (exe && exe.type === 'file') return join('E:\\matdem', e.name)
            } catch (e2) { /* next */ }
          }
        } catch (e3) { /* ignore */ }
        return null
      })()
      return detectPromise
    }

    const ctl = async function (args, timeoutMs) {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found (looked under E:\\matdem etc.)')
      const ctlFile = join(dir, 'matdemctl.ps1')
      const argv = [PWSH, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ctlFile].concat(args)
      const handle = subprocess.spawn({
        argv: argv,
        cwd: dir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4194304 },
          stderr: { maxBytes: 262144 }
        },
        graceMs: 2000
      })
      let disposer = null
      if (timeoutMs && timeoutMs > 0) {
        disposer = ctx.timer.timeout(function () { try { handle.terminate() } catch (e) {} }, timeoutMs)
      }
      try {
        const outcome = await handle.done
        const so = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
        const se = handle.collected && handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
        if (outcome.exitCode !== 0) {
          throw new Error('matdemctl ' + args[0] + ' failed (' + outcome.exitCode + '): ' + String(se || so || '').slice(0, 400))
        }
        return so
      } finally {
        if (disposer) disposer()
      }
    }

    const sys = async function (argv, timeoutMs) {
      const handle = subprocess.spawn({
        argv: argv,
        cwd: 'C:\\Windows',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 1048576 },
          stderr: { maxBytes: 262144 }
        },
        graceMs: 2000
      })
      let disposer = null
      if (timeoutMs && timeoutMs > 0) {
        disposer = ctx.timer.timeout(function () { try { handle.terminate() } catch (e) {} }, timeoutMs)
      }
      try {
        const outcome = await handle.done
        const so = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
        const se = handle.collected && handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
        return { code: outcome.exitCode, stdout: so, stderr: se }
      } finally {
        if (disposer) disposer()
      }
    }

    const spawnDetached = async function (argv, cwd) {
      const handle = subprocess.spawn({
        argv: argv,
        cwd: cwd,
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 3000
      })
      return handle
    }

    // ---------- window / OCR primitives ----------
    const listWindows = async function () {
      const out = await ctl(['win'], 20000)
      try { return JSON.parse(out) } catch (e) { return [] }
    }

    const findMainWindow = async function () {
      const ws = await listWindows()
      const sun = ws.filter(function (w) { return w.visible && w.cls === 'SunAwtFrame' })
      return sun.find(function (w) { return w.title.indexOf('主程序') >= 0 }) ||
             sun.find(function (w) { return w.title.indexOf('矩阵离散元') >= 0 }) ||
             sun.find(function (w) { return /matdem/i.test(w.title) }) || null
    }

    const waitForMainWindow = async function (timeoutMs) {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const w = await findMainWindow()
        if (w) return w
        await ctx.timer.timeout(3000)
      }
      return null
    }

    let shotSeq = 0
    const ocrWindow = async function (win) {
      shotSeq++
      const png = join(scratchDir, 'shot-' + shotSeq + '.png')
      await ctl(['shot', png, String(win.hwnd)], 30000)
      const out = await ctl(['ocr', png], 60000)
      let lines = []
      try { lines = JSON.parse(out) } catch (e) { lines = [] }
      return { lines: lines, rect: { x: win.x, y: win.y, w: win.w, h: win.h } }
    }

    const findLine = function (lines, targets) {
      for (let i = 0; i < lines.length; i++) {
        const t = norm(lines[i].t)
        if (t.length === 0) continue
        for (let j = 0; j < targets.length; j++) {
          const tg = norm(targets[j])
          if (tg.length === 0) continue
          if (t.indexOf(tg) >= 0 || (t.length >= 2 && tg.indexOf(t) >= 0)) return lines[i]
        }
      }
      return null
    }

    // find a file/folder row in the right file-manager panel (tree at y>12%h,
    // file rows below). Exact (contains) matches win by longest text; otherwise
    // a fuzzy (Levenshtein) fallback tolerates common OCR digit/letter
    // confusions (e.g. EQv5 read as EQv6, makeGIF read as makeGlF).
    const findPanelRow = function (ocr, nameNorm) {
      const win = ocr.rect
      const nn = stripM(fileNorm(nameNorm))
      let best = null
      let bestScore = -1
      for (let i = 0; i < ocr.lines.length; i++) {
        const l = ocr.lines[i]
        if (l.x < win.w * 0.78) continue
        if (l.y < win.h * 0.12) continue
        const t = stripM(fileNorm(l.t))
        if (t.length < 4) continue
        const exact = nn.indexOf(t) >= 0 || t.indexOf(nn) >= 0
        let score = -1
        if (exact) {
          score = 1000 + t.length
        } else {
          const dist = levenshtein(nn, t)
          const minLen = Math.min(nn.length, t.length)
          if (dist <= 1 || (minLen >= 4 && dist / minLen <= 0.25)) {
            score = 200 - dist * 10 + Math.min(t.length, 10)
          }
        }
        if (score > bestScore) {
          best = l
          bestScore = score
        }
      }
      return best
    }

    const clickAt = async function (win, l) {
      const cx = win.x + l.x + Math.floor((l.w || 40) / 2)
      const cy = win.y + l.y + Math.floor((l.h || 14) / 2)
      await ctl(['click', String(cx), String(cy)], 15000)
      return { x: cx, y: cy }
    }
    const dblClickAt = async function (win, l) {
      const cx = win.x + l.x + Math.floor((l.w || 40) / 2)
      const cy = win.y + l.y + Math.floor((l.h || 14) / 2)
      await ctl(['dblclick', String(cx), String(cy)], 15000)
      return { x: cx, y: cy }
    }

    // ---------- business actions ----------
    const mcrInfo = async function () {
      try {
        const r = await sys([REG, 'query', 'HKLM\\SOFTWARE\\MathWorks\\MATLAB Runtime\\9.14', '/v', 'MATLABROOT'], 15000)
        if (r.code !== 0) return { version: '9.14 (R2023a)', root: null, queryFailed: true }
        const m = r.stdout.match(/MATLABROOT\s+REG_SZ\s+(.+)/i)
        if (m) return { version: '9.14 (R2023a)', root: m[1].trim() }
        return { version: '9.14 (R2023a)', root: null }
      } catch (e) {
        return { version: null, root: null, error: String(e && e.message || e) }
      }
    }

    const gpuInfo = async function () {
      try {
        const r = await sys(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'], 15000)
        if (r.code !== 0) return null
        const line = r.stdout.trim().split(/\r?\n/)[0]
        return line || null
      } catch (e) {
        return null
      }
    }

    const status = async function () {
      const dir = await detectDir()
      let running = false
      let window = null
      let gpu = null
      if (dir) {
        try {
          window = await findMainWindow()
          running = !!window
        } catch (e) { /* ignore */ }
        try { gpu = await gpuInfo() } catch (e) { gpu = null }
      }
      const mcr = await mcrInfo()
      let ctlReady = false
      if (dir) {
        try {
          const cst = await fsService.stat(await fsService.resolve(join(dir, 'matdemctl.ps1')))
          ctlReady = !!(cst && cst.type === 'file')
        } catch (e) { ctlReady = false }
      }
      return {
        found: !!dir,
        dir: dir,
        ctlReady: ctlReady,
        mcr: mcr,
        running: running,
        window: window ? { hwnd: window.hwnd, title: window.title, x: window.x, y: window.y, w: window.w, h: window.h } : null,
        gpu: gpu
      }
    }

    const launch = async function (enterMain) {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      let win = null
      try { win = await findMainWindow() } catch (e) { win = null }
      if (!win) {
        if (!launchedHandle) {
          launchedHandle = await spawnDetached([join(dir, 'MatDEM.exe')], dir)
        }
        win = await waitForMainWindow(120000)
        if (!win) throw new Error('MatDEM window did not appear within 120s')
      }
      if (enterMain !== false) {
        await ctl(['fg', String(win.hwnd)], 10000)
        await ctx.timer.timeout(1500)
        const ocr = await ocrWindow(win)
        const mainBtn = findLine(ocr.lines, ['主程序'])
        if (mainBtn && norm(mainBtn.t).indexOf('主程序') >= 0) {
          await clickAt(win, mainBtn)
          await ctx.timer.timeout(10000)
          win = await findMainWindow()
        }
      }
      return {
        launched: true,
        window: win ? { hwnd: win.hwnd, title: win.title, x: win.x, y: win.y, w: win.w, h: win.h } : null
      }
    }

    const closeMatdem = async function () {
      try {
        if (launchedHandle) { launchedHandle.terminate(); launchedHandle = null }
      } catch (e) { /* ignore */ }
      try {
        await sys([TASKKILL, '/IM', 'MatDEM.exe', '/T', '/F'], 15000)
      } catch (e) { /* ignore */ }
      return { closed: true }
    }

    const listScripts = async function () {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      const out = []
      const rootT = await fsService.resolve(dir)
      const entries = await fsService.listDir(rootT)
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (e.type === 'file' && /\.m$/i.test(e.name)) {
          out.push({ path: e.name, size: e.size || 0 })
        } else if (e.type === 'directory' && /^examples/i.test(e.name)) {
          try {
            const sub = await fsService.listDir(e.target)
            for (let j = 0; j < sub.length; j++) {
              const s = sub[j]
              if (s.type === 'file' && /\.m$/i.test(s.name)) {
                out.push({ path: e.name + '\\' + s.name, size: s.size || 0 })
              }
            }
          } catch (e2) { /* skip */ }
        }
      }
      out.sort(function (a, b) { return a.path.localeCompare(b.path) })
      return out
    }

    const readScript = async function (script) {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      const t = await fsService.resolve(join(dir, script))
      const st = await fsService.stat(t)
      if (!st || st.type !== 'file') throw new Error('script not found: ' + script)
      const content = await fsService.readText(t)
      const MAX = 20000
      return { path: script, bytes: content.length, content: content.slice(0, MAX), truncated: content.length > MAX }
    }

    const writeScript = async function (name, content) {
      if (!/^[A-Za-z0-9_\-]+\.m$/.test(name)) throw new Error('invalid script name (use letters/digits/_/- ending .m)')
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      const t = await fsService.resolve(join(dir, name))
      await fsService.writeText(t, content)
      return { path: name, bytes: content.length, note: 'MatDEM may overwrite .m files that are open in its editor; close MatDEM (matdem_close) before writing, or restart before running' }
    }

    const listResults = async function () {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      const out = []
      const scan = async function (rel, exts) {
        try {
          const t = await fsService.resolve(join(dir, rel))
          const st = await fsService.stat(t)
          if (!st || st.type !== 'directory') return
          const entries = await fsService.listDir(t)
          for (let i = 0; i < entries.length; i++) {
            const e = entries[i]
            if (e.type !== 'file') continue
            const ext = (e.name.split('.').pop() || '').toLowerCase()
            if (exts.indexOf(ext) >= 0) out.push({ path: rel ? rel + '\\' + e.name : e.name, size: e.size || 0 })
          }
        } catch (e) { /* skip */ }
      }
      await scan('', ['png', 'gif', 'jpg', 'jpeg'])
      await scan('TempModel', ['mat'])
      await scan('data', ['mat'])
      out.sort(function (a, b) { return b.size - a.size })
      return out.slice(0, 100)
    }

    // ---------- GUI automation ----------
    // dismiss one modal dialog window. Prefer 取消/否/No (do NOT confirm
    // exit), fall back to 确定/关闭/好, last resort click bottom-right area.
    const dismissOne = async function (w) {
      await ctl(['fg', String(w.hwnd)], 10000)
      await ctx.timer.timeout(600)
      const ocr = await ocrWindow(w)
      const cancel = findLine(ocr.lines, ['取消', '否', 'cancel', 'no'])
      const ok = findLine(ocr.lines, ['确定', 'ok', 'yes', '关闭', '好'])
      const btn = cancel || ok
      if (btn) {
        await clickAt(w, btn)
      } else {
        await ctl(['click', String(w.x + Math.floor(w.w * 0.75)), String(w.y + Math.floor(w.h * 0.82))], 10000)
      }
      await ctx.timer.timeout(800)
    }

    const dismissDialogs = async function () {
      try {
        const main = await findMainWindow()
        const ws = await listWindows()
        for (let i = 0; i < ws.length; i++) {
          const w = ws[i]
          if (!w.visible || w.cls !== 'SunAwtFrame') continue
          if (main && w.hwnd === main.hwnd) continue
          const title = String(w.title || '')
          if (title.indexOf('矩阵离散元') >= 0) continue
          if (/matdem主程序/i.test(title)) continue
          if (/figure|图/i.test(title)) continue
          if (w.w >= 600 && w.h >= 400) continue
          await dismissOne(w)
        }
      } catch (e) { /* ignore */ }
    }

    // find a currently open modal 提示 dialog (e.g. the 退出? prompt that
    // can linger after a restart or pop up right after clicking 运行以上命令)
    const findModalDialog = async function () {
      const ws = await listWindows()
      return ws.find(function (w) {
        return w.visible && w.cls === 'SunAwtFrame' && String(w.title || '').indexOf('提示') >= 0 && w.w < 600 && w.h < 400
      }) || null
    }

    const ensureMainWindow = async function () {
      let win = null
      try { win = await findMainWindow() } catch (e) { win = null }
      if (!win) {
        await launch(true)
        win = await waitForMainWindow(120000)
        if (!win) throw new Error('MatDEM window unavailable')
      }
      await ctl(['fg', String(win.hwnd)], 10000)
      await ctx.timer.timeout(1200)
      let ocr = await ocrWindow(win)
      const mainBtn = findLine(ocr.lines, ['主程序'])
      if (mainBtn) {
        await clickAt(win, mainBtn)
        await ctx.timer.timeout(10000)
        win = await findMainWindow()
        if (!win) throw new Error('main program window did not open')
        await ctl(['fg', String(win.hwnd)], 10000)
        await ctx.timer.timeout(1500)
        ocr = await ocrWindow(win)
      }
      return { win: win, ocr: ocr }
    }

    // snapshot TempModel files with mtimes (unix seconds)
    const tempSnapshot = async function (dir) {
      try {
        const out = await ctl(['files', join(dir, 'TempModel')], 20000)
        return JSON.parse(out)
      } catch (e) {
        return []
      }
    }

    const runScript = async function (script, timeoutMs, wait) {
      const dir = await detectDir()
      if (!dir) throw new Error('MatDEM directory not found')
      const rel = String(script).replace(/\\/g, '/')
      const parts = rel.split('/').filter(function (p) { return p.length > 0 })
      if (parts.length === 0) throw new Error('empty script path')
      const base = parts[parts.length - 1]
      const baseNorm = norm(base.replace(/\.m$/i, ''))
      const baseShort = baseNorm.replace(/^user/, '')
      const baseTargets = [baseNorm, baseShort].filter(function (s) { return s.length >= 4 })

      let win = null
      let ocr = null
      let restartUsed = false

      const attempt = async function () {
        const env = await ensureMainWindow()
        win = env.win
        ocr = env.ocr
        // a stray modal (e.g. 退出?) can linger after a restart and swallow
        // all clicks; clear it before navigating the file manager
        try { await dismissDialogs() } catch (e) { /* ignore */ }
        try { ocr = await ocrWindow(win) } catch (e) { /* ignore */ }

        for (let pi = 0; pi < parts.length - 1; pi++) {
          const dirNorm = norm(parts[pi])
          let row = findPanelRow(ocr, dirNorm)
          let tries = 0
          while (!row && tries < 4) {
            await ctl(['wheel', String(win.x + Math.floor(win.w * 0.9)), String(win.y + Math.floor(win.h * 0.6)), '-6'], 15000)
            await ctx.timer.timeout(1000)
            ocr = await ocrWindow(win)
            row = findPanelRow(ocr, dirNorm)
            tries++
          }
          if (!row) throw new Error('folder not visible in file manager: ' + parts[pi])
          await dblClickAt(win, row)
          await ctx.timer.timeout(3000)
          ocr = await ocrWindow(win)
        }

        let row = null
        for (let ti = 0; ti < baseTargets.length && !row; ti++) {
          row = findPanelRow(ocr, baseTargets[ti])
        }
        let tries = 0
        while (!row && tries < 4) {
          await ctl(['wheel', String(win.x + Math.floor(win.w * 0.9)), String(win.y + Math.floor(win.h * 0.6)), '-6'], 15000)
          await ctx.timer.timeout(1000)
          ocr = await ocrWindow(win)
          for (let ti = 0; ti < baseTargets.length && !row; ti++) {
            row = findPanelRow(ocr, baseTargets[ti])
          }
          tries++
        }
        if (!row) throw new Error('script not visible in file manager: ' + base)

        let loaded = null
        for (let attemptN = 0; attemptN < 3 && !loaded; attemptN++) {
          await dblClickAt(win, row)
          await ctx.timer.timeout(2500)
          ocr = await ocrWindow(win)
          loaded = findLine(ocr.lines, ['commandisloadedfrom'].concat(baseTargets))
        }
        return { row: row, loaded: loaded }
      }

      let result = null
      try {
        result = await attempt()
      } catch (e) {
        if (String(e && e.message || e).indexOf('not visible in file manager') >= 0) {
          await closeMatdem()
          await ctx.timer.timeout(4000)
          launchedHandle = null
          restartUsed = true
          result = await attempt()
        } else {
          throw e
        }
      }

      // find and click the run button
      await ctl(['fg', String(win.hwnd)], 10000)
      await ctx.timer.timeout(1200)
      ocr = await ocrWindow(win)
      let runBtn = findLine(ocr.lines, ['运行以上命令'])
      if (!runBtn) {
        await ctx.timer.timeout(2000)
        ocr = await ocrWindow(win)
        runBtn = findLine(ocr.lines, ['运行以上命令'])
      }
      if (!runBtn) {
        const hasEditor = findLine(ocr.lines, ['命令编辑器', '编辑器'])
        if (!hasEditor && !restartUsed) {
          await closeMatdem()
          await ctx.timer.timeout(4000)
          launchedHandle = null
          restartUsed = true
          result = await attempt()
          await ctl(['fg', String(win.hwnd)], 10000)
          await ctx.timer.timeout(1200)
          ocr = await ocrWindow(win)
          runBtn = findLine(ocr.lines, ['运行以上命令'])
          if (!runBtn) {
            const snip = ocr.lines.slice(0, 15).map(function (l) { return l.t }).join(' | ')
            throw new Error('run button (运行以上命令) not found after restart; ocr: ' + snip.slice(0, 300))
          }
        } else {
          const snip = ocr.lines.slice(0, 15).map(function (l) { return l.t }).join(' | ')
          throw new Error('run button (运行以上命令) not found; ocr: ' + snip.slice(0, 300))
        }
      }

      // baselines BEFORE clicking run
      let baseWindowCount = 0
      try {
        const ws = await listWindows()
        baseWindowCount = ws.filter(function (w) { return w.visible && w.cls === 'SunAwtFrame' }).length
      } catch (e) { /* ignore */ }
      const tRun = Math.floor(Date.now() / 1000)
      const baseTemp = await tempSnapshot(dir)

      await clickAt(win, runBtn)

      // a 提示/退出? dialog can pop up right after the run click and block
      // the command; dismiss it and click run once more
      try {
        await ctx.timer.timeout(2500)
        const modal = await findModalDialog()
        if (modal) {
          await dismissOne(modal)
          await ctl(['fg', String(win.hwnd)], 10000)
          await ctx.timer.timeout(800)
          await clickAt(win, runBtn)
        }
      } catch (e) { /* ignore */ }

      // poll the output region + figures + files
      const t0 = Date.now()
      const seen = {}
      const order = []
      let output = ''
      let status = 'running'
      while (Date.now() - t0 < timeoutMs) {
        await ctx.timer.timeout(2500)
        const o = await ocrWindow(win)
        const region = o.lines.filter(function (l) { return l.y > o.rect.h * 0.8 && l.x < o.rect.w * 0.9 })
        for (let i = 0; i < region.length; i++) {
          const l = region[i]
          const key = l.y + ':' + l.x
          if (!seen[key]) {
            seen[key] = true
            order.push(l)
          }
        }
        if (order.length > 0) {
          output = order.map(function (l) { return l.t }).join('\n')
        }
        let newFigure = false
        try {
          const ws = await listWindows()
          const cnt = ws.filter(function (w) { return w.visible && w.cls === 'SunAwtFrame' }).length
          newFigure = cnt > baseWindowCount
        } catch (e) { /* ignore */ }
        let newTemp = false
        const cur = await tempSnapshot(dir)
        for (let i = 0; i < cur.length; i++) {
          if (cur[i].mtime > tRun) { newTemp = true; break }
        }
        const joined = norm(output)
        const doneMark = /(已结束|完成|完毕|finished|done|succeed|success|错误|error|failed)/.test(joined)
        if ((doneMark || newFigure || newTemp) && order.length >= 2) {
          status = 'done'
          break
        }
        if (wait === false) break
      }
      if (status === 'running' && Date.now() - t0 >= timeoutMs) status = 'timeout'
      try { await dismissDialogs() } catch (e) { /* ignore */ }
      const lines = output.split('\n').filter(function (s) { return s.trim().length > 0 })
      return {
        status: status,
        script: script,
        output: lines.slice(-40).join('\n'),
        lineCount: lines.length,
        loaded: !!(result && result.loaded),
        restarted: restartUsed,
        window: win ? { hwnd: win.hwnd, title: win.title, x: win.x, y: win.y, w: win.w, h: win.h } : null
      }
    }

    const readOutput = async function () {
      const win = await findMainWindow()
      if (!win) return { output: '', window: null }
      const o = await ocrWindow(win)
      const region = o.lines.filter(function (l) { return l.y > o.rect.h * 0.8 && l.x < o.rect.w * 0.9 })
      const text = region.map(function (l) { return l.t }).join('\n')
      return {
        output: text.split('\n').filter(function (s) { return s.trim().length > 0 }).slice(-40).join('\n'),
        window: { hwnd: win.hwnd, title: win.title, x: win.x, y: win.y, w: win.w, h: win.h }
      }
    }

    // ---------- model tools ----------
    const tool = function (name, description, parameters, fn) {
      const def = harness.defineTool({
        name: name,
        description: description,
        parameters: parameters,
        output: {
          schema: { type: 'object', properties: {}, additionalProperties: true },
          render: function (args, value) {
            return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
          }
        },
        execute: async function (args) {
          return await fn(args)
        }
      })
      harness.registerTool(ctx, def)
    }

    tool('matdem_status', 'Check the MatDEM 5.11 installation and runtime: find the program directory, verify the MATLAB Runtime R2023a (9.14), report whether the GUI is running, its window, and the NVIDIA GPU. Use this first before any other matdem_* tool.', {
      type: 'object',
      properties: {}
    }, async function () {
      return await status()
    })

    tool('matdem_launch', 'Launch the MatDEM 5.11 GUI (MatDEM.exe). By default it also clicks the 主程序 button on the start page so the main program window with the code editor is shown. Pass enterMain=false to stop at the start page.', {
      type: 'object',
      properties: {
        enterMain: { type: 'boolean', description: 'whether to enter the main program window automatically (default true)' }
      }
    }, async function (args) {
      return await launch(args.enterMain)
    })

    tool('matdem_scripts', 'List the user scripts (.m files) in the MatDEM root and in every examples* folder. These are the scripts the agent can write and the MatDEM GUI can run.', {
      type: 'object',
      properties: {}
    }, async function () {
      return { scripts: await listScripts() }
    })

    tool('matdem_read_script', 'Read the content of a MatDEM script (.m file) by its relative path (e.g. user_MySim.m or examples2025/user_TwoBallsHM.m).', {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'relative path of the .m script inside the MatDEM directory' }
      },
      required: ['script']
    }, async function (args) {
      return await readScript(args.script)
    })

    tool('matdem_write_script', 'Create or overwrite a user script (.m file) in the MatDEM root directory. The script immediately appears in the MatDEM GUI file manager. Name must be letters/digits/_/- ending in .m (e.g. user_MySim.m). NOTE: MatDEM may overwrite .m files that are open in its editor; close MatDEM (matdem_close) before writing, then launch again before running.', {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'file name, e.g. user_MySim.m' },
        content: { type: 'string', description: 'full MATLAB script content' }
      },
      required: ['name', 'content']
    }, async function (args) {
      return await writeScript(args.name, args.content)
    })

    tool('matdem_run_script', 'Run a MatDEM script in the running MatDEM GUI. Automates: open the main program window, navigate the right-side file manager to the script (folders first, then the file row), double-click it so it loads into the command editor, click the 运行以上命令 button, then poll for completion. Completion is detected from the bottom message strip (输出消息), new figure windows, or TempModel/ files written after the run started. Note: disp/fprintf output of user code is NOT shown in the strip (only MatDEM app messages are); scripts should save results to files (e.g. print/saveas png, save .mat, fopen/fprintf) and the agent should check them with matdem_results. If the file manager listing is stale or the editor view is lost (result view/small mode), it restarts MatDEM once and retries. Use wait=false to start the run and return immediately; otherwise it polls until completion or timeoutMs (default 120000).', {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'relative path of the .m script, e.g. user_MySim.m or examples2025/user_TwoBallsHM.m' },
        wait: { type: 'boolean', description: 'poll until completion markers or timeout (default true)' },
        timeoutMs: { type: 'integer', description: 'poll timeout in milliseconds (default 120000)' }
      },
      required: ['script']
    }, async function (args) {
      return await runScript(args.script, args.timeoutMs || 120000, args.wait !== false)
    })

    tool('matdem_output', 'Read the current text in the MatDEM output message strip (输出消息) at the bottom of the main window, via OCR of the live GUI. Use it to poll a long simulation started with matdem_run_script wait=false.', {
      type: 'object',
      properties: {}
    }, async function () {
      return await readOutput()
    })

    tool('matdem_results', 'List recent result files produced by MatDEM: PNG/GIF figures in the root, .mat model files in TempModel/ and data/.', {
      type: 'object',
      properties: {}
    }, async function () {
      return { results: await listResults() }
    })

    tool('matdem_close', 'Close the MatDEM GUI process (taskkill MatDEM.exe, tree, force). Use it to stop the GUI or free the GPU.', {
      type: 'object',
      properties: {}
    }, async function () {
      return await closeMatdem()
    })

    // ---------- client RPC ----------
    harness.handle('md-status', async function () { return await status() })
    harness.handle('md-launch', async function (args) { return await launch(args && args.enterMain) })
    harness.handle('md-scripts', async function () { return { scripts: await listScripts() } })
    harness.handle('md-read-script', async function (args) { return await readScript(args.script) })
    harness.handle('md-write-script', async function (args) { return await writeScript(args.name, args.content) })
    harness.handle('md-results', async function () { return { results: await listResults() } })
    harness.handle('md-run', async function (args) {
      return await runScript(args.script, args.timeoutMs || 90000, args.wait !== false)
    })
    harness.handle('md-output', async function () { return await readOutput() })
    harness.handle('md-close', async function () { return await closeMatdem() })

    console.log('matdem plugin ready: dir=' + (matdemDir || 'detect-on-demand'))
  }
}

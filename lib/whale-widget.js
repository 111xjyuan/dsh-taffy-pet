/* =============================================================================
 * dsh-taffy-pet —— 永雏塔菲桌宠（浏览器端）
 * -----------------------------------------------------------------------------
 * 宿主（lib/index.js）沿用 dsh-whale-widget 的 /dsh-whale/* 路由与 .dshw-* 账本，
 * 本文件是全新前端：大菲/小菲两种形态 + 可换装 + 分件骨架动作 + 触摸反馈 +
 * 按压随机语音 + 余额/今日/本轮计费，粉色调简洁菜单。
 *
 * 素材目录：~/.dsh/taffy-pet/   经 /dsh-whale/taffy-file?p=<相对路径> 读取
 *   art/manifest.json  {version, outfits:[{id,name,file,small,rig:{parts,pivots},w,h}]}
 *   art/outfits/<file>  art/small/<file>  art/rig/<id>/<part>.png
 * 语音：~/.dsh/whale-audio/ 经 /dsh-whale/audio.json + /dsh-whale/audio-fragment.wav?id=
 * 计费：/dsh-whale/balance.json、/dsh-whale/last-turn.json、/dsh-whale/usage-records.json
 * ========================================================================== */
(function () {
  if (window.__TAFFY_PET_BOOTED__) return
  window.__TAFFY_PET_BOOTED__ = true

  var STORE_KEY = 'tp-pet-v2'
  var API = {
    art: '/dsh-whale/taffy-file?p=',
    audio: '/dsh-whale/audio.json',
    frag: '/dsh-whale/audio-fragment.wav?id=',
    balance: '/dsh-whale/balance.json',
    lastTurn: '/dsh-whale/last-turn.json',
    usage: '/dsh-whale/usage-records.json',
    petState: '/dsh-whale/pet-state.json',
    vrmRuntime: '/dsh-whale/vrm-runtime.js',
    vrmList: '/dsh-whale/vrm-list.json'
  }

  var DEFAULTS = {
    form: 'big',        // big=大菲 / small=小菲
    outfit: '',
    outfitSmall: '',
    soundOn: true,
    vol: 0.7,
    h: 300,
    bubbleOn: true,
    showToday: true,
    showLast: true,
    refreshSec: 60,
    x: null,
    y: null,
    whisperOn: false,     // 碎碎念：默认关（调研结论：主动搭话最容易被嫌烦）
    whisperMin: 45,       // 碎碎念间隔（分钟）
    notifyOn: true,       // 窗口失焦时的系统通知
    motionOn: true,       // 动效总开关（跟随系统「减少动效」时自动关闭）
    quietFrom: 23,        // 静默时段起（含）
    quietTo: 9,           // 静默时段止（不含）
    mode: '2d',           // 2d=立绘 / 3d=VRM 模型（实验形态）
    vrmFile: ''           // ~/.dsh/taffy-pet/vrm/ 下的文件名
  }
  var REDUCED = false
  try {
    var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    REDUCED = !!mqReduce.matches
    mqReduce.addEventListener && mqReduce.addEventListener('change', function (e) { REDUCED = !!e.matches })
  } catch (e) {}

  var state = loadState()
  var art = { outfits: [] }
  var fragPool = []
  var fragList = []
  var artSig = ''
  var menuEl = null, menuOpen = false, currentTab = 'outfit'
  var busyUntil = 0
  var pollTimer = null, turnTimer = null
  var balanceInfo = { ok: false, text: '—' }
  var lastTurnInfo = { amount: 0, tokens: 0 }
  var todayInfo = { amount: 0 }

  /* ------------------------------------------------------------------ 存储 */
  function loadState() {
    var s = {}
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch (e) { s = {} }
    var out = {}
    for (var k in DEFAULTS) out[k] = (k in s) ? s[k] : DEFAULTS[k]
    return out
  }
  var saveTimer = 0
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)) } catch (e) {}
    // 再落一份到 ~/.dsh/taffy-pet/ui-state.json（跨浏览器/清缓存不丢位置与设置）
    clearTimeout(saveTimer)
    saveTimer = setTimeout(function () {
      try {
        fetch(API.petState, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui: state })
        }).catch(function () {})
      } catch (e) {}
    }, 700)
  }
  // 启动时读服务端状态：服务端的值优先（它才是"上一次真正用过的")
  function loadServerState() {
    return getJSON(API.petState).then(function (r) {
      if (!r || !r.ok) return null
      var ui = r.ui
      if (ui && typeof ui === 'object') {
        for (var k in DEFAULTS) {
          if (k in ui && ui[k] !== null && ui[k] !== undefined) state[k] = ui[k]
        }
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)) } catch (e) {}
      }
      return r
    })
  }

  /* ------------------------------------------------------------------ 工具 */
  function el(tag, cls, html) {
    var d = document.createElement(tag)
    if (cls) d.className = cls
    if (html !== undefined) d.innerHTML = html
    return d
  }
  function artUrl(rel) {
    return API.art + String(rel).split('/').map(encodeURIComponent).join('/')
  }
  function money(v) {
    var n = Number(v)
    if (!isFinite(n)) return '—'
    return '¥' + n.toFixed(n < 0.01 ? 4 : 2)
  }
  function fmtTokens(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k'
    return String(n)
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null })
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
  // 形象图片路径：小菲用 manifest 的 small（相对 art/ 的完整路径），大菲用 outfits/<file>
  function figPath2x(o) {
    if (state.form === 'small' && o.small && o.small2x) return 'art/' + o.small2x
    if (state.form !== 'small' && o.file2x) return 'art/outfits/' + o.file2x
    return ''
  }

  function figPath(o) {
    if (!o) return ''
    if (state.form === 'small' && o.small) return 'art/' + o.small
    return 'art/outfits/' + o.file
  }
  function smallMap() {
    var m = {}
    art.outfits.forEach(function (o) { if (o.small) m[o.id] = o.small })
    return m
  }

  /* ------------------------------------------------------------------ 数据 */
  function loadArt() {
    return getJSON(artUrl('art/manifest.json')).then(function (m) {
      if (m && Array.isArray(m.outfits)) {
        art.outfits = m.outfits.filter(function (o) { return o && o.file })
      }
      var m2 = smallMap()
      if (!state.outfit || !art.outfits.some(function (o) { return o.id === state.outfit })) {
        var pref = art.outfits.filter(function (o) { return o.id === 'detective' })[0]
        state.outfit = (pref || art.outfits[0] || {}).id || ''
      }
      if (!state.outfitSmall || !m2[state.outfitSmall]) {
        state.outfitSmall = m2[state.outfit] || (Object.keys(m2)[0] || '')
      }
      saveState()
      var sig = JSON.stringify(art.outfits)
      var changed = sig !== artSig
      artSig = sig
      return changed
    })
  }
  function loadAudio() {
    return getJSON(API.audio).then(function (a) {
      var list = (a && Array.isArray(a.fragments)) ? a.fragments : []
      var prefer = list.filter(function (f) { return /^tv-/.test(String(f.id)) })
      if (!prefer.length) prefer = list.filter(function (f) { return /^taffy-/.test(String(f.id)) })
      if (!prefer.length) prefer = [{ id: 'ya1' }, { id: 'ya2' }]
      fragPool = prefer.map(function (f) { return String(f.id) })
      fragList = prefer.map(function (f) {
        return { id: String(f.id), name: String(f.name || f.id) }
      })
    })
  }
  function loadBalance(refresh) {
    return getJSON(API.balance + (refresh ? '?refresh=1' : '')).then(function (b) {
      if (b && b.ok !== false && b.totalBalance !== null && b.totalBalance !== undefined) {
        balanceInfo = { ok: true, text: money(b.totalBalance) }
      } else {
        balanceInfo = { ok: false, text: b && b.error ? '不可用' : '—' }
      }
      return b
    })
  }
  function loadUsage() {
    return getJSON(API.usage).then(function (u) {
      if (u && u.ok && u.today) todayInfo.amount = Number(u.today.total) || 0
      return u
    })
  }
  function loadLastTurn() {
    return getJSON(API.lastTurn).then(function (t) {
      if (t) lastTurnInfo = { amount: Number(t.amount) || 0, tokens: Number(t.tokens) || 0 }
    })
  }
  function refreshBilling() {
    return Promise.all([loadBalance(), loadUsage(), loadLastTurn()]).then(function () {
      renderBubble(false)
    })
  }
  var lastSeq = null
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer)
    if (turnTimer) clearInterval(turnTimer)
    // 轮次探测固定 6s：一轮结束就冒个泡 + 放一句 + 冒星星
    turnTimer = setInterval(function () {
      if (document.hidden) return
      getJSON(API.lastTurn).then(function (t) {
        if (!t || t.seq === undefined || t.seq === null) return
        var seq = Number(t.seq)
        lastTurnInfo = { amount: Number(t.amount) || 0, tokens: Number(t.tokens) || 0 }
        if (lastSeq !== null && seq !== lastSeq) {
          lastSeq = seq
          if (Number(t.amount) > 0) {
            bubbleSay()
            renderBubble(true)
            floatStars()
            playSound(pickEndVoice())
          }
        } else {
          lastSeq = seq
        }
      }).catch(function () {})
    }, 6000)
    pollTimer = setInterval(function () {
      if (document.hidden) return
      loadBalance().then(loadUsage).then(function () { renderBubble(false) })
    }, Math.max(20, Number(state.refreshSec) || 60) * 1000)
    if (stateTimer) clearInterval(stateTimer)
    stateTimer = setInterval(pollActivity, 2600)
    pollActivity()
    scheduleWhisper()
  }

  /* ------------------------------------------------ 工作状态（六档）联动 */
  var stateTimer = 0
  var lastStatus = ''
  var statusAt = 0
  var STATUS = {
    thinking: { say: '在想呢喵…', cls: 'tp-st-think' },
    working: { say: '干活中喵', cls: 'tp-st-work' },
    waiting: { say: '等你回话喵', cls: 'tp-st-wait' },
    success: { say: '搞定喵！', cls: 'tp-st-ok' },
    error: { say: '呜…出错了喵', cls: 'tp-st-err' },
    idle: { say: '', cls: '' }
  }
  function pollActivity() {
    if (document.hidden) return
    getJSON(API.petState).then(function (r) {
      if (!r || !r.ok || !r.activity) return
      var st = String(r.activity.status || 'idle')
      if (st === lastStatus) return
      var from = lastStatus
      lastStatus = st
      statusAt = Date.now()
      onStatus(st, from, r.activity.detail || '')
    }).catch(function () {})
  }
  function onStatus(st, from, detail) {
    if (vr.on) {
      if (next === 'success') vrReact('happy')
      else if (next === 'error') vrReact('sad')
      else if (next === 'waiting') vrReact('surprised')
    }
    if (!root) return
    root.classList.remove('tp-st-think', 'tp-st-work', 'tp-st-wait', 'tp-st-ok', 'tp-st-err')
    var meta = STATUS[st]
    if (!meta) return
    if (meta.cls) root.classList.add(meta.cls)
    // 「等待你回答」和「出错」是用户需要知道的，成功只在窗口失焦时提示
    var important = st === 'waiting' || st === 'error'
    if (st === 'success' && document.hidden && state.notifyOn) notify('塔菲办好了喵', lastTurnInfo.amount ? ('本轮 ¥' + lastTurnInfo.amount.toFixed(4)) : '任务完成')
    if (!state.bubbleOn) return
    if (important || (st === 'success' && !document.hidden)) {
      if (Date.now() - statusAt < 80) return   // 刚切过去，防抖
      lastSay = meta.say
      renderBubble(true)
      if (st === 'success') floatStars()
    }
  }
  function notify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      var n = new Notification(title, { body: body, silent: true, tag: 'taffy-pet' })
      setTimeout(function () { try { n.close() } catch (e) {} }, 6000)
    } catch (e) {}
  }

  /* ------------------------------------------------------------ 碎碎念 */
  var whisperTimer = 0
  var lastInputAt = Date.now()
  function inQuietHours() {
    var h = new Date().getHours()
    var a = Number(state.quietFrom), b = Number(state.quietTo)
    if (a === b) return false
    return a < b ? (h >= a && h < b) : (h >= a || h < b)
  }
  function scheduleWhisper() {
    if (whisperTimer) clearTimeout(whisperTimer)
    if (!state.whisperOn) return
    var mins = Math.max(5, Number(state.whisperMin) || 45)
    whisperTimer = setTimeout(function () {
      var idleMs = Date.now() - lastInputAt
      var ok = !document.hidden && !inQuietHours() && idleMs > 5 * 60 * 1000 && !menuOpen
      if (ok && state.bubbleOn) {
        bubbleSay()
        renderBubble(true)
      }
      scheduleWhisper()
    }, mins * 60 * 1000)
  }
  function pickEndVoice() {
    if (!fragPool.length) return ''
    return fragPool[Math.floor(Math.random() * fragPool.length)]
  }

  /* ------------------------------------------------------------------ 声音 */
  var currentAudio = null
  function stopCurrentSound() {
    if (!currentAudio) return
    try {
      currentAudio.pause()
      currentAudio.currentTime = 0
      currentAudio.src = ''
    } catch (e) {}
    currentAudio = null
  }
  function playSound(id, vol) {
    if (!state.soundOn || !id) return
    stopCurrentSound()   // 上一条没放完也直接掐掉，避免两条叠在一起
    try {
      var a = new Audio(API.frag + encodeURIComponent(id))
      a.volume = clamp(typeof vol === 'number' ? vol : state.vol, 0, 1)
      a.addEventListener('ended', function () { if (currentAudio === a) currentAudio = null })
      currentAudio = a
      a.play().catch(function () {})
    } catch (e) {}
  }
  function playRandomPress() {
    if (!fragPool.length) return
    playSound(fragPool[Math.floor(Math.random() * fragPool.length)])
  }

  /* ------------------------------------------------------------- 动作定义 */
  // rig 有没有都能用的「整体动作」；有骨架时同样走姿态系统
  var ACTIONS = [
    { id: 'greet', name: '打招呼', ms: 1900, say: true },
    { id: 'shake', name: '塔菲摇', ms: 2400, say: true },
    { id: 'heart', name: '比心', ms: 1600, say: true }
  ]
  var CSS_CLASS = {
    greet: 'tp-a-greet', shake: 'tp-a-shake2', heart: 'tp-a-heart'
  }

  /* ------------------------------------------------------------------ 宠物 */
  var root, stage, layerBox, bubble, shadow
  var bodyImg = null, rig = null
  var dragging = false, dragMoved = false, dragStart = null
  var dragVel = []          // 拖动速度采样 {t,x,y}
  var throwRaf = 0
  var act = null   // {id, start, ms}
  var touchAt = 0
  var rafId = 0

  function currentOutfit() {
    if (state.form === 'small') {
      var want = state.outfitSmall
      var s = art.outfits.filter(function (o) { return o.id === want })[0]
      // 兼容旧版本存成路径的情况（"small/small-x.png"）
      if (!s && want) {
        var base = String(want).split('/').pop().replace(/^small-/, '').replace(/\.png$/, '')
        s = art.outfits.filter(function (o) { return o.id === base && o.small })[0]
        if (s) state.outfitSmall = s.id
      }
      if (!s) s = art.outfits.filter(function (o) { return o.small })[0]
      if (s) return s
    }
    for (var i = 0; i < art.outfits.length; i++) if (art.outfits[i].id === state.outfit) return art.outfits[i]
    return art.outfits[0] || null
  }

  function mount() {
    if (document.getElementById('tp-root')) return
    var style = el('style')
    style.textContent = CSS
    document.head.appendChild(style)

    root = el('div', 'tp-root')
    root.id = 'tp-root'
    shadow = el('div', 'tp-shadow')
    stage = el('div', 'tp-stage')
    layerBox = el('div', 'tp-layers')
    stage.appendChild(layerBox)
    bubble = el('div', 'tp-bubble')
    root.appendChild(shadow)
    root.appendChild(bubble)
    root.appendChild(stage)
    document.body.appendChild(root)

    applyLayout(true)
    renderFigure()
    bindPetEvents()
    startPolling()
    loadVrmList()
    window.addEventListener('resize', function () { clampIntoViewport() })
    refreshBilling()
    tick(performance.now())
    setInterval(loadAudio, 300000)
  }

  /* --------------------------------------------------------- 布局与位置 */
  function applyLayout(first) {
    if (!root) return
    var h = clamp(Number(state.h) || 300, 140, 560)
    root.style.setProperty('--tp-h', h + 'px')
    var w = Math.round(h * 0.62)
    root.style.width = w + 'px'
    root.style.height = h + 'px'
    if (state.x === null || state.y === null) {
      setPos(window.innerWidth - w - 26, window.innerHeight - h - 18, true)
    } else {
      setPos(state.x, state.y, false)
    }
    if (rig) positionRig()
    if (vr.on) resizeVrm()
    sizeBubble()
  }

  // 气泡跟随桌宠大小缩放（以 300px 高为基准，13px 字号）
  function sizeBubble() {
    if (!bubble) return
    var h = clamp(Number(state.h) || 300, 140, 560)
    var k = clamp(h / 300, 0.72, 1.75)
    bubble.style.fontSize = (15.5 * k).toFixed(2) + 'px'
  }

  // 调整大小时保持「底边中点」不动，避免一跳一跳
  function resizeKeepingAnchor(newH, silent) {
    if (!root) return
    var ow = root.offsetWidth, oh = root.offsetHeight
    var ox = root.offsetLeft, oy = root.offsetTop
    var cx = ox + ow / 2
    var bottom = oy + oh
    state.h = clamp(Number(newH) || 300, 140, 560)
    saveState()
    applyLayout(false)
    var nw = root.offsetWidth, nh = root.offsetHeight
    setPos(cx - nw / 2, bottom - nh, true)
    if (!silent) positionMenu()
  }

  function setPos(x, y, persist) {
    if (!root) return
    var w = root.offsetWidth || 200
    var h = root.offsetHeight || Number(state.h) || 300
    x = clamp(x, -w * 0.25, window.innerWidth - w * 0.75)
    y = clamp(y, -h * 0.2, window.innerHeight - h * 0.6)
    root.style.left = Math.round(x) + 'px'
    root.style.top = Math.round(y) + 'px'
    // 贴左边缘时左右镜像，让塔菲朝向屏幕内侧
    root.classList.toggle('tp-flip', x <= 10)
    if (persist !== false) {
      state.x = Math.round(x); state.y = Math.round(y); saveState()
    }
  }
  // 松手后贴近任意一边就吸附住（左右 + 上下），贴左时立绘左右镜像朝向屏幕内
  // 只允许停在屏幕底部：横向随意，纵向永远贴底
  function snapToEdge() {
    if (!root) return
    var w = root.offsetWidth, h = root.offsetHeight
    var pad = 6
    var vw = window.innerWidth, vh = window.innerHeight
    var nx = Math.min(Math.max(root.offsetLeft, pad), Math.max(pad, vw - w - pad))
    var ny = vh - h - pad
    // 从上方回到底部时做一个自由落体 + 弹跳，而不是瞬移
    if (root.offsetTop < ny - 12) dropTo(nx, ny)
    else setPos(nx, ny, true)
  }

  var dropRaf = 0
  function dropTo(nx, ny) {
    if (!root) return
    if (dropRaf) cancelAnimationFrame(dropRaf)
    var y = root.offsetTop, vy = 0, last = performance.now()
    var g = 3200
    function step(now) {
      var dt = Math.min(0.048, (now - last) / 1000) || 0.016
      last = now
      vy += g * dt
      y += vy * dt
      if (y >= ny) {
        y = ny
        if (vy > 260) { vy = -vy * 0.34; }        // 落地弹一下
        else {
          vy = 0
          setPos(nx, ny, true)
          dropRaf = 0
          if (vr.on && vr.vrm) { vr.hopAt = performance.now() }
          return
        }
      }
      setPos(nx, y, false)
      dropRaf = requestAnimationFrame(step)
    }
    dropRaf = requestAnimationFrame(step)
  }
  function clampIntoViewport() {
    if (!root) return
    // 窗口变化只做边界回收，不改尺寸
    setPos(root.offsetLeft, root.offsetTop, false)
    if (menuOpen) positionMenu()
  }

  /* ------------------------------------------------------------- 形象渲染 */
  // 松手甩抛：沿松手瞬间的速度做抛物线，带摩擦与边缘反弹，停下来再吸附
  function startThrow() {
    if (!dragVel.length) return false
    var last = dragVel[dragVel.length - 1]
    var first = dragVel[0]
    var dt = last.t - first.t
    if (dt <= 0 || dt > 400) return false
    var vx = (last.x - first.x) / dt      // px/ms
    var vy = (last.y - first.y) / dt
    var sp = Math.sqrt(vx * vx + vy * vy)
    if (sp < 0.35) return false           // 慢慢拖：直接吸附，不抛
    if (REDUCED || state.motionOn === false) { snapToEdge(); return true }
    if (throwRaf) cancelAnimationFrame(throwRaf)
    var x = root.offsetLeft, y = root.offsetTop
    var w = root.offsetWidth, h = root.offsetHeight
    var vmax = 3.2
    vx = Math.max(-vmax, Math.min(vmax, vx)) * 1.15
    vy = Math.max(-vmax, Math.min(vmax, vy)) * 1.15
    var prev = 0
    var step = function (now) {
      if (!prev) prev = now
      var d = Math.min(48, now - prev); prev = now
      x += vx * d; y += vy * d
      var pad = 6
      var hit = false
      if (x < pad) { x = pad; vx = -vx * 0.55; hit = true }
      else if (x > innerWidth - w - pad) { x = innerWidth - w - pad; vx = -vx * 0.55; hit = true }
      if (y < pad) { y = pad; vy = -vy * 0.55; hit = true }
      else if (y > innerHeight - h - pad) { y = innerHeight - h - pad; vy = -vy * 0.62; hit = true }
      var fr = Math.pow(0.9955, d)   // 空气阻力
      vx *= fr; vy *= fr
      vy += 0.02 * d                 // 重力
      setPos(x, y, false)
      if (hit && Math.abs(vy) > 1.1) { try { pressUpFx() } catch (e) {} }
      if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.06) {
        throwRaf = 0
        setPos(x, y, true)
        snapToEdge()
        if (menuOpen) positionMenu()
        return
      }
      throwRaf = requestAnimationFrame(step)
    }
    throwRaf = requestAnimationFrame(step)
    return true
  }

  function renderFigure() {
    var o = currentOutfit()
    act = null
    if (state.mode === '3d') {
      if (layerBox) layerBox.innerHTML = ''
      root.classList.add('tp-mode-3d')
      if (!o) return
      startVrm()
      return
    }
    root.classList.remove('tp-mode-3d')
    if (vr.on) stopVrm()
    if (!o) { layerBox.innerHTML = ''; return }
    // 有分件骨架 → 图层拼装
    if (o.rig && o.rig.enabled && o.rig.parts && o.rig.parts.body && state.form === 'small') {
      buildRig(o)
      return
    }
    if (rig) teardownRig()
    bodyImg = el('img', 'tp-body')
    bodyImg.alt = '塔菲'
    bodyImg.draggable = false
    bodyImg.decoding = 'async'
    bodyImg.src = artUrl(figPath(o))
    // 高分屏优先用 @2x（manifest 里写了才用，没有就退回 1x）
    var f2 = figPath2x(o)
    if (f2 && (window.devicePixelRatio || 1) > 1.25) {
      bodyImg.srcset = artUrl(f2) + ' 2x'
    }
    layerBox.innerHTML = ''
    layerBox.appendChild(bodyImg)
    root.classList.add('tp-fallback')
    renderBubble(false)
  }

  function teardownRig() {
    rig = null
    root.classList.remove('tp-rig')
  }

  function buildRig(o) {
    var parts = o.rig.parts
    var piv = o.rig.pivots || {}
    teardownRig()
    layerBox.innerHTML = ''
    bodyImg = null
    var order = ['legL', 'legR', 'armL', 'armR', 'body', 'head']
    var imgs = {}
    order.forEach(function (name) {
      var file = parts[name]
      if (!file) return
      var img = el('img', 'tp-part tp-part-' + name)
      img.draggable = false
      img.src = artUrl('art/' + file)
      var p = piv[name] || [0.5, 0.5]
      img.style.transformOrigin = (p[0] * 100).toFixed(2) + '% ' + (p[1] * 100).toFixed(2) + '%'
      layerBox.appendChild(img)
      imgs[name] = img
    })
    rig = { imgs: imgs, piv: piv, w: Number(o.w) || 0, h: Number(o.h) || 0 }
    root.classList.add('tp-rig')
    root.classList.remove('tp-fallback')
    positionRig()
  }

  function positionRig() {
    if (!rig || !stage) return
    var sw = stage.clientWidth, sh = stage.clientHeight
    var w = rig.w, h = rig.h
    if (!w || !h) { w = sw; h = sh }
    var scale = Math.min(sw / w, sh / h)
    var bw = Math.round(w * scale), bh = Math.round(h * scale)
    var left = Math.round((sw - bw) / 2), top = Math.round(sh - bh)
    for (var k in rig.imgs) {
      var im = rig.imgs[k]
      im.style.width = bw + 'px'
      im.style.height = bh + 'px'
      im.style.left = left + 'px'
      im.style.top = top + 'px'
    }
  }

  /* ------------------------------------------------------- 姿态（rAF 驱动） */
  function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2 }

  function basePose(t) {
    return {
      root: { tx: 0, ty: Math.sin(t * 1.15) * 1.1, rot: 0, sx: 1, sy: 1 },
      body: { rot: Math.sin(t * 0.72) * 0.7, ty: 0 },
      head: { rot: Math.sin(t * 0.9) * 1.4, ty: Math.sin(t * 0.9 + 0.4) * 0.8 },
      armL: { rot: 2.2 * Math.sin(t * 1.05) },
      armR: { rot: -2.2 * Math.sin(t * 1.05) },
      legL: { rot: 0 },
      legR: { rot: 0 }
    }
  }

  function zeroPose() {
    return {
      root: { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 },
      body: { rot: 0, ty: 0 }, head: { rot: 0, ty: 0 },
      armL: { rot: 0 }, armR: { rot: 0 }, legL: { rot: 0 }, legR: { rot: 0 }
    }
  }

  function actionPose(id, u, t, ms) {
    var p = zeroPose()
    var k = Math.sin(Math.PI * clamp(u, 0, 1))
    if (id === 'wave') {
      var up = clamp(u / 0.22, 0, 1)
      p.armR.rot = -82 * easeInOut(up) + Math.sin(t * 17) * 14 * up
      p.head.rot = 6 * up
      p.root.ty = -1.5 * up
    } else if (id === 'bounce') {
      p.root.ty = -18 * Math.abs(Math.sin(u * Math.PI * 2))
      p.root.sy = 1 + 0.05 * Math.abs(Math.sin(u * Math.PI * 2))
      p.head.ty = -2 * k
    } else if (id === 'jump') {
      p.root.ty = -74 * Math.sin(Math.PI * u)
      p.root.sy = 1 - 0.06 * Math.sin(Math.PI * Math.min(1, u * 1.6))
      p.armL.rot = 34 * k; p.armR.rot = -34 * k
    } else if (id === 'dance') {
      p.root.rot = 6.5 * Math.sin(u * Math.PI * 4)
      p.body.rot = 3.5 * Math.sin(u * Math.PI * 4)
      p.head.rot = -4 * Math.sin(u * Math.PI * 4)
      p.armL.rot = 20 * Math.sin(u * Math.PI * 4)
      p.armR.rot = 20 * Math.sin(u * Math.PI * 4)
      p.legL.rot = -5 * Math.sin(u * Math.PI * 4)
      p.legR.rot = 5 * Math.sin(u * Math.PI * 4)
      p.root.ty = -6 * Math.abs(Math.sin(u * Math.PI * 4))
    } else if (id === 'stretch') {
      p.armL.rot = 58 * k; p.armR.rot = -58 * k
      p.root.sy = 1 + 0.05 * k
      p.head.rot = -5 * k
    } else if (id === 'spin') {
      p.root.rot = 360 * u
    } else if (id === 'shake') {
      p.root.tx = 5 * Math.sin(u * Math.PI * 18)
      p.head.rot = 5 * Math.sin(u * Math.PI * 18)
    } else if (id === 'tiltl') {
      p.head.rot = -17 * k; p.body.rot = -3 * k
    } else if (id === 'tiltr') {
      p.head.rot = 17 * k; p.body.rot = 3 * k
    } else if (id === 'nod') {
      p.head.ty = 5 * Math.abs(Math.sin(u * Math.PI * 4))
      p.head.rot = -4 * Math.abs(Math.sin(u * Math.PI * 4))
    } else if (id === 'look') {
      p.head.rot = 8 * Math.sin(u * Math.PI * 2)
      p.body.rot = 3 * Math.sin(u * Math.PI * 2)
    } else if (id === 'sit') {
      p.root.sy = 1 - 0.1 * k
      p.root.ty = 2 * k
    } else if (id === 'sleep') {
      p.head.rot = -9 * k; p.body.rot = -3 * k
      p.root.ty = 3 * k
      p.armL.rot = -3 * k; p.armR.rot = 3 * k
    } else if (id === 'dizzy') {
      p.head.rot = 13 * Math.sin(u * Math.PI * 8)
      p.body.rot = 4 * Math.sin(u * Math.PI * 8)
    } else if (id === 'heart') {
      p.armL.rot = 26 * k; p.armR.rot = -26 * k
      p.root.ty = -8 * k
    }
    return p
  }

  function addPose(a, b) {
    var out = {}
    for (var g in a) {
      out[g] = {}
      for (var k in a[g]) {
        var v = (a[g][k] === undefined ? 0 : a[g][k]) + ((b[g] && b[g][k]) || 0)
        out[g][k] = v
      }
    }
    return out
  }

  function applyPose(p) {
    if (!rig || !root) return
    var st = stage
    st.style.transform = 'translate(' + p.root.tx.toFixed(2) + 'px,' + p.root.ty.toFixed(2) + 'px) rotate(' + p.root.rot.toFixed(2) + 'deg) scale(' + p.root.sx.toFixed(3) + ',' + p.root.sy.toFixed(3) + ')'
    var map = { body: p.body, head: p.head, armL: p.armL, armR: p.armR, legL: p.legL, legR: p.legR }
    for (var name in map) {
      var im = rig.imgs[name]
      if (!im) continue
      var q = map[name] || {}
      im.style.transform = 'translate(' + (q.tx || 0).toFixed(2) + 'px,' + (q.ty || 0).toFixed(2) + 'px) rotate(' + (q.rot || 0).toFixed(2) + 'deg)'
    }
  }

  function startTick() {
    if (!rafId) rafId = requestAnimationFrame(tick)
  }
  function stopTick() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopTick(); lastInputAt = Date.now() }
    else { startTick(); if (root) pollActivity() }
  })

  function tick(now) {
    rafId = requestAnimationFrame(tick)
    if (!root) return
    if (vr.on) return
    var t = now / 1000
    if (rig) {
      var p = basePose(t)
      if (act) {
        var u = (now - act.start) / act.ms
        if (u >= 1) { act = null }
        else p = addPose(p, actionPose(act.id, u, t, act.ms))
      }
      if (touchAt && now - touchAt < 420) {
        var tu = (now - touchAt) / 420
        var sq = Math.sin(Math.PI * Math.min(1, tu * 1.35))
        var tp = zeroPose()
        tp.root.sy = 1 - 0.07 * sq
        tp.root.sx = 1 + 0.04 * sq
        tp.head.ty = 2.4 * sq
        p = addPose(p, tp)
      }
      applyPose(p)
    } else if (bodyImg) {
      // 无骨架：整体呼吸感
      bodyImg.style.transform = 'translateY(' + (Math.sin(t * 1.15) * 1.1).toFixed(2) + 'px) scale(' + (1 + Math.sin(t * 1.15) * 0.004).toFixed(4) + ',' + (1 + Math.sin(t * 1.15) * 0.006).toFixed(4) + ')'
    }
  }

  /* ------------------------------------------------------- 3D 形态（VRM） */
  var vr = {
    on: false, loading: false, canvas: null, renderer: null, scene: null, camera: null,
    vrm: null, clock: 0, raf: 0, last: 0, files: [], rest: null, lookTarget: null,
    blinkAt: 0, blinkUntil: 0, exprUntil: 0, exprName: '', scriptPromise: null,
    pointer: { x: 0, y: 0 }, bbox: null, fit: null, hopAt: 0, T: null
  }
  var _v3 = { euler: null, quat: null }

  function loadVrmRuntime(cb) {
    if (window.TaffyVRM) return cb(null)
    if (vr.scriptPromise) {
      vr.scriptPromise.then(function () { cb(null) }, cb)
      return
    }
    vr.scriptPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script')
      sc.src = API.vrmRuntime
      sc.onload = function () { resolve() }
      sc.onerror = function () { reject(new Error('vrm runtime load failed')) }
      document.head.appendChild(sc)
    })
    vr.scriptPromise.then(function () { cb(null) }, cb)
  }

  function loadVrmList() {
    return fetch(API.vrmList, { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        var entries = []
        var files = (j && j.files) || []
        for (var i = 0; i < files.length; i++) {
          entries.push({ path: 'vrm/' + files[i], label: files[i].replace(/\.(vrm|glb)$/i, ''), kind: 'vrm' })
        }
        var models = (j && j.models) || []
        for (var k = 0; k < models.length; k++) {
          entries.push({ path: models[k].path, label: 'MMD·' + models[k].label, kind: 'mmd' })
        }
        vr.entries = entries
        vr.files = entries.map(function (e) { return e.path })
        return vr.files
      })
      .catch(function () { vr.files = []; vr.entries = []; return [] })
  }

  function currentModel() {
    var list = vr.entries || []
    for (var i = 0; i < list.length; i++) if (list[i].path === state.vrmFile) return list[i]
    return list[0] || null
  }

  function startVrm() {
    if (vr.on || vr.loading) return
    if (!stage) return
    vr.loading = true
    if (!vr.files.length) {
      loadVrmList().then(function () {
        vr.loading = false
        if (!vr.files.length) { state.mode = '2d'; saveState(); renderFigure(); return }
        startVrm()
      })
      return
    }
    loadVrmRuntime(function (err) {
      if (err) {
        console.warn('[taffy] 3D 运行时加载失败', err)
        vr.loading = false
        state.mode = '2d'
        saveState()
        renderFigure()
        return
      }
      buildVrmScene()
    })
  }

  function buildVrmScene() {
    try {
      var T = window.TaffyVRM
      var THREE = T.THREE
      vr.T = T
      _v3.euler = new THREE.Euler()
      _v3.quat = new THREE.Quaternion()
      var canvas = el('canvas', 'tp-vrm')
      var sw = stage.clientWidth || 180
      var sh = stage.clientHeight || 300
      canvas.width = sw
      canvas.height = sh
      layerBox.innerHTML = ''
      layerBox.appendChild(canvas)
      vr.canvas = canvas

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(sw, sh, false)
      if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace
      vr.renderer = renderer

      var scene = new THREE.Scene()
      vr.scene = scene
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b9c9, 2.4))
      var d1 = new THREE.DirectionalLight(0xffffff, 1.5)
      d1.position.set(1.2, 2.4, 2.0)
      scene.add(d1)
      var d2 = new THREE.DirectionalLight(0xffd9ea, 0.6)
      d2.position.set(-1.6, 1.2, 1.2)
      scene.add(d2)

      var camera = new THREE.PerspectiveCamera(30, sw / sh, 0.05, 60)
      vr.camera = camera

      var model = currentModel()
      if (!model) {
        vr.loading = false; return
      }
      if (model.kind === 'mmd') {
        var dir = model.path.replace(/[^/]+$/, '')
        // 贴图是「裸文件名」形式（BiaoQing01.png），用 LoadingManager 把请求重写到 taffy-file 路由
        var mgr = new THREE.LoadingManager()
        mgr.setURLModifier(function (u) {
          u = String(u)
          if (u.indexOf('data:') === 0) return u
          if (u.indexOf('/dsh-whale/taffy-file') === 0) return u
          var clean = u.split('?')[0]
          try { clean = decodeURIComponent(clean) } catch (e) {}
          var name = clean.split('/').pop()
          if (!name) return u
          return API.art + encodeURIComponent(dir + name)
        })
        mgr.onError = function (u) {
        }
        mgr.onLoad = function () {
          try {
            if (!vr.vrm && !vr.model) return
            if (typeof applyIdlePose === 'function') applyIdlePose(0, performance.now(), 0.016)
            vr.renderer.render(vr.scene, vr.camera)
          } catch (e) {}
        }
        var mmd = new T.MMDLoader(mgr)
        var pmxUrl = API.art + encodeURIComponent(model.path)
        mmd.load(pmxUrl, function (obj) {
          try {
            vr.kind = 'mmd'
            vr.model = obj
            obj.rotation.y = Math.PI
            scene.add(obj)
            // MMD 单位很大（~20），缩放到和 VRM 同量级
            var bb = new THREE.Box3().setFromObject(obj)
            var hh = bb.getSize(new THREE.Vector3()).y || 20
            var sc = 1.62 / hh
            obj.scale.setScalar(sc)
            obj.position.y -= bb.min.y * sc
            bb = new THREE.Box3().setFromObject(obj)
            vr.bbox = { size: bb.getSize(new THREE.Vector3()), center: bb.getCenter(new THREE.Vector3()) }
            captureRestPose(T)
            vr.on = true
            vr.loading = false
            window.__taffyVr = vr
            root.classList.add('tp-mode-3d')
            resizeVrm()
            try { applyIdlePose(0, performance.now(), 0.016) } catch (e) {}
            vr.renderer.render(vr.scene, vr.camera)
            if (!window.__noLoop) vr.raf = requestAnimationFrame(vrmLoop)
          } catch (e) {
            console.warn('[taffy] MMD 初始化失败', e)
            stopVrm()
          }
        }, undefined, function (e) {
          console.warn('[taffy] MMD 加载失败', e)
          stopVrm()
        })
        return
      }
      var loader = new T.GLTFLoader()
      loader.register(function (parser) { return new T.VRMLoaderPlugin(parser) })
      var url = API.art + encodeURIComponent(model.path)
      loader.load(url, function (gltf) {
        try {
          var vrm = gltf.userData.vrm
          if (!vrm) throw new Error('not a vrm')
          T.VRMUtils.removeUnnecessaryVertices(gltf.scene)
          T.VRMUtils.removeUnnecessaryJoints(gltf.scene)
          var isV0 = !vrm.meta || vrm.meta.metaVersion === '0'
          vrm.scene.rotation.y = isV0 ? Math.PI : 0
          scene.add(vrm.scene)
          vr.vrm = vrm
          vr.kind = 'vrm'
          var box = new THREE.Box3().setFromObject(vrm.scene)
          vrm.scene.position.y -= box.min.y
          box = new THREE.Box3().setFromObject(vrm.scene)
          vr.bbox = { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) }
          captureRestPose(T)
          vr.on = true
          vr.loading = false
          window.__taffyVr = vr
          root.classList.add('tp-mode-3d')
          resizeVrm()
          try { applyIdlePose(0, performance.now(), 0.016) } catch (e) {}
          vr.renderer.render(vr.scene, vr.camera)
          vr.raf = requestAnimationFrame(vrmLoop)
        } catch (e) {
          console.warn('[taffy] 3D 模型初始化失败', e)
          stopVrm()
        }
      }, undefined, function (e) {
        console.warn('[taffy] 3D 模型加载失败', e)
        stopVrm()
        state.mode = '2d'
        saveState()
        renderFigure()
      })
    } catch (e) {
      console.warn('[taffy] 3D 初始化失败', e)
      stopVrm()
    }
  }

  var BONE = {
    hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
    leftUpperArm: 'leftUpperArm', rightUpperArm: 'rightUpperArm',
    leftLowerArm: 'leftLowerArm', rightLowerArm: 'rightLowerArm'
  }

  var MMD_BONES = {
    hips: '下半身', spine: '上半身', chest: '上半身2', neck: '首', head: '頭',
    leftUpperArm: '左腕', rightUpperArm: '右腕', leftLowerArm: '左ひじ', rightLowerArm: '右ひじ'
  }

  function collectBones(root) {
    var found = {}
    var want = {}
    var keys = ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']
    for (var i = 0; i < keys.length; i++) want[MMD_BONES[keys[i]]] = keys[i]
    root.traverse(function (o) {
      if (want[o.name] && !found[want[o.name]]) found[want[o.name]] = o
    })
    return found
  }

  function captureRestPose(T) {
    var names = [BONE.hips, BONE.spine, BONE.chest, BONE.neck, BONE.head,
      BONE.leftUpperArm, BONE.rightUpperArm, BONE.leftLowerArm, BONE.rightLowerArm]
    var rest = {}
    if (vr.kind === 'mmd') {
      vr.nodes = collectBones(vr.model)
      for (var j = 0; j < names.length; j++) {
        var n = vr.nodes[names[j]]
        if (n) rest[names[j]] = n.quaternion.clone()
      }
      vr.rest = rest
      return
    }
    var nodes = {}
    for (var i = 0; i < names.length; i++) {
      var node = vr.vrm.humanoid.getNormalizedBoneNode(names[i])
      if (node) { nodes[names[i]] = node; rest[names[i]] = node.quaternion.clone() }
    }
    vr.nodes = nodes
    vr.rest = rest
  }

  function setBone(name, ex, ey, ez) {
    if (!vr.rest) return
    var node = (vr.nodes && vr.nodes[name]) || (vr.vrm && vr.vrm.humanoid.getNormalizedBoneNode(name))
    if (!node) return
    _v3.euler.set(ex || 0, ey || 0, ez || 0)
    _v3.quat.setFromEuler(_v3.euler)
    var base = vr.rest[name]
    if (base) node.quaternion.copy(base).multiply(_v3.quat)
    else node.quaternion.copy(_v3.quat)
  }

  function setExpr(name, v) {
    try {
      var em = vr.vrm && vr.vrm.expressionManager
      if (em && em.getExpression(name)) em.setValue(name, v)
    } catch (e) {}
  }

  // 表情互斥：切下一个之前先把所有表情权重清零，避免「按一下切不回去 / 多个表情叠在一起」
  var EXPRS = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh']

  function clearExprs(exceptName) {
    for (var i = 0; i < EXPRS.length; i++) {
      if (EXPRS[i] === exceptName) continue
      setExpr(EXPRS[i], 0)
    }
  }

  function vrReact(kind) {
    if (!vr.on || !vr.vrm) return
    var now = performance.now()
    var next = ''
    if (kind === 'happy') { next = 'happy'; vr.exprUntil = now + 1100 }
    else if (kind === 'surprised') { next = 'surprised'; vr.exprUntil = now + 700 }
    else if (kind === 'sad') { next = 'sad'; vr.exprUntil = now + 1400 }
    clearExprs(next)
    vr.exprName = next
    if (next) setExpr(next, 1)
    vr.hopAt = now
  }

  // 塔菲的经典动作（都在现成的骨骼上做，风格不乱加）
  function smoother(u) {
    u = u < 0 ? 0 : (u > 1 ? 1 : u)
    return u * u * u * (u * (u * 6 - 15) + 10)
  }
  function lerpN(a, b, u) { return a + (b - a) * u }

  // 动作 = 关键帧（相对待机姿态的偏移，弧度）+ 可选振荡；smootherstep 插值，避免线性 sin 的僵硬感
  var ACTIONS3D = [
    {
      id: 'wave', name: '招手', dur: 2300, expr: 'happy',
      keys: [
        { t: 0, b: {} },
        { t: 0.12, b: { rightUpperArm: [-0.05, 0, 0.82], rightLowerArm: [-1.30, 0, 0], head: [0.03, 0.10, -0.05], chest: [0, 0.05, 0.02] } },
        { t: 0.30, b: { rightUpperArm: [-0.10, 0, 0.95], rightLowerArm: [-1.55, 0, 0], head: [0.04, 0.13, -0.07], chest: [0, 0.07, 0.03] } },
        { t: 0.46, b: { rightUpperArm: [-0.05, 0, 0.78], rightLowerArm: [-1.15, 0, 0], head: [0.02, 0.10, -0.05], chest: [0, 0.05, 0.02] } },
        { t: 0.62, b: { rightUpperArm: [-0.10, 0, 0.95], rightLowerArm: [-1.55, 0, 0], head: [0.04, 0.13, -0.07], chest: [0, 0.07, 0.03] } },
        { t: 0.82, b: { rightUpperArm: [-0.10, 0, 0.35], rightLowerArm: [0, -0.55, 0], head: [0.02, 0.05, -0.02] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'heart', name: '比心', dur: 2100, expr: 'happy',
      keys: [
        { t: 0, b: {} },
        { t: 0.18, b: { leftUpperArm: [-1.08, 0, -0.30], rightUpperArm: [-1.08, 0, 0.30], leftLowerArm: [0, 1.55, 0], rightLowerArm: [0, -1.55, 0], head: [0.10, 0, 0.06] } },
        { t: 0.34, b: { leftUpperArm: [-1.20, 0, -0.22], rightUpperArm: [-1.20, 0, 0.22], leftLowerArm: [0, 1.75, 0], rightLowerArm: [0, -1.75, 0], head: [0.13, 0, 0.08], chest: [-0.05, 0, 0] } },
        { t: 0.58, b: { leftUpperArm: [-1.16, 0, -0.24], rightUpperArm: [-1.16, 0, 0.24], leftLowerArm: [0, 1.70, 0], rightLowerArm: [0, -1.70, 0], head: [0.11, 0, 0.07], chest: [-0.02, 0, 0] } },
        { t: 0.82, b: { leftUpperArm: [-0.45, 0, -0.30], rightUpperArm: [-0.45, 0, 0.30], leftLowerArm: [0, 0.60, 0], rightLowerArm: [0, -0.60, 0], head: [0.05, 0, 0.03] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'tilt', name: '歪头', dur: 1700, expr: 'surprised',
      keys: [
        { t: 0, b: {} },
        { t: 0.22, b: { head: [0.06, 0.05, 0.26], neck: [0.03, 0.02, 0.10], chest: [0, 0, 0.04] } },
        { t: 0.62, b: { head: [0.08, 0.06, 0.30], neck: [0.04, 0.03, 0.12], chest: [0, 0, 0.05] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'sway', name: '塔菲摇', dur: 2600, expr: 'happy',
      keys: [
        { t: 0, b: {} },
        { t: 0.15, b: { hips: [0, 0.16, 0.10], chest: [0, -0.07, -0.04], head: [0, -0.08, 0.06] } },
        { t: 0.85, b: { hips: [0, 0.16, 0.10], chest: [0, -0.07, -0.04], head: [0, -0.08, 0.06] } },
        { t: 1, b: {} }
      ],
      osc: [{ bone: 'hips', axis: 1, amp: 0.16, freq: 4, phase: 0 }, { bone: 'chest', axis: 1, amp: -0.07, freq: 4, phase: 0.25 }, { bone: 'head', axis: 1, amp: -0.09, freq: 4, phase: 0.55 }]
    },
    {
      id: 'laugh', name: '唐笑', dur: 2000, expr: 'happy',
      keys: [
        { t: 0, b: {} },
        { t: 0.16, b: { head: [-0.24, 0, 0], chest: [-0.10, 0, 0], spine: [-0.05, 0, 0], leftUpperArm: [0, 0, -0.16], rightUpperArm: [0, 0, 0.16] } },
        { t: 0.84, b: { head: [-0.24, 0, 0], chest: [-0.10, 0, 0], spine: [-0.05, 0, 0], leftUpperArm: [0, 0, -0.16], rightUpperArm: [0, 0, 0.16] } },
        { t: 1, b: {} }
      ],
      osc: [{ bone: 'head', axis: 0, amp: 0.055, freq: 11, phase: 0 }, { bone: 'chest', axis: 0, amp: 0.03, freq: 11, phase: 0.5 }]
    },
    {
      id: 'bow', name: '鞠躬', dur: 1800,
      keys: [
        { t: 0, b: {} },
        { t: 0.26, b: { spine: [0.34, 0, 0], chest: [0.20, 0, 0], head: [0.12, 0, 0], hips: [0.05, 0, 0] } },
        { t: 0.55, b: { spine: [0.40, 0, 0], chest: [0.24, 0, 0], head: [0.14, 0, 0], hips: [0.06, 0, 0] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'stretch', name: '伸懒腰', dur: 2400,
      keys: [
        { t: 0, b: {} },
        { t: 0.24, b: { leftUpperArm: [0, 0, -1.55], rightUpperArm: [0, 0, 1.55], leftLowerArm: [-0.35, 0, 0], rightLowerArm: [-0.35, 0, 0], chest: [-0.14, 0, 0], head: [-0.12, 0, 0] } },
        { t: 0.55, b: { leftUpperArm: [0, 0, -1.85], rightUpperArm: [0, 0, 1.85], leftLowerArm: [-0.55, 0, 0], rightLowerArm: [-0.55, 0, 0], chest: [-0.20, 0, 0], head: [-0.18, 0, 0], spine: [-0.08, 0, 0] } },
        { t: 0.78, b: { leftUpperArm: [0, 0, -0.80], rightUpperArm: [0, 0, 0.80], leftLowerArm: [-0.20, 0, 0], rightLowerArm: [-0.20, 0, 0], chest: [-0.05, 0, 0], head: [-0.05, 0, 0] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'spin', name: '转圈', dur: 2200, expr: 'happy', spin: true,
      keys: [
        { t: 0, b: {} },
        { t: 0.2, b: { leftUpperArm: [0, 0, -0.35], rightUpperArm: [0, 0, 0.35], head: [0, 0.10, 0] } },
        { t: 0.8, b: { leftUpperArm: [0, 0, -0.35], rightUpperArm: [0, 0, 0.35], head: [0, -0.10, 0] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'salute', name: '敬礼', dur: 1700, expr: 'happy',
      keys: [
        { t: 0, b: {} },
        { t: 0.22, b: { rightUpperArm: [0, 0, 0.95], rightLowerArm: [0, -0.30, 1.55], head: [0.03, 0.06, -0.03], chest: [0, 0.04, 0] } },
        { t: 0.72, b: { rightUpperArm: [0, 0, 0.98], rightLowerArm: [0, -0.30, 1.60], head: [0.03, 0.06, -0.03], chest: [0, 0.04, 0] } },
        { t: 1, b: {} }
      ]
    },
    {
      id: 'shy', name: '捂脸', dur: 2000, expr: 'surprised',
      keys: [
        { t: 0, b: {} },
        { t: 0.2, b: { leftUpperArm: [-1.05, 0, -0.55], rightUpperArm: [-1.05, 0, 0.55], leftLowerArm: [0, 1.60, 0], rightLowerArm: [0, -1.60, 0], head: [0.16, 0, 0], chest: [0.05, 0, 0] } },
        { t: 0.75, b: { leftUpperArm: [-1.10, 0, -0.60], rightUpperArm: [-1.10, 0, 0.60], leftLowerArm: [0, 1.68, 0], rightLowerArm: [0, -1.68, 0], head: [0.18, 0, 0], chest: [0.06, 0, 0] } },
        { t: 1, b: {} }
      ]
    }
  ]

  function findAction(id) {
    for (var i = 0; i < ACTIONS3D.length; i++) if (ACTIONS3D[i].id === id) return ACTIONS3D[i]
    return null
  }

  function startAction(id) {
    if (!vr.on || !vr.vrm) return
    var a = findAction(id)
    if (!a) return
    var now = performance.now()
    vr.act = a
    vr.actStart = now
    vr.actEnd = now + a.dur
    vr.spinBase = vr.vrm.scene.rotation.y
    if (a.expr) { clearExprs(a.expr); vr.exprName = a.expr; vr.exprUntil = now + a.dur; setExpr(a.expr, 0.9) }
  }

  // 采样动作在 p（0..1）处的骨骼偏移
  function sampleAction(a, p) {
    var ks = a.keys || []
    var out = {}
    if (!ks.length) return out
    var i = 0
    while (i < ks.length - 1 && p > ks[i + 1].t) i++
    var k0 = ks[i], k1 = ks[Math.min(i + 1, ks.length - 1)]
    var span = Math.max(0.0001, k1.t - k0.t)
    var u = smoother((p - k0.t) / span)
    var b0 = k0.b || {}, b1 = k1.b || {}
    var names = {}
    for (var n in b0) names[n] = 1
    for (var m in b1) names[m] = 1
    for (var nm in names) {
      var v0 = b0[nm] || [0, 0, 0]
      var v1 = b1[nm] || [0, 0, 0]
      out[nm] = [lerpN(v0[0], v1[0], u), lerpN(v0[1], v1[1], u), lerpN(v0[2], v1[2], u)]
    }
    if (a.osc) {
      var env = Math.sin(Math.PI * Math.min(1, Math.max(0, p)))
      for (var oi = 0; oi < a.osc.length; oi++) {
        var o = a.osc[oi]
        var cur = out[o.bone] || [0, 0, 0]
        var val = Math.sin(p * Math.PI * 2 * o.freq + (o.phase || 0) * Math.PI * 2) * o.amp * env
        cur = [cur[0], cur[1], cur[2]]
        cur[o.axis] += val
        out[o.bone] = cur
      }
    }
    return out
  }

  function resizeVrm() {
    if (!vr.on || !vr.renderer || !vr.canvas) return
    var sw = (vr.canvas && vr.canvas.clientWidth) || stage.clientWidth || 180
    var sh = (vr.canvas && vr.canvas.clientHeight) || stage.clientHeight || 300
    vr.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    vr.renderer.setSize(sw, sh, false)
    vr.camera.aspect = sw / sh
    vr.camera.updateProjectionMatrix()
    if (vr.bbox) {
      var size = vr.bbox.size
      var center = vr.bbox.center
      var fov = vr.camera.fov * Math.PI / 180
      // 脚底在 y=0：按身高取景，画面底部≈脚底
      // 只按身高取景：T-pose 的臂展会算进 bbox 宽度，用它取景会把人物缩得很小
      var dist = (size.y * 0.5) / Math.tan(fov / 2) * 1.03
      var lookY = size.y * 0.5
      vr.camera.position.set(0, lookY, dist)
      vr.camera.lookAt(0, lookY, 0)
      vr.camera.updateMatrixWorld()
      vr.fit = { center: center, dist: dist }
    }
  }

  // 计算并应用一帧待机姿态（t=0 时也用来定初始姿势）
  function applyIdlePose(t, now, dt) {
    if (!vr.model) return
    dt = dt || 0.016
    var idle = REDUCED ? 0.35 : 1
    var lookX = vr.pointer.x
    var lookY = vr.pointer.y

    var pose = {
      spine: [Math.sin(t * 1.05) * 0.018 * idle, 0, 0],
      chest: [Math.sin(t * 1.05 + 0.5) * 0.014 * idle, 0, 0],
      hips: [0, Math.sin(t * 0.42) * 0.085 * idle, Math.sin(t * 0.42) * 0.02 * idle],
      neck: [Math.sin(t * 0.55) * 0.03 * idle + lookY * 0.05,
             Math.sin(t * 0.33) * 0.06 * idle + lookX * 0.10, 0],
      head: [Math.sin(t * 0.47 + 0.8) * 0.02 * idle + lookY * 0.04,
             Math.sin(t * 0.29) * 0.05 * idle + lookX * 0.08,
             Math.sin(t * 0.31) * 0.03 * idle],
      leftUpperArm: [0, 0, 1.18 + Math.sin(t * 0.9) * 0.03 * idle],
      rightUpperArm: [0, 0, -1.18 - Math.sin(t * 0.9 + 0.6) * 0.03 * idle],
      leftLowerArm: [0, 0.12, -0.12],
      rightLowerArm: [0, -0.12, 0.12]
    }

    // 动作：关键帧偏移叠加到待机姿势上
    if (vr.act) {
      var p3 = (vr.frozen != null) ? vr.frozen : (now - vr.actStart) / vr.act.dur
      if (p3 >= 1) {
        vr.act = null
        if (vr.spinBase !== undefined) { vr.vrm.scene.rotation.y = vr.spinBase; vr.spinBase = undefined }
      } else {
        var off = sampleAction(vr.act, p3)
        for (var k in off) {
          var base = pose[k] || [0, 0, 0]
          pose[k] = [base[0] + off[k][0], base[1] + off[k][1], base[2] + off[k][2]]
        }
        if (vr.act.spin && vr.spinBase !== undefined) {
          vr.vrm.scene.rotation.y = vr.spinBase + Math.PI * 2 * smoother(p3)
        }
      }
    }

    for (var bn in pose) setBone(bn, pose[bn][0], pose[bn][1], pose[bn][2])

    if (now > vr.blinkAt) {
      vr.blinkUntil = now + 110
      vr.blinkAt = now + 2600 + Math.random() * 4200
    }
    setExpr('blink', now < vr.blinkUntil ? 1 : 0)
    if (vr.exprName && now > vr.exprUntil) {
      // 到点必须把权重归零，否则表情会一直挂在脸上
      setExpr(vr.exprName, 0)
      vr.exprName = ''
    }
    if (vr.exprName) setExpr(vr.exprName, 1)

    if (vr.lookTarget && vr.fit && vr.bbox) {
      var c = vr.fit.center
      vr.lookTarget.position.set(c.x + lookX * 0.45, c.y + 0.55 + lookY * 0.25, c.z + 1.6)
    }

    if (vr.hopAt) {
      var hk = (now - vr.hopAt) / 420
      if (hk < 1) vr.vrm.scene.position.y = Math.sin(hk * Math.PI) * 0.06
      else { vr.vrm.scene.position.y = 0; vr.hopAt = 0 }
    }

    vr.frames = (vr.frames || 0) + 1
    vr.vrm.update(dt)
    vr.renderer.render(vr.scene, vr.camera)
  }

  function vrmLoop(now) {
    if (!vr.on) return
    vr.raf = requestAnimationFrame(vrmLoop)
    var dt = vr.last ? Math.min(0.06, (now - vr.last) / 1000) : 0.016
    vr.last = now
    if (!vr.vrm) return
    vr.clock += dt
    applyIdlePose(vr.clock, now, dt)
  }
  function stopVrm() {
    vr.loading = false
    if (vr.raf) cancelAnimationFrame(vr.raf)
    vr.raf = 0
    vr.on = false
    vr.last = 0
    if (root) root.classList.remove('tp-mode-3d')
    try { if (vr.renderer) vr.renderer.dispose() } catch (e) {}
    if (vr.scene) {
      vr.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          var m = o.material
          if (m.map) m.map.dispose()
          m.dispose()
        }
      })
    }
    vr.renderer = null
    vr.scene = null
    vr.camera = null
    vr.vrm = null
    vr.canvas = null
    vr.rest = null
    vr.bbox = null
    vr.fit = null
    if (layerBox) layerBox.innerHTML = ''
  }

  /* ------------------------------------------------------------- 点击/拖拽 */
  function bindPetEvents() {
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      pressDownFx()
      dragging = true; dragMoved = false
      dragStart = { sx: e.clientX, sy: e.clientY, ox: root.offsetLeft, oy: root.offsetTop, t: Date.now() }
      try { stage.setPointerCapture(e.pointerId) } catch (err) {}
    })
    stage.addEventListener('pointermove', function (e) {
      if (!dragging || !dragStart) return
      // 采样拖动速度，松手时用于甩抛
      var nowT = Date.now()
      dragVel.push({ t: nowT, x: e.clientX, y: e.clientY })
      if (dragVel.length > 6) dragVel.shift()
      var dx = e.clientX - dragStart.sx
      var dy = e.clientY - dragStart.sy
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) {
        dragMoved = true
        resetPressFx()         // 一旦开始拖动就恢复原状，拖动过程中保持正常比例
        root.classList.add('tp-dragging')
        if (menuOpen) closeMenu()
        playRandomPress()      // 拖拽开始也算一次按压
      }
      lastInputAt = Date.now()
      if (dragMoved) setPos(dragStart.ox + dx, dragStart.oy + dy, false)
    })
    stage.addEventListener('pointerup', function (e) {
      if (!dragging) return
      dragging = false
      root.classList.remove('tp-dragging')
      if (dragMoved) {
        setPos(root.offsetLeft, root.offsetTop, true)
        if (!startThrow()) snapToEdge()
        if (menuOpen) positionMenu()
        resetPressFx()
      } else {
        touch()               // 左键单击 = 摸一下
        pressUpFx()
      }
      dragStart = null
      dragVel.length = 0
    })
    stage.addEventListener('pointercancel', function () {
      dragging = false; dragStart = null; dragVel.length = 0
      root.classList.remove('tp-dragging')
      resetPressFx()
      snapToEdge()
    })
    stage.addEventListener('pointermove', function (e) {
      if (!vr.on || !stage) return
      var r = stage.getBoundingClientRect()
      vr.pointer.x = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1)
      vr.pointer.y = clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1, 1) * -1
    })
    stage.addEventListener('pointerleave', function () {
      vr.pointer.x = 0
      vr.pointer.y = 0
    })
    stage.addEventListener('contextmenu', function (e) {
      e.preventDefault()
      e.stopPropagation()
      if (menuOpen) closeMenu(); else openMenu('setting')
    })
    // 滚轮缩放（不改变位置，只以底边为锚）
    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      resizeKeepingAnchor((Number(state.h) || 300) + (e.deltaY > 0 ? -20 : 20))
    }, { passive: false })
  }

  // 左键 = 触摸：语音 + 抖一下 + 小爱心
  // 按下：压扁；松开：回弹 + 轻微上跳（参考大肥鱼插件的按压手感）
  var tapTimer = 0
  function pressDownFx() {
    if (vr.on) return
    if (!stage) return
    clearTimeout(tapTimer)
    stage.classList.remove('tp-tap')
    stage.style.transition = 'transform .1s ease-out'
    stage.style.transform = 'scaleY(.9) scaleX(1.06)'
  }
  function pressUpFx() {
    if (vr.on) return
    if (!stage) return
    stage.style.transition = 'transform .18s cubic-bezier(.34,1.56,.64,1)'
    stage.style.transform = ''
    clearTimeout(tapTimer)
    if (REDUCED || state.motionOn === false) return
    tapTimer = setTimeout(function () {
      if (!stage) return
      stage.style.transition = ''
      stage.classList.add('tp-tap')
      setTimeout(function () { if (stage) stage.classList.remove('tp-tap') }, 520)
    }, 150)
  }

  // 还原到未按压的形状（拖动/取消时用，不做回弹动画）
  function resetPressFx() {
    if (vr.on) { if (stage) { stage.style.transition = ''; stage.style.transform = '' } return }
    if (!stage) return
    clearTimeout(tapTimer)
    stage.classList.remove('tp-tap')
    stage.style.transition = 'transform .16s ease-out'
    stage.style.transform = ''
  }

  function touch() {
    vrReact('happy')
    if (vr.on) {
      var pool = ACTIONS3D
      startAction(pool[Math.floor(Math.random() * pool.length)].id)
    }
    lastInputAt = Date.now()
    touchAt = performance.now()
    playRandomPress()
    floatHearts(1 + Math.floor(Math.random() * 2))
    if (menuOpen) closeMenu()
    bubbleSay()
    renderBubble(true)
  }

  function clearAction() {
    act = null
    busyUntil = 0
    if (!stage) return
    for (var k in CSS_CLASS) stage.classList.remove(CSS_CLASS[k])
    root.classList.remove('tp-acting')
  }

  function doAction(id) {
    var a = null
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) a = ACTIONS[i]
    if (!a) return
    clearAction()   // 动作没做完又被触发 → 直接重置重来
    // 动作只给小菲（大菲是写实全身立绘，做整体动作容易穿帮）
    if (state.form !== 'small') return
    busyUntil = Date.now() + a.ms
    if (rig) {
      act = { id: id, start: performance.now(), ms: a.ms }
    } else if (stage) {
      var cls = CSS_CLASS[id]
      if (!cls) return
      stage.classList.add(cls)
      root.classList.add('tp-acting')
      setTimeout(function () {
        stage.classList.remove(cls)
        root.classList.remove('tp-acting')
      }, a.ms)
    }
    if (id === 'heart') floatHearts(3)
    if (id === 'greet') floatHearts(1)
  }

  function floatHearts(n) {
    for (var i = 0; i < (n || 1); i++) (function (i) {
      setTimeout(function () {
        var h = el('div', 'tp-fx-heart', '💗')
        h.style.left = (30 + Math.random() * 38) + '%'
        layerBox.appendChild(h)
        setTimeout(function () { h.remove() }, 1400)
      }, i * 130)
    })(i)
  }
  function floatStars() {
    for (var i = 0; i < 3; i++) (function (i) {
      setTimeout(function () {
        var s = el('div', 'tp-fx-star', '✨')
        s.style.left = (26 + Math.random() * 48) + '%'
        layerBox.appendChild(s)
        setTimeout(function () { s.remove() }, 1300)
      }, i * 140)
    })(i)
  }

  /* ---------------------------------------------------------------- 气泡 */
  // 台词统一带「喵」尾音，贴合塔菲说话风格
  var SAYS = [
    '钦～喵', '草喵～', '摸摸头喵', '塔菲在这里喵', '不许摸太多次哦喵', '在的在的喵',
    '今天也要加油喵', '累了就休息一下喵', '记得喝水喵', '塔菲看着你哦喵',
    '关注塔菲谢谢喵', '塔菲喵喵叫～', '再摸就要收费了喵', '陪我玩一会儿喵',
    '你今天也很努力喵', '摸摸尾巴也可以喵'
  ]
  var bubbleTimer = 0
  var lastSay = ''
  function bubbleSay() {
    lastSay = SAYS[Math.floor(Math.random() * SAYS.length)]
    return lastSay
  }
  function renderBubble(show, say) {
    if (!bubble) return
    sizeBubble()
    if (!state.bubbleOn) { bubble.classList.remove('tp-pop'); return }
    if (say !== undefined && say !== '') lastSay = say
    var sayLine = lastSay && show ? '<div class="tp-say">' + escapeHtml(lastSay) + '</div>' : ''
    var balText = balanceInfo.ok ? balanceInfo.text : (balanceInfo.text || '—')
    var html = sayLine
      + '<div class="tp-bal"><span class="tp-bal-label">余额</span>'
      + '<span class="tp-bal-num">' + escapeHtml(balText) + '</span></div>'
    var meta = []
    if (state.showToday && todayInfo.amount) {
      meta.push('<span class="tp-met"><i>今日</i>' + escapeHtml(money(todayInfo.amount)) + '</span>')
    }
    if (state.showLast && lastTurnInfo.amount) {
      meta.push('<span class="tp-met"><i>本轮</i>' + escapeHtml(money(lastTurnInfo.amount))
        + (lastTurnInfo.tokens ? '<em>' + fmtTokens(lastTurnInfo.tokens) + ' tok</em>' : '') + '</span>')
    }
    if (meta.length) html += '<div class="tp-metas">' + meta.join('') + '</div>'
    bubble.innerHTML = html
    if (show) {
      placeBubble()
      bubble.classList.add('tp-pop')
      clearTimeout(bubbleTimer)
      bubbleTimer = setTimeout(function () { bubble.classList.remove('tp-pop') }, 3800)
    }
  }
  // 气泡自适应摆位：优先在头顶两侧，其次左右，最后上下；贴着窗口在哪就换到空的一侧
  function placeBubble() {
    if (!bubble) return
    var pad = 10, gap = 12
    bubble.style.visibility = 'hidden'
    bubble.style.left = '0px'
    bubble.style.top = '0px'
    var bw = bubble.offsetWidth || 220
    var bh = bubble.offsetHeight || 120
    var rect = root.getBoundingClientRect()
    var rw = rect.width, rh = rect.height
    var headY = rh * 0.22
    var cands = [
      ['tl', -bw - gap, headY - bh * 0.6],
      ['tr', rw + gap, headY - bh * 0.6],
      ['bl', -bw - gap, headY + rh * 0.30 - bh * 0.5],
      ['br', rw + gap, headY + rh * 0.30 - bh * 0.5],
      ['tc', Math.round((rw - bw) / 2), -bh - gap],
      ['bc', Math.round((rw - bw) / 2), rh + gap]
    ]
    var pick = null
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]
      var x0 = rect.left + c[1], y0 = rect.top + c[2]
      if (x0 >= pad && y0 >= pad && x0 + bw <= window.innerWidth - pad && y0 + bh <= window.innerHeight - pad) {
        pick = c; break
      }
    }
    if (!pick) {
      // 都放不下：夹回可视区，仍以头顶上方为准
      var c2 = cands[4]
      c2[1] = Math.min(Math.max(rect.left + c2[1], pad), window.innerWidth - pad - bw) - rect.left
      c2[2] = Math.min(Math.max(rect.top + c2[2], pad), window.innerHeight - pad - bh) - rect.top
      pick = c2
    }
    bubble.classList.remove('tp-tl', 'tp-tr', 'tp-bl', 'tp-br', 'tp-tc', 'tp-bc')
    bubble.classList.add('tp-' + pick[0])
    bubble.style.left = Math.round(pick[1]) + 'px'
    bubble.style.top = Math.round(pick[2]) + 'px'
    bubble.style.visibility = ''
  }

  /* ---------------------------------------------------------------- 菜单 */
  var TABS = [
    { id: 'outfit', label: '换装' },
    { id: 'action', label: '动作' },
    { id: 'sound', label: '声音' },
    { id: 'setting', label: '设置' }
  ]

  function toggleMenu(tab) {
    if (menuOpen) closeMenu(); else openMenu(tab)
  }
  function openMenu(tab) {
    if (tab) currentTab = tab
    if (menuOpen) { renderMenu(); return }
    menuOpen = true
    if (!menuEl) {
      menuEl = el('div', 'tp-menu')
      menuEl.addEventListener('pointerdown', function (e) { e.stopPropagation() })
      menuEl.addEventListener('contextmenu', function (e) { e.preventDefault() })
      document.body.appendChild(menuEl)
    }
    menuEl.classList.add('tp-menu-open')
    root.classList.add('tp-menu-on')
    refreshBilling()
    // 每次打开菜单都重读一次 manifest：换了素材只要重开菜单就能看到，不用刷新页面
    loadArt().then(function (changed) {
      if (!menuOpen || !changed) return
      renderFigure()
      renderMenu()
      positionMenu()
    })
    renderMenu()
    positionMenu()
    setTimeout(function () { document.addEventListener('pointerdown', outsideClose) }, 0)
  }
  function closeMenu() {
    menuOpen = false
    if (menuEl) menuEl.classList.remove('tp-menu-open')
    if (root) root.classList.remove('tp-menu-on')
    document.removeEventListener('pointerdown', outsideClose)
  }
  function outsideClose(e) {
    if (!menuOpen) return
    if (menuEl && menuEl.contains(e.target)) return
    if (root && root.contains(e.target)) return
    closeMenu()
  }
  function positionMenu() {
    if (!menuEl || !root) return
    var r = root.getBoundingClientRect()
    var mw = menuEl.offsetWidth || 344
    var mh = menuEl.offsetHeight || 420
    var left = r.left - mw - 14
    if (left < 8) left = Math.min(window.innerWidth - mw - 8, r.right + 14)
    var top = r.bottom - mh
    top = clamp(top, 10, Math.max(10, window.innerHeight - mh - 10))
    menuEl.style.left = Math.round(clamp(left, 8, Math.max(8, window.innerWidth - mw - 8))) + 'px'
    menuEl.style.top = Math.round(top) + 'px'
  }

  function renderMenu() {
    if (!menuEl || !menuOpen) return
    var o = currentOutfit()
    var avaSrc = o ? artUrl(figPath(o)) : ''
    var head = '<div class="tp-mhead">'
      + '<div class="tp-mava">' + (avaSrc ? '<img src="' + avaSrc + '" alt="">' : '<span>菲</span>') + '</div>'
      + '<div class="tp-mtitle"><b>永雏塔菲</b><small>' + escapeHtml((o && o.name) || '素材未就绪') + ' · ' + (state.form === 'small' ? '小菲' : '大菲') + '</small></div>'
      + '<div class="tp-mstat">' + (balanceInfo.ok ? balanceInfo.text : (balanceInfo.text || '—'))
      + '<small>' + (lastTurnInfo.amount ? '本轮 ' + money(lastTurnInfo.amount) : (todayInfo.amount ? '今日 ' + money(todayInfo.amount) : '余额')) + '</small></div>'
      + '</div>'
    var tabs = '<div class="tp-mtabs">' + TABS.map(function (t) {
      return '<button data-tab="' + t.id + '" class="' + (currentTab === t.id ? 'on' : '') + '">' + t.label + '</button>'
    }).join('') + '</div>'
    menuEl.innerHTML = head + tabs + '<div class="tp-mbody">' + renderTab() + '</div>'
    bindMenu()
    positionMenu()
  }

  function renderTab() {
    var modeSeg = '<div class="tp-seg tp-mode-seg">'
      + '<button class="' + (state.mode !== '3d' ? 'on' : '') + '" data-mode="2d">2D 立绘</button>'
      + '<button class="' + (state.mode === '3d' ? 'on' : '') + '" data-mode="3d">3D 模型</button></div>'
    if (currentTab === 'outfit') {
      if (state.mode === '3d') {
        return modeSeg + modelRows()
      }
      var sm = smallMap()
      var list = state.form === 'small'
        ? art.outfits.filter(function (o) { return !!o.small })
        : art.outfits
      if (!list.length) return '<div class="tp-empty">还没有素材～把立绘放进 ~/.dsh/taffy-pet/art/outfits/</div>'
      var formRow = '<div class="tp-seg"><button class="' + (state.form === 'big' ? 'on' : '') + '" data-form="big">大菲</button>'
        + '<button class="' + (state.form === 'small' ? 'on' : '') + '" data-form="small"' + (Object.keys(sm).length ? '' : ' disabled') + '>小菲</button></div>'
      var cur = state.form === 'small' ? state.outfitSmall : state.outfit
      var grid = '<div class="tp-grid tp-grid-outfit">' + list.map(function (x) {
        var dim = state.form === 'small' && !x.small ? ' dim' : ''
        var on = x.id === cur
        var file = (state.form === 'small' && x.small) ? x.small : ('outfits/' + x.file)
        return '<button class="tp-pick' + (on ? ' on' : '') + dim + '" data-outfit="' + escapeAttr(x.id) + '" data-small="' + (x.small ? '1' : '') + '">'
          + '<span class="tp-pick-img"><img loading="lazy" src="' + artUrl('art/' + file) + '" alt=""></span>'
          + '<span class="tp-pick-name">' + escapeHtml(x.name || x.id) + '</span></button>'
      }).join('') + '</div>'
      return modeSeg + formRow + grid + '<div class="tp-tip">右键桌宠打开菜单；左键单击是「摸一下」。</div>'
    }
    if (currentTab === 'action') {
      if (!vr.on) {
        return '<div class="tp-empty">动作现在只给 3D 模型用～<br>在上面「换装」里切到 3D 模型再回来。</div>'
      }
      return '<div class="tp-grid tp-grid-btn3">' + ACTIONS3D.map(function (a) {
        return '<button class="tp-actbtn" data-act3d="' + a.id + '">' + a.name + '</button>'
      }).join('') + '</div><div class="tp-tip">都是塔菲直播里的经典动作。<br>点桌宠也会随机做一个。</div>'
    }
    if (currentTab === 'sound') {
      return ''
        + '<div class="tp-row"><span>按压音效</span><button class="tp-switch ' + (state.soundOn ? 'on' : '') + '" data-toggle="soundOn"><i></i></button></div>'
        + '<div class="tp-row"><span>音量</span><span class="tp-range-wrap"><input type="range" min="0" max="100" value="' + Math.round(state.vol * 100) + '" data-vol></span><b class="tp-val">' + Math.round(state.vol * 100) + '%</b></div>'
        + '<div class="tp-row"><span>语音池</span><b>' + fragPool.length + ' 段随机</b></div>'
        + '<div class="tp-voice-head"><span>全部语音（点哪条放哪条）</span><button class="tp-btn tp-btn-mini" data-test-sound>随机一句</button></div>'
        + '<div class="tp-voice-list">' + (fragList.length ? fragList.map(function (f, i) {
            return '<button class="tp-voice-item" data-voice="' + escapeAttr(f.id) + '"><i>' + (i + 1) + '</i><span>' + escapeHtml(f.name) + '</span></button>'
          }).join('') : '<div class="tp-empty">还没有语音素材</div>') + '</div>'
        + '<div class="tp-tip">按压 / 触摸时从上面这些里随机播一条，平时不响。</div>'
    }
    // 设置
    return ''
      + '<div class="tp-row"><span>大小</span><span class="tp-range-wrap"><input type="range" min="160" max="520" step="10" value="' + (Number(state.h) || 300) + '" data-h></span><b class="tp-val">' + (Number(state.h) || 300) + '</b></div>'
      + '<div class="tp-sub">计费显示</div>'
      + '<div class="tp-row"><span>按压弹出余额</span><button class="tp-switch ' + (state.bubbleOn ? 'on' : '') + '" data-toggle="bubbleOn"><i></i></button></div>'
      + '<div class="tp-row"><span>显示今日消耗</span><button class="tp-switch ' + (state.showToday ? 'on' : '') + '" data-toggle="showToday"><i></i></button></div>'
      + '<div class="tp-row"><span>显示本轮消耗</span><button class="tp-switch ' + (state.showLast ? 'on' : '') + '" data-toggle="showLast"><i></i></button></div>'
      + '<div class="tp-row"><span>刷新间隔</span><span class="tp-seg tp-seg-mini">'
      + [30, 60, 120, 300].map(function (s) { return '<button class="' + (Number(state.refreshSec) === s ? 'on' : '') + '" data-refresh="' + s + '">' + (s >= 60 ? (s / 60) + '分' : s + '秒') + '</button>' }).join('')
      + '</span></div>'
      + '<div class="tp-sub">互动</div>'
      + '<div class="tp-row"><span>碎碎念</span><button class="tp-switch ' + (state.whisperOn ? 'on' : '') + '" data-toggle="whisperOn"><i></i></button></div>'
      + '<div class="tp-row"><span>碎碎念间隔</span><span class="tp-seg tp-seg-mini">'
      + [30, 45, 60, 120].map(function (m) { return '<button class="' + (Number(state.whisperMin) === m ? 'on' : '') + '" data-whisper="' + m + '">' + m + '分</button>' }).join('')
      + '</span></div>'
      + '<div class="tp-row"><span>任务完成通知</span><button class="tp-switch ' + (state.notifyOn ? 'on' : '') + '" data-toggle="notifyOn"><i></i></button></div>'
      + '<div class="tp-row"><span>按压动效</span><button class="tp-switch ' + (state.motionOn ? 'on' : '') + '" data-toggle="motionOn"><i></i></button></div>'
      + '<div class="tp-actions2"><button class="tp-btn" data-reset-pos>回到右下角</button><button class="tp-btn tp-btn-pink" data-refresh-bal>刷新余额</button></div>'
      + '<div class="tp-actions2"><button class="tp-btn" data-quit>收起桌宠</button><button class="tp-btn" data-open-dir>素材目录</button></div>'
      + '<div class="tp-actions2"><button class="tp-btn" data-reload>重新加载桌宠</button></div>'
      + '<div class="tp-tip">当前余额 ' + (balanceInfo.ok ? balanceInfo.text : '—') + ' · 账本继承自小鲸鱼插件<br>素材：~/.dsh/taffy-pet/art/</div>'
  }

  function modelRows() {
    var list = vr.entries || []
    if (!list.length) {
      return '<div class="tp-tip">还没找到 3D 模型。<br>把官方 <b>.vrm</b> 放到 <b>~/.dsh/taffy-pet/vrm/</b>，再点「重新加载桌宠」。</div>'
        + '<div class="tp-actions2"><button class="tp-btn" data-open-vrm-dir>打开模型目录</button></div>'
    }
    var cur = currentModel()
    var curPath = cur ? cur.path : ''
    return '<div class="tp-row"><span>模型</span><b class="tp-val">' + escapeHtml(cur ? cur.label : '') + '</b></div>'
      + '<div class="tp-seg tp-seg-mini tp-vrm-list">'
      + list.map(function (en) {
        return '<button class="' + (en.path === curPath ? 'on' : '') + '" data-vrm="' + escapeAttr(en.path) + '">'
          + escapeHtml(en.label) + '</button>'
      }).join('')
      + '</div>'
      + '<div class="tp-tip">VRM 放 <b>~/.dsh/taffy-pet/vrm/</b>；MMD 的 <b>.pmx</b> 放 <b>~/.dsh/taffy-pet/models/&lt;名字&gt;/model.pmx</b>（贴图平铺在同目录）。</div>'
  }

  function bindMenu() {
    menuEl.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { currentTab = b.getAttribute('data-tab'); renderMenu() })
    })
    menuEl.querySelectorAll('[data-act3d]').forEach(function (b) {
      b.addEventListener('click', function () {
        startAction(b.getAttribute('data-act3d'))
        closeMenu()
      })
    })
    menuEl.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode')
        if (m === state.mode) return
        state.mode = m
        saveState()
        if (m === '2d' && vr.on) stopVrm()
        renderFigure()
        renderMenu()
        pressUpFx()
      })
    })
    menuEl.querySelectorAll('[data-open-vrm-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        alert(['3D 模型目录：', '~/.dsh/taffy-pet/vrm/', '', '把官方模型解压出的 .vrm 文件放进去，', '再点「重新加载桌宠」。'].join('\n'))
      })
    })
    menuEl.querySelectorAll('[data-vrm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-vrm')
        if (f === state.vrmFile) return
        state.vrmFile = f
        saveState()
        if (vr.on) stopVrm()
        renderFigure()
        renderMenu()
      })
    })
    menuEl.querySelectorAll('[data-form]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-form')
        if (f === 'small' && !Object.keys(smallMap()).length) return
        state.form = f; saveState(); renderFigure(); renderMenu()
        pressUpFx()
      })
    })
    menuEl.querySelectorAll('[data-outfit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-outfit')
        var hasSmall = b.getAttribute('data-small') === '1'
        if (state.form === 'small') {
          if (!hasSmall) { state.form = 'big' }
          else state.outfitSmall = id
        }
        state.outfit = id
        saveState(); renderFigure(); renderMenu(); pressUpFx()
      })
    })
    menuEl.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-toggle')
        state[k] = !state[k]; saveState()
        if (k === 'bubbleOn') renderBubble(false)
        if (k === 'whisperOn') scheduleWhisper()
        if (k === 'notifyOn' && state.notifyOn && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(function () {})
        }
        renderMenu()
      })
    })
    menuEl.querySelectorAll('[data-whisper]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.whisperMin = Number(b.getAttribute('data-whisper')); saveState(); scheduleWhisper(); renderMenu()
      })
    })
    menuEl.querySelectorAll('[data-refresh]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.refreshSec = Number(b.getAttribute('data-refresh')); saveState(); startPolling(); renderMenu()
      })
    })
    var vol = menuEl.querySelector('[data-vol]')
    if (vol) vol.addEventListener('input', function () {
      state.vol = Number(vol.value) / 100; saveState()
      var v = menuEl.querySelector('.tp-val'); if (v) v.textContent = vol.value + '%'
    })
    var hh = menuEl.querySelector('[data-h]')
    if (hh) {
      hh.addEventListener('input', function () {
        var v = menuEl.querySelector('.tp-val'); if (v) v.textContent = hh.value
        resizeKeepingAnchor(Number(hh.value), true)   // 拖动过程中菜单保持不动
      })
      hh.addEventListener('change', function () {
        snapToEdge()                                  // 改完大小重新贴边
        positionMenu()                                // 松手后再把菜单对齐一次
      })
    }
    menuEl.querySelectorAll('[data-voice]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-voice')
        menuEl.querySelectorAll('.tp-voice-item.on').forEach(function (x) { x.classList.remove('on') })
        b.classList.add('on')
        var save = state.soundOn; state.soundOn = true
        playSound(id); state.soundOn = save
      })
    })
    var ts = menuEl.querySelector('[data-test-sound]')
    if (ts) ts.addEventListener('click', function () {
      if (!fragPool.length) return
      var save = state.soundOn; state.soundOn = true
      playSound(fragPool[Math.floor(Math.random() * fragPool.length)]); state.soundOn = save
    })
    var rp = menuEl.querySelector('[data-reset-pos]')
    if (rp) rp.addEventListener('click', function () {
      var w = root.offsetWidth, h = root.offsetHeight
      setPos(window.innerWidth - w - 26, window.innerHeight - h - 18, true)
      positionMenu()
    })
    var rb = menuEl.querySelector('[data-refresh-bal]')
    if (rb) rb.addEventListener('click', function () {
      loadBalance(true).then(function () { renderMenu(); renderBubble(true) })
    })
    var qt = menuEl.querySelector('[data-quit]')
    if (qt) qt.addEventListener('click', function () {
      root.style.display = 'none'; closeMenu()
      var tip = el('div', 'tp-revive', '点这里收回塔菲')
      document.body.appendChild(tip)
      tip.addEventListener('click', function () { root.style.display = ''; tip.remove() })
    })
    var rl = menuEl.querySelector('[data-reload]')
    if (rl) rl.addEventListener('click', function () { location.reload() })
    var od = menuEl.querySelector('[data-open-dir]')
    if (od) od.addEventListener('click', function () {
      alert('素材目录：\n~/.dsh/taffy-pet/art/outfits/\n~/.dsh/taffy-pet/art/small/\n~/.dsh/taffy-pet/art/rig/')
    })
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function escapeAttr(s) { return escapeHtml(s) }

  /* -------------------------------------------------------------------- CSS */
  var CSS = ''
    + ':root{--tp-pink:#ff7eb3;--tp-pink-2:#ff9cc4;--tp-pink-3:#ffe3ef;--tp-pink-4:#fff3f8;--tp-ink:#5b3246;--tp-ink-2:#8d6280;--tp-line:rgba(255,126,179,.28)}'
    + '#tp-root{position:fixed;left:0;top:0;z-index:2147482000;user-select:none;-webkit-user-select:none;pointer-events:none;height:var(--tp-h,300px)}'
    + '#tp-root .tp-stage{position:relative;width:100%;height:100%;transform-origin:bottom center;pointer-events:auto;cursor:grab}'
    + '#tp-root.tp-dragging .tp-stage{cursor:grabbing}'
    + '#tp-root .tp-layers{position:absolute;inset:0;pointer-events:none}'
    + '#tp-root .tp-vrm{position:absolute;left:-80%;bottom:0;width:260%;height:100%;display:block;pointer-events:none}'
    + '#tp-root.tp-mode-3d .tp-body{display:none}'
    + '#tp-root .tp-vrm-list{flex-wrap:wrap;justify-content:flex-start;gap:6px}'
    + '#tp-root .tp-body{position:absolute;left:0;bottom:0;width:100%;height:100%;object-fit:contain;object-position:bottom center;filter:drop-shadow(0 10px 14px rgba(190,90,140,.22));pointer-events:none}'
    + '#tp-root .tp-part{position:absolute;pointer-events:none;will-change:transform}'
    + '#tp-root.tp-rig .tp-stage{filter:drop-shadow(0 10px 14px rgba(190,90,140,.2))}'
    + '#tp-root .tp-shadow{position:absolute;left:50%;bottom:-6px;width:56%;height:14px;transform:translateX(-50%);background:radial-gradient(ellipse at center,rgba(190,90,140,.28),rgba(190,90,140,0) 70%);pointer-events:none}'
    + '#tp-root .tp-fx-heart,#tp-root .tp-fx-star{position:absolute;bottom:34%;font-size:20px;animation:tp-fx 1.3s ease-out forwards}'
    + '@keyframes tp-fx{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(-90px) scale(1.2);opacity:0}}'
    + '#tp-root .tp-bubble{position:absolute;left:0;top:0;transform:scale(.9);transform-origin:50% 50%;'
    + 'min-width:11.6em;max-width:min(78vw,20em);padding:1.45em 2em 1.65em;'
    + 'background:radial-gradient(120% 120% at 28% 18%,#ffffff 0%,#fff4f9 46%,#ffe1ee 100%);'
    + 'border:2px solid rgba(255,255,255,.98);color:var(--tp-ink);font-size:13px;line-height:1.4;'
    + 'border-radius:48% 52% 47% 53% / 50% 47% 53% 50%;'
    + 'box-shadow:0 2px 6px rgba(255,255,255,.9) inset,0 16px 36px -10px rgba(226,90,150,.5),0 6px 16px rgba(226,90,150,.2);'
    + 'opacity:0;transition:opacity .2s ease,transform .3s cubic-bezier(.34,1.56,.64,1);'
    + 'pointer-events:none;font-family:inherit;text-align:center;display:block}'
    + '#tp-root .tp-bubble.tp-pop{opacity:1;transform:scale(1)}'
    // 气泡尾巴：两个小圆点，指向右下方的桌宠
    + '#tp-root .tp-bubble:before,#tp-root .tp-bubble:after{content:"";position:absolute;border-radius:50%;'
    + 'background:radial-gradient(120% 120% at 30% 20%,#ffffff,#ffe1ee 70%);'
    + 'border:1.5px solid rgba(255,255,255,.98);box-shadow:0 3px 10px rgba(226,90,150,.22)}'
    + '#tp-root .tp-bubble:after{width:1.15em;height:1.15em}'
    + '#tp-root .tp-bubble:before{width:.68em;height:.68em}'
    // 尾巴四个朝向：tl=气泡在宠物左上、tr=右上、bl=左下、br=右下、tc=正上、bc=正下
    + '#tp-root .tp-bubble.tp-tl:after{right:.65em;bottom:-.95em}'
    + '#tp-root .tp-bubble.tp-tl:before{right:.05em;bottom:-1.7em}'
    + '#tp-root .tp-bubble.tp-tr:after{left:.65em;bottom:-.95em}'
    + '#tp-root .tp-bubble.tp-tr:before{left:.05em;bottom:-1.7em}'
    + '#tp-root .tp-bubble.tp-bl:after{right:.65em;top:-.95em}'
    + '#tp-root .tp-bubble.tp-bl:before{right:.05em;top:-1.7em}'
    + '#tp-root .tp-bubble.tp-br:after{left:.65em;top:-.95em}'
    + '#tp-root .tp-bubble.tp-br:before{left:.05em;top:-1.7em}'
    + '#tp-root .tp-bubble.tp-tc:after{left:50%;margin-left:-.58em;bottom:-.95em}'
    + '#tp-root .tp-bubble.tp-tc:before{left:50%;margin-left:-.34em;bottom:-1.7em}'
    + '#tp-root .tp-bubble.tp-bc:after{left:50%;margin-left:-.58em;top:-.95em}'
    + '#tp-root .tp-bubble.tp-bc:before{left:50%;margin-left:-.34em;top:-1.7em}'
    + '#tp-root .tp-bubble .tp-say{color:#d6438a;font-size:.98em;font-weight:700;letter-spacing:.3px;'
    + 'margin:0 0 .55em;padding-bottom:.5em;border-bottom:1px dashed rgba(232,140,178,.5)}'
    + '#tp-root .tp-bal{display:flex;align-items:baseline;justify-content:center;gap:.5em;white-space:nowrap}'
    + '#tp-root .tp-bal-label{font-size:.86em;color:#c98aa8;letter-spacing:.2em;transform:translateY(-.25em)}'
    + '#tp-root .tp-bal-num{font-size:2.05em;font-weight:800;letter-spacing:-.02em;line-height:1.15;'
    + 'background:linear-gradient(135deg,#ff7ab8,#e0327d 60%,#c21f6b);-webkit-background-clip:text;background-clip:text;color:transparent;'
    + 'filter:drop-shadow(0 2px 3px rgba(226,90,150,.28))}'
    + '#tp-root .tp-metas{display:flex;justify-content:center;gap:.9em;margin-top:.55em;white-space:nowrap;flex-wrap:nowrap}'
    + '#tp-root .tp-met{font-size:.9em;color:#a8597e;display:inline-flex;align-items:baseline;gap:.32em}'
    + '#tp-root .tp-met i{font-style:normal;font-size:.8em;color:#cf98b3;letter-spacing:.08em}'
    + '#tp-root .tp-met em{font-style:normal;font-size:.78em;color:#cf98b3;margin-left:.15em}'
    + '#tp-root .tp-bubble b{color:var(--tp-pink);font-weight:600}'
    + '.tp-voice-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--tp-ink2);margin:12px 2px 6px}'
    + '.tp-voice-list{max-height:236px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--tp-line);border-radius:12px;background:#fff;padding:4px}'
    + '.tp-voice-list::-webkit-scrollbar{width:8px}'
    + '.tp-voice-list::-webkit-scrollbar-thumb{background:#ffc6dd;border-radius:8px}'
    + '.tp-voice-list::-webkit-scrollbar-track{background:transparent}'
    + '.tp-voice-item{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:6px 8px;border-radius:8px;font-size:12px;color:var(--tp-ink);font-family:inherit;cursor:pointer}'
    + '.tp-voice-item:hover{background:#fff2f7}'
    + '.tp-voice-item.on{background:#ffe3ee}'
    + '.tp-voice-item i{flex:none;width:22px;height:22px;border-radius:7px;background:#ffe3ee;color:#c2377a;font-style:normal;font-size:11px;display:flex;align-items:center;justify-content:center}'
    + '.tp-voice-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.tp-btn-mini{padding:4px 10px;font-size:12px;border-radius:9px;min-height:0}'
    + '#tp-root .tp-bubble .tp-dot{margin:0 6px;color:#e6b9cd}'
    // 无骨架时的整体动作
    + '@keyframes tp-bounce{0%,100%{transform:translateY(0) scale(1,1)}30%{transform:translateY(-16px) scale(.96,1.04)}60%{transform:translateY(0) scale(1.06,.94)}80%{transform:translateY(-4px)}}'
    + '#tp-root .tp-a-bounce{animation:tp-bounce .9s ease-in-out}'
    + '@keyframes tp-hop{0%{transform:translateY(0) rotate(0)}35%{transform:translateY(-54px) rotate(-6deg)}60%{transform:translateY(-8px) rotate(4deg)}100%{transform:translateY(0) rotate(0)}}'
    + '#tp-root .tp-a-hop{animation:tp-hop .82s cubic-bezier(.3,.8,.4,1)}'
    + '@keyframes tp-dance{0%,100%{transform:rotate(0) translateY(0)}20%{transform:rotate(-7deg) translateY(-6px)}40%{transform:rotate(6deg) translateY(0)}60%{transform:rotate(-5deg) translateY(-5px)}80%{transform:rotate(4deg) translateY(0)}}'
    + '#tp-root .tp-a-dance{animation:tp-dance 2s ease-in-out}'
    + '@keyframes tp-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}'
    + '#tp-root .tp-a-spin{animation:tp-spin 1.1s ease-in-out}'
    + '@keyframes tp-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px) rotate(-2deg)}40%{transform:translateX(5px) rotate(2deg)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}'
    + '#tp-root .tp-a-shake{animation:tp-shake .7s ease-in-out}'
    + '@keyframes tp-tiltl{0%,100%{transform:rotate(0)}45%{transform:rotate(-9deg) translateX(-4px)}}'
    + '#tp-root .tp-a-tiltl{animation:tp-tiltl 1.2s ease-in-out}'
    + '@keyframes tp-tiltr{0%,100%{transform:rotate(0)}45%{transform:rotate(9deg) translateX(4px)}}'
    + '#tp-root .tp-a-tiltr{animation:tp-tiltr 1.2s ease-in-out}'
    + '@keyframes tp-wave{0%,100%{transform:rotate(0)}20%{transform:rotate(-4deg) translateY(-3px)}60%{transform:rotate(4deg)} }'
    + '#tp-root .tp-a-wave{animation:tp-wave 1.8s ease-in-out}'
    + '@keyframes tp-stretch{0%,100%{transform:scale(1,1)}40%,70%{transform:scale(.98,1.08) translateY(-10px)}}'
    + '#tp-root .tp-a-stretch{animation:tp-stretch 1.8s ease-in-out}'
    + '@keyframes tp-nod{0%,100%{transform:translateY(0)}50%{transform:translateY(5px) rotate(-2deg)}}'
    + '#tp-root .tp-a-nod{animation:tp-nod 1.1s ease-in-out}'
    + '@keyframes tp-look{0%,100%{transform:rotate(0)}30%{transform:rotate(-5deg)}70%{transform:rotate(5deg)}}'
    + '#tp-root .tp-a-look{animation:tp-look 1.8s ease-in-out}'
    + '#tp-root .tp-a-sit{transform-origin:bottom center;animation:tp-sit 2.2s ease-in-out}'
    + '@keyframes tp-sit{0%,100%{transform:scaleY(1)}35%,75%{transform:scaleY(.9) translateY(2px)}}'
    + '#tp-root.tp-sleeping .tp-stage{filter:drop-shadow(0 8px 12px rgba(190,90,140,.18)) brightness(.95) saturate(.92)}'
    + '@keyframes tp-sleep{0%,100%{transform:rotate(0)}50%{transform:rotate(-3deg) translateY(3px)}}'
    + '#tp-root .tp-a-sleep{animation:tp-sleep 4.2s ease-in-out}'
    + '@keyframes tp-dizzy{0%{transform:rotate(0)}25%{transform:rotate(6deg)}50%{transform:rotate(-6deg)}75%{transform:rotate(4deg)}100%{transform:rotate(0)}}'
    + '#tp-root .tp-a-dizzy{animation:tp-dizzy 1.8s linear}'
    + '#tp-root .tp-a-greet{animation:tp-greet 1.9s ease-in-out}'
    + '@keyframes tp-greet{0%,100%{transform:translateY(0) rotate(0)}12%{transform:translateY(-14px) rotate(-5deg)}24%{transform:translateY(0) rotate(0)}36%{transform:translateY(-10px) rotate(5deg)}48%{transform:translateY(0)}70%{transform:translateY(-4px) rotate(-2deg)}}'
    + '#tp-root .tp-a-shake2{animation:tp-shake2 2.4s cubic-bezier(.4,0,.6,1)}'
    + '@keyframes tp-shake2{0%,100%{transform:rotate(0) skewX(0) translateY(0)}10%{transform:rotate(-9deg) skewX(4deg) translateY(-5px)}20%{transform:rotate(9deg) skewX(-4deg) translateY(0)}30%{transform:rotate(-8deg) skewX(4deg) translateY(-5px)}40%{transform:rotate(8deg) skewX(-4deg) translateY(0)}50%{transform:rotate(-7deg) skewX(3deg) translateY(-4px)}60%{transform:rotate(7deg) skewX(-3deg) translateY(0)}70%{transform:rotate(-5deg)}80%{transform:rotate(5deg)}90%{transform:rotate(-2deg)}}'
    + '#tp-root .tp-a-heart{animation:tp-heart 1.6s cubic-bezier(.3,1.4,.5,1)}'
    + '@keyframes tp-heart{0%,100%{transform:scale(1,1) translateY(0)}30%{transform:scale(1.06,.94) translateY(4px)}60%{transform:scale(.97,1.05) translateY(-8px)}80%{transform:scale(1,1)}}'
    + '#tp-root .tp-stage{transform-origin:bottom center;will-change:transform}'
    + '#tp-root.tp-flip .tp-layers{transform:scaleX(-1)}'
    + '#tp-root .tp-stage.tp-tap{animation:tp-tap .5s cubic-bezier(.3,1.4,.5,1)}'
    + '#tp-root.tp-st-think .tp-body{filter:drop-shadow(0 8px 12px rgba(120,140,220,.28))}'
    + '#tp-root.tp-st-work .tp-body{filter:drop-shadow(0 8px 12px rgba(120,200,160,.26))}'
    + '#tp-root.tp-st-wait .tp-body{filter:drop-shadow(0 8px 14px rgba(255,190,90,.40))}'
    + '#tp-root.tp-st-ok .tp-body{filter:drop-shadow(0 8px 14px rgba(255,126,179,.45))}'
    + '#tp-root.tp-st-err .tp-body{filter:drop-shadow(0 8px 14px rgba(230,80,110,.45))}'
    + '@media (prefers-reduced-motion: reduce){'
    + '#tp-root .tp-stage,#tp-root .tp-body{animation:none!important;transition:none!important}'
    + '#tp-root .tp-fx-heart,#tp-root .tp-fx-star{animation-duration:.02s!important}'
    + '}'
    + '@keyframes tp-tap{0%{transform:scaleY(.9) scaleX(1.06)}45%{transform:scaleY(1.07) scaleX(.95)}72%{transform:scaleY(.98) scaleX(1.01)}100%{transform:none}}'
    + '@keyframes tp-touched{0%{transform:scale(1,1)}35%{transform:scale(1.06,.92) translateY(3px)}70%{transform:scale(.98,1.03) translateY(-2px)}100%{transform:scale(1,1)}}'
    + '.tp-grid-btn3{grid-template-columns:repeat(3,1fr)}'
    + '.tp-revive{position:fixed;right:16px;bottom:12px;z-index:2147482002;background:#fff;border:1px solid var(--tp-line);color:var(--tp-ink);border-radius:999px;padding:6px 14px;font-size:12px;cursor:pointer;box-shadow:0 6px 18px rgba(190,90,140,.18)}'
    // 菜单
    + '.tp-menu{position:fixed;z-index:2147482001;width:344px;max-height:min(600px,calc(100vh - 16px));display:none;flex-direction:column;background:linear-gradient(180deg,#fff 0%,var(--tp-pink-4) 100%);color:var(--tp-ink);border:1px solid var(--tp-line);border-radius:18px;box-shadow:0 18px 44px rgba(190,90,140,.22),0 2px 6px rgba(190,90,140,.12);font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font-size:13px;overflow:hidden}'
    + '.tp-menu.tp-menu-open{display:flex}'
    + '.tp-mhead{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#ffd9e9,#ffeef6);border-bottom:1px solid var(--tp-line);flex:none}'
    + '.tp-mava{width:38px;height:38px;border-radius:50%;overflow:hidden;background:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(190,90,140,.25);flex:none;display:flex;align-items:center;justify-content:center;color:var(--tp-pink);font-weight:700}'
    + '.tp-mava img{width:100%;height:100%;object-fit:cover;object-position:top center}'
    + '.tp-mtitle{flex:1;display:flex;flex-direction:column;line-height:1.25;min-width:0}'
    + '.tp-mtitle b{font-size:14px;color:#4a2738}'
    + '.tp-mtitle small{color:var(--tp-ink-2);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.tp-mstat{text-align:right;font-weight:700;color:var(--tp-pink);font-size:14px;display:flex;flex-direction:column}'
    + '.tp-mstat small{font-weight:400;color:var(--tp-ink-2);font-size:10px}'
    + '.tp-mtabs{display:flex;gap:4px;padding:8px 10px 0;flex:none}'
    + '.tp-mtabs button{flex:1;border:0;background:transparent;color:var(--tp-ink-2);padding:7px 0;border-radius:10px 10px 0 0;font-size:12.5px;cursor:pointer;font-family:inherit}'
    + '.tp-mtabs button.on{background:#fff;color:var(--tp-pink);font-weight:700;box-shadow:0 -2px 8px rgba(190,90,140,.08)}'
    + '.tp-mbody{padding:12px 12px 14px;overflow:auto;flex:1}'
    + '.tp-grid{display:grid;gap:8px}'
    + '.tp-grid-outfit{grid-template-columns:repeat(3,1fr)}'
    + '.tp-grid-btn{grid-template-columns:repeat(3,1fr)}'
    + '.tp-pick{display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid transparent;background:#fff;border-radius:12px;padding:6px 4px;cursor:pointer;font-family:inherit;transition:.15s}'
    + '.tp-pick:hover{border-color:var(--tp-pink-2);transform:translateY(-1px)}'
    + '.tp-pick.on{border-color:var(--tp-pink);background:#fff6fa;box-shadow:0 3px 10px rgba(255,126,179,.22)}'
    + '.tp-pick.dim{opacity:.42}'
    + '.tp-pick-img{width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;overflow:hidden}'
    + '.tp-pick-img img{max-width:100%;max-height:100%;object-fit:contain}'
    + '.tp-pick-name{font-size:10.5px;color:var(--tp-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
    + '.tp-actbtn{border:1px solid var(--tp-line);background:#fff;color:var(--tp-ink);border-radius:11px;padding:10px 4px;cursor:pointer;font-family:inherit;font-size:12.5px;transition:.15s}'
    + '.tp-actbtn:hover{background:var(--tp-pink-3);border-color:var(--tp-pink-2);transform:translateY(-1px)}'
    + '.tp-seg{display:flex;gap:6px;background:#fff;border:1px solid var(--tp-line);border-radius:12px;padding:4px;margin-bottom:10px}'
    + '.tp-seg button{flex:1;border:0;background:transparent;color:var(--tp-ink-2);padding:7px 0;border-radius:9px;font-family:inherit;font-size:12.5px;cursor:pointer}'
    + '.tp-seg button.on{background:linear-gradient(135deg,#ff9cc4,#ff7eb3);color:#fff;font-weight:600}'
    + '.tp-seg button:disabled{opacity:.4;cursor:not-allowed}'
    + '.tp-seg-mini{flex:1;margin:0;padding:3px;gap:3px}'
    + '.tp-seg-mini button{padding:5px 0;font-size:11.5px}'
    + '.tp-seg-form{margin-bottom:8px}'
    + '.tp-sub{margin:12px 2px 4px;font-size:11px;color:#b48aa0;letter-spacing:.4px}'
    + '.tp-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px dashed rgba(255,126,179,.16)}'
    + '.tp-row>span:first-child{flex:1;color:var(--tp-ink-2)}'
    + '.tp-row b{font-weight:600;color:var(--tp-ink)}'
    + '.tp-range-wrap{flex:1;display:flex}'
    + '.tp-range-wrap input[type=range]{width:100%;-webkit-appearance:none;appearance:none;height:6px;border-radius:99px;background:linear-gradient(90deg,#ffd3e4,#ffa9cd);outline:none}'
    + '.tp-range-wrap input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:#fff;border:2.5px solid var(--tp-pink);box-shadow:0 2px 6px rgba(255,126,179,.35);cursor:pointer}'
    + '.tp-range-wrap input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#fff;border:2.5px solid var(--tp-pink);cursor:pointer}'
    + '.tp-val{min-width:38px;text-align:right;color:var(--tp-pink);font-variant-numeric:tabular-nums}'
    + '.tp-switch{width:42px;height:24px;border-radius:99px;border:0;background:#e9d7e0;position:relative;cursor:pointer;transition:.2s;flex:none;padding:0}'
    + '.tp-switch i{position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.18)}'
    + '.tp-switch.on{background:linear-gradient(135deg,#ff8fb8,#ff6ea8)}'
    + '.tp-switch.on i{left:21px}'
    + '.tp-btn{border:1px solid var(--tp-line);background:#fff;color:var(--tp-ink);border-radius:11px;padding:9px 12px;cursor:pointer;font-family:inherit;font-size:12.5px;transition:.15s}'
    + '.tp-btn:hover{border-color:var(--tp-pink-2);background:#fff7fb}'
    + '.tp-btn-pink{background:linear-gradient(135deg,#ff9cc4,#ff7eb3);color:#fff;border-color:transparent;font-weight:600}'
    + '.tp-btn-pink:hover{filter:brightness(1.04);background:linear-gradient(135deg,#ff9cc4,#ff7eb3)}'
    + '.tp-actions2{display:flex;gap:8px;margin-top:8px}'
    + '.tp-actions2 .tp-btn{flex:1}'
    + '.tp-tip{margin-top:10px;font-size:11px;line-height:1.6;color:#b48aa0;background:#fff7fb;border:1px dashed var(--tp-pink-3);border-radius:10px;padding:8px 10px}'
    + '.tp-empty{padding:26px 10px;text-align:center;color:#b48aa0;font-size:12px}'

  /* ------------------------------------------------------------------ 启动 */
  function boot() {
    // 服务端 ui-state 优先（浏览器清过缓存也能找回位置/设置），失败就用本地
    var ready = Promise.resolve()
    if (typeof loadServerState === 'function') {
      ready = loadServerState().catch(function () { return null })
    }
    ready.then(function () {
      return loadArt()
    }).then(function () {
      if (!art.outfits.length) return
      mount()
      // 位置只允许贴在四条边上：启动时把旧的中心位置拉回最近边
      setTimeout(function () { snapToEdge(); positionMenu() }, 60)
    }).catch(function () {})
    loadAudio()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()

// 冒烟测试：不启动 DSH，只校验「包本身是否自洽」
// 用法：node scripts/smoke.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m)
const bad = (m) => { failed++; console.log('  \x1b[31m✗\x1b[0m ' + m) }
const check = (cond, m) => (cond ? ok(m) : bad(m))

console.log('\n[1] package.json')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
check(pkg.name === 'dsh-taffy-pet', 'name = dsh-taffy-pet')
check(!!pkg.dsh?.bundle?.patch, '声明了 dsh.bundle.patch')
check(fs.existsSync(path.join(ROOT, pkg.main || 'lib/index.js')), 'main 入口存在')

console.log('\n[2] 插件入口')
const entry = fs.readFileSync(path.join(ROOT, pkg.main || 'lib/index.js'), 'utf8')
check(/export\s+default/.test(entry) && /apply/.test(entry), '导出 default + apply')
check(entry.includes('/dsh-whale/taffy-file'), '注册了素材路由')
check(entry.includes('/dsh-whale/pet-state.json'), '注册了状态路由')
check(fs.existsSync(path.join(ROOT, 'lib/seed-assets.js')), '有首次运行素材落盘逻辑')
check(entry.includes('/dsh-whale/vrm-runtime.js'), '注册了 3D 运行时路由')
check(entry.includes('/dsh-whale/vrm-list.json'), '注册了 3D 模型列表路由')
const vrmRt = path.join(ROOT, 'lib/vrm-runtime.js')
check(fs.existsSync(vrmRt) && fs.statSync(vrmRt).size > 100000, '3D 运行时打包文件存在（three + three-vrm）')

console.log('\n[3] 美术素材')
const artDir = path.join(ROOT, 'assets/art')
const manifest = JSON.parse(fs.readFileSync(path.join(artDir, 'manifest.json'), 'utf8'))
check(Array.isArray(manifest.outfits) && manifest.outfits.length > 0, `manifest 有 ${manifest.outfits?.length} 套服装`)
const ids = new Set()
for (const o of manifest.outfits) {
  if (ids.has(o.id)) bad(`重复 id: ${o.id}`)
  ids.add(o.id)
  const f = path.join(artDir, 'outfits', o.file)
  if (!fs.existsSync(f)) { bad(`缺图: ${o.file}`); continue }
  const size = readPngSize(f)
  if (size && (size.w !== o.w || size.h !== o.h)) bad(`${o.id} 尺寸不符: 声明 ${o.w}x${o.h}，实际 ${size.w}x${size.h}`)
  if (o.small) {
    const sf = path.join(artDir, o.small)
    if (!fs.existsSync(sf)) bad(`缺小菲图: ${o.small}`)
  }
  if (o.file2x && !fs.existsSync(path.join(artDir, 'outfits', o.file2x))) bad(`缺 2x: ${o.file2x}`)
}
if (!failed) ok('全部服装/小菲/2x 文件与声明一致')

console.log('\n[4] 语音素材')
const audioDir = path.join(ROOT, 'assets/audio')
const audio = JSON.parse(fs.readFileSync(path.join(audioDir, 'audio.json'), 'utf8'))
check(Array.isArray(audio.fragments) && audio.fragments.length > 0, `audio.json 有 ${audio.fragments?.length} 段`)
let missing = 0
for (const f of audio.fragments) if (!fs.existsSync(path.join(audioDir, f.id + '.wav'))) missing++
check(missing === 0, missing ? `${missing} 段语音缺 wav` : '语音文件齐备')

console.log('\n[5] 前端脚本语法')
const widget = path.join(ROOT, 'lib/whale-widget.js')
check(fs.existsSync(widget), 'lib/whale-widget.js 存在')
const src = fs.readFileSync(widget, 'utf8')
check(src.includes('__TAFFY_PET_BOOTED__'), '有防重复挂载标记')
check(/dsh-whale\/widget\.js/.test(entry), '注入地址与前端文件一致')

function readPngSize(file) {
  try {
    const buf = fs.readFileSync(file)
    if (buf.readUInt32BE(0) !== 0x89504e47) return null
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  } catch { return null }
}

console.log(failed ? `\n\x1b[31m${failed} 项失败\x1b[0m\n` : '\n\x1b[32m全部通过\x1b[0m\n')
process.exit(failed ? 1 : 0)

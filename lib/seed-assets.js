import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.join(HERE, '..')

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name)
    const to = path.join(dst, ent.name)
    if (ent.isDirectory()) copyTree(from, to)
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to)
  }
}

/**
 * 首次安装时把插件自带的立绘与语音铺到用户目录。
 *
 * - 立绘：~/.dsh/taffy-pet/art  （manifest.json 存在就整体跳过，不覆盖用户自己的素材）
 * - 语音：~/.dsh/whale-audio    （audio.json 存在就整体跳过）
 *
 * 只补缺、不覆盖：用户后来替换/删除的素材不会被安装过程还原。
 */
export function seedAssets(log) {
  const tasks = [
    {
      name: 'art',
      src: path.join(PKG_ROOT, 'assets', 'art'),
      dst: path.join(os.homedir(), '.dsh', 'taffy-pet', 'art'),
      marker: 'manifest.json',
    },
    {
      name: 'audio',
      src: path.join(PKG_ROOT, 'assets', 'audio'),
      dst: path.join(os.homedir(), '.dsh', 'whale-audio'),
      marker: 'audio.json',
    },
  ]

  for (const t of tasks) {
    try {
      if (!fs.existsSync(t.src)) continue
      if (fs.existsSync(path.join(t.dst, t.marker))) continue
      copyTree(t.src, t.dst)
      log?.('taffy-pet: seeded', t.name, '->', t.dst)
    } catch (err) {
      log?.('taffy-pet: seed failed for', t.name, String(err && err.message || err))
    }
  }
}

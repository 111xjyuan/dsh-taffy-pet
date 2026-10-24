// 批量把目录里的 .vmd 转成 .vrma，直接放进桌宠的动作目录
// 用法：node tools/vmd2vrma-all.mjs <vmd目录> [--out=动作目录] [--base=model.vrm]
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const get = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d };
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('用法：node tools/vmd2vrma-all.mjs <vmd目录> [--out=目录] [--base=model.vrm]'); process.exit(1) }

const out = get('out', join(homedir(), '.dsh', 'taffy-pet', 'vrm', 'anim'));
const base = get('base', join(homedir(), '.dsh', 'taffy-pet', 'vrm', 'taffy.vrm'));
mkdirSync(out, { recursive: true });

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.vmd'));
if (!files.length) { console.log('目录里没有 .vmd：', dir); process.exit(0) }

let ok = 0;
for (const f of files) {
  const src = join(dir, f);
  const dst = join(out, basename(f, '.vmd') + '.vrma');
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, 'vmd2vrma.mjs'), src, dst, '--base=' + base], { stdio: 'inherit' });
    ok++;
  } catch (e) {
    console.log('跳过', f, String(e.message || e).slice(0, 80));
  }
}
console.log('完成：' + ok + '/' + files.length + ' → ' + out);

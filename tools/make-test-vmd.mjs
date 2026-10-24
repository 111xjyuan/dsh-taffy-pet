// 生成一个测试用 VMD：右臂挥手 + 头部轻点，用来验证 vmd2vrma 链路
import { writeFileSync } from 'node:fs';

const buf = Buffer.alloc(30 + 20 + 4 + 300 * (15 + 4 + 12 + 16 + 64));
let o = 0;
buf.write('Vocaloid Motion Data 0002', 0, 'ascii'); o = 30;
buf.fill(0, o, o + 20); o += 20;
const frames = [];
function push(bone, frame, pos, rot) { frames.push({ bone, frame, pos, rot }); }
const q = (axis, ang) => {
  const s = Math.sin(ang / 2), c = Math.cos(ang / 2);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
};
for (let f = 0; f <= 90; f += 15) {
  const w = Math.sin((f / 90) * Math.PI * 2) * 0.9;
  push('rightUpperArm', f, [0, 0, 0], q('z', -1.2 + w * 0.35));
  push('rightLowerArm', f, [0, 0, 0], q('x', -0.9 + w * 0.5));
  push('head', f, [0, 0, 0], q('y', w * 0.18));
}
buf.writeUInt32LE(frames.length, o); o += 4;
for (const fr of frames) {
  buf.fill(0, o, o + 15);
  Buffer.from(fr.bone, 'utf8').copy(buf, o);
  o += 15;
  buf.writeUInt32LE(fr.frame, o); o += 4;
  const p = fr.pos;
  buf.writeFloatLE(p[0], o); buf.writeFloatLE(p[1], o + 4); buf.writeFloatLE(p[2], o + 8); o += 12;
  const r = fr.rot;
  buf.writeFloatLE(r[0], o); buf.writeFloatLE(r[1], o + 4); buf.writeFloatLE(r[2], o + 8); buf.writeFloatLE(r[3], o + 12); o += 16;
  o += 64;
}
writeFileSync('tools/test-wave.vmd', buf.subarray(0, o));
console.log('wrote tools/test-wave.vmd', o, 'bytes');

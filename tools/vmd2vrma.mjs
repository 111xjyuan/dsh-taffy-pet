// MMD .vmd（Vocaloid Motion Data）→ VRM Animation .vrma
// 用法：node tools/vmd2vrma.mjs <motion.vmd> [out.vrma] [--base=talk.vrm]
// 原理：把 VMD 的骨骼关键帧映射到 VRM humanoid 骨骼，用 base 模型（默认 taffy.vrm）的
//       rest 姿态和层级拼出一个最小 glTF，加上 VRMC_vrm_animation 扩展与动画通道。
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('--base=')) || '--base=').slice(7) || null;
const pos = args.filter((a) => !a.startsWith('--'));
const inFile = pos[0];
const outFile = pos[1] || (inFile ? inFile.replace(/\.vmd$/i, '') + '.vrma' : '');

// MMD 日文骨骼 → VRM humanoid 名称
const BONE_MAP = {
  'センター': 'hips', '上半身': 'spine', '上半身2': 'chest', '首': 'neck', '頭': 'head',
  '左肩': 'leftShoulder', '左腕': 'leftUpperArm', '左ひじ': 'leftLowerArm', '左手': 'leftHand',
  '右肩': 'rightShoulder', '右腕': 'rightUpperArm', '右ひじ': 'rightLowerArm', '右手': 'rightHand',
  '左足': 'leftUpperLeg', '左ひざ': 'leftLowerLeg', '左足首': 'leftFoot',
  '右足': 'rightUpperLeg', '右ひざ': 'rightLowerLeg', '右足首': 'rightFoot',
  '左足ＩＫ': null, '右足ＩＫ': null,
  // 英文别名（有些动作包用英文骨骼名，也方便测试）
  center: 'hips', hips: 'hips', upperBody: 'spine', upperBody2: 'chest', neck: 'neck', head: 'head',
  leftShoulder: 'leftShoulder', leftArm: 'leftUpperArm', leftUpperArm: 'leftUpperArm',
  leftElbow: 'leftLowerArm', leftLowerArm: 'leftLowerArm', leftWrist: 'leftHand', leftHand: 'leftHand',
  rightShoulder: 'rightShoulder', rightArm: 'rightUpperArm', rightUpperArm: 'rightUpperArm',
  rightElbow: 'rightLowerArm', rightLowerArm: 'rightLowerArm', rightWrist: 'rightHand', rightHand: 'rightHand',
  leftLeg: 'leftUpperLeg', leftUpperLeg: 'leftUpperLeg', leftKnee: 'leftLowerLeg', leftLowerLeg: 'leftLowerLeg',
  leftAnkle: 'leftFoot', leftFoot: 'leftFoot',
  rightLeg: 'rightUpperLeg', rightUpperLeg: 'rightUpperLeg', rightKnee: 'rightLowerLeg', rightLowerLeg: 'rightLowerLeg',
  rightAnkle: 'rightFoot', rightFoot: 'rightFoot'
};
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'chest', head: 'neck',
  leftShoulder: 'chest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'chest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg'
};

const sjis = new TextDecoder('shift_jis');
function readCString(buf, off, len) {
  let end = off;
  while (end < off + len && buf[end] !== 0) end++;
  return sjis.decode(buf.subarray(off, end)).trim();
}

function parseVmd(buf) {
  const magic = buf.subarray(0, 30).toString('ascii');
  if (!magic.startsWith('Vocaloid Motion Data')) throw new Error('不是 VMD 文件: ' + magic);
  let o = 30;
  const modelName = readCString(buf, o, 20); o += 20;
  const count = buf.readUInt32LE(o); o += 4;
  const motions = [];
  for (let i = 0; i < count; i++) {
    const boneName = readCString(buf, o, 15); o += 15;
    const frame = buf.readUInt32LE(o); o += 4;
    const px = buf.readFloatLE(o), py = buf.readFloatLE(o + 4), pz = buf.readFloatLE(o + 8); o += 12;
    const qx = buf.readFloatLE(o), qy = buf.readFloatLE(o + 4), qz = buf.readFloatLE(o + 8), qw = buf.readFloatLE(o + 12); o += 16;
    o += 64; // interpolation
    motions.push({ boneName, frame, pos: [px, py, pz], rot: [qx, qy, qz, qw] });
  }
  return { modelName, motions };
}

// 读 .vrm(glb) 的 humanoid rest 姿态
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB');
  let o = 12;
  const jsonLen = buf.readUInt32LE(o); o += 8;
  const json = JSON.parse(buf.subarray(o, o + jsonLen).toString('utf8'));
  return json;
}
function humanoidBones(gltf) {
  const out = {};
  const v1 = gltf.extensions && gltf.extensions.VRMC_vrm;
  if (v1 && v1.humanoid && v1.humanoid.humanBones) {
    for (const [name, v] of Object.entries(v1.humanoid.humanBones)) {
      if (v && typeof v.node === 'number') out[name] = v.node;
    }
    return out;
  }
  const v0 = gltf.extensions && gltf.extensions.VRM;
  if (v0 && v0.humanoid && v0.humanoid.humanBones) {
    for (const b of v0.humanoid.humanBones) {
      if (b && typeof b.node === 'number') out[b.bone] = b.node;
    }
    return out;
  }
  return out;
}

// 构建 VRMA
function buildVrma(restNodes, tracks) {
  const names = Object.keys(restNodes);
  const index = {};
  names.forEach((n, i) => { index[n] = i + 1; }); // 0 = root

  const nodes = [{ name: 'VRM_Root', children: [] }];
  for (const n of names) {
    const r = restNodes[n];
    const node = { name: n };
    if (r.t) node.translation = r.t;
    if (r.r) node.rotation = r.r;
    if (r.s) node.scale = r.s;
    const kids = names.filter((c) => PARENT[c] === n);
    if (kids.length) node.children = kids.map((c) => index[c]);
    nodes.push(node);
  }
  nodes[0].children = names.filter((n) => PARENT[n] == null).map((n) => index[n]);

  // 二进制：每段 = 时间数组 + 值数组
  const chunks = [];
  let offset = 0;
  const accessors = [];
  const bufferViews = [];
  const samplers = [];
  const channels = [];

  const pushFloats = (arr) => {
    const b = Buffer.alloc(arr.length * 4);
    arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
    const view = bufferViews.length - 1;
    accessors.push({ bufferView: view, componentType: 5126, count: arr.length, type: 'SCALAR' });
    chunks.push(b);
    offset += b.length;
    return { view, accessor: accessors.length - 1 };
  };

  for (const [bone, keys] of Object.entries(tracks)) {
    if (!index[bone]) continue;
    keys.sort((a, b) => a.t - b.t);
    const times = keys.map((k) => k.t);

    // rotation
    const q = [];
    keys.forEach((k) => q.push(k.r[0], k.r[1], k.r[2], k.r[3]));
    const tb = Buffer.alloc(times.length * 4);
    times.forEach((v, i) => tb.writeFloatLE(v, i * 4));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: tb.length });
    const tView = bufferViews.length - 1;
    accessors.push({ bufferView: tView, componentType: 5126, count: times.length, type: 'SCALAR', min: [times[0]], max: [times[times.length - 1]] });
    const tAcc = accessors.length - 1;
    chunks.push(tb); offset += tb.length;

    const rb = Buffer.alloc(q.length * 4);
    q.forEach((v, i) => rb.writeFloatLE(v, i * 4));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: rb.length });
    const rView = bufferViews.length - 1;
    accessors.push({ bufferView: rView, componentType: 5126, count: q.length / 4, type: 'VEC4' });
    const rAcc = accessors.length - 1;
    chunks.push(rb); offset += rb.length;

    samplers.push({ input: tAcc, output: rAcc, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: index[bone], path: 'rotation' } });
  }

  const bin = Buffer.concat(chunks);
  const humanBones = {};
  for (const n of names) humanBones[n] = { node: index[n] };

  const gltf = {
    asset: { version: '2.0', generator: 'vmd2vrma (dsh-taffy-pet)' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
    bufferViews,
    accessors,
    animations: [{ name: 'motion', channels, samplers }]
  };
  return gltf;
}

function mmdQuatToGltf(q) {
  // MMD 左手系 → glTF 右手系：镜像 Z 轴后，四元数取 (-x, -y, z, w)
  const [x, y, z, w] = q;
  const len = Math.hypot(x, y, z, w) || 1;
  return [-x / len, -y / len, z / len, w / len];
}

function main() {
  if (!inFile) {
    console.error('用法：node tools/vmd2vrma.mjs <motion.vmd> [out.vrma] [--base=model.vrm]');
    process.exit(1);
  }
  const basePath = base || join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'taffy-pet', 'vrm', 'taffy.vrm');
  const glb = parseGlb(readFileSync(basePath));
  const map = humanoidBones(glb);
  const rest = {};
  for (const [name, nodeIdx] of Object.entries(map)) {
    if (!PARENT.hasOwnProperty(name)) continue;
    const n = glb.nodes[nodeIdx] || {};
    rest[name] = { t: n.translation, r: n.rotation, s: n.scale };
  }

  const vmd = parseVmd(readFileSync(inFile));
  const tracks = {};
  let maxFrame = 0;
  for (const m of vmd.motions) {
    const bone = BONE_MAP[m.boneName];
    if (!bone) continue;
    if (!tracks[bone]) tracks[bone] = [];
    tracks[bone].push({ t: m.frame / 30, r: mmdQuatToGltf(m.rot), p: m.pos });
    maxFrame = Math.max(maxFrame, m.frame);
  }
  if (!Object.keys(tracks).length) throw new Error('VMD 里没有可映射的骨骼');

  const gltf = buildVrma(rest, tracks);
  writeFileSync(outFile, JSON.stringify(gltf));
  const bones = Object.keys(tracks).length;
  console.log('OK', basename(outFile), '| 骨骼', bones, '| 时长', (maxFrame / 30).toFixed(2) + 's',
    '| 大小', (readFileSync(outFile).length / 1024).toFixed(0) + 'KB');
}

main();

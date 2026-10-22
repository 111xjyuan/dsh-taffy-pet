#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""素材后处理：清掉抠图残留的小碎块、去掉透明边、统一输出。

用法（三个子命令）：
  python clean_art.py outfit  <输入.png> <输出.png> [--max-h 1100]
  python clean_art.py expr    <输入.png> <输出.png> [--size 360]
  python clean_art.py check   <目录>

规则：
  outfit —— 只保留 alpha 连通域中面积 >= 最大连通域 1.5% 的部分，然后按内容紧裁，
             高度缩放到 --max-h 以内（保持比例），不放大。
  expr   —— 同上清洗后，按内容紧裁并居中补成正方形，缩放到 --size。
"""
import sys, os, argparse
import numpy as np
from PIL import Image


def load_rgba(p):
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        return im.convert("RGBA")
    return im.convert("RGBA")


def label_components(alpha):
    """返回 (labels, sizes)，0 为背景。优先 OpenCV（快），失败再回退泛洪。"""
    try:
        import cv2
        num, labels, stats, _ = cv2.connectedComponentsWithStats(
            (alpha > 24).astype(np.uint8), connectivity=8)
        sizes = [0] + [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, num)]
        return labels, sizes
    except Exception:
        pass
    h, w = alpha.shape
    labels = np.zeros((h, w), dtype=np.int32)
    cur = 0
    sizes = [0]
    ys, xs = np.nonzero(alpha > 24)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        cur += 1
        cnt = 0
        stack = [(y0, x0)]
        labels[y0, x0] = cur
        while stack:
            y, x = stack.pop()
            cnt += 1
            for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] > 24 and not labels[ny, nx]:
                    labels[ny, nx] = cur
                    stack.append((ny, nx))
        sizes.append(cnt)
    return labels, sizes


def keep_big_components(im, ratio=0.015):
    a = np.array(im.getchannel("A"))
    if not a.size:
        return im
    labels, sizes = label_components(a)
    if len(sizes) <= 2:
        return im
    biggest = max(sizes[1:])
    keep = [i for i in range(1, len(sizes)) if sizes[i] >= biggest * ratio]
    if len(keep) == len(sizes) - 1:
        return im
    mask = np.isin(labels, keep)
    out = np.array(im)
    out[:, :, 3] = np.where(mask, out[:, :, 3], 0)
    return Image.fromarray(out, "RGBA")


def trim(im, pad=2):
    bb = im.getchannel("A").getbbox()
    if not bb:
        return im
    l, t, r, b = bb
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def cmd_outfit(src, dst, max_h):
    im = keep_big_components(load_rgba(src))
    im = trim(im)
    if max_h and im.height > max_h:
        nw = max(1, round(im.width * max_h / im.height))
        im = im.resize((nw, max_h), Image.LANCZOS)
    im.save(dst, "PNG", optimize=True)
    print("outfit ->", dst, im.size)


def cmd_expr(src, dst, size):
    im = keep_big_components(load_rgba(src), ratio=0.02)
    im = trim(im, pad=0)
    side = max(im.width, im.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    if size:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas.save(dst, "PNG", optimize=True)
    print("expr ->", dst, canvas.size)


def cmd_check(d):
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith(".png"):
            continue
        p = os.path.join(d, f)
        im = Image.open(p)
        a = np.array(im.convert("RGBA").getchannel("A"))
        trans = (a < 24).mean() * 100
        print(f"{f:32s} {im.width}x{im.height}  透明 {trans:5.1f}%")
        out = os.path.join(os.path.dirname(d.rstrip("/\\")), "_check_" + f)
        bg = Image.new("RGB", im.size, (255, 240, 247))
        src = im.convert("RGBA")
        bg.paste(src, (0, 0), src)
        bg.thumbnail((520, 520), Image.LANCZOS)
        bg.save(out)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    ap = argparse.ArgumentParser()
    sub = sys.argv[1]
    if sub == "outfit":
        cmd_outfit(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 1100)
    elif sub == "expr":
        cmd_expr(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 360)
    elif sub == "check":
        cmd_check(sys.argv[2])
    else:
        print("unknown:", sub); sys.exit(2)

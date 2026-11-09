# -*- coding: utf-8 -*-
"""由原始封面生成自适应图标前景图。

Android 的自适应图标是 108dp 的图层，系统只显示中间 72dp（圆形或圆角方形
遮罩），边缘另有 1/6 用于启动器动画。若把整幅图直接铺满 108dp，四周会被裁掉
一圈，看起来就是"图标只有一部分"。

这里把原图按 1:1 放进 72dp 视口，四周扩展 1/4 宽度的边距，边距用边缘像素拉伸
填充（不用纯色，避免部分启动器的视差动画露出色边）。

用法（在 源码/android 目录下）：
    python prepare-icon.py
"""

import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：python -m pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "artwork", "launcher-artwork-original.png")
TARGET = os.path.join(HERE, "res", "drawable-nodpi", "launcher_artwork.png")
PREVIEW = os.path.join(HERE, "artwork", "icon-preview.png")

# 原图占 108dp 图层的比例。系统只显示中间 72dp（66.7%），剩下的是留白与动画区。
# 0.62 lets the artwork fill about 76% of the visible viewport, with room around the book.
SHARE = 0.62


def pad_to_adaptive(src):
    """原图按 SHARE 比例居中放入画布，边距用边缘像素复制填充。"""

    width, height = src.size
    canvas_size = int(round(width / SHARE))
    if canvas_size % 2:
        canvas_size += 1
    pad = (canvas_size - width) // 2
    canvas = Image.new(src.mode, (canvas_size, canvas_size))

    # 先放原图，再分别向四个方向拉伸最外侧一行/一列，顺序保证四角也正确
    canvas.paste(src, (pad, pad))
    top = src.crop((0, 0, width, 1)).resize((width, pad), Image.NEAREST)
    bottom = src.crop((0, height - 1, width, height)).resize(
        (width, pad), Image.NEAREST
    )
    canvas.paste(top, (pad, 0))
    canvas.paste(bottom, (pad, pad + height))

    left = canvas.crop((pad, 0, pad + 1, canvas.height)).resize(
        (pad, canvas.height), Image.NEAREST
    )
    right = canvas.crop(
        (pad + width - 1, 0, pad + width, canvas.height)
    ).resize((pad, canvas.height), Image.NEAREST)
    canvas.paste(left, (0, 0))
    canvas.paste(right, (pad + width, 0))
    return canvas, pad


def render_preview(canvas, pad, box=360):
    """按系统遮罩生成预览：只显示中间 72/108，圆形与圆角方形各一张。"""

    size = canvas.width  # 108dp 图层
    side = int(size * 72 / 108)  # 72dp 可见区域
    left = (size - side) // 2
    view = canvas.crop((left, left, left + side, left + side)).resize(
        (box, box), Image.LANCZOS
    )

    sheet = Image.new("RGB", (box * 2 + 30, box), (246, 246, 246))
    for index, shape in enumerate(("circle", "squircle")):
        mask = Image.new("L", (box, box), 0)
        from PIL import ImageDraw

        draw = ImageDraw.Draw(mask)
        if shape == "circle":
            draw.ellipse((0, 0, box - 1, box - 1), fill=255)
        else:
            draw.rounded_rectangle((0, 0, box - 1, box - 1), radius=int(box * 0.22), fill=255)
        tile = Image.new("RGB", (box, box), (246, 246, 246))
        tile.paste(view, (0, 0), mask)
        sheet.paste(tile, (index * (box + 30), 0))
    return sheet


def main():
    if not os.path.exists(SOURCE):
        sys.exit("找不到原图：%s" % SOURCE)

    src = Image.open(SOURCE).convert("RGB")
    canvas, pad = pad_to_adaptive(src)
    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    canvas.save(TARGET, "PNG", optimize=True)

    render_preview(canvas, pad).save(PREVIEW, "PNG")
    print("原图 %dx%d -> 前景 %dx%d（边距 %d）" % (src.width, src.height, canvas.width, canvas.height, pad))
    print("已写入 %s" % TARGET)
    print("预览 %s" % PREVIEW)


if __name__ == "__main__":
    main()

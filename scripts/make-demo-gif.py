# -*- coding: utf-8 -*-
"""合成演示动图：读取 demo-frames/ 的截图与 frames.json，逐帧在顶部绘制字幕，输出 docs/images/demo.gif。

用法（先运行 scripts/record-demo.cjs 生成截图）：
    python scripts/make-demo-gif.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FRAMES_DIR = ROOT / "demo-frames"
OUTPUT = ROOT / "docs" / "images" / "demo.gif"
FONT_PATHS = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]

BG = (23, 32, 48)
FG = (244, 247, 251)
PAD_X = 12
PAD_Y = 10
BAR_HEIGHT = 46
RADIUS = 10
FONT_SIZE = 22


def load_font():
    for path in FONT_PATHS:
        if Path(path).exists():
            return ImageFont.truetype(path, FONT_SIZE)
    raise SystemExit("找不到中文字体，请修改 FONT_PATHS")


def draw_caption(image, text, font):
    draw = ImageDraw.Draw(image)
    bar_w = image.width - PAD_X * 2
    box = (PAD_X, PAD_Y, PAD_X + bar_w, PAD_Y + BAR_HEIGHT)
    draw.rounded_rectangle(box, radius=RADIUS, fill=BG)

    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    x = (image.width - (right - left)) // 2
    y = PAD_Y + (BAR_HEIGHT - font.size) // 2 - 2
    draw.text((x, y), text, font=font, fill=FG)


def main():
    meta = json.loads((FRAMES_DIR / "frames.json").read_text(encoding="utf-8"))
    font = load_font()
    frames = []
    durations = []
    for item in meta:
        image = Image.open(FRAMES_DIR / item["file"]).convert("RGB")
        draw_caption(image, item["caption"], font)
        frames.append(image.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))
        durations.append(item["ms"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    size = OUTPUT.stat().st_size
    print(f"已生成 {OUTPUT}：{len(frames)} 帧，{size / 1024:.0f} KB")


if __name__ == "__main__":
    main()

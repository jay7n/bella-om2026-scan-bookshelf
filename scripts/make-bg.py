#!/usr/bin/env python3
"""
生成页面底图 public/bg-night.jpg 和 public/bg-sky.jpg。

做法：把书架照片的明暗，叠到主题色渐变的亮度上 ——
形状看得见（是一条条书脊），但颜色始终是主题色。
纱层也一起合成了，所以 CSS 里不需要再叠任何东西。

想调深浅，改 build() 里这几行再跑一次，别去改 CSS：

    tint    照片的存在感，0 = 完全看不见，1 = 照片本身
    bias    底色亮度下限，越大书脊越不明显
    vt/vb   顶部/底部纱层浓度，vb 越大底部越实（文字越好读）
"""
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import numpy as np

SRC = "docs/shelf-source.jpg"
W, H = 1200, 2600


def load_luminance() -> np.ndarray:
    src = Image.open(SRC).convert("L")
    iw, ih = src.size
    scale = max(W / iw, H / ih)
    img = src.resize((int(iw * scale), int(ih * scale)), Image.LANCZOS)
    left = (img.width - W) // 2
    top = int((img.height - H) * 0.42)
    img = img.crop((left, top, left + W, top + H))
    img = ImageOps.autocontrast(img, cutoff=1)
    lum = np.asarray(img, dtype=float) / 255.0
    return np.clip(lum * 1.15 - 0.05, 0, 1)


def build(lum, name, top, bottom, glow, tint, bias, vt, vb, power=1.25):
    a, b = np.array(top, float), np.array(bottom, float)
    t = np.linspace(0, 1, H)[:, None, None]
    grad = (a * (1 - t) + b * t) * np.ones((H, W, 1))

    g = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(g).ellipse([-W // 3, -int(H * 0.28), W + W // 3, int(H * 0.30)], fill=glow)
    g = g.filter(ImageFilter.GaussianBlur(180))
    grad = np.clip(grad + np.asarray(g, float) * 0.16, 0, 255)

    mod = bias + (1 - bias) * lum[..., None] * 1.35
    tinted = np.clip(grad * np.clip(mod, 0, 1.9), 0, 255)
    out = grad * (1 - tint) + tinted * tint

    tf = np.linspace(0, 1, H)[:, None, None]
    alpha = vt + (vb - vt) * np.clip(tf, 0, 1) ** power
    out = out * (1 - alpha) + (a * (1 - tf) + b * tf) * alpha

    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(
        f"public/{name}", "JPEG", quality=82, optimize=True
    )
    print("wrote", name)


lum = load_luminance()
build(lum, "bg-night.jpg", (0x1A, 0x40, 0x36), (0x09, 0x22, 0x1E), (233, 168, 60), 0.95, 0.42, 0.06, 0.80)
build(lum, "bg-sky.jpg", (0xF4, 0xF8, 0xFC), (0xD2, 0xE0, 0xEC), (226, 112, 74), 0.40, 0.86, 0.16, 0.82)

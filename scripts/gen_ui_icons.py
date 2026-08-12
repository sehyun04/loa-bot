"""떠상 화면에서 쓰는 UI 아이콘 PNG를 만드는 스크립트.

유니코드 이모지(등급 색 점, 지역 핀)를 쓰지 않기로 해서, 같은 자리에 넣을
봇 커스텀 이모지용 이미지를 여기서 생성한다. 아이템 아이콘과 달리 이건
받아올 CDN 원본이 없어서 직접 그린다.

Pillow를 requirements에 넣지 않으려고 zlib만으로 PNG를 쓴다. 원과 티어드롭
두 종류뿐이라 래스터라이저를 통째로 들일 이유가 없다.

실행: .venv/Scripts/python.exe scripts/gen_ui_icons.py
"""

import math
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

OUT_DIR = Path(__file__).resolve().parents[1] / "resources" / "ui_icons"

SIZE = 128
SS = 4  # 슈퍼샘플링 배수. 안티에일리어싱 없이는 22px로 줄었을 때 계단이 보인다.

# run/views/common.py, merchant_view.py의 _GRADE_COLOR와 같은 값이어야 한다.
GRADE_COLORS = {
    "grade0": 0x6E7681,
    "grade1": 0x1EB854,
    "grade2": 0x3B82F6,
    "grade3": 0xA855F7,
    "grade4": 0xF5C518,
}
BRAND = 0xC8963E


def write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    h = len(pixels)
    w = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # 필터 타입 None
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def render(coverage, rgb: int) -> list[list[tuple[int, int, int, int]]]:
    """coverage(x, y) -> bool 을 SS배 슈퍼샘플링해서 알파로 굽는다.

    좌표는 24x24 뷰박스 기준(Lucide 아이콘 좌표계)으로 받는다."""
    r, g, b = (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF
    scale = 24 / SIZE
    rows = []
    for py in range(SIZE):
        row = []
        for px in range(SIZE):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) * scale
                    y = (py + (sy + 0.5) / SS) * scale
                    if coverage(x, y):
                        hits += 1
            row.append((r, g, b, round(255 * hits / (SS * SS))))
        rows.append(row)
    return rows


def dot_coverage(x: float, y: float) -> bool:
    # 24 뷰박스 안에 반지름 9. 인라인 이모지는 주변 글자와 붙어 보여서 여백을 좀 남긴다.
    return (x - 12) ** 2 + (y - 12) ** 2 <= 9**2


def _pin_shape():
    """Lucide map-pin 형상: 원 + 꼭짓점까지의 접선 삼각형, 가운데 구멍."""
    cx, cy, rad = 12.0, 10.0, 8.0
    tipx, tipy = 12.0, 22.0
    d = math.hypot(tipx - cx, tipy - cy)
    # 접점은 중심에서 꼭짓점 방향으로부터 acos(rad/d) 만큼 벌어진 두 점
    base = math.atan2(tipy - cy, tipx - cx)
    spread = math.acos(rad / d)
    t1 = (cx + rad * math.cos(base - spread), cy + rad * math.sin(base - spread))
    t2 = (cx + rad * math.cos(base + spread), cy + rad * math.sin(base + spread))
    tri = ((tipx, tipy), t1, t2)

    def sign(p, a, b):
        return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])

    def coverage(x: float, y: float) -> bool:
        p = (x, y)
        if (x - cx) ** 2 + (y - cy) ** 2 <= 3.2**2:
            return False  # 가운데 구멍
        if (x - cx) ** 2 + (y - cy) ** 2 <= rad**2:
            return True
        s = [sign(p, tri[i], tri[(i + 1) % 3]) for i in range(3)]
        return all(v >= 0 for v in s) or all(v <= 0 for v in s)

    return coverage


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, color in GRADE_COLORS.items():
        write_png(OUT_DIR / f"{name}.png", render(dot_coverage, color))
        print(f"생성: {name}.png")
    write_png(OUT_DIR / "pin.png", render(_pin_shape(), BRAND))
    print("생성: pin.png")
    print(f"완료 -> {OUT_DIR}")


if __name__ == "__main__":
    main()

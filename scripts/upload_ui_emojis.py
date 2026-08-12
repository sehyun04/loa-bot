"""resources/ui_icons/*.png 를 봇 애플리케이션 이모지로 올려두는 스크립트.

떠상 화면의 등급 점과 지역 핀을 유니코드 이모지 대신 아이콘으로 쓰기 위한
업로드 단계다. 원본 이미지는 scripts/gen_ui_icons.py 가 만든다.

CDN에서 받아오는 아이템 아이콘과 달리 로컬 파일을 읽는다는 점만 다르고,
결과를 resources/ui_emoji.json 에 남겨 재실행 시 중복 업로드를 피하는 방식은
scripts/upload_item_emojis.py 와 같다.

실행: .venv/Scripts/python.exe scripts/upload_ui_emojis.py
"""

import asyncio
import base64
import json
import sys
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run.core import config  # noqa: E402

ICON_DIR = Path(__file__).resolve().parents[1] / "resources" / "ui_icons"
OUTPUT_JSON = Path(__file__).resolve().parents[1] / "resources" / "ui_emoji.json"
API_BASE = "https://discord.com/api/v10"


async def main() -> None:
    icons = sorted(ICON_DIR.glob("*.png"))
    if not icons:
        print(f"{ICON_DIR} 에 PNG가 없다. 먼저 scripts/gen_ui_icons.py 를 실행할 것")
        return
    print(f"아이콘 {len(icons)}개 발견")

    existing: dict[str, str] = {}
    if OUTPUT_JSON.exists():
        existing = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
        print(f"이미 업로드된 {len(existing)}개는 건너뜀")

    headers = {"Authorization": f"Bot {config.DISCORD_TOKEN}"}
    url = f"{API_BASE}/applications/{config.DISCORD_APPLICATION_ID}/emojis"

    async with aiohttp.ClientSession(headers=headers) as session:
        for i, path in enumerate(icons, 1):
            key = path.stem
            if key in existing:
                continue
            name = f"loa_ui_{key}"[:32]
            data_uri = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()

            async with session.post(url, json={"name": name, "image": data_uri}) as resp:
                if resp.status not in (200, 201):
                    body = await resp.text()
                    print(f"[{i}/{len(icons)}] 이모지 생성 실패 ({resp.status}) {name}: {body[:200]}")
                    continue
                payload = await resp.json()
                existing[key] = f"<:{name}:{payload['id']}>"
                print(f"[{i}/{len(icons)}] 업로드 완료: {name}")

            OUTPUT_JSON.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            await asyncio.sleep(1.5)

    print(f"완료: {len(existing)}/{len(icons)}개, {OUTPUT_JSON} 에 저장")


if __name__ == "__main__":
    asyncio.run(main())

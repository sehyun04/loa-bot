"""떠상 아이템 아이콘을 봇 애플리케이션 이모지로 한 번만 업로드해두는 스크립트.

Section+Thumbnail은 이미지가 너무 크게 나와서, 등급 이모지만 한 작은 인라인
아이콘으로 바꾸기로 했다. 디스코드에 그 크기로 이미지를 넣는 유일한 방법은
커스텀 이모지뿐이라, 아이템 아이콘(115종, 중복 제외)을 애플리케이션 이모지로
업로드하고 그 결과(이름 -> `<:name:id>`)를 resources/item_emoji.json 에 저장한다.

애플리케이션 이모지는 길드 이모지 슬롯(서버당 50~250개)과 무관하게 봇 하나당
2000개까지 쓸 수 있고, 봇이 들어간 모든 서버에서 공용으로 쓸 수 있다.

실행: .venv/Scripts/python.exe scripts/upload_item_emojis.py
(봇 게이트웨이 접속 없이 REST만 쓰므로 봇이 이미 다른 곳에서 떠 있어도 충돌 안 한다.)
"""

import asyncio
import base64
import json
import re
import sys
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run.core import config  # noqa: E402

MERCHANT_JSON = Path(__file__).resolve().parents[1] / "resources" / "merchant.json"
OUTPUT_JSON = Path(__file__).resolve().parents[1] / "resources" / "item_emoji.json"
ICON_BASE = "https://cdn-lostark.game.onstove.com/"
API_BASE = "https://discord.com/api/v10"


def slugify(icon_path: str) -> str:
    stem = icon_path.removeprefix("efui_iconatlas/").rsplit(".", 1)[0]
    safe = re.sub(r"[^a-zA-Z0-9_]", "_", stem)
    return ("loa_" + safe)[:32]


async def main() -> None:
    merchant = json.loads(MERCHANT_JSON.read_text(encoding="utf-8"))
    icons = sorted({item["icon"] for region in merchant["regions"] for item in region["items"]})
    print(f"고유 아이콘 {len(icons)}개 발견")

    existing: dict[str, str] = {}
    if OUTPUT_JSON.exists():
        existing = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
        print(f"이미 업로드된 {len(existing)}개는 건너뜀")

    headers = {"Authorization": f"Bot {config.DISCORD_TOKEN}"}
    app_id = config.DISCORD_APPLICATION_ID
    url = f"{API_BASE}/applications/{app_id}/emojis"

    async with aiohttp.ClientSession(headers=headers) as session:
        for i, icon in enumerate(icons, 1):
            if icon in existing:
                continue
            name = slugify(icon)
            async with session.get(ICON_BASE + icon) as resp:
                if resp.status != 200:
                    print(f"[{i}/{len(icons)}] 이미지 다운로드 실패 ({resp.status}): {icon}")
                    continue
                image_bytes = await resp.read()
                content_type = resp.content_type or "image/png"

            data_uri = f"data:{content_type};base64,{base64.b64encode(image_bytes).decode()}"

            async with session.post(url, json={"name": name, "image": data_uri}) as resp:
                if resp.status not in (200, 201):
                    body = await resp.text()
                    print(f"[{i}/{len(icons)}] 이모지 생성 실패 ({resp.status}) {name}: {body[:200]}")
                    continue
                payload = await resp.json()
                emoji_id = payload["id"]
                existing[icon] = f"<:{name}:{emoji_id}>"
                print(f"[{i}/{len(icons)}] 업로드 완료: {name}")

            OUTPUT_JSON.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            # 애플리케이션 이모지 생성도 레이트리밋이 있어 넉넉히 쉬어간다
            await asyncio.sleep(1.5)

    print(f"완료: {len(existing)}/{len(icons)}개, {OUTPUT_JSON} 에 저장")


if __name__ == "__main__":
    asyncio.run(main())

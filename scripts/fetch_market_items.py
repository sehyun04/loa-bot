"""거래소에 실제로 올라와 있는 아이템 이름을 전부 긁어서 /시세 자동완성용
로컬 카탈로그(resources/market_items.json)로 저장하는 스크립트.

배경: 로스트아크 오픈API의 POST /markets/items는 자동완성처럼 키 입력마다
부르기엔 레이트리밋(공유 80/분)이 너무 빡빡하다. 그래서 그동안은 자동완성이
market_presets.json에 손으로 적어둔 20개 남짓한 이름만 보여줬는데, 실제
거래소에 있는 아이템 이름과 안 맞아서 어색했다. 이 스크립트로 한 번(혹은
가끔) 카탈로그를 갱신해두면, 봇은 그 이후로 로컬 파일만 보고 자동완성을
채우니 실시간 API 호출이 전혀 없다.

아바타(코스튬)는 8000개가 넘어서 여기 넣으면 이 스크립트 하나가 프로덕션
봇과 같은 API 키의 레이트리밋을 10분 넘게 통째로 잡아먹는다. "시세"로
찾는 건 거의 재련재료/각인서/요리/생활/전투용품처럼 진행에 쓰는 아이템이라,
일단 아바타는 빼고 나머지 카테고리만 받는다. 필요해지면 CATEGORIES에
20000을 추가해서 다시 돌리면 된다.

실행: .venv/Scripts/python.exe scripts/fetch_market_items.py
(약 750개 아이템 기준 카테고리당 페이지 넘기며 총 80회 안팎 호출, 1~2분)
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run.core import config  # noqa: E402
from run.services.lostark.client import close_client, get_client  # noqa: E402

OUTPUT_JSON = Path(__file__).resolve().parents[1] / "resources" / "market_items.json"

# run/services/lostark/market.py의 CATEGORY_CODES에서 아바타(20000)만 뺀 목록.
CATEGORIES = {
    50000: "강화 재료",
    40000: "각인서",
    70000: "요리",
    90000: "생활",
    60000: "전투 용품",
    140000: "펫",
    160000: "탈것",
    100000: "모험의 서",
    110000: "항해",
    170000: "기타",
    220000: "보석 상자",
    10100: "장비 상자",
}


async def fetch_category(code: int, label: str) -> list[dict]:
    client = get_client()
    items: dict[str, str] = {}  # name -> grade, 중복 제거
    page = 1
    while True:
        payload = await client.post(
            "/markets/items",
            body={
                "Sort": "CURRENT_MIN_PRICE",
                "CategoryCode": code,
                "ItemName": "",
                "PageNo": page,
                "SortCondition": "ASC",
            },
        )
        rows = (payload or {}).get("Items") or []
        if not rows:
            break
        for row in rows:
            name = row.get("Name")
            if name:
                items[name] = row.get("Grade", "")
        if len(rows) < 10:
            break
        page += 1
    print(f"{label} ({code}): {len(items)}개, {page}페이지")
    return [{"name": name, "grade": grade} for name, grade in items.items()]


async def main() -> None:
    if not config.has_lostark_api():
        print("LOSTARK_API_KEY가 설정되어 있지 않아요")
        return

    all_items: dict[str, str] = {}
    for code, label in CATEGORIES.items():
        for row in await fetch_category(code, label):
            all_items[row["name"]] = row["grade"]

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "items": [
            {"name": name, "grade": grade}
            for name, grade in sorted(all_items.items())
        ],
    }
    OUTPUT_JSON.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"완료: 총 {len(all_items)}개, {OUTPUT_JSON} 에 저장")
    await close_client()


if __name__ == "__main__":
    asyncio.run(main())

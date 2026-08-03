from dataclasses import dataclass

from run.services.lostark.client import get_client

SEARCH_TTL = 300.0
OPTIONS_TTL = 86400.0


@dataclass(frozen=True)
class MarketItem:
    id: int
    name: str
    grade: str
    icon: str | None
    bundle_count: int
    current_min_price: int
    yesterday_avg_price: float
    recent_price: int

    @property
    def unit_price(self) -> float:
        """묶음 단위 아이템은 개당 가격으로 봐야 비교가 된다."""
        return self.current_min_price / self.bundle_count if self.bundle_count else 0.0


def _parse(row: dict) -> MarketItem:
    return MarketItem(
        id=row.get("Id", 0),
        name=row.get("Name", ""),
        grade=row.get("Grade", ""),
        icon=row.get("Icon"),
        bundle_count=row.get("BundleCount") or 1,
        current_min_price=row.get("CurrentMinPrice") or 0,
        yesterday_avg_price=row.get("YDayAvgPrice") or 0.0,
        recent_price=row.get("RecentPrice") or 0,
    )


# 거래소 상위 카테고리 전체 목록 (/markets/options로 확인, 2026-08-03 기준).
# CategoryCode는 이제 필수라 0("전체")으로 한 번에 검색할 수 없다 - 이 순서대로
# 하나씩 찔러보다가 결과가 나오는 카테고리에서 멈춘다. 강화 재료를 맨 앞에 둔 건
# 실제로 가장 많이 찾는 카테고리라 대부분 첫 호출에서 끝나기 때문이다.
CATEGORY_CODES: list[int] = [
    50000,   # 강화 재료
    40000,   # 각인서
    70000,   # 요리
    90000,   # 생활
    60000,   # 전투 용품
    20000,   # 아바타
    140000,  # 펫
    160000,  # 탈것
    100000,  # 모험의 서
    110000,  # 항해
    170000,  # 기타
    220000,  # 보석 상자
    10100,   # 장비 상자
]


async def search(name: str, category_code: int | None = None, limit: int = 8) -> list[MarketItem]:
    """category_code를 안 주면 CATEGORY_CODES를 순서대로 찔러보다가 결과가
    나오는 첫 카테고리에서 멈춘다. 카테고리를 미리 아는 호출자(예: 지옥 보상 -
    전부 강화 재료다)는 category_code를 넘겨서 불필요한 호출을 피한다."""
    client = get_client()
    codes = [category_code] if category_code is not None else CATEGORY_CODES
    for code in codes:
        payload = await client.post(
            "/markets/items",
            body={
                "Sort": "CURRENT_MIN_PRICE",
                "CategoryCode": code,
                "ItemName": name,
                "PageNo": 1,
                "SortCondition": "ASC",
            },
            ttl=SEARCH_TTL,
        )
        rows = (payload or {}).get("Items") or []
        if rows:
            return [_parse(r) for r in rows[:limit]]
    return []

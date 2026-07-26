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


async def search(name: str, limit: int = 8) -> list[MarketItem]:
    client = get_client()
    payload = await client.post(
        "/markets/items",
        body={
            "Sort": "CURRENT_MIN_PRICE",
            "CategoryCode": 0,
            "ItemName": name,
            "PageNo": 1,
            "SortCondition": "ASC",
        },
        ttl=SEARCH_TTL,
    )
    if not payload:
        return []
    rows = payload.get("Items") or []
    return [_parse(r) for r in rows[:limit]]

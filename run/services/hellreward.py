import json
import re
from dataclasses import dataclass

from run.core import config
from run.services.lostark import market

_TABLE: dict = json.loads(
    (config.RESOURCE_DIR / "hell_reward.json").read_text(encoding="utf-8")
)
_PHEON_RATE_PATH = config.RESOURCE_DIR / "pheon_rate.json"

TIERS = ("1640", "1700", "1730", "1750")

# 페온은 거래소 아이템이 아니라 캐시샵에서 크리스탈로 사는 재화라 시세 API로는 안 잡힌다.
# 100개 묶음이 850크리스탈로 제일 싸다(15% 할인) - 이 비율로 환산한다. 크리스탈 자체의
# 골드 가치(크리스탈→골드 로열 크리스탈 마켓 시세)는 공식 API에 없어서
# resources/pheon_rate.json에 사용자가 직접 갱신하는 값으로 둔다.
_CRYSTAL_PER_100_PHEON = 8.5

# 캐시샵 페온 정가 - 확률/시세가 아니라 고정값이라 패치 전까진 안 바뀐다.
_PHEON_COST = {
    "어빌리티 스톤 키트": 9,
}

# "젬 선택" 상자는 페온만으로 안 되고 "젬 자체 시세 + 페온값"을 더해야 한다 - 상자를
# 페온만으로 캐시샵에서 사는 게 아니라, 원하는 젬을 거래소에서 직접 골라 살 수 있고
# 그 시세가 등급 안에서도 종류마다 천차만별이라(예: 희귀 1골드 vs 8000골드대) "젬
# 선택"의 실질 가치는 그 등급에서 고를 수 있는 가장 비싼 젬의 시세를 기준으로 잡는다.
_GEM_CATEGORY = 230000  # 아크그리드 재료 - 거래소 검색에서 젬이 이 카테고리에 있다
_GEM_TYPES = (
    "혼돈의 젬 : 왜곡", "혼돈의 젬 : 붕괴", "혼돈의 젬 : 침식",
    "질서의 젬 : 불변", "질서의 젬 : 견고", "질서의 젬 : 안정",
)
_GEM_PHEON = {"희귀": 6, "영웅": 12}


async def _gem_prices(grade: str) -> list[float]:
    prices = []
    for name in _GEM_TYPES:
        results = await market.search(name, category_code=_GEM_CATEGORY, limit=8)
        prices.extend(r.unit_price for r in results if r.grade == grade)
    return prices


async def _gem_box_value(grade: str, *, pick_best: bool) -> float | None:
    """해당 등급 젬 상자 1개의 골드 가치 = 젬 시세 + 페온 정가를 골드로 환산한 값.

    "선택" 상자는 6종 중 원하는 걸 고를 수 있으니 최고가를 쓰고, "랜덤" 상자는
    어떤 종류가 나올지 모르니 6종 평균가를 쓴다."""
    prices = await _gem_prices(grade)
    if not prices:
        return None
    gem_price = max(prices) if pick_best else sum(prices) / len(prices)
    return gem_price + _GEM_PHEON[grade] * _pheon_gold_value()

# 특수재련(순환/전이 돌파석)은 재화 없이 강화를 누르게 해주는 아이템이라 거래소/페온
# 어디에도 안 잡힌다. 무기 강화 특정 단계 기준으로 개당 가치를 사용자가 직접 정했다
# (2026-08-03) - 확률/시세가 아니라 티어별 고정 참조값이라 패치 전까진 안 바뀐다.
_SPECIAL_REFINE_GOLD = {
    "1640": 118,  # 에기르 무기 11강 기준
    "1700": 121,  # 에기르 무기 19강 기준
    "1730": 543,  # 세르카 무기 12강 기준
    "1750": 621,  # 세르카 무기 16강 기준
}
_SPECIAL_REFINE_LABEL = {
    "1640": "에기르 무기 11강 기준",
    "1700": "에기르 무기 19강 기준",
    "1730": "세르카 무기 12강 기준",
    "1750": "세르카 무기 16강 기준",
}


def special_refine_label(tier: str) -> str | None:
    return _SPECIAL_REFINE_LABEL.get(tier)

# 팔찌는 옵션이 랜덤이라 거래소에 "고대 팔찌"라는 이름의 단일 시세가 없다 - 실제
# 가치는 "쓸 만한 옵션 조합이 뜰 확률 x 그 조합의 시세"의 기댓값이라, 참고 사이트가
# 그렇게 계산해 내놓은 개당 값을 그대로 가져다 쓴다 (2026-08-05).
# 원래는 값을 못 매긴다고 보고 계산에서 뺐는데, 그러면 팔찌 층이 통째로 "시세 조회
# 불가"로 빠져서 다른 보상과 비교 자체가 안 되는 게 더 큰 문제였다.
_BRACELET_GOLD = {
    "고대 팔찌": 1250,
    "유물 팔찌": 955,
}


def bracelet_label(item_name: str) -> str | None:
    gold = _BRACELET_GOLD.get(item_name)
    return f"개당 {gold:,}골드 기준" if gold is not None else None

# 귀속(비거래) 이거나 아직 가치 기준이 안 잡힌 것들.
# "혼돈의 돌"은 무기/방어구 세부 수량을 사이트에서 못 얻어서 같이 뺐다.
_NOT_PRICEABLE = {
    "천상 도전 횟수 +1 (귀속)",
    "정련된 운명의 돌",
}

_MARKET_CATEGORY = 50000  # 강화 재료 - 지옥 보상 아이템은 전부 이 카테고리 아래에 있다


def _pheon_gold_value() -> float:
    rate = json.loads(_PHEON_RATE_PATH.read_text(encoding="utf-8"))
    gold_per_crystal = rate["crystal_gold_price"] / rate["crystal_gold_qty"]
    return gold_per_crystal * _CRYSTAL_PER_100_PHEON

_PAREN_SUFFIX_RE = re.compile(r"\s*\([^)]*\)\s*$")


@dataclass(frozen=True)
class RewardItem:
    name: str
    qty: int
    gold: float | None  # None이면 시세로 못 구한 항목


@dataclass(frozen=True)
class CategoryValue:
    category: str
    items: list[RewardItem]
    total_gold: float | None  # 구성 아이템 중 하나라도 시세를 못 구하면 None


def floor_to_stage(floor: int) -> str:
    """1~9층은 기본 단계, 10~19는 1단계... 100층만 최고 단계."""
    if not (1 <= floor <= 100):
        raise ValueError("층수는 1~100 사이여야 해요")
    if floor == 100:
        return "max"
    if floor < 10:
        return "0"
    return str(floor // 10)


def stage_label(stage: str) -> str:
    return "기본 단계" if stage == "0" else ("최고 단계" if stage == "max" else f"{stage}단계")


def categories_for(tier: str, floor: int) -> list[str]:
    stage = floor_to_stage(floor)
    return list(_TABLE.get(tier, {}).get(stage, {}).keys())


def display_name(item_name: str) -> str:
    # "순환 돌파석 (에기르 무기 19→20)" 같은 괄호는 어떤 강화에 쓰는지 알려주는
    # 설명이지 거래소 아이템명의 일부가 아니라, 검색·표시 전에 떼어낸다.
    return _PAREN_SUFFIX_RE.sub("", item_name)


async def _price_one(item_name: str, qty: int, tier: str) -> float | None:
    if item_name == "귀속 골드":
        return float(qty)
    if display_name(item_name) in ("순환 돌파석", "전이 돌파석"):
        gold_per_unit = _SPECIAL_REFINE_GOLD.get(tier)
        return gold_per_unit * qty if gold_per_unit is not None else None
    if item_name in _BRACELET_GOLD:
        return _BRACELET_GOLD[item_name] * qty
    if item_name in _PHEON_COST:
        return _PHEON_COST[item_name] * _pheon_gold_value() * qty
    if item_name == "희귀 젬 선택 상자":
        value = await _gem_box_value("희귀", pick_best=True)
        return value * qty if value is not None else None
    if item_name == "영웅 젬 선택 상자":
        value = await _gem_box_value("영웅", pick_best=True)
        return value * qty if value is not None else None
    if item_name == "희귀~영웅 젬 랜덤 상자":
        # 낮은 티어에서 뜨는 랜덤 등급 상자 - 종류도 못 고르니 평균가 기준,
        # 등급은 희귀 90% / 영웅 10% 확률의 기댓값
        rare = await _gem_box_value("희귀", pick_best=False)
        heroic = await _gem_box_value("영웅", pick_best=False)
        if rare is None or heroic is None:
            return None
        return (0.9 * rare + 0.1 * heroic) * qty
    if item_name in _NOT_PRICEABLE:
        return None

    query = display_name(item_name)
    results = await market.search(query, category_code=_MARKET_CATEGORY, limit=8)
    if not results:
        return None
    match = next((r for r in results if r.name == query), results[0])
    return match.unit_price * qty


async def evaluate(tier: str, floor: int, category: str) -> CategoryValue:
    stage = floor_to_stage(floor)
    raw_items = _TABLE.get(tier, {}).get(stage, {}).get(category, [])

    items: list[RewardItem] = []
    total = 0.0
    priceable = bool(raw_items)
    for entry in raw_items:
        name, qty = entry["item"], entry["qty"]
        gold = await _price_one(name, qty, tier)
        items.append(RewardItem(name=name, qty=qty, gold=gold))
        if gold is None:
            priceable = False
        else:
            total += gold

    return CategoryValue(category=category, items=items, total_gold=total if priceable else None)

"""스펙업 우선순위 진단.

로펙·로아업처럼 "비용 대비 전투력 상승"으로 줄을 세우려면 재련 단계별 성공 확률과
재료표가 있어야 하는데, 그건 공식 API에 없다. 대신 공식 API 만으로 확실하게 알 수
있는 게 하나 있다 - **같은 종류끼리 얼마나 벌어져 있는가**다.

곱연산 구조에서는 한 곳만 처져 있으면 그 곳을 올리는 게 대체로 가장 싸다. 그래서
여기서는 부위별 재련 단계, 보석 레벨, 각인 레벨을 각자 같은 종류끼리 비교해서 뒤처진
순으로 세운다. 값을 지어내지 않고 실제로 아는 것만 쓴다.

골드는 각인과 재련에 붙는다. 각인은 각인서가 거래소에 있고, 재련은 확률·재료표를
resources/refine_table.json 에 들여오면서 붙일 수 있게 됐다. 다만 어느 등급의 장비를
끼고 있는지는 응답에 없어서 아이템 레벨로 추정한다 - 그래서 어느 표로 계산했는지 화면에
같이 적는다. 보석은 거래소가 아니라 경매장이라 아직 못 붙이고, 완갑은 골드보다 실링·
파편이 주 비용이라 한 숫자로 줄이면 거짓말이 된다(/완갑 이 따로 있다).
"""

import re
from dataclasses import dataclass, replace

from run.services import refine
from run.services.lostark import armory, market

# 재련 단계를 서로 비교할 부위. 장신구·팔찌·어빌리티 스톤은 재련하지 않고, 완갑은
# 재료와 단계 스케일이 달라서 이 비교에서 뺀다.
ARMOR_SLOTS = ("투구", "상의", "하의", "장갑", "어깨")
WEAPON_SLOT = "무기"
GAUNTLET_SLOT = "완갑"

# 유물 각인의 최고 레벨. 여기 못 미치면 그만큼 뒤처진 것으로 본다.
ENGRAVING_MAX_LEVEL = 4

# 각인 1레벨을 올리는 데 드는 유물 각인서 장수.
ENGRAVING_BOOKS_PER_LEVEL = 5

ENGRAVING_CATEGORY = 40000  # 거래소 - 각인서

_REFINE_RE = re.compile(r"^\+(\d+)\s")


@dataclass(frozen=True)
class SpecUpItem:
    category: str
    label: str  # 지금 상태
    target: str  # 한 단계 올린 모습
    gap: int  # 같은 종류 중 얼마나 뒤처졌는지 - 정렬 기준
    reason: str
    gold: float | None = None
    gold_note: str | None = None
    # 재련 항목만 채운다. 시세는 나중에 한 번에 붙이는데, 그때 무엇을 몇 부위나
    # 올리는 건지 알아야 해서 여기 실어 보낸다.
    refine_step: tuple[str, int, int] | None = None  # (부위, 목표 단계, 부위 수)


def _refine_level(name: str | None) -> int | None:
    match = _REFINE_RE.match(name or "")
    return int(match.group(1)) if match else None


def _refine_levels(equipment: list[dict]) -> dict[str, int]:
    levels: dict[str, int] = {}
    for item in equipment:
        slot, level = item.get("Type"), _refine_level(item.get("Name"))
        if level is None or slot is None:
            continue
        # 귀걸이·반지처럼 같은 부위가 둘인 경우는 재련 대상이 아니라 안 겹친다.
        levels[slot] = level
    return levels


def _armor_items(levels: dict[str, int]) -> list[SpecUpItem]:
    armor = {s: lv for s, lv in levels.items() if s in ARMOR_SLOTS}
    if len(armor) < 2:
        return []

    top = max(armor.values())
    others = ", ".join(f"{s} +{lv}" for s, lv in sorted(armor.items(), key=lambda kv: -kv[1]))

    # 같은 단계에서 처진 부위는 한 항목으로 묶는다. 부위별로 쪼개면 "투구 +18 → +19"
    # 같은 줄이 글자 하나 다르지 않게 넷씩 반복돼서, 화면 절반이 같은 문장이 된다.
    # 어차피 해야 할 일도 같은 일 하나다.
    lagging: dict[int, list[str]] = {}
    for slot, level in armor.items():
        if top - level > 0:
            lagging.setdefault(level, []).append(slot)

    items = []
    for level, slots in sorted(lagging.items()):
        gap = top - level
        label = f"{slots[0]} +{level}" if len(slots) == 1 else f"방어구 {len(slots)}부위 +{level}"
        where = ", ".join(slots) if len(slots) > 1 else None
        items.append(SpecUpItem(
            category="재련",
            label=label,
            target=f"+{level + 1}",
            gap=gap,
            reason=" · ".join(p for p in (where, f"방어구 최고 +{top}") if p),
            refine_step=("armor", level + 1, len(slots)),
        ))
    if not items:
        items.append(SpecUpItem(
            category="재련",
            label="방어구",
            target="-",
            gap=0,
            reason=f"다섯 부위가 +{top} 로 고르게 맞아 있어요 ({others})",
        ))
    return items


def _weapon_item(levels: dict[str, int]) -> SpecUpItem | None:
    weapon = levels.get(WEAPON_SLOT)
    armor = [lv for s, lv in levels.items() if s in ARMOR_SLOTS]
    if weapon is None or not armor:
        return None

    top = max(armor)
    # 무기는 공격력에 직접 붙어서 보통 방어구보다 앞서 간다. 방어구에 따라잡혔다면
    # 그 자체가 신호라 뒤처진 폭을 그대로 준다.
    gap = top - weapon
    if gap <= 0:
        return None
    return SpecUpItem(
        category="재련",
        label=f"무기 +{weapon}",
        target=f"+{weapon + 1}",
        gap=gap + 1,  # 같은 폭이면 방어구보다 먼저 올리는 게 낫다
        reason=f"방어구 최고 +{top} · 무기는 공격력에 직접 붙어요",
        refine_step=("weapon", weapon + 1, 1),
    )


def _gauntlet_item(levels: dict[str, int]) -> SpecUpItem | None:
    level = levels.get(GAUNTLET_SLOT)
    if level is None:
        return None
    return SpecUpItem(
        category="재련",
        label=f"완갑 +{level}",
        target=f"+{level + 1}",
        # 완갑은 다른 부위와 단계 스케일이 아예 달라서 뒤처진 폭을 그대로 비교할 수
        # 없다. 낮은 단계일수록 싸게 오르는 건 분명하니 낮을 때만 위로 올린다.
        gap=max(0, 5 - level),
        reason="낮은 단계일수록 싸게 올라요",
        gold_note="골드보다 실링·파편이 주 비용이라 `/완갑` 에서 따로 봐요",
    )


def _gem_items(gems: list[dict]) -> list[SpecUpItem]:
    levels = [g.get("Level") for g in gems if g.get("Level") is not None]
    if not levels:
        return []
    top = max(levels)
    lowest = min(levels)
    if lowest >= top:
        return []
    count = sum(1 for lv in levels if lv == lowest)
    return [SpecUpItem(
        category="보석",
        label=f"{lowest}레벨 보석 {count}개",
        target=f"{lowest + 1}레벨",
        gap=top - lowest,
        reason=f"가장 높은 보석 {top}레벨 · 낮은 것부터 맞춰요",
        gold_note="보석은 경매장이라 시세를 아직 못 붙여요",
    )]


async def _engraving_items(effects: list[dict], *, with_price: bool) -> list[SpecUpItem]:
    items: list[SpecUpItem] = []
    for effect in effects:
        name, level = effect.get("Name"), effect.get("Level")
        if not name or level is None or level >= ENGRAVING_MAX_LEVEL:
            continue

        gold = note = None
        if with_price:
            results = await market.search(name, category_code=ENGRAVING_CATEGORY, limit=8)
            book = next((r for r in results if r.name.startswith("유물")), None)
            if book:
                gold = book.unit_price * ENGRAVING_BOOKS_PER_LEVEL
                # 각인서 이름에 각인 이름이 그대로 들어가 있어서(유물 원한 각인서) 등급만
                # 남긴다. 각인 이름은 바로 위 label 에 이미 있다.
                note = f"각인서 {ENGRAVING_BOOKS_PER_LEVEL}장 · 장당 {book.unit_price:,.0f}골드"

        items.append(SpecUpItem(
            category="각인",
            label=f"{name} Lv.{level}",
            target=f"Lv.{level + 1}",
            gap=ENGRAVING_MAX_LEVEL - level,
            reason=f"Lv.{ENGRAVING_MAX_LEVEL} 까지 {ENGRAVING_MAX_LEVEL - level}단계",
            gold=gold,
            gold_note=note,
        ))
    return items


async def _priced_refine(item: SpecUpItem, grade: str) -> SpecUpItem:
    """재련 한 단계에 드는 기대 골드. 숨결까지 포함해 제일 싼 방법 기준이다."""
    item_type, target, pieces = item.refine_step
    try:
        report = await refine.report(refine.Request(item_type, grade, target))
    except ValueError:
        # 표에 없는 단계(예: 이미 최고 단계)면 골드 없이 그대로 둔다.
        return item

    best = report.recommended
    note = [f"{refine.GRADE_LABELS[grade]} 기준", f"평균 {best.expected_tries:.1f}번"]
    if pieces > 1:
        note.append(f"1부위 {best.expected_cost:,.0f}골드 x {pieces}")
    return replace(item, gold=best.expected_cost * pieces, gold_note=" · ".join(note))


@dataclass(frozen=True)
class SpecUpReport:
    character: armory.Character
    items: tuple[SpecUpItem, ...]


async def diagnose(name: str, *, with_price: bool = True) -> SpecUpReport:
    char = await armory.fetch_character(name)
    payload = await armory.fetch_raw(name)

    levels = _refine_levels(payload.get("ArmoryEquipment") or [])
    gems = (payload.get("ArmoryGem") or {}).get("Gems") or []
    effects = (payload.get("ArmoryEngraving") or {}).get("ArkPassiveEffects") or []

    items = [*_armor_items(levels), *_gem_items(gems)]
    if weapon := _weapon_item(levels):
        items.append(weapon)
    if gauntlet := _gauntlet_item(levels):
        items.append(gauntlet)
    items.extend(await _engraving_items(effects, with_price=with_price))
    items = [i for i in items if i.gap > 0]

    grade = refine.grade_for_item_level(char.item_level) if with_price else None
    if grade:
        items = [
            await _priced_refine(i, grade) if i.refine_step else i for i in items
        ]

    # 뒤처진 폭이 같으면 골드를 아는 쪽을 먼저 보여준다 - 바로 실행에 옮길 수 있어서다.
    items.sort(key=lambda i: (-i.gap, i.gold is None, i.gold or 0))
    return SpecUpReport(character=char, items=tuple(items))

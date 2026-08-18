"""완갑 재련 비용 계산.

완갑은 한 단계에 돈이 두 번 나간다. 먼저 파편과 실링으로 장비 경험치를 100% 채워야
재련을 시도할 수 있고(공식 가이드: "장비 성장이 완료되면 [장비 재련] 버튼이 활성화"),
그 다음부터 재련 재료가 시도할 때마다 나간다. 실패해도 경험치와 단계는 내려가지
않으므로("재련에 실패하더라도 장비 경험치 및 단계가 하락하거나 파괴되지 않습니다")
성장 비용은 단계당 한 번, 재련 비용만 기대 시도 횟수만큼 곱한다. 둘을 헷갈려서 성장을
재련의 대안으로 놓으면 비용이 통째로 틀린다.

성공 확률과 재료 수량은 단계마다 다르고 공개된 표가 있어서 resources 에 그대로 넣었다.
실패 시 확률·장인의 기운이 오르는 규칙은 일반 재련과 같아서 refine.simulate 를 쓴다.
"""

import json
from dataclasses import dataclass
from functools import lru_cache

from run.core import config
from run.services import refine
from run.services.lostark import market

ENHANCE_CATEGORY = 50000  # 거래소 - 강화 재료

# 실링은 거래소에서 살 수 없다. 골드로 환산하지 않고 필요한 양만 따로 알려준다.
SILVER_KEY = "silver"


@lru_cache(maxsize=1)
def _table() -> dict:
    path = config.RESOURCE_DIR / "gauntlet_refine.json"
    return json.loads(path.read_text(encoding="utf-8"))


def max_stage() -> int:
    return len(_table()["stages"])


def stage_row(stage: int) -> dict:
    """stage 단계로 올리는 재련 한 줄. 표의 'N단계' 는 +N 으로 가는 시도를 말한다."""
    rows = _table()["stages"]
    if not 1 <= stage <= len(rows):
        raise ValueError(f"완갑 재련 단계는 1~{len(rows)} 이에요")
    return rows[stage - 1]


@dataclass(frozen=True)
class Prices:
    unit: dict[str, float]  # 재료 키 -> 개당 골드
    shard_pouch: str | None  # 파편 시세를 환산한 주머니 이름
    missing: tuple[str, ...]  # 거래소에서 못 찾은 재료 이름

    def gold_of(self, amounts: dict) -> float:
        """수량 묶음의 골드 합. 시세를 모르는 재료는 빼고 더한다 - 0으로 치면
        비용이 실제보다 싸 보이므로 missing 을 화면에 같이 띄운다."""
        total = float(amounts.get("gold", 0))
        for key, qty in amounts.items():
            if key in ("gold", SILVER_KEY):
                continue
            total += qty * self.unit.get(key, 0.0)
        return total


async def _exact(name: str) -> market.MarketItem | None:
    """이름이 정확히 같은 매물만 쓴다. '운명의 파괴석' 과 '운명의 파괴석 결정' 처럼
    한 글자 차이로 값이 다섯 배 나는 재료가 섞여 있다."""
    rows = await market.search(name, category_code=ENHANCE_CATEGORY, limit=10)
    return next((r for r in rows if r.name == name), None)


async def fetch_prices() -> Prices:
    table = _table()
    unit: dict[str, float] = {}
    missing: list[str] = []

    for key, name in table["materials"].items():
        if key == "shard":
            continue
        row = await _exact(name)
        if row is None:
            missing.append(name)
        else:
            unit[key] = row.unit_price

    # 파편은 귀속이라 거래소에 매물이 없다. 주머니로만 살 수 있어서 개당 가장 싼
    # 주머니를 기준으로 환산한다 - 실제로도 그렇게 산다.
    best: tuple[float, str] | None = None
    for pouch in table["shard_pouches"]:
        row = await _exact(pouch["item"])
        if row is None or not row.current_min_price:
            continue
        per_shard = row.current_min_price / pouch["qty"]
        if best is None or per_shard < best[0]:
            best = (per_shard, pouch["item"])

    if best is None:
        missing.append(table["materials"]["shard"])
    else:
        unit["shard"] = best[0]

    return Prices(unit=unit, shard_pouch=best[1] if best else None, missing=tuple(missing))


@dataclass(frozen=True)
class StagePlan:
    stage: int  # 이 단계로 올린다 (+stage)
    rate: float
    attempt_gold: float  # 재련 1회에 나가는 골드
    growth_gold: float  # 경험치를 채우는 데 드는 골드 - 단계당 한 번
    expected_tries: float
    max_tries: int  # 장기백
    expected_shard: float
    expected_silver: float

    @property
    def expected_gold(self) -> float:
        return self.growth_gold + self.expected_tries * self.attempt_gold

    @property
    def max_gold(self) -> float:
        return self.growth_gold + self.max_tries * self.attempt_gold


@dataclass(frozen=True)
class GauntletPlan:
    start: int
    target: int
    stages: tuple[StagePlan, ...]
    prices: Prices

    @property
    def expected_gold(self) -> float:
        return sum(s.expected_gold for s in self.stages)

    @property
    def max_gold(self) -> float:
        return sum(s.max_gold for s in self.stages)

    @property
    def expected_shard(self) -> float:
        return sum(s.expected_shard for s in self.stages)

    @property
    def expected_silver(self) -> float:
        return sum(s.expected_silver for s in self.stages)


def plan(start: int, target: int, prices: Prices, *, artisan: float = 0.0) -> GauntletPlan:
    """start 단계에서 target 단계까지. 시세를 인자로 받아 계산부만 따로 돌려볼 수 있게 한다."""
    if not 0 <= start < target <= max_stage():
        raise ValueError(f"단계는 0 이상 {max_stage()} 이하여야 하고, 목표가 더 높아야 해요")

    stages = []
    for stage in range(start + 1, target + 1):
        row = stage_row(stage)
        attempt = prices.gold_of(row["refine"])
        growth = prices.gold_of(row["growth"])

        # 이미 쌓아 둔 장인의 기운은 지금 두드리고 있는 단계에만 남아 있다.
        outcome = refine.simulate(
            row["rate"],
            cost_per_try=attempt,
            artisan=artisan if stage == start + 1 else 0.0,
        )
        stages.append(StagePlan(
            stage=stage,
            rate=row["rate"],
            attempt_gold=attempt,
            growth_gold=growth,
            expected_tries=outcome.expected_tries,
            max_tries=outcome.max_tries,
            expected_shard=row["growth"]["shard"] + outcome.expected_tries * row["refine"]["shard"],
            expected_silver=row["growth"][SILVER_KEY] + outcome.expected_tries * row["refine"][SILVER_KEY],
        ))

    return GauntletPlan(start=start, target=target, stages=tuple(stages), prices=prices)


async def estimate(start: int, target: int, *, artisan: float = 0.0) -> GauntletPlan:
    return plan(start, target, await fetch_prices(), artisan=artisan)

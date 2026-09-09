"""재련 기대 비용 계산.

재련은 실패해도 재료가 그대로 나가고, 실패할수록 성공 확률과 장인의 기운이 함께
오른다. 그래서 "성공까지 평균 몇 골드"는 확률의 역수(1/p)가 아니라 실패 상태를
따라가며 누적해야 나온다.

단계별 기본 확률과 재료 수량은 공식 API에 없어서 loa.icepeng.com(LoaCalc)이 관리하는
표를 가져다 쓴다(scripts/fetch_refine_table.py). 계산 규칙도 같은 곳의 모델을 옮겨
왔다 - 실패 1회당 기본 확률의 10%p 씩 최대 2배까지 오르고, 장인의 기운은 그 시도의
성공 확률을 2.15로 나눈 만큼 쌓인다. 예전에 여기 있던 "실패 1회당 기본 확률의
46.5%"는 장인의 기운 공식(1/2.15)을 성공 확률에도 잘못 갖다 쓴 것이라 확률을 크게
부풀렸다.
"""

import json
import math
from dataclasses import dataclass, field, replace

from run.core import config
from run.services.lostark import market

_TABLE: dict = json.loads(
    (config.RESOURCE_DIR / "refine_table.json").read_text(encoding="utf-8")
)["data"]

# 장인의 기운은 그 시도의 성공 확률을 이 값으로 나눈 만큼 쌓인다.
JANGIN_DIVIDER = 2.15

# 실패 1회당 오르는 폭은 기본 확률의 10%, 상한은 기본 확률의 2배다(= 실패 10번).
FAIL_PROB_RATIO = 0.1
FAIL_PROB_CAP = 2.0

# 숨결은 개수를 조절해 확률을 조금씩 올리고, 나머지(재봉술/야금술 책)는 1개 고정이다.
BREATH_NAMES = ("은총", "축복", "가호", "용암", "빙하")

# 확률이 낮은 단계는 장기백까지 400번을 넘기기도 한다. 그보다 길어지면 표가 깨진
# 것이니 무한 루프 대신 여기서 끊는다.
_MAX_TRIES = 2000

GRADE_LABELS: dict[str, str] = {
    "t4_1730": "T4 1730 (상위 고대)",
    "t4_1590": "T4 1590 (4티어)",
    "t3_1525": "T3 1525 (상위 고대)",
    "t3_1390": "T3 1390 (상위 유물~고대)",
    "t3_1250": "T3 1250 (희귀~유물)",
}

ITEM_TYPE_LABELS = {"weapon": "무기", "armor": "방어구"}

# 캐릭터 아이템 레벨 -> 그 레벨대에서 끼고 있을 장비의 재련 표. 정확히는 장비 등급이지만
# 공식 API 응답에는 그걸 딱 집어 주는 값이 없다. 등급이 바뀌는 지점에서 아이템 레벨도
# 같이 뛰어서 대신 쓸 수 있는데, 경계에 걸친 캐릭터는 한 칸 어긋날 수 있다 - 그래서
# 이걸 쓰는 쪽(스펙업)은 어떤 등급으로 계산했는지 화면에 같이 적는다.
_GRADE_BY_ITEM_LEVEL = (
    (1700, "t4_1730"),
    (1580, "t4_1590"),
    (1520, "t3_1525"),
    (1390, "t3_1390"),
    (0, "t3_1250"),
)


def grade_for_item_level(item_level: float | None) -> str | None:
    if item_level is None:
        return None
    return next(grade for floor, grade in _GRADE_BY_ITEM_LEVEL if item_level >= floor)

# 표에 쓰는 짧은 이름 -> 사람이 보는 이름. 거래소 이름과 다른 것만 적는다.
DISPLAY_NAMES: dict[str, str] = {
    "파편": "명예의 파편",
    "운명파편": "운명의 파편",
    "수결": "수호석 결정",
    "파결": "파괴석 결정",
    "수호강석": "수호강석",
    "파괴강석": "파괴강석",
    "정제된수호강석": "정제된 수호강석",
    "정제된파괴강석": "정제된 파괴강석",
    "운명의수호석": "운명의 수호석",
    "운명의파괴석": "운명의 파괴석",
    "운명의수호석결정": "운명의 수호석 결정",
    "운명의파괴석결정": "운명의 파괴석 결정",
    "중급오레하": "오레하 융화 재료",
    "상급오레하": "상급 오레하 융화 재료",
    "최상급오레하": "최상급 오레하 융화 재료",
    "아비도스": "아비도스 융화 재료",
    "상급아비도스": "상급 아비도스 융화 재료",
    "명돌": "명예의 돌파석",
    "위명돌": "위대한 명예의 돌파석",
    "경명돌": "경이로운 명예의 돌파석",
    "찬명돌": "찬란한 명예의 돌파석",
    "운돌": "운명의 돌파석",
    "위운돌": "위대한 운명의 돌파석",
    "은총": "태양의 은총",
    "축복": "태양의 축복",
    "가호": "태양의 가호",
    "빙하": "빙하의 숨결",
    "용암": "용암의 숨결",
}

# 재봉술/야금술 책은 표에 줄임말로 들어 있고 거래소 이름에는 적용 구간까지 붙는다.
_BOOK_NAMES = {
    "기본": "비늘 [5-7]",
    "응용": "선혈 [8-10]",
    "심화": "마수 [11-15]",
    "숙련": "몽환 [13-15]",
    "특화": "몽환 [16-19]",
    "전문": "쇠락 [13-15]",
    "복합": "쇠락 [16-19]",
    "업화A": "업화 [11-14]",
    "업화B": "업화 [15-18]",
    "업화C": "업화 [19-20]",
}

# 표의 짧은 이름 -> 거래소에서 실제로 사는 물건과 그 하나에 든 개수. 파편처럼 주머니로만
# 파는 건 주머니 값을 개수로 나눠야 개당 값이 나온다. 강석류는 거래소가 100개 묶음으로
# 파는데 그건 market.unit_price 가 이미 개당으로 바꿔 준다.
_MARKET_SOURCES: dict[str, tuple[tuple[str, int], ...]] = {
    "파편": (
        ("명예의 파편 주머니(소)", 500),
        ("명예의 파편 주머니(중)", 1000),
        ("명예의 파편 주머니(대)", 1500),
    ),
    "운명파편": (("운명의 파편 주머니(소)", 1000),),
    "수결": (("수호석 결정", 1),),
    "파결": (("파괴석 결정", 1),),
}

_MARKET_CATEGORY = 50000  # 거래소 - 강화 재료


def display_name(name: str) -> str:
    if name in DISPLAY_NAMES:
        return DISPLAY_NAMES[name]
    for craft in ("재봉술", "야금술"):
        if name.startswith(craft):
            return f"{craft} : {_BOOK_NAMES[name[len(craft):]]}"
    return name


def _market_sources(name: str) -> tuple[tuple[str, int], ...]:
    if name in _MARKET_SOURCES:
        return _MARKET_SOURCES[name]
    return ((display_name(name), 1),)


@dataclass(frozen=True)
class RefineTable:
    item_type: str
    grade: str
    target: int
    base_prob: float
    additional_prob: float  # 성장 지원·영지 연구처럼 기본 확률에 더해지는 몫
    amount: dict[str, int]  # 1회 시도에 나가는 재료
    breath: dict[str, tuple[int, float]]  # 이름 -> (최대 개수, 개당 확률)

    @property
    def label(self) -> str:
        return f"{ITEM_TYPE_LABELS[self.item_type]} +{self.target - 1} → +{self.target}"


@dataclass(frozen=True)
class Strategy:
    """숨결 조합 하나를 성공할 때까지 계속 쓴 결과."""

    breaths: dict[str, int]  # 매 시도에 넣는 숨결/책 (빈 dict면 노숨)
    try_prob: float  # 첫 시도의 성공 확률
    try_cost: float  # 1회 비용 (재료 + 숨결)
    expected_cost: float
    expected_tries: float
    median_tries: int  # 절반은 이 횟수 안에 끝난다
    unlucky_tries: int  # 열에 아홉은 이 횟수 안에 끝난다
    ceiling_tries: int  # 장기백 - 최악의 경우에도 여기서 끝난다
    ceiling_cost: float


@dataclass(frozen=True)
class Request:
    """한 번의 조회. 화면에서 단계·등급만 바꿔 다시 계산할 수 있게 묶어 둔다."""

    item_type: str
    grade: str
    target: int
    jangin: float = 0.0  # 이미 쌓인 장인의 기운 (0~1)
    prob_from_failure: float = 0.0  # 실패로 이미 붙은 추가 확률 (0~1)
    extra_prob: float = 0.0  # 영지 연구·성장 지원 등 (0~1)

    def with_target(self, target: int) -> "Request":
        return replace(self, target=target)

    def with_grade(self, grade: str) -> "Request":
        # 등급이 바뀌면 그 등급에 없는 단계일 수 있다. 가장 가까운 단계로 붙인다.
        target = min(levels(self.item_type, grade), key=lambda x: abs(x - self.target))
        return replace(self, grade=grade, target=target)

    def with_item_type(self, item_type: str) -> "Request":
        # 무기와 방어구는 등급별 단계 구성이 같아서 단계는 그대로 들고 간다.
        return replace(self, item_type=item_type)


@dataclass(frozen=True)
class Report:
    request: "Request"
    table: RefineTable
    prices: dict[str, float]
    missing: tuple[str, ...]  # 시세를 못 구한 재료
    material_cost: float  # 숨결 뺀 1회 재료값
    strategies: tuple[Strategy, ...]  # 숨결을 적게 쓰는 순서
    best: int  # strategies 안에서 기대 비용이 가장 싼 것

    @property
    def no_breath(self) -> Strategy:
        return self.strategies[0]

    @property
    def full_breath(self) -> Strategy:
        return self.strategies[-1]

    @property
    def recommended(self) -> Strategy:
        return self.strategies[self.best]


def grades(item_type: str) -> list[str]:
    """표가 있는 등급을 최신순으로."""
    have = _TABLE[item_type]
    return [g for g in GRADE_LABELS if g in have]


def levels(item_type: str, grade: str) -> list[int]:
    return sorted(int(x) for x in _TABLE.get(item_type, {}).get(grade, {}))


def get_table(
    item_type: str, grade: str, target: int, *, extra_prob: float = 0.0
) -> RefineTable:
    """loa-calc 의 getRefineTable 이관.

    슈퍼 익스프레스처럼 상시로 붙어 있는 확률·재료 할인은 등급별로 여기 반영돼 있고,
    기간 한정 성장 지원이나 영지 연구는 그때그때 달라서 extra_prob 로 받는다.
    """
    raw = _TABLE.get(item_type, {}).get(grade, {}).get(str(target))
    if raw is None:
        available = levels(item_type, grade)
        if not available:
            raise ValueError("그 장비 등급은 표에 없어")
        label = GRADE_LABELS.get(grade, grade)
        raise ValueError(
            f"{label} 등급에는 {available[0]}~{available[-1]}단계만 있어 (넣은 값: {target})"
        )

    base_prob = raw["baseProb"]
    additional_prob = 0.0
    cost_reduction = 0.0
    gold_reduction = 0.0
    gold_ceil_unit = 1

    # 슈퍼 익스프레스 구간마다 할인 폭이 다르고, 구간을 벗어나면 할인이 아예 없다.
    if grade == "t3_1250" and target <= 15:
        additional_prob = 0.1 if target <= 12 else (0.05 if target <= 14 else 0.03)
        cost_reduction, gold_reduction = 0.4, 1.0
    elif grade == "t3_1390" and target <= 20:
        additional_prob = base_prob
        gold_ceil_unit = 10
        cost_reduction, gold_reduction = (0.5, 0.5) if target == 20 else (0.6, 1.0)
    elif grade == "t3_1525" and target <= 19:
        additional_prob = base_prob
        cost_reduction, gold_reduction = 0.6, 1.0
    elif grade == "t4_1590" and target <= 18:
        gold_reduction = 0.2

    def discounted(name: str, value: int) -> int:
        if name == "골드":
            return math.ceil(value * (1 - gold_reduction) / gold_ceil_unit) * gold_ceil_unit
        return math.ceil(value * (1 - cost_reduction))

    return RefineTable(
        item_type=item_type,
        grade=grade,
        target=target,
        base_prob=base_prob,
        additional_prob=round(additional_prob, 3) + extra_prob,
        amount={n: discounted(n, v) for n, v in raw["amount"].items()},
        breath={n: (v[0], v[1]) for n, v in raw["breath"].items()},
    )


@dataclass(frozen=True)
class _BreathOption:
    cost: float
    prob: float
    amounts: dict[str, int] = field(default_factory=dict)


def _breath_options(table: RefineTable, prices: dict[str, float]) -> list[_BreathOption]:
    """싼 것부터 하나씩 얹어 가며 만든 조합 목록. 0번째는 노숨이다.

    숨결로 올릴 수 있는 확률은 기본 확률만큼이 상한이라, 그 한도를 채우는 데 필요한
    만큼만 넣는다 - 확률당 가격이 싼 것부터 채워야 같은 확률을 가장 싸게 산다.
    """
    order = sorted(table.breath, key=lambda n: prices.get(n, 0.0) / table.breath[n][1])

    options = [_BreathOption(cost=0.0, prob=0.0)]
    prob_left = max(table.base_prob, 0.01)
    for name in order:
        max_amount, unit_prob = table.breath[name]
        if name in BREATH_NAMES:
            # 한도를 채우고 남은 몫이 부동소수점 오차로 음수가 되는 자리가 있어 0에서 막는다.
            amount = max(min(math.ceil(prob_left / unit_prob), max_amount), 0)
            gain = max(min(amount * unit_prob, prob_left), 0.0)
            prob_left -= amount * unit_prob
        else:
            # 책은 1개 고정이고 확률도 개수와 무관하다.
            amount, gain = 1, unit_prob
        prev = options[-1]
        options.append(_BreathOption(
            cost=prev.cost + amount * prices.get(name, 0.0),
            prob=prev.prob + gain,
            amounts={**prev.amounts, name: amount},
        ))
    return options


def _round4(value: float) -> float:
    """게임 확률 표기가 소수점 둘째 자리(%)까지라 그 단위로 끊는다."""
    return math.floor(value * 10000 + 0.5) / 10000


def _simulate(
    table: RefineTable,
    option: _BreathOption,
    material_cost: float,
    prob_from_failure: float,
    jangin: float,
) -> Strategy:
    prob = table.base_prob + prob_from_failure
    reach = 1.0  # 여기까지 전부 실패했을 확률
    expected_cost = expected_tries = ceiling_cost = 0.0
    acc = 0.0  # 이 시도까지 성공했을 누적 확률
    median = unlucky = 0
    first_prob = 0.0

    for index in range(1, _MAX_TRIES + 1):
        if jangin >= 1.0:
            # 장기백 - 어차피 확정 성공이라 숨결을 넣을 이유가 없다.
            hit_prob, cost = 1.0, material_cost
        else:
            hit_prob = _round4(min(prob + table.additional_prob + option.prob, 1.0))
            cost = material_cost + option.cost
        if index == 1:
            first_prob = hit_prob

        expected_cost += reach * cost
        ceiling_cost += cost
        expected_tries += index * reach * hit_prob

        acc += reach * hit_prob
        if not median and acc >= 0.5:
            median = index
        if not unlucky and acc >= 0.9:
            unlucky = index

        jangin += hit_prob / JANGIN_DIVIDER
        prob = min(prob + table.base_prob * FAIL_PROB_RATIO, table.base_prob * FAIL_PROB_CAP)
        reach *= 1 - hit_prob

        if hit_prob >= 1.0:
            return Strategy(
                breaths=dict(option.amounts),
                try_prob=first_prob,
                try_cost=material_cost + option.cost,
                expected_cost=expected_cost,
                expected_tries=expected_tries,
                median_tries=median or index,
                unlucky_tries=unlucky or index,
                ceiling_tries=index,
                ceiling_cost=ceiling_cost,
            )

    raise ValueError("계산이 끝나지 않았어 - 재련 표를 확인해 줘")


def simulate(base_prob: float, *, cost_per_try: float = 0.0, jangin: float = 0.0) -> Strategy:
    """표에 없는 재련(완갑처럼 단계표를 따로 들고 있는 쪽)을 같은 규칙으로 돌린다."""
    if not 0 < base_prob <= 1:
        raise ValueError("성공 확률은 0 초과 1 이하여야 해")
    if not 0 <= jangin < 1:
        raise ValueError("장인의 기운은 0 이상 100% 미만이어야 해")

    table = RefineTable(
        item_type="weapon",
        grade="",
        target=0,
        base_prob=base_prob,
        additional_prob=0.0,
        amount={},
        breath={},
    )
    return _simulate(table, _BreathOption(cost=0.0, prob=0.0), cost_per_try, 0.0, jangin)


async def fetch_prices(names: list[str]) -> tuple[dict[str, float], list[str]]:
    """거래소 최저가 기준 개당 골드. 못 찾은 재료 이름은 따로 돌려준다."""
    prices: dict[str, float] = {}
    missing: list[str] = []
    for name in names:
        if name == "골드":
            prices[name] = 1.0
            continue
        candidates = []
        for query, per_item in _market_sources(name):
            rows = await market.search(query, category_code=_MARKET_CATEGORY, limit=8)
            hit = next((r for r in rows if r.name == query), None)
            if hit and hit.unit_price > 0:
                candidates.append(hit.unit_price / per_item)
        if candidates:
            prices[name] = min(candidates)
        else:
            prices[name] = 0.0
            missing.append(name)
    return prices, missing


def evaluate(
    request: Request, prices: dict[str, float], *, missing: tuple[str, ...] = ()
) -> Report:
    """숨결 조합별로 성공까지 밀어 보고 제일 싼 것을 고른다.

    원본(LoaCalc)은 시도마다 숨결 개수를 줄여 가는 경로까지 전부 뒤져서 여기보다
    조금 더 싼 값을 찾는다. 그 탐색은 확률이 낮은 단계에서 8초를 넘기는데, 실제로
    아낄 수 있는 건 재 본 사례에서 0.25% 안쪽이었다. 시세가 하루에도 그보다 크게
    움직이는 걸 생각하면, 사람이 따라할 수 있는 "이 조합으로 계속 간다" 쪽이 낫다.
    """
    if not 0 <= request.jangin < 1:
        raise ValueError("장인의 기운은 0 이상 100% 미만이어야 해")

    table = get_table(
        request.item_type, request.grade, request.target, extra_prob=request.extra_prob
    )
    material_cost = sum(prices.get(n, 0.0) * a for n, a in table.amount.items())
    strategies = tuple(
        _simulate(table, option, material_cost, request.prob_from_failure, request.jangin)
        for option in _breath_options(table, prices)
    )
    best = min(range(len(strategies)), key=lambda i: strategies[i].expected_cost)
    return Report(
        request=request,
        table=table,
        prices=prices,
        missing=missing,
        material_cost=material_cost,
        strategies=strategies,
        best=best,
    )


async def report(request: Request) -> Report:
    table = get_table(
        request.item_type, request.grade, request.target, extra_prob=request.extra_prob
    )
    prices, missing = await fetch_prices(list(table.amount) + list(table.breath))
    return evaluate(request, prices, missing=tuple(missing))

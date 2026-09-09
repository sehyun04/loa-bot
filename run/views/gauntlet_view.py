"""완갑 재련 비용 화면 (Components V2).

Container 구조:
    Container 1: 무엇을 계산했는지 (구간)
    Container 2: 예상 골드 / 단계별 / 재료 총량과 시세

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

from run.services import gauntlet

# 실링과 파편은 자릿수가 커서 그대로 찍으면 읽는 데 시간이 걸린다.
_MAN = 10_000
_EOK = 100_000_000


def _gold(value: float) -> str:
    return f"**{value:,.0f}** 골드"


def _man(value: float, unit: str) -> str:
    if value >= _EOK:
        # 억을 넘어가면 만 단위로도 자릿수를 못 센다.
        return f"{value / _EOK:,.1f}억{unit}"
    if value >= _MAN:
        return f"{value / _MAN:,.0f}만{unit}"
    return f"{value:,.0f}{unit}"


def _price(value: float) -> str:
    """파편처럼 개당 1골드가 안 되는 재료는 소수 둘째 자리에서 다 뭉개진다."""
    return f"{value:,.3f}" if value < 1 else f"{value:,.2f}"


def _rate(value: float) -> str:
    return f"{value * 100:g}%"


def _head(plan: gauntlet.GauntletPlan) -> str:
    return (
        f"# 완갑 +{plan.start} → +{plan.target}\n"
        f"{len(plan.stages)}단계 · 거래소 최저가 기준"
    )


def _single(stage: gauntlet.StagePlan) -> list[discord.ui.Item]:
    """한 단계만 물어봤으면 단계별 목록이 따로 필요 없다. 대신 그 한 단계를 뜯어 보여준다."""
    return [
        discord.ui.TextDisplay(
            f"`평균` {_gold(stage.expected_gold)}\n"
            f"-# 성공률 {_rate(stage.rate)} · 평균 {stage.expected_tries:.1f}번 · "
            f"재련 1회 {stage.attempt_gold:,.0f} + 성장 {stage.growth_gold:,.0f} 골드"
        ),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
        discord.ui.TextDisplay(
            f"`최악` {_gold(stage.max_gold)}\n"
            f"-# 장인의 기운이 꽉 차는 {stage.max_tries}번째까지 갔을 때"
        ),
    ]


def _rollup(plan: gauntlet.GauntletPlan) -> list[discord.ui.Item]:
    return [
        discord.ui.TextDisplay(
            f"`평균` {_gold(plan.expected_gold)}\n"
            f"-# 단계마다 평균만큼 두드렸을 때"
        ),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
        discord.ui.TextDisplay(
            f"`최악` {_gold(plan.max_gold)}\n"
            f"-# 모든 단계에서 장인의 기운이 꽉 찰 때까지 실패했을 때"
        ),
    ]


def _stage_lines(plan: gauntlet.GauntletPlan) -> str:
    return "\n".join(
        f"`+{s.stage}` {_rate(s.rate)} · 평균 {s.expected_tries:.1f}번 · {s.expected_gold:,.0f} 골드"
        for s in plan.stages
    )


def _materials(plan: gauntlet.GauntletPlan) -> str:
    lines = [
        f"운명의 파편 {_man(plan.expected_shard, '개')} · 실링 {_man(plan.expected_silver, '')}",
        # 성장과 재련을 한 덩어리로 보면 왜 파편이 이렇게 많이 드는지가 설명되지 않는다.
        "-# 성장(파편·실링)은 단계마다 한 번, 재련 재료는 시도할 때마다 나가",
    ]

    prices = plan.prices
    seen = " · ".join(
        f"{label} {_price(prices.unit[key])}"
        for key, label in (
            ("destruction", "파괴석"), ("guardian", "수호석"),
            ("leapstone", "돌파석"), ("fusion", "융화"), ("shard", "파편"),
        )
        if key in prices.unit
    )
    if seen:
        pouch = f" · 파편은 {prices.shard_pouch} 환산" if prices.shard_pouch else ""
        lines.append(f"-# 개당 시세 {seen}{pouch}")
    if prices.missing:
        lines.append(f"-# 거래소에서 {' · '.join(prices.missing)} 를 못 찾아서 그만큼은 빠져 있어")
    return "\n".join(lines)


def build_view(plan: gauntlet.GauntletPlan) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(discord.ui.TextDisplay(_head(plan))))

    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("### 예상 골드"),
        discord.ui.Separator(),
    ]
    if len(plan.stages) == 1:
        body += _single(plan.stages[0])
    else:
        body += _rollup(plan)
        body += [
            discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
            discord.ui.TextDisplay("### 단계별"),
            discord.ui.Separator(),
            discord.ui.TextDisplay(_stage_lines(plan)),
        ]

    body += [
        discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
        discord.ui.TextDisplay(_materials(plan)),
    ]
    view.add_item(discord.ui.Container(*body))
    return view

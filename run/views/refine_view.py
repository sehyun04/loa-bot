import discord

from run.services import refine
from run.views import common


def _gold(value: float) -> str:
    return f"{value:,.0f} 골드"


def _cost_suffix(value: float | None) -> str:
    return f" · {_gold(value)}" if value is not None else ""


def build_result_view(outcome: refine.RefineOutcome, base_rate: float, artisan: float) -> discord.ui.LayoutView:
    gain = outcome.attempts[1].artisan - outcome.attempts[0].artisan if len(outcome.attempts) > 1 else 0.0

    head = f"## 재련 기대 비용\n기본 성공 확률 {base_rate * 100:.1f}%"
    if artisan > 0:
        head += f" · 장인의 기운 {artisan * 100:.1f}% 쌓인 상태"

    lines = [
        head,
        f"**평균 {outcome.expected_tries:.1f}번**만에 성공해요"
        f"{_cost_suffix(outcome.expected_cost)}\n"
        f"-# 절반은 {outcome.median_tries}번 안에, 열에 아홉은 {outcome.unlucky_tries}번 안에 끝나요",
    ]

    if outcome.has_ceiling:
        lines.append(
            f"운이 최악이어도 **{outcome.max_tries}번**이면 확정이에요"
            f"{_cost_suffix(outcome.max_cost)}\n"
            f"-# 실패마다 {gain * 100:.2f}%p씩 올라요 · "
            f"성공률은 {refine.FAIL_STACK_CAP}번까지만, 장인의 기운은 끝까지"
        )
    else:
        lines.append(
            "이 재련은 **천장이 없어요**\n"
            "-# 실패해도 성공률과 장인의 기운이 오르지 않아서, 운이 나쁘면 끝없이 들어가요."
        )

    if outcome.cost_per_try is None:
        lines.append("-# 시도 1회에 드는 골드를 `비용`으로 넣으면 골드까지 계산해요.")

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay("\n\n".join(lines)),
        accent_colour=common.BRAND,
    ))
    return view

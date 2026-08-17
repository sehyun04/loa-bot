"""재련 기대 비용 화면 (Components V2).

Container 구조:
    Container 1: 무엇을 계산했는지 (입력 요약)
    Container 2: 결과 (평균 / 최악)
    Container 3: 계산 근거와 단서

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

from run.services import refine


def _gold(value: float) -> str:
    return f"**{value:,.0f}** 골드"


def _cost_suffix(value: float | None) -> str:
    return f"  ·  {_gold(value)}" if value is not None else ""


def _header(outcome: refine.RefineOutcome, base_rate: float, artisan: float) -> str:
    meta = [f"기본 확률 **{base_rate * 100:.1f}%**"]
    if artisan > 0:
        meta.append(f"장인의 기운 **{artisan * 100:.1f}%** 쌓인 상태")
    if outcome.cost_per_try is not None:
        meta.append(f"1회 {_gold(outcome.cost_per_try)}")
    return "# 재련 기대 비용\n" + " · ".join(meta)


def _certain(outcome: refine.RefineOutcome) -> str:
    """확률 100%로 물어본 경우. 평균과 최악이 둘 다 1번이라 나눠 적을 게 없다."""
    return (
        f"`확정` **1번**{_cost_suffix(outcome.expected_cost)}\n"
        "-# 성공 확률이 100%라 실패할 일이 없어요"
    )


def _average(outcome: refine.RefineOutcome) -> str:
    return (
        f"`평균` **{outcome.expected_tries:.1f}번**{_cost_suffix(outcome.expected_cost)}\n"
        f"-# 절반은 {outcome.median_tries}번 안에, 열에 아홉은 {outcome.unlucky_tries}번 안에 끝나요"
    )


def _worst(outcome: refine.RefineOutcome) -> str:
    if not outcome.has_ceiling:
        return (
            "`최악` **천장 없음**\n"
            "-# 실패해도 성공률과 장인의 기운이 오르지 않아서, 운이 나쁘면 끝없이 들어가요"
        )

    # 천장에 닿은 이유가 두 가지다 - 기운이 꽉 찼거나(장기백), 성공률 자체가 100%가
    # 됐거나. 둘을 뭉쳐서 "장기백"이라고 쓰면 확률이 높은 재련에서 틀린 말이 된다.
    why = (
        "장인의 기운이 꽉 차서 확정 성공하는 지점, 흔히 장기백이라고 부르는 그 지점이에요"
        if outcome.attempts[-1].guaranteed
        else "여기서 성공률이 100%에 닿아요"
    )
    return f"`최악` **{outcome.max_tries}번**{_cost_suffix(outcome.max_cost)}\n-# {why}"


def _notes(outcome: refine.RefineOutcome) -> list[str]:
    notes = []

    # max_tries 가 1이면 실패 자체가 일어날 수 없어서 상승폭을 적을 이유가 없다.
    if outcome.fail_gain > 0 and outcome.max_tries > 1:
        gain = f"**{outcome.fail_gain * 100:.2f}%p**"
        capped = outcome.attempts[1].success_rate <= outcome.attempts[0].success_rate
        if capped:
            # 기운이 이미 많이 쌓인 상태로 물어보면 성공률은 상한에 걸려 멈춰 있다.
            # 그때도 "실패마다 오른다"고 쓰면 위에 적힌 숫자와 안 맞는다.
            notes.append(f"성공률은 이미 상한까지 올라 더 안 오르고, 장인의 기운만 실패마다 {gain} 쌓여요")
        else:
            notes.append(
                f"실패 1회당 성공률과 장인의 기운이 각각 {gain} 올라요 · "
                f"성공률은 실패 {refine.FAIL_STACK_CAP}번까지만 오르고 기운은 끝까지 차요"
            )

    if outcome.cost_per_try is None:
        notes.append("시도 1회에 드는 골드를 `비용`으로 넣으면 골드까지 계산해요")
    return notes


def build_result_view(outcome: refine.RefineOutcome, base_rate: float, artisan: float) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()

    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay(_header(outcome, base_rate, artisan)),
    ))

    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("### 성공까지"),
        discord.ui.Separator(),
    ]
    if outcome.max_tries == 1:
        body.append(discord.ui.TextDisplay(_certain(outcome)))
    else:
        body += [
            discord.ui.TextDisplay(_average(outcome)),
            discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
            discord.ui.TextDisplay(_worst(outcome)),
        ]
    view.add_item(discord.ui.Container(*body))

    if notes := _notes(outcome):
        view.add_item(discord.ui.Container(
            discord.ui.TextDisplay("\n".join(f"-# {n}" for n in notes)),
        ))

    return view

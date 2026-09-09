"""재련 기대 비용 화면 (Components V2).

Container 구조:
    Container 1: 무엇을 계산했는지 (부위·단계·확률)
    Container 2: 성공까지 (평균 / 장기백)
    Container 3: 숨결을 쓸지 말지
    Container 4: 재료 (1회 / 평균)
    Container 5: 단계·등급·부위를 바꾸는 조작부

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import discord

from run.services import refine
from run.views import common


def _gold(value: float) -> str:
    return f"**{value:,.0f}** 골드"


def _qty(value: float) -> str:
    """재료 개수는 백만 단위까지 가서 그대로 쓰면 자릿수만 세게 된다."""
    if value >= 10000:
        return f"{value / 10000:,.1f}만"
    return f"{value:,.0f}"


def _pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def _breath_text(breaths: dict[str, int]) -> str:
    if not breaths:
        return "숨결 없이"
    return " · ".join(f"{refine.display_name(n)} {a}개" for n, a in breaths.items())


def _header(report: refine.Report) -> str:
    table, request = report.table, report.request
    # 헤더에 적는 확률은 숨결을 안 썼을 때다. 추천이 숨결을 쓰는 쪽이면 그렇게 올라간
    # 확률은 숨결 칸에서 따로 보여준다 - 여기 섞으면 재련 창 숫자와 안 맞는다.
    meta = [refine.GRADE_LABELS[table.grade], f"성공 확률 **{_pct(report.no_breath.try_prob)}**"]
    if request.jangin > 0:
        meta.append(f"장인의 기운 **{_pct(request.jangin)}**")
    lines = [f"# {table.label}", " · ".join(meta)]

    extra = []
    if table.additional_prob > 0:
        extra.append(f"기본 {_pct(table.base_prob)} + 추가 {_pct(table.additional_prob)}")
    if request.prob_from_failure > 0:
        extra.append(f"실패 누적 {_pct(request.prob_from_failure)}")
    if extra:
        lines.append("-# " + " · ".join(extra))
    return "\n".join(lines)


def _success(report: refine.Report) -> list[discord.ui.Item]:
    best = report.recommended
    body = [discord.ui.TextDisplay("### 성공까지"), discord.ui.Separator()]

    if best.ceiling_tries == 1:
        body.append(discord.ui.TextDisplay(
            f"`확정` **1번** · {_gold(best.expected_cost)}\n"
            "-# 확률이 100%라 실패할 일이 없어"
        ))
        return body

    body += [
        discord.ui.TextDisplay(
            f"`평균` **{best.expected_tries:.1f}번** · {_gold(best.expected_cost)}\n"
            f"-# 절반은 {best.median_tries}번 안에, 열에 아홉은 {best.unlucky_tries}번 안에 끝나"
        ),
        discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
        discord.ui.TextDisplay(
            f"`장기백` **{best.ceiling_tries}번** · {_gold(best.ceiling_cost)}\n"
            f"-# {best.ceiling_tries}번째엔 장인의 기운이 꽉 차서 확정 성공해"
        ),
    ]
    return body


def _breath_section(report: refine.Report) -> list[discord.ui.Item] | None:
    """숨결을 쓰는 쪽과 안 쓰는 쪽 중 뭐가 싼지."""
    # 숨결을 못 쓰는 단계이거나, 안 써도 확정 성공이면 비교할 게 없다.
    if not report.table.breath or report.no_breath.try_prob >= 1.0:
        return None

    best = report.recommended
    lines = [
        f"`추천` {_breath_text(best.breaths)} → **{_pct(best.try_prob)}** · "
        f"{_gold(best.expected_cost)}"
    ]

    # 추천이 노숨이면 비교 대상은 숨결을 가장 많이 쓰는 쪽이다.
    other = report.full_breath if report.best == 0 else report.no_breath
    if other is not best:
        gap = other.expected_cost / best.expected_cost - 1
        label = "풀숨" if report.best == 0 else "노숨"
        lines.append(
            f"`{label}` {_breath_text(other.breaths)} → **{_pct(other.try_prob)}** · "
            f"{_gold(other.expected_cost)}\n"
            f"-# 추천보다 {gap * 100:.0f}% 더 들어"
        )

    cap = max(report.table.base_prob, 0.01)
    lines.append(f"-# 숨결로 올릴 수 있는 확률은 기본 확률만큼({_pct(cap)}p)까지야")
    return [
        discord.ui.TextDisplay("### 숨결"),
        discord.ui.Separator(),
        discord.ui.TextDisplay("\n".join(lines)),
    ]


def _materials(report: refine.Report) -> list[discord.ui.Item]:
    table, best = report.table, report.recommended
    # 슈퍼 익스프레스 구간처럼 골드가 0으로 깎인 재료는 적어봐야 눈만 어지럽다.
    amounts = {n: a for n, a in table.amount.items() if a > 0}
    once = " · ".join(f"{refine.display_name(n)} {a:,}" for n, a in amounts.items())

    notes = [
        f"1회 {_gold(best.try_cost)} (재료 {report.material_cost:,.0f} + 숨결 "
        f"{best.try_cost - report.material_cost:,.0f})"
        if best.breaths
        else f"1회 {_gold(best.try_cost)}"
    ]
    if report.missing:
        missing = ", ".join(refine.display_name(n) for n in report.missing)
        notes.append(f"{missing} 시세를 못 구해서 0골드로 뒀어 - 실제로는 더 들어")
    notes.append("거래소 최저가 기준")

    body = [
        discord.ui.TextDisplay("### 재료"),
        discord.ui.Separator(),
        discord.ui.TextDisplay(f"`1회` {once}"),
    ]

    # 평균 소모 = 1회 재료 x 평균 시도 횟수. 숨결도 매 시도 들어가니 같이 센다.
    # 한 번에 끝나는 단계면 1회와 같은 줄이 되니 뺀다.
    if best.expected_tries >= 1.05:
        average = {n: a * best.expected_tries for n, a in amounts.items()}
        for name, amount in best.breaths.items():
            average[name] = average.get(name, 0.0) + amount * best.expected_tries
        body += [
            discord.ui.Separator(spacing=discord.SeparatorSpacing.small),
            discord.ui.TextDisplay("`평균` " + " · ".join(
                f"{refine.display_name(n)} {_qty(v)}" for n, v in average.items()
            )),
        ]

    body.append(discord.ui.TextDisplay("\n".join(f"-# {n}" for n in notes)))
    return body


async def _rebuild(interaction: discord.Interaction, request: refine.Request) -> None:
    await interaction.response.defer()
    try:
        report = await refine.report(request)
    except ValueError as exc:
        await interaction.followup.send(
            view=common.error_view("계산할 수 없어", str(exc)), ephemeral=True
        )
        return
    await interaction.edit_original_response(view=RefineView(report))


class _TargetSelect(discord.ui.Select):
    def __init__(self, request: refine.Request) -> None:
        self.request = request
        available = refine.levels(request.item_type, request.grade)
        super().__init__(
            placeholder="목표 단계",
            options=[
                discord.SelectOption(
                    label=f"+{level - 1} → +{level}",
                    value=str(level),
                    default=level == request.target,
                )
                for level in available
            ],
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        await _rebuild(interaction, self.request.with_target(int(self.values[0])))


class _GradeSelect(discord.ui.Select):
    def __init__(self, request: refine.Request) -> None:
        self.request = request
        super().__init__(
            placeholder="장비 등급",
            options=[
                discord.SelectOption(
                    label=refine.GRADE_LABELS[grade],
                    value=grade,
                    default=grade == request.grade,
                )
                for grade in refine.grades(request.item_type)
            ],
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        await _rebuild(interaction, self.request.with_grade(self.values[0]))


class _TypeButton(discord.ui.Button):
    def __init__(self, request: refine.Request, item_type: str) -> None:
        self.request = request
        self.item_type = item_type
        current = request.item_type == item_type
        super().__init__(
            label=refine.ITEM_TYPE_LABELS[item_type],
            style=discord.ButtonStyle.primary if current else discord.ButtonStyle.secondary,
            disabled=current,
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        await _rebuild(interaction, self.request.with_item_type(self.item_type))


class RefineView(discord.ui.LayoutView):
    def __init__(self, report: refine.Report) -> None:
        super().__init__(timeout=600)
        request = report.request

        self.add_item(discord.ui.Container(discord.ui.TextDisplay(_header(report))))
        self.add_item(discord.ui.Container(*_success(report)))
        if breath := _breath_section(report):
            self.add_item(discord.ui.Container(*breath))
        self.add_item(discord.ui.Container(*_materials(report)))
        self.add_item(discord.ui.Container(
            discord.ui.ActionRow(_TargetSelect(request)),
            discord.ui.ActionRow(_GradeSelect(request)),
            discord.ui.ActionRow(*(
                _TypeButton(request, item_type) for item_type in refine.ITEM_TYPE_LABELS
            )),
        ))

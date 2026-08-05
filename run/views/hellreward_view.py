import discord

from run.services import hellreward
from run.views import common


def _format_category_line(rank: int | None, cv: hellreward.CategoryValue, tier: str) -> str:
    parts = ", ".join(f"{hellreward.display_name(it.name)} {it.qty:,}개" for it in cv.items)
    prefix = f"`{rank}` " if rank else ""
    if cv.total_gold is None:
        return f"{prefix}**{cv.category}** — {parts}\n-# 시세 조회 불가 (귀속/확률형 포함)"

    note = parts
    label = None
    if cv.category == "특수 재련":
        label = hellreward.special_refine_label(tier)
    elif cv.category == "팔찌" and cv.items:
        label = hellreward.bracelet_label(cv.items[0].name)
    if label:
        note = f"{parts} · {label}"
    return f"{prefix}**{cv.category}** — {cv.total_gold:,.0f} 골드\n-# {note}"


class _CategorySelect(discord.ui.Select):
    def __init__(self, tier: str, floor: int, categories: list[str]) -> None:
        self.tier = tier
        self.floor = floor
        super().__init__(
            placeholder="뜬 보상 상자를 전부 골라주세요 (2개 이상)",
            options=[discord.SelectOption(label=c, value=c) for c in categories],
            min_values=2,
            max_values=len(categories),
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        results = [
            await hellreward.evaluate(self.tier, self.floor, cat) for cat in self.values
        ]
        await interaction.edit_original_response(
            view=build_result_view(self.tier, self.floor, results)
        )


class HellRewardPickView(discord.ui.LayoutView):
    def __init__(self, tier: str, floor: int, categories: list[str]) -> None:
        super().__init__(timeout=180)
        stage = hellreward.stage_label(hellreward.floor_to_stage(floor))
        text = discord.ui.TextDisplay(
            f"## 지옥 보상 효율\n"
            f"{tier} · {floor}층 ({stage})\n"
            f"뜬 보상 상자를 아래에서 전부 골라주세요."
        )
        self.add_item(discord.ui.Container(
            text,
            discord.ui.ActionRow(_CategorySelect(tier, floor, categories)),
            accent_colour=common.BRAND,
        ))


def build_result_view(tier: str, floor: int, results: list[hellreward.CategoryValue]) -> discord.ui.LayoutView:
    stage = hellreward.stage_label(hellreward.floor_to_stage(floor))
    priced = sorted((r for r in results if r.total_gold is not None), key=lambda r: -r.total_gold)
    unpriced = [r for r in results if r.total_gold is None]

    lines = [f"## 지옥 보상 효율\n{tier} · {floor}층 ({stage})"]
    if priced:
        best = priced[0]
        lines.append(f"**{best.category}**이(가) 제일 이득이에요.")
    for i, cv in enumerate(priced, start=1):
        lines.append(_format_category_line(i, cv, tier))
    for cv in unpriced:
        lines.append(_format_category_line(None, cv, tier))

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay("\n\n".join(lines)),
        accent_colour=common.BRAND,
    ))
    return view

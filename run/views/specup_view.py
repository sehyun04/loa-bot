import discord

from run.services import specup
from run.views import common

# 디스코드 메시지 길이 제한도 있고, 열 몇 줄을 늘어놓으면 뭘 먼저 할지가 오히려
# 안 보인다. 위에서부터 몇 개만 보여준다.
TOP_N = 8


def _line(rank: int, item: specup.SpecUpItem) -> str:
    gold = f" · **{item.gold:,.0f} 골드**" if item.gold is not None else ""
    note = f"\n-# {item.gold_note}" if item.gold_note else ""
    return (
        f"`{rank}` [{item.category}] {item.label} → {item.target}{gold}\n"
        f"-# {item.reason}{note}"
    )


def build_report_view(report: specup.SpecUpReport) -> discord.ui.LayoutView:
    char = report.character
    head = [f"## {char.name} 스펙업"]
    meta = " · ".join(p for p in (
        char.class_name,
        f"{char.item_level:,.2f}" if char.item_level else None,
        f"전투력 {char.combat_power}" if char.combat_power else None,
    ) if p)
    if meta:
        head.append(meta)

    lines = ["\n".join(head)]

    if not report.items:
        lines.append(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        )
    else:
        lines.append(
            "같은 종류끼리 비교해서 **많이 뒤처진 순서**로 세웠어요.\n"
            "-# 비용 대비 효율이 아니라 균형 기준이에요. "
            "재련 확률표가 공개돼 있지 않아서 재련 비용은 아직 못 붙여요."
        )
        lines.extend(_line(i, it) for i, it in enumerate(report.items[:TOP_N], start=1))
        if len(report.items) > TOP_N:
            lines.append(f"-# 이 밖에 {len(report.items) - TOP_N}개가 더 있어요.")

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay("\n\n".join(lines)),
        accent_colour=common.BRAND,
    ))
    return view

import discord

from run.services import specup
from run.views import common

# 앞의 몇 개가 "지금 손댈 것"이고 나머지는 "그다음"이다. 한 덩어리로 쭉 늘어놓으면
# 어디까지가 급한 건지 안 보여서 이 지점에서 한 번 끊는다.
PRIMARY_N = 3


def _item_lines(rank: int, item: specup.SpecUpItem) -> str:
    """한 항목 = 굵은 제목 한 줄 + 작은 설명 줄들."""
    head = f"`{rank}` **{item.label}** → {item.target}"
    if item.gold is not None:
        head += f"  ·  **{item.gold:,.0f}** 골드"

    notes = [f"{item.category} · {item.reason}"]
    if item.gold_note:
        notes.append(item.gold_note)
    return head + "\n" + "\n".join(f"-# {n}" for n in notes)


def _header_section(char) -> discord.ui.Section | discord.ui.TextDisplay:
    meta = " · ".join(p for p in (
        char.class_name,
        f"Lv.{char.item_level:,.2f}" if char.item_level else None,
        f"전투력 {char.combat_power}" if char.combat_power else None,
    ) if p)
    text = discord.ui.TextDisplay(f"## {char.name} 스펙업\n{meta}" if meta else f"## {char.name} 스펙업")

    # 캐릭터 이미지가 있으면 오른쪽에 붙인다. 없으면 Section 자체가 성립하지 않으니
    # 그냥 텍스트만 둔다.
    if not char.image_url:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(char.image_url))


def _gold_summary(items: tuple[specup.SpecUpItem, ...]) -> str | None:
    priced = [i for i in items if i.gold is not None]
    if len(priced) < 2:
        return None
    total = sum(i.gold for i in priced)
    return f"값이 매겨진 {len(priced)}개를 전부 올리면 **{total:,.0f} 골드**예요."


def build_report_view(report: specup.SpecUpReport) -> discord.ui.LayoutView:
    char = report.character
    container = discord.ui.Container(accent_colour=common.BRAND)
    container.add_item(_header_section(char))
    container.add_item(discord.ui.Separator())

    if not report.items:
        container.add_item(discord.ui.TextDisplay(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        ))
        view = discord.ui.LayoutView()
        view.add_item(container)
        return view

    container.add_item(discord.ui.TextDisplay(
        "같은 종류끼리 비교해서 **많이 뒤처진 순서**로 세웠어요.\n"
        "-# 비용 대비 효율이 아니라 균형 기준이에요. "
        "재련 확률표가 공개돼 있지 않아서 재련 비용은 아직 못 붙여요."
    ))

    primary = report.items[:PRIMARY_N]
    rest = report.items[PRIMARY_N:]

    container.add_item(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
    container.add_item(discord.ui.TextDisplay("### 먼저 손댈 것"))
    for rank, item in enumerate(primary, start=1):
        container.add_item(discord.ui.TextDisplay(_item_lines(rank, item)))

    if rest:
        container.add_item(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        container.add_item(discord.ui.TextDisplay("### 그다음"))
        for rank, item in enumerate(rest, start=PRIMARY_N + 1):
            container.add_item(discord.ui.TextDisplay(_item_lines(rank, item)))

    if summary := _gold_summary(report.items):
        container.add_item(discord.ui.Separator())
        container.add_item(discord.ui.TextDisplay(f"-# {summary}"))

    view = discord.ui.LayoutView()
    view.add_item(container)
    return view

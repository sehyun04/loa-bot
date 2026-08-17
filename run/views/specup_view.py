"""스펙업 우선순위 화면 (Components V2).

Container 구조:
    Container 1: 캐릭터 머리말 (Section + Thumbnail)
    Container 2: 먼저 손댈 것 - 상위 몇 개만 근거까지 붙여서
    Container 3: 그다음 - 한 항목당 한 줄로 압축
    Container 4: 합계와 단서

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려져서 V2 로
옮긴 티가 안 난다 - debi-marlene 의 stats_view 도 같은 이유로 색을 뺀다.
"""

import discord

from run.services import specup

# 앞의 몇 개가 "지금 손댈 것"이고 나머지는 "그다음"이다. 한 덩어리로 쭉 늘어놓으면
# 어디까지가 급한 건지 안 보여서 이 지점에서 한 번 끊는다.
PRIMARY_N = 3


def _gold(value: float) -> str:
    return f"  ·  **{value:,.0f}** 골드"


def _primary_block(rank: int, item: specup.SpecUpItem) -> discord.ui.TextDisplay:
    head = f"`{rank}` **{item.label}** → {item.target}"
    if item.gold is not None:
        head += _gold(item.gold)

    # 근거와 시세를 한 줄에 잇는다. 항목마다 -# 을 두 줄씩 달면 실제 할 일보다
    # 설명이 더 길어져서 목록이 안 읽힌다.
    note = " · ".join(p for p in (item.category, item.reason, item.gold_note) if p)
    return discord.ui.TextDisplay(f"{head}\n-# {note}")


def _compact_line(item: specup.SpecUpItem) -> str:
    """뒤쪽 항목은 한 줄로 줄인다. 지금 당장 할 일이 아니라서 근거까지 필요하지 않다."""
    line = f"`{item.category}` **{item.label}** → {item.target}"
    return line + (_gold(item.gold) if item.gold is not None else "")


def _spaced(items: list[specup.SpecUpItem], start: int) -> list[discord.ui.Item]:
    """항목 사이에 얇은 구분선을 끼운다. 붙여 놓으면 어디서 한 항목이 끝나는지 안 보인다."""
    out: list[discord.ui.Item] = []
    for offset, item in enumerate(items):
        if out:
            out.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.small))
        out.append(_primary_block(start + offset, item))
    return out


def _header(char) -> discord.ui.Section | discord.ui.TextDisplay:
    meta = " · ".join(p for p in (
        char.class_name,
        f"Lv.{char.item_level:,.2f}" if char.item_level else None,
        f"전투력 **{char.combat_power}**" if char.combat_power else None,
    ) if p)
    text = discord.ui.TextDisplay(f"# {char.name}\n{meta}")

    # Section 은 accessory 가 필수다 - 이미지가 없으면 Section 없이 텍스트만 넣는다.
    if not char.image_url:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=char.image_url))


def _footer(items: tuple[specup.SpecUpItem, ...]) -> str:
    lines = []
    priced = [i for i in items if i.gold is not None]
    if len(priced) >= 2:
        lines.append(f"값이 매겨진 {len(priced)}개를 전부 올리면 **{sum(i.gold for i in priced):,.0f} 골드**예요")
    # 기준 설명은 맨 아래로 내린다. 머리말에 두면 실제 목록보다 면책 문구가 먼저,
    # 그리고 더 크게 보인다.
    lines.append(
        "같은 종류끼리 비교해서 많이 뒤처진 순서예요 · 비용 대비 효율이 아니라 균형 기준이고, "
        "재련은 확률표가 없고 보석은 경매장이라 그쪽 시세는 아직 못 붙여요"
    )
    return "\n".join(f"-# {line}" for line in lines)


def build_report_view(report: specup.SpecUpReport) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(_header(report.character)))

    if not report.items:
        view.add_item(discord.ui.Container(discord.ui.TextDisplay(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        )))
        return view

    primary = list(report.items[:PRIMARY_N])
    view.add_item(discord.ui.Container(
        discord.ui.TextDisplay("### 먼저 손댈 것"),
        discord.ui.Separator(),
        *_spaced(primary, start=1),
    ))

    if rest := list(report.items[PRIMARY_N:]):
        # 압축한 줄들은 한 TextDisplay 에 몰아넣는다. 한 줄짜리 사이에 구분선을 끼우면
        # 목록이 다시 늘어지고, 컴포넌트 40개 상한도 항목 수만큼 빨리 찬다.
        view.add_item(discord.ui.Container(
            discord.ui.TextDisplay("### 그다음"),
            discord.ui.Separator(),
            discord.ui.TextDisplay("\n".join(_compact_line(i) for i in rest)),
        ))

    view.add_item(discord.ui.Container(discord.ui.TextDisplay(_footer(report.items))))
    return view

"""스펙업 우선순위 화면 (Components V2).

Container 구조:
    Container 1: 캐릭터 머리말 (Section + Thumbnail) + 기준 안내
    Container 2: 우선순위 목록 (먼저 손댈 것 / 그다음 / 합계)

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려져서 V2 로
옮긴 티가 안 난다 - debi-marlene 의 stats_view 도 같은 이유로 색을 뺀다.
"""

import discord

from run.services import specup

# 앞의 몇 개가 "지금 손댈 것"이고 나머지는 "그다음"이다. 한 덩어리로 쭉 늘어놓으면
# 어디까지가 급한 건지 안 보여서 이 지점에서 한 번 끊는다.
PRIMARY_N = 3


def _item_block(rank: int, item: specup.SpecUpItem) -> discord.ui.TextDisplay:
    head = f"`{rank}` **{item.label}** → {item.target}"
    if item.gold is not None:
        head += f"  ·  **{item.gold:,.0f}** 골드"

    notes = [f"{item.category} · {item.reason}"]
    if item.gold_note:
        notes.append(item.gold_note)
    return discord.ui.TextDisplay(head + "\n" + "\n".join(f"-# {n}" for n in notes))


def _spaced(items: list[specup.SpecUpItem], start: int) -> list[discord.ui.Item]:
    """항목 사이에 얇은 구분선을 끼운다. 붙여 놓으면 어디서 한 항목이 끝나는지 안 보인다."""
    out: list[discord.ui.Item] = []
    for offset, item in enumerate(items):
        if out:
            out.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.small))
        out.append(_item_block(start + offset, item))
    return out


def _header(char) -> discord.ui.Section | discord.ui.TextDisplay:
    meta = " · ".join(p for p in (
        char.class_name,
        f"Lv.{char.item_level:,.2f}" if char.item_level else None,
        f"전투력 **{char.combat_power}**" if char.combat_power else None,
    ) if p)
    text = discord.ui.TextDisplay(f"# {char.name}\n## 스펙업 우선순위\n{meta}")

    # Section 은 accessory 가 필수다 - 이미지가 없으면 Section 없이 텍스트만 넣는다.
    if not char.image_url:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=char.image_url))


def _gold_summary(items: tuple[specup.SpecUpItem, ...]) -> str | None:
    priced = [i for i in items if i.gold is not None]
    if len(priced) < 2:
        return None
    return f"-# 값이 매겨진 {len(priced)}개를 전부 올리면 **{sum(i.gold for i in priced):,.0f} 골드**예요."


def build_report_view(report: specup.SpecUpReport) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()

    # === Container 1: 머리말 ===
    head: list[discord.ui.Item] = [_header(report.character)]
    if report.items:
        head.append(discord.ui.TextDisplay(
            "-# 같은 종류끼리 비교해서 **많이 뒤처진 순서**예요. 비용 대비 효율이 아니라 "
            "균형 기준이고, 재련 확률표가 공개돼 있지 않아 재련 비용은 아직 못 붙여요."
        ))
    view.add_item(discord.ui.Container(*head))

    if not report.items:
        view.add_item(discord.ui.Container(discord.ui.TextDisplay(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        )))
        return view

    # === Container 2: 우선순위 목록 ===
    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("### 먼저 손댈 것"),
        discord.ui.Separator(),
        *_spaced(list(report.items[:PRIMARY_N]), start=1),
    ]

    if rest := list(report.items[PRIMARY_N:]):
        body += [
            discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
            discord.ui.TextDisplay("### 그다음"),
            discord.ui.Separator(),
            *_spaced(rest, start=PRIMARY_N + 1),
        ]

    if summary := _gold_summary(report.items):
        body += [discord.ui.Separator(), discord.ui.TextDisplay(summary)]

    view.add_item(discord.ui.Container(*body))
    return view

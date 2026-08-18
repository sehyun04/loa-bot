"""스펙업 우선순위 화면 (Components V2).

Container 구조:
    Container 1: 캐릭터 머리말 (Section + Thumbnail)
    Container 2: 목록 전부 - 먼저 손댈 것 / 그다음 / 합계와 단서

구역마다 컨테이너를 쪼개면 카드가 넷으로 흩어진다. 한 줄짜리 구역이 카드 하나를
통째로 차지하고 카드 사이 여백만 늘어나서, 정보량에 비해 화면이 성기게 보인다.
구역은 카드가 아니라 large 구분선으로 나눈다.

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
        # 합계는 잔글씨로 내리지 않는다. 이 화면에서 곧바로 쓸 수 있는 유일한 숫자다.
        lines.append(f"{len(priced)}개 전부 올리면 **{sum(i.gold for i in priced):,.0f} 골드**")
    # 기준 설명은 맨 아래에 한 줄로만 둔다. 머리말에 길게 두면 정작 목록보다 면책
    # 문구가 먼저, 그리고 더 크게 보인다.
    lines.append(
        "-# 같은 종류끼리 비교한 균형 기준이에요 · 재련 골드는 거래소 최저가 기준 평균값이고 "
        "보석은 경매장이라 아직 못 붙여요"
    )
    return "\n".join(lines)


def build_report_view(report: specup.SpecUpReport) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(_header(report.character)))

    if not report.items:
        view.add_item(discord.ui.Container(discord.ui.TextDisplay(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        )))
        return view

    # 뒤에 한 항목만 남는다면 구역을 나누지 않는다. 제목 한 줄과 구분선이 정작
    # 항목보다 자리를 더 먹는다.
    split = PRIMARY_N if len(report.items) > PRIMARY_N + 1 else len(report.items)

    body: list[discord.ui.Item] = [
        discord.ui.TextDisplay("### 먼저 손댈 것"),
        discord.ui.Separator(),
        *_spaced(list(report.items[:split]), start=1),
    ]

    if rest := list(report.items[split:]):
        # 압축한 줄들은 한 TextDisplay 에 몰아넣는다. 한 줄짜리 사이에 구분선을 끼우면
        # 목록이 다시 늘어지고, 컴포넌트 40개 상한도 항목 수만큼 빨리 찬다.
        body += [
            discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
            discord.ui.TextDisplay("### 그다음"),
            discord.ui.Separator(),
            discord.ui.TextDisplay("\n".join(_compact_line(i) for i in rest)),
        ]

    body += [
        discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
        discord.ui.TextDisplay(_footer(report.items)),
    ]
    view.add_item(discord.ui.Container(*body))
    return view

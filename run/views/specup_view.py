import discord

from run.services import specup

# 앞의 몇 개가 "지금 손댈 것"이고 나머지는 "그다음"이다. 한 덩어리로 쭉 늘어놓으면
# 어디까지가 급한 건지 안 보여서 이 지점에서 한 번 끊는다.
PRIMARY_N = 3


def _item_block(rank: int, item: specup.SpecUpItem) -> str:
    head = f"`{rank}` **{item.label}** → {item.target}"
    if item.gold is not None:
        head += f"  ·  **{item.gold:,.0f}** 골드"

    notes = [f"{item.category} · {item.reason}"]
    if item.gold_note:
        notes.append(item.gold_note)
    return head + "\n" + "\n".join(f"-# {n}" for n in notes)


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

    # 머리말과 목록을 Container 두 개로 나눈다. 한 상자에 다 넣으면 어디까지가 설명이고
    # 어디부터가 목록인지 눈으로 안 갈린다. accent_colour 는 주지 않는다 - 색 줄을 넣는
    # 순간 기존 임베드와 똑같이 보여서 V2 로 짠 의미가 없다.
    head = discord.ui.Container(_header(report.character))
    if report.items:
        head.add_item(discord.ui.TextDisplay(
            "-# 같은 종류끼리 비교해서 **많이 뒤처진 순서**예요. 비용 대비 효율이 아니라 "
            "균형 기준이고, 재련 확률표가 공개돼 있지 않아 재련 비용은 아직 못 붙여요."
        ))
    view.add_item(head)

    if not report.items:
        view.add_item(discord.ui.Container(discord.ui.TextDisplay(
            "**딱히 뒤처진 곳이 없어요.**\n"
            "-# 재련·보석·각인이 모두 고르게 맞아 있어요."
        )))
        return view

    body = discord.ui.Container()
    body.add_item(discord.ui.TextDisplay("### 먼저 손댈 것"))
    body.add_item(discord.ui.Separator())
    for rank, item in enumerate(report.items[:PRIMARY_N], start=1):
        body.add_item(discord.ui.TextDisplay(_item_block(rank, item)))

    if rest := report.items[PRIMARY_N:]:
        body.add_item(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        body.add_item(discord.ui.TextDisplay("### 그다음"))
        body.add_item(discord.ui.Separator())
        for rank, item in enumerate(rest, start=PRIMARY_N + 1):
            body.add_item(discord.ui.TextDisplay(_item_block(rank, item)))

    if summary := _gold_summary(report.items):
        body.add_item(discord.ui.Separator())
        body.add_item(discord.ui.TextDisplay(summary))

    view.add_item(body)
    return view

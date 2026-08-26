"""캐릭터 조회 화면.

`/원정대` 는 Components V2, `/스펙` 은 임베드 그대로다. 원정대는 서버가 여러 곳이면
임베드 필드가 세로로 끝없이 쌓이고 캐릭터도 잘라내야 했지만, `/스펙` 은 한 캐릭터라
그 문제가 없다.
"""

import discord

from run.services.lostark.armory import Character, Sibling
from run.views import common

# 한 메시지 4000자 상한. 한 줄이 대략 30자라 이 정도면 헤더까지 넣고도 남는다.
MAX_ROWS = 50

# 한 메시지 컴포넌트 40개 상한. 한 줄이 TextDisplay 하나씩을 먹으므로 이쪽이 먼저
# 찬다. 40 을 꽉 채우지 않는 건 맨 아래 잔글씨 두 줄 몫을 남기기 위해서다.
MAX_COMPONENTS = 38


def _fmt_level(value: float | None) -> str:
    return f"{value:,.2f}" if value is not None else "-"


def character_embed(char: Character) -> discord.Embed:
    header = " · ".join(x for x in (char.server, char.class_name) if x)
    embed = common.base_embed(char.name, header or None)

    embed.add_field(name="아이템 레벨", value=_fmt_level(char.item_level), inline=True)
    embed.add_field(name="전투력", value=char.combat_power or "-", inline=True)
    embed.add_field(name="원정대", value=f"Lv.{char.expedition_level}" if char.expedition_level else "-", inline=True)

    if char.engravings:
        embed.add_field(name="각인", value="\n".join(char.engravings[:8]), inline=False)
    if char.ark_passive:
        embed.add_field(
            name="아크패시브",
            value=" · ".join(f"{name} {value}" for name, value in char.ark_passive),
            inline=False,
        )
    if char.gems:
        embed.add_field(name="보석", value=" · ".join(char.gems), inline=True)
    if char.ability_stone:
        embed.add_field(name="어빌리티 스톤", value="\n".join(char.ability_stone), inline=False)
    if char.card_sets:
        embed.add_field(name="카드", value=" · ".join(char.card_sets[:3]), inline=True)

    if char.guild:
        embed.set_footer(text=f"길드 {char.guild}")
    if char.image_url:
        embed.set_thumbnail(url=char.image_url)
    return embed


def _row(sibling: Sibling) -> str:
    """레벨을 코드 스팬에 넣어 자리를 맞추던 걸 걷어냈다.

    고정폭이라 숫자는 맞았지만 줄마다 회색 상자가 하나씩 생겨서, 목록 전체가 이름이
    아니라 상자 기둥으로 먼저 읽혔다. fetch_siblings 가 내림차순으로 주는 덕에 굵은
    글씨만으로도 어디가 위인지 보인다.
    """
    return f"**{_fmt_level(sibling.item_level)}**  {sibling.name}  ·  {sibling.class_name}"


def _by_server(siblings: list[Sibling]) -> list[tuple[str, list[Sibling]]]:
    """캐릭터가 많은 서버부터. 보통 본캐가 있는 서버라 맨 위에 와야 한다.

    fetch_siblings 가 이미 아이템 레벨 내림차순으로 주므로 서버 안 순서는 건드리지 않는다.
    """
    grouped: dict[str, list[Sibling]] = {}
    for s in siblings:
        grouped.setdefault(s.server, []).append(s)
    return sorted(grouped.items(), key=lambda kv: -len(kv[1]))


def siblings_view(owner: str, siblings: list[Sibling]) -> discord.ui.LayoutView:
    if not siblings:
        return common.notice_view("원정대가 비어 있어요", f"{owner} 의 캐릭터를 찾지 못했어요.")

    groups = _by_server(siblings)

    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(discord.ui.TextDisplay(
        f"# {owner} 의 원정대\n캐릭터 **{len(siblings)}** · 서버 **{len(groups)}**곳"
    )))

    body: list[discord.ui.Item] = []
    # 머리말 컨테이너와 텍스트, 본문 컨테이너, 맨 아래 잔글씨의 구분선과 텍스트.
    used = 5
    rows_left = MAX_ROWS
    dropped: list[str] = []
    for server, chars in groups:
        # 서버 제목 + 서버 사이 구분선. 제목만 넣고 캐릭터를 한 명도 못 넣을 바에는
        # 그 서버는 통째로 생략하는 게 낫다.
        cost = 1 + (1 if body else 0)
        if rows_left <= 0 or used + cost + 1 > MAX_COMPONENTS:
            dropped.append(server)
            continue

        if body:
            body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        body.append(discord.ui.TextDisplay(f"### {server}  ·  {len(chars)}캐릭"))
        used += cost

        # 잘릴 때 붙일 "외 N캐릭" 한 줄 몫을 항상 남겨둔다.
        room = min(rows_left, MAX_COMPONENTS - used - 1)
        shown = chars[:room]
        # 한 줄에 TextDisplay 를 하나씩 쓴다. 한 덩어리 텍스트로 붙이면 줄 사이가
        # 너무 빽빽해서 안 읽힌다 - 컴포넌트 사이 기본 여백이 V2 에서 줄 수 있는
        # 가장 작은 간격이다. Separator 를 끼우면 그보다 더 벌어진다.
        body += [discord.ui.TextDisplay(_row(c)) for c in shown]
        used += len(shown)
        rows_left -= len(shown)

        if len(shown) < len(chars):
            body.append(discord.ui.TextDisplay(f"-# 외 {len(chars) - len(shown)}캐릭"))
            used += 1

    notes = []
    if len(groups) > 1:
        notes.append("아이템 레벨 높은 순 · 로아 원정대는 서버 단위라 서버가 곧 원정대 구분이에요")
    if dropped:
        # 서버가 통째로 빠지면 머리말의 서버 수와 화면이 어긋난다. 어디가 빠졌는지 밝힌다.
        notes.append(f"캐릭터가 적은 서버 {len(dropped)}곳({' · '.join(dropped)})은 생략했어요")
    if notes:
        body += [
            discord.ui.Separator(spacing=discord.SeparatorSpacing.large),
            discord.ui.TextDisplay("\n".join(f"-# {n}" for n in notes)),
        ]

    view.add_item(discord.ui.Container(*body))
    return view

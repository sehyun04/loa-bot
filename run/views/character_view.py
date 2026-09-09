"""캐릭터 조회 화면 (Components V2).

Container 구조:
    /스펙    Container 1: 이름·직업·아이템 레벨 (Section + Thumbnail)
             Container 2: 각인 / 아크패시브 / 보석·스톤·카드
    /원정대  Container 1: 머리말   Container 2: 서버별 캐릭터 목록

accent_colour 는 주지 않는다. 색 줄이 붙으면 기존 임베드와 똑같이 그려진다.
"""

import re

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


# "돌격대장 Lv.4 (유물)" 꼴. 등급이 없을 수도 있어서 통째로 옵셔널이다.
_ENGRAVING = re.compile(r"^(?P<name>.+?)\s+Lv\.(?P<level>\d+)(?:\s+\((?P<grade>[^)]+)\))?$")

# 각인은 6개가 정석이고 아크패시브 개편 뒤로도 그 언저리다. 8줄을 넘기면 각인만으로
# 화면이 다 차서, 넘치는 만큼은 잔글씨 한 줄로 접는다.
MAX_ENGRAVINGS = 8


def _engraving_line(raw: str) -> str:
    """등급을 코드 스팬으로 앞에 세운다. 뒤에 괄호로 달면 이름이 괄호에 밀린다."""
    m = _ENGRAVING.match(raw)
    if not m:
        return f"**{raw}**"
    grade = f"`{m['grade']}` " if m["grade"] else ""
    return f"{grade}**{m['name']}** Lv.{m['level']}"


def _spec_header(char: Character) -> discord.ui.Item:
    # 칭호는 여기 섞지 않는다. 서버·직업과 나란히 두면 셋 다 같은 종류의 값처럼
    # 보여서, 못 보던 칭호가 직업 이름인 줄 안다. 맨 아래 잔글씨로 내린다.
    meta = " · ".join(p for p in (char.server, char.class_name) if p)
    stats = " · ".join(p for p in (
        f"아이템 레벨 **{_fmt_level(char.item_level)}**" if char.item_level is not None else None,
        f"전투력 **{char.combat_power}**" if char.combat_power else None,
        f"원정대 **Lv.{char.expedition_level}**" if char.expedition_level else None,
    ) if p)
    text = discord.ui.TextDisplay("\n".join(p for p in (f"# {char.name}", meta, stats) if p))

    # Section 은 accessory 가 필수다 - 이미지가 없으면 Section 없이 텍스트만 넣는다.
    if not char.image_url:
        return text
    return discord.ui.Section(text, accessory=discord.ui.Thumbnail(media=char.image_url))


def _block(title: str, body: str) -> list[discord.ui.Item]:
    return [
        discord.ui.TextDisplay(f"### {title}"),
        discord.ui.Separator(),
        discord.ui.TextDisplay(body),
    ]


def _extras(char: Character) -> str:
    """보석·스톤·카드는 각각 한 줄이라 구역을 셋으로 나누면 제목이 내용보다 길어진다."""
    rows = [
        (label, value)
        for label, value in (
            ("보석", " · ".join(char.gems)),
            ("스톤", " · ".join(char.ability_stone)),
            ("카드", " · ".join(char.card_sets[:3])),
        )
        if value
    ]
    return "\n".join(f"`{label}` {value}" for label, value in rows)


def spec_view(char: Character) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView()
    view.add_item(discord.ui.Container(_spec_header(char)))

    body: list[discord.ui.Item] = []
    if char.engravings:
        lines = [_engraving_line(e) for e in char.engravings[:MAX_ENGRAVINGS]]
        if len(char.engravings) > MAX_ENGRAVINGS:
            lines.append(f"-# 외 {len(char.engravings) - MAX_ENGRAVINGS}개")
        body += _block("각인", "\n".join(lines))
    if char.ark_passive:
        if body:
            body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        body += _block(
            "아크패시브", " · ".join(f"{name} **{value}**" for name, value in char.ark_passive)
        )
    if extras := _extras(char):
        if body:
            body.append(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        body.append(discord.ui.TextDisplay(extras))
    # 아이템 레벨만 오고 각인도 보석도 비어 있는 캐릭터가 있다. 머리말만 덩그러니
    # 남으면 조회가 반쯤 실패한 것처럼 보여서, 비었다는 걸 말로 밝힌다.
    if not body:
        body.append(discord.ui.TextDisplay("각인이며 보석이며, 세부 정보는 받아오지 못했어요."))

    if tail := " · ".join(p for p in (
        f"칭호 {char.title}" if char.title else None,
        f"길드 {char.guild}" if char.guild else None,
    ) if p):
        body.append(discord.ui.TextDisplay(f"-# {tail}"))
    view.add_item(discord.ui.Container(*body))
    return view


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

from datetime import datetime
from math import ceil

import discord

from run.services.merchant import schedule as sch
from run.services.merchant.kloa import Sighting
from run.utils import timez
from run.views import common

_GROUP_LABEL = {1: "1그룹", 2: "2그룹", 3: "3그룹"}
# kloa.gg 원본 등급 스케일은 0부터 시작하는 5단계다: 일반·고급·희귀·영웅·전설.
# 1부터 시작한다고 잘못 가정하면 전설(4)이 영웅색으로, 나머지도 한 칸씩 밀려 보인다.
_GRADE_DOT = {0: "⚪", 1: "🟢", 2: "🔵", 3: "🟣", 4: "🟡"}
_GRADE_COLOR = {
    0: common.MUTED,
    1: discord.Color(0x1EB854),
    2: discord.Color(0x3B82F6),
    3: discord.Color(0xA855F7),
    4: discord.Color(0xF5C518),
}
_SMALL = discord.SeparatorSpacing.small
_LARGE = discord.SeparatorSpacing.large
_ROW_GAP = "-# ​"  # 작은 글씨 + 보이지 않는 공백 한 글자 = 얇은 구분선 역할


def _groups_text(groups: tuple[int, ...]) -> str:
    return " · ".join(_GROUP_LABEL.get(g, f"{g}그룹") for g in sorted(groups))


def _tagged(item: sch.Item, with_icon: bool) -> str:
    # 희귀도 점(색) + 실제 아이템 아이콘(이모지 크기) + 이름
    # 길이가 넘치면(build_merchant_view의 content_length 체크) with_icon 자체를
    # 꺼서 전부 텍스트로 되돌리므로, 여기서는 타입으로 따로 거르지 않는다.
    dot = _GRADE_DOT.get(item.grade, "⚪")
    icon = item.emoji if with_icon else ""
    return f"{dot} {icon} {item.name}" if icon else f"{dot} {item.name}"


def _grades_of(sighting: Sighting) -> list[int]:
    region = sch.region_by_id(sighting.region_id)
    if region is None:
        return []
    meta = {i.name: i.grade for i in region.items}
    return [meta[n] for n in sighting.items if n in meta]


def _card_first(items: list[sch.Item]) -> list[sch.Item]:
    # 카드가 항상 먼저, 나머지(재료 등)는 그다음. 같은 묶음 안에서는 원래 순서 유지
    return sorted(items, key=lambda i: 0 if i.type == "card" else 1)


def _region_text(region: sch.Region, seen: dict[str, Sighting], with_icon: bool) -> str:
    found = seen.get(region.id)
    header = f"📍 **{region.name}** · {region.npc}"
    if found:
        by_name = {i.name: i for i in region.items}
        items = _card_first([by_name[n] for n in found.items if n in by_name])
        rows = [f"`└` {_tagged(i, with_icon)}" for i in items]
    elif seen:
        # 다른 지역은 제보가 들어왔는데 이 지역만 비었다 — 후보를 섞으면 사실과 헷갈린다
        rows = ["`└` 제보 대기"]
    else:
        cards = [i for i in region.items_of("card") if not i.hidden]
        if not cards:
            rows = ["`└` 카드 없음"]
        else:
            rows = [f"`└` {_tagged(i, with_icon)}" for i in cards[:4]]
            if len(cards) > 4:
                rows.append(f"`└` ⋯ 외 {len(cards) - 4}종")
    # 줄 사이를 살짝 띄운다. 빈 줄(\n\n)은 일반 문단 간격이라 너무 벌어져 보이길래,
    # 대신 작은 글씨(-#) 한 줄을 끼워 넣는다 - 폰트가 작아서 일반 빈 줄보다 좁게 벌어진다.
    return header + "\n\n" + f"\n{_ROW_GAP}\n".join(rows)


def _paginate(regions: list[sch.Region]) -> list[list[sch.Region]]:
    """지역 목록을 2~3페이지로 균등하게 나눈다.

    한 메시지에 다 욱여넣으면(그룹 2개만 겹쳐도 15개 안팎) 스크롤이 너무 길어진다.
    페이지 수를 고정하지 않고 지역 수에 맞춰 정하는 이유는, 그룹이 1개만 떠 있을 때는
    7곳 안팎이라 굳이 나눌 필요가 없기 때문이다.
    """
    n = len(regions)
    if n <= 6:
        return [regions]
    pages = 3 if n > 12 else 2
    size = ceil(n / pages)
    return [regions[i : i + size] for i in range(0, n, size)]


class MerchantPager(discord.ui.LayoutView):
    """지역 목록 컨테이너를 여러 장 넘겨 보는 뷰. 페이지가 1장이면 버튼 없이 그대로."""

    def __init__(self, pages: list[discord.ui.Container]) -> None:
        super().__init__(timeout=600)
        self._pages = pages
        self._index = 0
        self.message: discord.Message | None = None  # on_timeout에서 버튼을 꺼야 해서 필요
        self._render()

    def _render(self) -> None:
        self.clear_items()
        self.add_item(self._pages[self._index])
        if len(self._pages) > 1:
            self.add_item(self._build_nav())

    def _build_nav(self) -> discord.ui.ActionRow:
        row = discord.ui.ActionRow()

        prev = discord.ui.Button(
            label="◀", style=discord.ButtonStyle.secondary, disabled=self._index == 0
        )
        prev.callback = self._make_step(-1)
        row.add_item(prev)

        row.add_item(
            discord.ui.Button(
                label=f"{self._index + 1} / {len(self._pages)}",
                style=discord.ButtonStyle.secondary,
                disabled=True,
            )
        )

        nxt = discord.ui.Button(
            label="▶",
            style=discord.ButtonStyle.secondary,
            disabled=self._index == len(self._pages) - 1,
        )
        nxt.callback = self._make_step(1)
        row.add_item(nxt)
        return row

    def _make_step(self, delta: int):
        async def _callback(interaction: discord.Interaction) -> None:
            self._index = max(0, min(len(self._pages) - 1, self._index + delta))
            self._render()
            await interaction.response.edit_message(view=self)

        return _callback

    async def on_timeout(self) -> None:
        if self.message is None:
            return
        for child in self.walk_children():
            if isinstance(child, discord.ui.Button):
                child.disabled = True
        try:
            await self.message.edit(view=self)
        except discord.HTTPException:
            pass  # 메시지가 지워졌거나 권한이 바뀌었을 수 있다 - 타임아웃 정리는 최선이면 됨


def build_merchant_view(
    now: datetime,
    server: str | None = None,
    sightings: tuple[Sighting, ...] = (),
    reports_block: str | None = None,
) -> discord.ui.LayoutView:
    active = sch.active_window(now)
    upcoming = sch.next_window(now)
    seen = {s.region_id: s for s in sightings}

    if not active:
        # 지금 없을 땐 지역/카드 후보를 잔뜩 늘어놔봐야 어차피 못 사는 정보라 소음이다.
        # 다음 등장 시각만 짧게.
        heading = (
            "## 지금은 떠돌이 상인이 없어요\n"
            f"다음 등장 {timez.to_discord_timestamp(upcoming.start, 'R')} "
            f"({timez.to_discord_timestamp(upcoming.start, 't')}) · {_groups_text(upcoming.groups)}"
        )
        container = discord.ui.Container(discord.ui.TextDisplay(heading), accent_colour=common.MUTED)
        view = discord.ui.LayoutView()
        view.add_item(container)
        return view

    regions = sch.regions_for(active.groups)
    heading = (
        f"## 떠돌이 상인 등장 중 — {_groups_text(active.groups)}\n"
        f"{timez.to_discord_timestamp(active.end, 'R')} 에 사라져요 "
        f"(종료 {timez.to_discord_timestamp(active.end, 't')})"
        f"\n**다음 등장** · {timez.to_discord_timestamp(upcoming.start, 'R')} "
        f"· {_groups_text(upcoming.groups)}"
    )
    accent = common.BRAND

    if seen:
        # 제보 중 가장 높은 등급으로 박스 전체 색을 물들인다 - 뭐가 떴는지 한눈에 보이게
        best_grade = max((g for s in seen.values() for g in _grades_of(s)), default=-1)
        accent = _GRADE_COLOR.get(best_grade, accent)

    title = f"{server} 판매 품목" if seen else "등장 가능 지역"

    if seen:
        footer = "-# 제보 출처: kloa.gg · 파는 물건은 서버마다 달라요"
    elif server:
        footer = f"-# {server}에 아직 제보가 없어요. 아래는 나올 수 있는 카드예요"
    else:
        # 서버를 안 넣으면 어느 서버든 같은 화면이라, 왜 그런지와 어떻게 하는지를 같이 알린다
        footer = "-# 등장 시각·지역은 전 서버 공통이에요. 서버를 넣으면 실제 파는 물건을 봐요"

    sorted_regions = sorted(regions, key=lambda x: (x.group, x.name))
    region_pages = _paginate(sorted_regions)

    def build_page(page_regions: list[sch.Region], with_icon: bool) -> discord.ui.Container:
        c = discord.ui.Container(accent_colour=accent)
        c.add_item(discord.ui.TextDisplay(heading))
        c.add_item(discord.ui.Separator(spacing=_LARGE))
        c.add_item(discord.ui.TextDisplay(f"### {title}"))
        for idx, r in enumerate(page_regions):
            c.add_item(discord.ui.TextDisplay(_region_text(r, seen, with_icon)))
            if idx < len(page_regions) - 1:
                c.add_item(discord.ui.Separator(spacing=_SMALL))
        if reports_block:
            c.add_item(discord.ui.Separator(spacing=_LARGE))
            c.add_item(discord.ui.TextDisplay(f"### {server} 디스코드 제보\n{reports_block}"))
        c.add_item(discord.ui.Separator(spacing=_SMALL))
        c.add_item(discord.ui.TextDisplay(footer))
        return c

    pages = [build_page(p, with_icon=True) for p in region_pages]
    # 디스코드 v2 메시지는 텍스트 총합 4000자 한도가 있다. 페이지를 나눠도 넘치면
    # 제일 무거운 부분(아이콘 태그)부터 빼고 다시 만든다.
    if any(p.content_length() > 3800 for p in pages):
        pages = [build_page(p, with_icon=False) for p in region_pages]

    return MerchantPager(pages)


def reports_text(reports: list) -> str:
    if not reports:
        return "아직 제보가 없어요. `/떠상제보` 로 알려주세요."
    lines = []
    for r in reports[:10]:
        head = f"**{r.region}**" + (f" · {r.npc}" if r.npc else "")
        if r.items:
            head += f"\n  {', '.join(r.items[:5])}"
        lines.append(head)
    return "\n".join(lines)


def upcoming_embed(window: sch.Window, server: str | None) -> discord.Embed:
    regions = sch.regions_for(window.groups)
    embed = common.base_embed(
        f"곧 떠돌이 상인이 나와요 — {_groups_text(window.groups)}",
        f"{timez.to_discord_timestamp(window.start, 'R')} 등장 "
        f"({window.start.strftime('%H:%M')} ~ {window.end.strftime('%H:%M')})",
    )
    embed.add_field(
        name="등장 가능 지역",
        value=" · ".join(r.name for r in regions),
        inline=False,
    )
    if server:
        embed.set_footer(text=f"{server} · 발견하면 /떠상제보 로 공유해주세요")
    else:
        embed.set_footer(text="발견하면 /떠상제보 로 공유해주세요")
    return embed

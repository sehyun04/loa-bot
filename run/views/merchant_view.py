from datetime import datetime

import discord

from run.services.merchant import schedule as sch
from run.utils import timez
from run.views import common

_GROUP_LABEL = {1: "1그룹", 2: "2그룹", 3: "3그룹"}


def _groups_text(groups: tuple[int, ...]) -> str:
    return " · ".join(_GROUP_LABEL.get(g, f"{g}그룹") for g in sorted(groups))


def _region_lines(regions: tuple[sch.Region, ...]) -> list[str]:
    lines = []
    for r in sorted(regions, key=lambda x: (x.group, x.name)):
        cards = r.items_of("card")
        card_text = ", ".join(c.name for c in cards[:4]) if cards else "카드 없음"
        if len(cards) > 4:
            card_text += f" 외 {len(cards) - 4}종"
        lines.append(f"**{r.name}** · {r.npc}\n  카드: {card_text}")
    return lines


def merchant_embed(now: datetime) -> discord.Embed:
    active = sch.active_window(now)
    upcoming = sch.next_window(now)

    if active:
        regions = sch.regions_for(active.groups)
        embed = common.base_embed(
            f"떠돌이 상인 등장 중 — {_groups_text(active.groups)}",
            f"{timez.to_discord_timestamp(active.end, 'R')} 에 사라져요 "
            f"(종료 {timez.to_discord_timestamp(active.end, 't')})",
        )
    else:
        regions = sch.regions_for(upcoming.groups)
        embed = common.notice_embed(
            "지금은 떠돌이 상인이 없어요",
            f"다음 등장 {timez.to_discord_timestamp(upcoming.start, 'R')} "
            f"— {_groups_text(upcoming.groups)}",
        )

    lines = _region_lines(regions)
    # 임베드 필드는 1024자 제한이라 지역을 나눠 담는다
    chunk: list[str] = []
    size = 0
    part = 1
    for line in lines:
        if size + len(line) > 900 and chunk:
            embed.add_field(
                name=f"등장 가능 지역 ({part})" if part > 1 else "등장 가능 지역",
                value="\n".join(chunk),
                inline=False,
            )
            chunk, size, part = [], 0, part + 1
        chunk.append(line)
        size += len(line) + 1
    if chunk:
        embed.add_field(
            name=f"등장 가능 지역 ({part})" if part > 1 else "등장 가능 지역",
            value="\n".join(chunk),
            inline=False,
        )

    if active:
        embed.add_field(
            name="다음 등장",
            value=f"{timez.to_discord_timestamp(upcoming.start, 'R')} · {_groups_text(upcoming.groups)}",
            inline=False,
        )

    embed.set_footer(text="등장 시각은 전 서버 공통이에요. 실제 위치는 /떠상제보 로 공유해요")
    return embed


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

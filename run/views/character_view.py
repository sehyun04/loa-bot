import discord

from run.services.lostark.armory import Character, Sibling
from run.views import common


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
    if char.card_sets:
        embed.add_field(name="카드", value=" · ".join(char.card_sets[:3]), inline=True)

    if char.guild:
        embed.set_footer(text=f"길드 {char.guild}")
    if char.image_url:
        embed.set_thumbnail(url=char.image_url)
    return embed


def siblings_embed(owner: str, siblings: list[Sibling]) -> discord.Embed:
    if not siblings:
        return common.notice_embed("원정대가 비어 있어요", f"{owner} 의 캐릭터를 찾지 못했어요.")

    by_server: dict[str, list[Sibling]] = {}
    for s in siblings:
        by_server.setdefault(s.server, []).append(s)

    embed = common.base_embed(
        f"{owner} 의 원정대",
        f"총 {len(siblings)}캐릭 · 서버 {len(by_server)}곳",
    )

    for server, chars in sorted(by_server.items(), key=lambda kv: -len(kv[1])):
        lines = [
            f"`{_fmt_level(c.item_level):>9}` {c.name} · {c.class_name}"
            for c in chars[:15]
        ]
        if len(chars) > 15:
            lines.append(f"... 외 {len(chars) - 15}캐릭")
        embed.add_field(name=server, value="\n".join(lines), inline=False)

    return embed

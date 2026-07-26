import discord

from run.services.auction import BidResult
from run.services.lostark.market import MarketItem
from run.views import common


def market_embed(query: str, items: list[MarketItem]) -> discord.Embed:
    if not items:
        return common.notice_embed(
            "검색 결과가 없어요", f"`{query}` 로 찾은 아이템이 없어요. 이름을 정확히 입력해주세요."
        )

    embed = common.base_embed(f"거래소 시세 — {query}", f"{len(items)}건")
    for item in items:
        lines = [f"현재 최저 **{item.current_min_price:,}골드**"]
        if item.bundle_count > 1:
            lines.append(f"{item.bundle_count}개 묶음 · 개당 {item.unit_price:,.1f}골드")
        if item.yesterday_avg_price:
            lines.append(f"어제 평균 {item.yesterday_avg_price:,.1f}골드")
        embed.add_field(
            name=f"{item.name} [{item.grade}]" if item.grade else item.name,
            value="\n".join(lines),
            inline=False,
        )
    if items[0].icon:
        embed.set_thumbnail(url=items[0].icon)
    return embed


def auction_embed(result: BidResult, break_even: int | None) -> discord.Embed:
    embed = common.base_embed(
        "경매 계산",
        f"{result.party_size}인 파티에서 **{result.bid:,}골드** 로 낙찰했을 때",
    )
    embed.add_field(name="내 실부담", value=f"{result.winner_cost:,}골드", inline=True)
    embed.add_field(name="1인당 분배금", value=f"{result.share_per_member:,}골드", inline=True)

    if break_even is not None:
        embed.add_field(
            name="손익분기 입찰가",
            value=(
                f"**{break_even:,}골드** 까지가 이득이에요\n"
                f"거래소 수수료 5%를 뺀 실수령과 같아지는 지점이에요."
            ),
            inline=False,
        )
    embed.set_footer(text="낙찰금은 파티 전원에게 나뉘고 낙찰자도 자기 몫을 받아요")
    return embed

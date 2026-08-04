import json
from collections import OrderedDict

import discord
from discord import app_commands
from discord.ext import commands

from run.core import config, errors
from run.services import auction
from run.views import common, market_view

_PRESETS: list[str] = json.loads(
    (config.RESOURCE_DIR / "market_presets.json").read_text(encoding="utf-8")
)["presets"]

# 거래소에 실제로 올라와 있는 아이템 전체 이름 목록. scripts/fetch_market_items.py로
# 미리 받아둔 로컬 스냅샷이라 자동완성이 키 입력마다 API를 부르지 않는다.
# _PRESETS 뒤에 붙여서 쓴다 - 입력이 비어 있을 때는 여전히 _PRESETS(자주 찾는
# 재련 재료)가 먼저 보이고, 뭔가 입력했을 때만 이 전체 카탈로그까지 검색된다.
_CATALOG: list[str] = [
    row["name"]
    for row in json.loads(
        (config.RESOURCE_DIR / "market_items.json").read_text(encoding="utf-8")
    )["items"]
]

# 유저별 최근 검색어. autocomplete에서 API를 부르지 않기 위한 재료다.
_recent: OrderedDict[str, list[str]] = OrderedDict()
_RECENT_MAX = 10


def _remember(user_id: str, query: str) -> None:
    history = _recent.get(user_id, [])
    history = [q for q in history if q != query]
    history.insert(0, query)
    _recent[user_id] = history[:_RECENT_MAX]
    if len(_recent) > 500:
        _recent.popitem(last=False)


class MarketCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="시세", description="거래소 아이템 시세를 봅니다")
    @app_commands.describe(아이템="아이템 이름")
    async def price(self, interaction: discord.Interaction, 아이템: str) -> None:
        await interaction.response.defer()
        if not config.has_lostark_api():
            await interaction.followup.send(embed=common.api_key_missing_embed())
            return

        from run.services.lostark import market

        query = 아이템.strip()
        try:
            items = await market.search(query)
        except errors.Maintenance:
            await interaction.followup.send(
                embed=common.notice_embed("점검 중이에요", "잠시 후 다시 시도해주세요.")
            )
            return
        except errors.LoaApiError as exc:
            await interaction.followup.send(embed=common.error_embed("조회 실패", str(exc)))
            return

        _remember(str(interaction.user.id), query)
        await interaction.followup.send(embed=market_view.market_embed(query, items))

    @price.autocomplete("아이템")
    async def price_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        # 키 입력 한 글자마다 호출된다. 여기서 API를 부르면 한도가 순식간에 녹는다.
        text = current.strip().lower()
        # 입력이 비어 있을 땐 카탈로그(알파벳/가나다순이라 코스튬 상자 같은 게
        # 먼저 걸린다)까지 섞지 않고 자주 찾는 재련 재료(_PRESETS)만 보여준다.
        recent = _recent.get(str(interaction.user.id), [])
        pool = recent + _PRESETS + (_CATALOG if text else [])
        seen, out = set(), []
        for name in pool:
            if name in seen:
                continue
            if text and text not in name.lower():
                continue
            seen.add(name)
            out.append(app_commands.Choice(name=name, value=name))
            if len(out) >= 25:
                break
        return out

    @app_commands.command(name="경매", description="경매 낙찰가로 실부담과 분배금을 계산합니다")
    @app_commands.describe(낙찰가="입찰하려는 골드", 인원="파티 인원", 시세="거래소 시세 (넣으면 손익분기까지 계산해요)")
    @app_commands.choices(
        인원=[
            app_commands.Choice(name="4인", value=4),
            app_commands.Choice(name="8인", value=8),
        ]
    )
    async def bid(
        self,
        interaction: discord.Interaction,
        낙찰가: int,
        인원: app_commands.Choice[int] | None = None,
        시세: int | None = None,
    ) -> None:
        party_size = 인원.value if 인원 else 8
        if 낙찰가 <= 0:
            await interaction.response.send_message(
                embed=common.error_embed("입력을 확인해주세요", "낙찰가는 1골드 이상이어야 해요."),
                ephemeral=True,
            )
            return

        result = auction.calculate(낙찰가, party_size)
        break_even = auction.break_even_bid(시세, party_size) if 시세 and 시세 > 0 else None
        await interaction.response.send_message(
            embed=market_view.auction_embed(result, break_even)
        )

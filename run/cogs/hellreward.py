import discord
from discord import app_commands
from discord.ext import commands

from run.services import hellreward
from run.views import common, hellreward_view

_TIER_CHOICES = [
    app_commands.Choice(name="1640 (I)", value="1640"),
    app_commands.Choice(name="1700 (II)", value="1700"),
    app_commands.Choice(name="1730 (III)", value="1730"),
    app_commands.Choice(name="1750 (IV)", value="1750"),
]


class HellRewardCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="지옥보상", description="지옥 보상 상자 중 뭐가 이득인지 비교합니다")
    @app_commands.describe(티어="사용한 지옥 열쇠 단계", 층="최종 도달 층수 (1~100)")
    @app_commands.choices(티어=_TIER_CHOICES)
    async def hell_reward(
        self,
        interaction: discord.Interaction,
        티어: app_commands.Choice[str],
        층: app_commands.Range[int, 1, 100],
    ) -> None:
        categories = hellreward.categories_for(티어.value, 층)
        if len(categories) < 2:
            await interaction.response.send_message(
                view=common.error_view("비교할 상자가 부족해요", "이 층수에는 상자 종류가 2개 미만이에요."),
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            view=hellreward_view.HellRewardPickView(티어.value, 층, categories)
        )

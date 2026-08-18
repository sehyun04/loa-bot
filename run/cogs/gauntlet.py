import discord
from discord import app_commands
from discord.ext import commands

from run.services import gauntlet
from run.views import common, gauntlet_view


class GauntletCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="완갑", description="완갑을 목표 단계까지 올리는 데 골드가 얼마나 드는지 계산합니다")
    @app_commands.describe(
        현재="지금 완갑 재련 단계",
        목표="올리고 싶은 단계. 안 넣으면 한 단계만 계산해요",
        기운="지금 단계에 쌓인 장인의 기운 (%)",
    )
    async def gauntlet_cost(
        self,
        interaction: discord.Interaction,
        현재: app_commands.Range[int, 0, 24],
        목표: app_commands.Range[int, 1, 25] | None = None,
        기운: app_commands.Range[float, 0.0, 99.9] = 0.0,
    ) -> None:
        # 재료 시세를 종류마다 따로 조회해서 3초를 넘긴다.
        await interaction.response.defer()
        try:
            plan = await gauntlet.estimate(현재, 목표 if 목표 is not None else 현재 + 1, artisan=기운 / 100)
        except ValueError as exc:
            await interaction.followup.send(
                view=common.error_view("계산할 수 없어요", str(exc)), ephemeral=True
            )
            return

        await interaction.followup.send(view=gauntlet_view.build_view(plan))

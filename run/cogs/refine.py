import discord
from discord import app_commands
from discord.ext import commands

from run.services import refine
from run.views import common, refine_view


class RefineCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="재련", description="재련 성공까지 평균 몇 번, 몇 골드 드는지 계산합니다")
    @app_commands.describe(
        확률="실패가 쌓이지 않은 상태의 성공 확률 (%)",
        비용="시도 1회에 드는 골드 (재료값 합계)",
        기운="지금까지 쌓인 장인의 기운 (%)",
        상승="실패 1회당 오르는 폭 (%). 숨결을 쓸 때만 넣으세요",
    )
    async def refine_cost(
        self,
        interaction: discord.Interaction,
        확률: app_commands.Range[float, 0.1, 100.0],
        비용: app_commands.Range[float, 0.0, 1_000_000_000.0] | None = None,
        기운: app_commands.Range[float, 0.0, 99.9] = 0.0,
        상승: app_commands.Range[float, 0.0, 100.0] | None = None,
    ) -> None:
        try:
            outcome = refine.simulate(
                확률 / 100,
                cost_per_try=비용,
                artisan=기운 / 100,
                fail_gain=None if 상승 is None else 상승 / 100,
            )
        except ValueError as exc:
            await interaction.response.send_message(
                view=common.error_view("계산할 수 없어요", str(exc)), ephemeral=True
            )
            return

        await interaction.response.send_message(
            view=refine_view.build_result_view(outcome, 확률 / 100, 기운 / 100)
        )

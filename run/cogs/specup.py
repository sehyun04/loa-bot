import discord
from discord import app_commands
from discord.ext import commands

from run.core import errors
from run.services import specup
from run.views import common, specup_view


class SpecUpCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="스펙업", description="지금 뭐부터 올리면 좋을지 뒤처진 순서로 알려줍니다")
    @app_commands.describe(닉네임="조회할 캐릭터 이름")
    async def spec_up(self, interaction: discord.Interaction, 닉네임: str) -> None:
        # 각인서 시세를 부위 수만큼 조회해서 3초를 넘길 수 있다.
        await interaction.response.defer()
        try:
            report = await specup.diagnose(닉네임)
        except errors.CharacterNotFound:
            await interaction.followup.send(
                view=common.error_view("그 캐릭터를 찾지 못했어", f"`{닉네임}`... 철자를 한 번만 더 봐줄래?"),
                ephemeral=True,
            )
            return

        await interaction.followup.send(view=specup_view.build_report_view(report))

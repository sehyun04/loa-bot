import discord
from discord import app_commands
from discord.ext import commands

from run.views import gemnave_view


class GemnaveCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="젬나브", description="젬 가공에서 굴릴지 리롤할지 알려주는 계산기를 엽니다")
    async def gemnave(self, interaction: discord.Interaction) -> None:
        # 링크 한 장이라 외부 호출이 없다. defer 할 이유가 없다.
        await interaction.response.send_message(view=gemnave_view.build_view())

import logging

import discord
from discord import app_commands
from discord.ext import commands

from run.core import errors
from run.services.lostark import armory
from run.views import character_view, common

log = logging.getLogger("loabot.character")


def _error_view(exc: Exception) -> discord.ui.LayoutView:
    """`/스펙` 은 성공 화면이 아직 임베드지만 오류는 여기로 통일한다.

    `/원정대` 가 V2 라 오류만 임베드로 두면 한 파일에 오류 경로가 두 벌 생긴다.
    오류 화면은 어차피 알림 상자 한 장이라 둘을 맞춰도 티가 나지 않는다.
    """
    if isinstance(exc, errors.ApiKeyMissing):
        return common.api_key_missing_view()
    if isinstance(exc, errors.ApiKeyInvalid):
        return common.error_view(
            "API 키가 거부됐어요", "키가 만료됐거나 형식이 잘못됐어요. 관리자에게 알려주세요."
        )
    if isinstance(exc, errors.CharacterNotFound):
        return common.notice_view(
            "캐릭터를 찾을 수 없어요", "닉네임 철자를 확인해주세요. 대소문자와 띄어쓰기까지 정확해야 해요."
        )
    if isinstance(exc, errors.Maintenance):
        return common.notice_view("지금은 점검 중이에요", "로스트아크가 잠시 문을 닫아 두었어요. 조금 뒤에 다시 찾아와 주세요.")
    if isinstance(exc, errors.RateLimited):
        return common.notice_view("잠깐 붐비고 있어요", "요청이 몰렸어요. 숨을 고르고 잠시 뒤에 다시 불러주세요.")
    if isinstance(exc, errors.LoaApiError):
        return common.error_view("조회하지 못했어요", str(exc))
    raise exc


class CharacterCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="스펙", description="캐릭터의 아이템 레벨과 세팅을 봅니다")
    @app_commands.describe(닉네임="조회할 캐릭터 이름")
    async def spec(self, interaction: discord.Interaction, 닉네임: str) -> None:
        await interaction.response.defer()
        try:
            char = await armory.fetch_character(닉네임.strip())
        except Exception as exc:
            await interaction.followup.send(view=_error_view(exc))
            return
        await interaction.followup.send(embed=character_view.character_embed(char))

    @app_commands.command(name="원정대", description="같은 계정의 캐릭터 목록을 봅니다")
    @app_commands.describe(닉네임="기준이 될 캐릭터 이름")
    async def siblings(self, interaction: discord.Interaction, 닉네임: str) -> None:
        await interaction.response.defer()
        name = 닉네임.strip()
        try:
            rows = await armory.fetch_siblings(name)
        except Exception as exc:
            await interaction.followup.send(view=_error_view(exc))
            return
        await interaction.followup.send(view=character_view.siblings_view(name, rows))

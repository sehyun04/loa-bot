import logging

import discord
from discord import app_commands
from discord.ext import commands

from run.core import config, db
from run.views import common

log = logging.getLogger("loabot")


class LoaBot(commands.Bot):
    def __init__(self) -> None:
        # 떠상 제보를 자체 커맨드로 받으므로 message_content 특권 인텐트가 필요 없다
        intents = discord.Intents.default()
        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None,
            application_id=int(config.DISCORD_APPLICATION_ID)
            if config.DISCORD_APPLICATION_ID
            else None,
        )
        self._ready_once = False

    async def setup_hook(self) -> None:
        applied = await db.amigrate()
        if applied:
            log.info("마이그레이션 적용: %s", applied)

        from run.cogs import setup_all_cogs
        from run.views.homework_view import HomeworkToggle

        # 재시작 전에 보낸 메시지의 버튼도 계속 동작하게 한다
        self.add_dynamic_items(HomeworkToggle)

        await setup_all_cogs(self)
        self.tree.on_error = self._on_app_command_error

    async def close(self) -> None:
        from run.services.lostark.client import close_client

        await close_client()
        await super().close()

    async def on_ready(self) -> None:
        # RESUME 재연결마다 on_ready가 다시 불린다. 동기화를 매번 하면 안 된다.
        if self._ready_once:
            log.info("재연결됨: %s", self.user)
            return
        self._ready_once = True

        log.info("로그인: %s (id=%s)", self.user, self.user.id if self.user else "?")
        await self._sync_commands()

    async def _sync_commands(self) -> None:
        try:
            if config.DEV_GUILD_ID:
                guild = discord.Object(id=int(config.DEV_GUILD_ID))
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                log.info("길드 커맨드 %d개 동기화 (즉시 반영)", len(synced))
            else:
                synced = await self.tree.sync()
                log.info("글로벌 커맨드 %d개 동기화 (반영까지 최대 1시간)", len(synced))
        except discord.HTTPException:
            log.exception("커맨드 동기화 실패")

    async def _on_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        original = getattr(error, "original", error)

        # 인터랙션 토큰 3초 만료. 이미 응답할 대상이 사라진 것이라 알릴 방법이 없다.
        if isinstance(original, discord.NotFound) and original.code == 10062:
            log.warning("인터랙션 만료: %s", interaction.command)
            return

        log.exception("커맨드 오류: %s", interaction.command, exc_info=original)
        embed = common.error_embed("문제가 생겼어요", "잠시 후 다시 시도해주세요.")
        try:
            if interaction.response.is_done():
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message(embed=embed, ephemeral=True)
        except discord.HTTPException:
            pass

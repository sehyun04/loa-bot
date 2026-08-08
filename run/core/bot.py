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
        from run.views.homework_view import (
            HomeworkCharacterSelect,
            HomeworkPick,
            HomeworkToggle,
        )

        # 재시작 전에 보낸 메시지의 버튼도 계속 동작하게 한다
        self.add_dynamic_items(HomeworkPick, HomeworkToggle, HomeworkCharacterSelect)

        await setup_all_cogs(self)
        self.tree.on_error = self._on_app_command_error

    async def close(self) -> None:
        from run.services.lostark.client import close_client
        from run.services.merchant import kloa

        await close_client()
        await kloa.close()
        await super().close()

    async def on_ready(self) -> None:
        # RESUME 재연결마다 on_ready가 다시 불린다. 동기화를 매번 하면 안 된다.
        if self._ready_once:
            log.info("재연결됨: %s", self.user)
            return
        self._ready_once = True

        log.info("로그인: %s (id=%s)", self.user, self.user.id if self.user else "?")
        if self.guilds:
            for guild in self.guilds:
                log.info("참여 중인 서버: %s (id=%s)", guild.name, guild.id)
        else:
            log.warning("아직 어떤 서버에도 초대되지 않았어요")
        await self._sync_commands()

    async def on_app_command_completion(
        self, interaction: discord.Interaction, command: app_commands.Command
    ) -> None:
        # 실행 기록이 없으면 "요청이 봇까지 왔는지"조차 알 수 없어 진단이 막힌다
        options = " ".join(f"{k}={v}" for k, v in interaction.namespace.__dict__.items() if v is not None)
        log.info("/%s %s (%s)", command.qualified_name, options, interaction.user)

    async def on_guild_join(self, guild: discord.Guild) -> None:
        # 글로벌 등록은 반영까지 최대 1시간이 걸린다. 새로 초대된 서버에는
        # 길드 스코프로 즉시 복사해서 바로 쓸 수 있게 한다.
        log.info("서버에 초대됨: %s (id=%s)", guild.name, guild.id)
        try:
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            log.info("%s 에 커맨드 %d개 즉시 등록", guild.name, len(synced))
        except discord.HTTPException:
            log.exception("길드 커맨드 동기화 실패: %s", guild.id)

    async def _sync_commands(self) -> None:
        try:
            if config.DEV_GUILD_ID:
                guild = discord.Object(id=int(config.DEV_GUILD_ID))
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                log.info("길드 커맨드 %d개 동기화 (즉시 반영)", len(synced))

                # 글로벌과 길드는 별개로 취급되어 같은 커맨드가 두 벌로 보인다.
                # 개발 중에는 즉시 반영되는 길드 쪽만 남긴다.
                self.tree.clear_commands(guild=None)
                await self.tree.sync()
                log.info("글로벌 커맨드 정리 완료 (중복 표시 방지)")
            else:
                synced = await self.tree.sync()
                log.info("글로벌 커맨드 %d개 동기화 (반영까지 최대 1시간)", len(synced))
        except discord.HTTPException:
            log.exception("커맨드 동기화 실패")

    async def _on_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        original = getattr(error, "original", error)
        name = interaction.command.qualified_name if interaction.command else "?"

        # 인터랙션 토큰 3초 만료. 이미 응답할 대상이 사라진 것이라 알릴 방법이 없다.
        if isinstance(original, discord.NotFound) and original.code == 10062:
            log.warning("인터랙션 만료: /%s", name)
            return

        # 게이트웨이가 끊겼다 재연결되는 타이밍에 같은 인터랙션이 중복 전달되면 먼저
        # 처리된 쪽이 이미 응답해버려서, 뒤이은 처리는 여기로 떨어진다. 실패가 아니라
        # 중복 처리의 부작용이라 에러 메시지를 또 보내려 하면 그것도 똑같이 실패한다.
        if isinstance(original, discord.HTTPException) and original.code == 40060:
            log.warning("중복 인터랙션 (이미 응답됨): /%s", name)
            return

        log.exception("커맨드 오류: /%s", name, exc_info=original)
        embed = common.error_embed("문제가 생겼어요", "잠시 후 다시 시도해주세요.")
        try:
            if interaction.response.is_done():
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.response.send_message(embed=embed, ephemeral=True)
        except discord.HTTPException:
            pass

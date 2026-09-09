import logging

import discord
from discord import app_commands
from discord.ext import commands, tasks

from run.services.merchant import kloa
from run.services.merchant import schedule as sch
from run.services.merchant import sightings
from run.services.merchant import wants as wants_svc
from run.utils import timez
from run.views import common, merchant_view

log = logging.getLogger("loabot.merchant")

SERVER_CHOICES = [app_commands.Choice(name=s, value=s) for s in sch.servers()]


class MerchantCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.card_alert_loop.start()

    async def cog_unload(self) -> None:
        self.card_alert_loop.cancel()

    async def _card_choices(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        text = current.strip().lower()
        out = []
        for name in sch.card_names():
            if text and text not in name.lower():
                continue
            out.append(app_commands.Choice(name=name, value=name))
            if len(out) >= 25:
                break
        return out

    @app_commands.command(name="떠상", description="떠돌이 상인 등장 시간과 판매 품목을 봅니다")
    @app_commands.describe(서버="판매 품목을 볼 서버")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def merchant(
        self, interaction: discord.Interaction, 서버: app_commands.Choice[str] | None = None
    ) -> None:
        await interaction.response.defer()
        now = timez.now()

        # 등장 시각·지역은 계산되지만 '무엇을 파는지'는 서버마다 달라 kloa 제보로만 알 수 있다
        seen = await kloa.sightings(서버.value, now) if 서버 else ()

        view = merchant_view.build_merchant_view(now, 서버.value if 서버 else None, seen)
        message = await interaction.followup.send(view=view, wait=True)
        if isinstance(view, merchant_view.MerchantPager):
            view.message = message

    @app_commands.command(name="떠상카드알림", description="원하는 카드가 뜨면 이 채널에서 멘션해드려요")
    @app_commands.describe(서버="어느 서버를 볼지", 카드="기다리는 카드")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def card_alert(
        self,
        interaction: discord.Interaction,
        서버: app_commands.Choice[str],
        카드: str,
    ) -> None:
        if interaction.guild_id is None:
            await interaction.response.send_message("서버 채널에서만 쓸 수 있어.", ephemeral=True)
            return

        if 카드 not in sch.card_names():
            await interaction.response.send_message(
                view=common.error_view("모르는 카드야", "자동완성에 뜨는 이름 중에서 골라줄래?"),
                ephemeral=True,
            )
            return

        user_id = str(interaction.user.id)
        await wants_svc.add(
            user_id=user_id,
            guild_id=str(interaction.guild_id),
            channel_id=str(interaction.channel_id),
            server=서버.value,
            card_name=카드,
        )

        # 지금 등장 중이면 이 등장에 대한 예전 발송 기록을 지운다 - 안 그러면
        # 이미 한 번 보낸 적 있는 (윈도우, 유저, 서버, 카드) 조합은 재등록해도 다시 안 온다
        window = sch.active_window(timez.now())
        if window is not None:
            await sightings.unclaim(f"cardalert:{window.id}:{user_id}:{서버.value}:{카드}")

        await interaction.response.send_message(
            view=common.base_view(
                "카드 알림을 걸어뒀어",
                f"**{서버.value}** · **{카드}**\n"
                "이게 뜨면 이 채널에서 불러줄게. 그만두려면 `/떠상카드해제` 를 써줘.",
            ),
            ephemeral=True,
        )

    @card_alert.autocomplete("카드")
    async def card_alert_autocomplete(self, interaction: discord.Interaction, current: str):
        return await self._card_choices(interaction, current)

    @app_commands.command(name="떠상카드해제", description="등록해둔 카드 알림을 해제합니다")
    @app_commands.describe(서버="해제할 서버", 카드="해제할 카드")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def card_alert_remove(
        self,
        interaction: discord.Interaction,
        서버: app_commands.Choice[str],
        카드: str,
    ) -> None:
        removed = await wants_svc.remove(str(interaction.user.id), 서버.value, 카드)
        if removed:
            await interaction.response.send_message(
                view=common.notice_view("이제 지켜보지 않을게", f"**{서버.value}** · {카드} 알림은 더 보내지 않을게."),
                ephemeral=True,
            )
        else:
            await interaction.response.send_message(
                view=common.notice_view("걸어둔 적이 없어", f"**{서버.value}** · {카드}... 걸어둔 적이 없어."),
                ephemeral=True,
            )

    @card_alert_remove.autocomplete("카드")
    async def card_alert_remove_autocomplete(self, interaction: discord.Interaction, current: str):
        # 등록한 것만 골라 보여준다 - 133종 전체 카드 목록을 뒤질 필요가 없다
        items = await wants_svc.for_user(str(interaction.user.id))
        서버_raw = getattr(interaction.namespace, "서버", None)
        서버_value = 서버_raw.value if isinstance(서버_raw, app_commands.Choice) else 서버_raw

        text = current.strip().lower()
        out = []
        for w in items:
            if 서버_value and w.server != 서버_value:
                continue
            if text and text not in w.card_name.lower():
                continue
            out.append(app_commands.Choice(name=w.card_name, value=w.card_name))
            if len(out) >= 25:
                break
        return out

    @app_commands.command(name="떠상카드목록", description="내가 등록한 카드 알림 목록을 봅니다")
    async def card_alert_list(self, interaction: discord.Interaction) -> None:
        items = await wants_svc.for_user(str(interaction.user.id))
        if not items:
            await interaction.response.send_message(
                view=common.notice_view("아직 걸어둔 알림이 없어", "`/떠상카드알림` 으로 기다리는 카드를 알려줘."),
                ephemeral=True,
            )
            return

        lines = [f"**{w.server}** · {w.card_name}" for w in items]
        await interaction.response.send_message(
            view=common.base_view("등록한 카드 알림", "\n".join(lines)),
            ephemeral=True,
        )

    @tasks.loop(minutes=1)
    async def card_alert_loop(self) -> None:
        now = timez.now()
        window = sch.active_window(now)
        if window is None:
            return

        all_wants = await wants_svc.all_wants()
        if not all_wants:
            return

        by_server: dict[str, list[wants_svc.Want]] = {}
        for want in all_wants:
            by_server.setdefault(want.server, []).append(want)

        for server, server_wants in by_server.items():
            seen = await kloa.sightings(server, now)

            # 카드 이름 -> (지역, 상인). 같은 카드가 여러 지역에 겹쳐 뜨는 일은 없어 먼저 찾은 걸 쓴다
            found: dict[str, tuple[str, str | None]] = {}
            for s in seen:
                for name in s.items:
                    found.setdefault(name, (s.region_name, s.npc))
            if not found:
                continue

            for want in server_wants:
                location = found.get(want.card_name)
                if location is None:
                    continue
                # 루프가 1분마다 돌아 같은 등장 동안 같은 유저에게 여러 번 갈 수 있다
                if not await sightings.claim(
                    f"cardalert:{window.id}:{want.user_id}:{want.server}:{want.card_name}"
                ):
                    continue

                channel = self.bot.get_channel(int(want.channel_id))
                if channel is None:
                    continue

                region_name, npc = location
                item = sch.card_by_name(want.card_name)
                icon = item.emoji if item else ""
                location_text = region_name + (f" · {npc}" if npc else "")
                text = (
                    f"<@{want.user_id}> {icon} **{want.card_name}** 카드가 떴어!\n{location_text}"
                    if icon
                    else f"<@{want.user_id}> **{want.card_name}** 카드가 떴어!\n{location_text}"
                )
                try:
                    await channel.send(text)
                except discord.HTTPException:
                    log.warning("떠상 카드 알림 전송 실패: channel=%s", want.channel_id)

    @card_alert_loop.before_loop
    async def before_card_alert(self) -> None:
        await self.bot.wait_until_ready()

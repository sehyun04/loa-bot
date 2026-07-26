import logging

import discord
from discord import app_commands
from discord.ext import commands, tasks

from run.services.merchant import schedule as sch
from run.services.merchant import sightings
from run.utils import timez
from run.views import common, merchant_view

log = logging.getLogger("loabot.merchant")

SERVER_CHOICES = [app_commands.Choice(name=s, value=s) for s in sch.servers()]


class MerchantCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.notify_loop.start()

    async def cog_unload(self) -> None:
        self.notify_loop.cancel()

    async def _region_choices(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        # 정적 데이터라 API를 타지 않는다
        text = current.strip().lower()
        out = []
        for region in sch.all_regions():
            label = f"{region.name} ({region.npc})"
            if text and text not in label.lower():
                continue
            out.append(app_commands.Choice(name=label, value=region.name))
            if len(out) >= 25:
                break
        return out

    @app_commands.command(name="떠상", description="떠돌이 상인 등장 시간과 제보를 봅니다")
    @app_commands.describe(서버="제보를 볼 서버")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def merchant(
        self, interaction: discord.Interaction, 서버: app_commands.Choice[str] | None = None
    ) -> None:
        await interaction.response.defer()
        now = timez.now()
        embed = merchant_view.merchant_embed(now)

        window = sch.active_window(now)
        if 서버 and window:
            reports = await sightings.active(window.id, 서버.value)
            embed.add_field(
                name=f"{서버.value} 제보",
                value=merchant_view.reports_text(reports),
                inline=False,
            )
        await interaction.followup.send(embed=embed)

    @app_commands.command(name="떠상제보", description="떠돌이 상인 위치를 공유합니다")
    @app_commands.describe(서버="발견한 서버", 지역="상인이 있는 지역", 품목="파는 물건 (쉼표로 구분)")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def report(
        self,
        interaction: discord.Interaction,
        서버: app_commands.Choice[str],
        지역: str,
        품목: str | None = None,
    ) -> None:
        now = timez.now()
        window = sch.active_window(now)
        if window is None:
            upcoming = sch.next_window(now)
            await interaction.response.send_message(
                embed=common.notice_embed(
                    "지금은 떠상 시간이 아니에요",
                    f"다음 등장 {timez.to_discord_timestamp(upcoming.start, 'R')} 이후에 제보해주세요.",
                ),
                ephemeral=True,
            )
            return

        region = next((r for r in sch.all_regions() if r.name == 지역), None)
        items = [x.strip() for x in (품목 or "").split(",") if x.strip()]

        await sightings.add(
            window_id=window.id,
            server=서버.value,
            region=지역,
            npc=region.npc if region else None,
            items=items,
            reporter_id=str(interaction.user.id),
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
        )

        embed = common.base_embed(
            "제보 고마워요",
            f"**{서버.value}** · {지역}" + (f" · {region.npc}" if region else ""),
        )
        if items:
            embed.add_field(name="판매 품목", value=", ".join(items), inline=False)
        embed.set_footer(text=f"이 제보는 {window.end.strftime('%H:%M')} 까지 유효해요")
        await interaction.response.send_message(embed=embed)

    @report.autocomplete("지역")
    async def report_autocomplete(self, interaction: discord.Interaction, current: str):
        return await self._region_choices(interaction, current)

    @app_commands.command(name="떠상알림", description="떠상 등장 알림을 이 채널에 받습니다")
    @app_commands.describe(서버="알림받을 서버", 알림분="등장 몇 분 전에 알릴지", 끄기="알림을 해제하려면 켜세요")
    @app_commands.choices(서버=SERVER_CHOICES)
    async def subscribe(
        self,
        interaction: discord.Interaction,
        서버: app_commands.Choice[str] | None = None,
        알림분: int = 10,
        끄기: bool = False,
    ) -> None:
        if interaction.guild_id is None:
            await interaction.response.send_message("서버 채널에서만 쓸 수 있어요.", ephemeral=True)
            return

        guild_id = str(interaction.guild_id)
        channel_id = str(interaction.channel_id)

        if 끄기:
            await sightings.unsubscribe(guild_id, channel_id)
            await interaction.response.send_message(
                embed=common.notice_embed("알림을 껐어요", "이 채널로 더는 떠상 알림을 보내지 않아요.")
            )
            return

        lead = max(1, min(알림분, 60))
        await sightings.subscribe(guild_id, channel_id, 서버.value if 서버 else None, lead)
        await interaction.response.send_message(
            embed=common.base_embed(
                "떠상 알림을 켰어요",
                f"등장 **{lead}분 전**에 이 채널로 알려드릴게요."
                + (f"\n대상 서버: {서버.value}" if 서버 else ""),
            )
        )

    @tasks.loop(minutes=1)
    async def notify_loop(self) -> None:
        now = timez.now()
        upcoming = sch.next_window(now)
        minutes_left = (upcoming.start - now).total_seconds() / 60

        subs = await sightings.subscriptions()
        if not subs:
            return

        for sub in subs:
            lead = sub["lead_minutes"]
            if not (lead - 1 < minutes_left <= lead):
                continue
            # 1분마다 도는 루프라 같은 알림이 두 번 걸릴 수 있다
            if not await sightings.claim(f"merchant:{upcoming.id}:{sub['channel_id']}"):
                continue

            channel = self.bot.get_channel(int(sub["channel_id"]))
            if channel is None:
                continue
            try:
                await channel.send(embed=merchant_view.upcoming_embed(upcoming, sub["server"]))
            except discord.HTTPException:
                log.warning("떠상 알림 전송 실패: channel=%s", sub["channel_id"])

    @notify_loop.before_loop
    async def before_notify(self) -> None:
        await self.bot.wait_until_ready()

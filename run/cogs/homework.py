import discord
from discord import app_commands
from discord.ext import commands

from run.core import config, errors
from run.services import homework
from run.views import common, homework_view


class HomeworkCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    async def _character_choices(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        # autocomplete는 글자마다 호출된다. 외부 API를 부르면 순식간에 한도가 녹는다.
        rows = await homework.list_characters(str(interaction.user.id))
        text = current.strip()
        return [
            app_commands.Choice(name=f"{r['character_name']} ({r['item_level'] or 0:,.0f})", value=r["character_name"])
            for r in rows
            if text.lower() in r["character_name"].lower()
        ][:25]

    @app_commands.command(name="숙제", description="내 숙제 체크리스트를 봅니다")
    @app_commands.describe(캐릭터="비워두면 아이템 레벨이 가장 높은 캐릭터를 봅니다")
    async def show(self, interaction: discord.Interaction, 캐릭터: str | None = None) -> None:
        user_id = str(interaction.user.id)
        chars = await homework.list_characters(user_id)
        if not chars:
            await interaction.response.send_message(
                view=common.notice_view(
                    "등록된 캐릭터가 없어요", "`/숙제설정` 으로 캐릭터를 먼저 등록해주세요."
                ),
                ephemeral=True,
            )
            return

        target = 캐릭터 or chars[0]["character_name"]
        if not any(c["character_name"] == target for c in chars):
            await interaction.response.send_message(
                view=common.notice_view(
                    f"{target} 은 등록된 캐릭터가 아니에요",
                    "`/숙제설정` 으로 먼저 등록해주세요.",
                ),
                ephemeral=True,
            )
            return

        await homework.sync_contents(user_id, target)
        tasks = await homework.load_tasks(user_id, target)
        roster = homework.same_roster(chars, target)
        await interaction.response.send_message(
            view=homework_view.homework_layout(target, tasks, user_id, roster),
            ephemeral=True,
        )

    @show.autocomplete("캐릭터")
    async def show_autocomplete(self, interaction: discord.Interaction, current: str):
        return await self._character_choices(interaction, current)

    @app_commands.command(name="숙제설정", description="숙제를 추적할 캐릭터를 등록합니다")
    @app_commands.describe(닉네임="원정대 대표 캐릭터 이름 (한 번만 넣으면 전체 캐릭터가 등록돼요)")
    async def setup(self, interaction: discord.Interaction, 닉네임: str) -> None:
        await interaction.response.defer(ephemeral=True)

        if not config.has_lostark_api():
            await interaction.followup.send(embed=common.api_key_missing_embed())
            return

        from run.services.lostark import armory

        try:
            siblings = await armory.fetch_siblings(닉네임.strip())
        except errors.CharacterNotFound:
            await interaction.followup.send(
                embed=common.notice_embed("캐릭터를 찾을 수 없어요", "닉네임을 다시 확인해주세요.")
            )
            return
        except errors.LoaApiError as exc:
            await interaction.followup.send(embed=common.error_embed("조회 실패", str(exc)))
            return

        user_id = str(interaction.user.id)
        registered = 0
        for sib in siblings:
            await homework.register_character(
                user_id, sib.name, sib.server, sib.class_name, sib.item_level
            )
            contents = [c.id for c in homework.suggested_for(sib.item_level)]
            await homework.set_contents(user_id, sib.name, contents)
            registered += 1

        embed = common.base_embed(
            "숙제 캐릭터를 등록했어요",
            f"{registered}개 캐릭터를 등록하고, 아이템 레벨에 맞는 컨텐츠를 자동으로 골랐어요.\n"
            "`/숙제` 로 체크리스트를 열어보세요.",
        )
        top = siblings[:5]
        if top:
            embed.add_field(
                name="주요 캐릭터",
                value="\n".join(f"{s.name} · {s.class_name} · {s.item_level or 0:,.2f}" for s in top),
                inline=False,
            )
        await interaction.followup.send(embed=embed)

import re

import discord

from run.core import db
from run.services import homework
from run.utils import timez
from run.views import common


def homework_embed(character: str, tasks: list[homework.TaskState]) -> discord.Embed:
    if not tasks:
        return common.notice_embed(
            f"{character} 의 숙제가 비어 있어요",
            "`/숙제설정` 으로 추적할 컨텐츠를 골라주세요.",
        )

    daily = [t for t in tasks if t.content.cycle == "daily"]
    weekly = [t for t in tasks if t.content.cycle == "weekly"]
    done_count = sum(1 for t in tasks if t.done)

    embed = common.base_embed(
        f"{character} 의 숙제",
        f"{done_count}/{len(tasks)} 완료",
    )

    for label, group in (("일일", daily), ("주간", weekly)):
        if not group:
            continue
        lines = [f"{'[v]' if t.done else '[ ]'} {t.label}" for t in group]
        embed.add_field(name=label, value="\n".join(lines), inline=False)

    embed.add_field(
        name="다음 리셋",
        value=(
            f"일일 {timez.to_discord_timestamp(timez.next_daily_reset(), 'R')}\n"
            f"주간 {timez.to_discord_timestamp(timez.next_weekly_reset(), 'R')}"
        ),
        inline=False,
    )
    return embed


class HomeworkToggle(discord.ui.DynamicItem[discord.ui.Button], template=r"hw:(?P<task_id>\d+)"):
    """봇이 재시작해도 살아있는 체크 버튼.

    custom_id에는 task의 정수 id만 담는다. 유저·캐릭터·컨텐츠를 전부 넣으면
    100자 제한에 걸리고 한글 캐릭터명까지 들어가기 때문에, id로 DB를 되짚는다.
    """

    def __init__(self, task_id: int, label: str, done: bool) -> None:
        self.task_id = task_id
        super().__init__(
            discord.ui.Button(
                label=label[:80],
                style=discord.ButtonStyle.success if done else discord.ButtonStyle.secondary,
                custom_id=f"hw:{task_id}",
            )
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Button, match: re.Match[str], /
    ) -> "HomeworkToggle":
        return cls(
            int(match["task_id"]),
            item.label or "",
            item.style == discord.ButtonStyle.success,
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        user_id = str(interaction.user.id)
        row = await db.aquery_one(
            "SELECT user_id, character_name FROM hw_tasks WHERE id=?", (self.task_id,)
        )
        # 이 검사가 없으면 아무나 남의 체크리스트를 눌러버릴 수 있다
        if row is None or row["user_id"] != user_id:
            await interaction.response.send_message(
                "본인 숙제만 체크할 수 있어요.", ephemeral=True
            )
            return

        await homework.toggle(user_id, self.task_id)
        character = row["character_name"]
        tasks = await homework.load_tasks(user_id, character)
        await interaction.response.edit_message(
            embed=homework_embed(character, tasks), view=HomeworkView(tasks)
        )


class HomeworkView(discord.ui.View):
    def __init__(self, tasks: list[homework.TaskState]) -> None:
        super().__init__(timeout=None)
        # 액션로우 5개 x 5개 = 25개가 상한
        for task in tasks[:25]:
            self.add_item(HomeworkToggle(task.task_id, task.label, task.done))

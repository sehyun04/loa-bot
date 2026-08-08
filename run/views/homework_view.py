import re

import discord

from run.core import db
from run.services import homework
from run.utils import timez
from run.views import common

# Components V2 메시지는 컴포넌트 40개가 상한이다. Section 하나가 3개(자기 자신 +
# 텍스트 + 버튼)를 먹으므로 숙제가 열 개를 넘으면 이 레이아웃으로는 안 들어간다.
# 그때는 목록을 텍스트로 합치고 버튼만 액션로우에 까는 쪽으로 물러선다.
_BUTTONS_PER_ROW = 5
_MAX_BUTTONS = 20

# 난이도 순서대로 색을 준다. 디스코드 버튼 색은 이 네 가지가 전부라, 요청받은
# "나이트메어 보라"는 블러플(primary)이 가장 가까운 대체다.
_LEVEL_STYLES = (
    discord.ButtonStyle.success,  # 노말 / 1단계
    discord.ButtonStyle.danger,  # 하드 / 2단계
    discord.ButtonStyle.primary,  # 나메 / 3단계
)


def _level_style(index: int) -> discord.ButtonStyle:
    """난이도 순번(1부터)에 맞는 색."""
    return _LEVEL_STYLES[min(index - 1, len(_LEVEL_STYLES) - 1)]


def _button_face(task: homework.TaskState) -> tuple[str, discord.ButtonStyle]:
    """버튼 하나로 도는 레이아웃에서 쓰는 라벨/색."""
    if not task.done:
        return "체크", discord.ButtonStyle.secondary
    return task.level_name or "완료", _level_style(task.cleared)


def _reset_text() -> str:
    return (
        f"-# 다음 리셋 · 일일 {timez.to_discord_timestamp(timez.next_daily_reset(), 'R')}"
        f" · 주간 {timez.to_discord_timestamp(timez.next_weekly_reset(), 'R')}"
    )


def _grouped(tasks: list[homework.TaskState]) -> list[tuple[str, list[homework.TaskState]]]:
    groups = [
        ("일일", [t for t in tasks if t.content.cycle == "daily"]),
        ("주간", [t for t in tasks if t.content.cycle == "weekly"]),
    ]
    return [(label, group) for label, group in groups if group]


def _header(character: str, tasks: list[homework.TaskState]) -> str:
    done = sum(1 for t in tasks if t.done)
    return f"## {character} 의 숙제\n{done}/{len(tasks)} 완료"


class HomeworkToggle(discord.ui.DynamicItem[discord.ui.Button], template=r"hw:(?P<task_id>\d+)"):
    """봇이 재시작해도 살아있는 체크 버튼.

    custom_id에는 task의 정수 id만 담는다. 유저·캐릭터·컨텐츠를 전부 넣으면
    100자 제한에 걸리고 한글 캐릭터명까지 들어가기 때문에, id로 DB를 되짚는다.
    """

    def __init__(self, task_id: int, label: str, style: discord.ButtonStyle) -> None:
        self.task_id = task_id
        super().__init__(
            discord.ui.Button(label=label[:80], style=style, custom_id=f"hw:{task_id}")
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Button, match: re.Match[str], /
    ) -> "HomeworkToggle":
        # 콜백이 DB에서 현재 상태를 다시 읽으므로 라벨/색은 복원만 해두면 된다.
        return cls(int(match["task_id"]), item.label or "", item.style)

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
        await _rerender(interaction, user_id, row["character_name"])


class HomeworkPick(
    discord.ui.DynamicItem[discord.ui.Button], template=r"hwp:(?P<task_id>\d+):(?P<level>\d+)"
):
    """난이도 하나를 찍는 버튼. 레이드마다 난이도 수만큼 깔린다.

    HomeworkToggle처럼 한 바퀴 도는 방식은 나이트메어를 찍는 데 세 번 눌러야 해서
    버렸다. 이미 켜진 버튼을 다시 누르면 해제된다.
    """

    def __init__(self, task_id: int, level: int, label: str, style: discord.ButtonStyle) -> None:
        self.task_id = task_id
        self.level = level
        super().__init__(
            discord.ui.Button(
                label=label[:80], style=style, custom_id=f"hwp:{task_id}:{level}"
            )
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Button, match: re.Match[str], /
    ) -> "HomeworkPick":
        return cls(int(match["task_id"]), int(match["level"]), item.label or "", item.style)

    async def callback(self, interaction: discord.Interaction) -> None:
        user_id = str(interaction.user.id)
        owner = await homework.owner_of(self.task_id)
        # 이 검사가 없으면 아무나 남의 체크리스트를 눌러버릴 수 있다
        if owner is None or owner[0] != user_id:
            await interaction.response.send_message(
                "본인 숙제만 체크할 수 있어요.", ephemeral=True
            )
            return

        await homework.set_cleared(user_id, self.task_id, self.level)
        await _rerender(interaction, user_id, owner[1])


class HomeworkCharacterSelect(
    discord.ui.DynamicItem[discord.ui.Select], template=r"hwc:(?P<user_id>\d+)"
):
    """같은 원정대 안에서 볼 캐릭터를 바꾸는 드롭다운.

    custom_id에는 소유자 id만 담는다. 캐릭터명은 한글이라 넣으면 100자 제한이
    위태롭고, 어차피 고른 값은 인터랙션의 values로 따로 들어온다.
    """

    def __init__(self, user_id: str, character: str, roster: list[dict]) -> None:
        self.user_id = user_id
        super().__init__(
            discord.ui.Select(
                placeholder="다른 캐릭터 보기",
                custom_id=f"hwc:{user_id}",
                options=[
                    discord.SelectOption(
                        label=row["character_name"][:100],
                        value=row["character_name"],
                        description=f"{row['class_name'] or ''} · {row['item_level'] or 0:,.0f}",
                        default=row["character_name"] == character,
                    )
                    for row in roster[:25]
                ],
            )
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Select, match: re.Match[str], /
    ) -> "HomeworkCharacterSelect":
        # 재시작 후 복원되는 인스턴스. 콜백이 DB에서 화면을 통째로 다시 그리므로
        # 옵션 목록은 복원할 필요가 없다.
        return cls(match["user_id"], "", [])

    async def callback(self, interaction: discord.Interaction) -> None:
        # 공개 메시지라 남도 누를 수 있다. 주인만 화면을 바꿀 수 있어야 한다.
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message(
                "본인 숙제만 넘겨볼 수 있어요.", ephemeral=True
            )
            return

        await _rerender(interaction, self.user_id, self.item.values[0])


def _pickable(
    task: homework.TaskState, item_level: float | None
) -> list[tuple[int, homework.Level]]:
    """이 캐릭터가 고를 수 있는 난이도.

    이미 찍어둔 난이도는 레벨 조건을 못 넘어도 남긴다. 안 그러면 해제할 방법이
    사라진다(카탈로그의 입장 레벨이 나중에 올라간 경우).
    """
    choices = task.content.levels_for(item_level)
    if task.done and all(index != task.cleared for index, _ in choices):
        current = task.content.levels[task.cleared - 1]
        choices = sorted([*choices, (task.cleared, current)])
    return choices


def _choices_container(
    character: str,
    tasks: list[homework.TaskState],
    item_level: float | None,
    compact: bool = False,
) -> discord.ui.Container:
    """난이도를 전부 버튼으로 깔아둔다. 고른 것만 색이 들어온다.

    난이도가 없는 컨텐츠는 이름을 라벨로 쓴 버튼 하나로 묶어서 한 줄에 몰아넣는다.
    줄마다 제목을 달면 40컴포넌트 예산이 금방 마른다.

    compact를 켜면 구분선과 일일/주간 제목을 뺀다. 보기엔 아쉽지만 컴포넌트를
    다섯 개 아낄 수 있어서, 레이드가 늘었을 때 버튼 방식을 유지하는 값이 된다.
    """
    container = discord.ui.Container()
    container.add_item(discord.ui.TextDisplay(_header(character, tasks)))

    for label, group in _grouped(tasks):
        if not compact:
            container.add_item(discord.ui.Separator())
            container.add_item(discord.ui.TextDisplay(f"**{label}**"))

        plain = [t for t in group if not t.content.levels]
        for start in range(0, len(plain), _BUTTONS_PER_ROW):
            row = discord.ui.ActionRow()
            for task in plain[start : start + _BUTTONS_PER_ROW]:
                style = (
                    discord.ButtonStyle.success if task.done else discord.ButtonStyle.secondary
                )
                row.add_item(HomeworkPick(task.task_id, 1, task.label, style))
            container.add_item(row)

        for task in (t for t in group if t.content.levels):
            choices = _pickable(task, item_level)
            if not choices:
                continue
            # 상태는 아래 버튼 색이 말해준다. 여기서 또 표시하면 중복이다.
            container.add_item(discord.ui.TextDisplay(task.label))
            row = discord.ui.ActionRow()
            for index, level in choices:
                picked = task.cleared == index
                row.add_item(
                    HomeworkPick(
                        task.task_id,
                        index,
                        level.name,
                        _level_style(index) if picked else discord.ButtonStyle.secondary,
                    )
                )
            container.add_item(row)

    if not compact:
        container.add_item(discord.ui.Separator())
    container.add_item(discord.ui.TextDisplay(_reset_text()))
    return container


def _listed_container(character: str, tasks: list[homework.TaskState]) -> discord.ui.Container:
    """Section이 40컴포넌트 상한에 안 들어갈 때 쓰는 축소판.

    목록을 텍스트 하나로 합치고 버튼은 밖의 액션로우로 뺀다. 이름이 두 번
    나오는 건 임베드 시절과 같지만, 터지는 것보다는 낫다.
    """
    container = discord.ui.Container()
    container.add_item(discord.ui.TextDisplay(_header(character, tasks)))
    lines = []
    for label, group in _grouped(tasks):
        lines.append(f"**{label}**")
        for t in group:
            mark = "[v]" if t.done else "[ ]"
            suffix = f" ({t.level_name})" if t.level_name else ""
            lines.append(f"{mark} {t.label}{suffix}")
    container.add_item(discord.ui.Separator())
    container.add_item(discord.ui.TextDisplay("\n".join(lines)))
    container.add_item(discord.ui.Separator())
    container.add_item(discord.ui.TextDisplay(_reset_text()))
    return container


def _item_level_of(roster: list[dict], character: str) -> float | None:
    return next(
        (c["item_level"] for c in roster if c["character_name"] == character), None
    )


def homework_layout(
    character: str, tasks: list[homework.TaskState], user_id: str, roster: list[dict]
) -> discord.ui.LayoutView:
    if not tasks:
        return common.notice_view(
            f"{character} 의 숙제가 비어 있어요",
            "`/숙제설정` 으로 캐릭터를 다시 등록해주세요.",
        )

    item_level = _item_level_of(roster, character)

    # 컴포넌트 상한은 discord.py가 세어준다. 직접 계산해서 맞추면 라이브러리 쪽 셈이
    # 바뀔 때 조용히 어긋나므로, 넘치면 그때 한 단계씩 물러서는 쪽을 택했다.
    # 난이도 버튼을 최대한 지키고, 정 안 되면 버튼 하나를 돌리는 옛 방식으로 간다.
    for compact in (False, True):
        try:
            view = discord.ui.LayoutView(timeout=None)
            view.add_item(_choices_container(character, tasks, item_level, compact))
            return _with_switcher(view, user_id, character, roster)
        except ValueError:
            continue

    view = discord.ui.LayoutView(timeout=None)
    view.add_item(_listed_container(character, tasks))
    for start in range(0, min(len(tasks), _MAX_BUTTONS), _BUTTONS_PER_ROW):
        row = discord.ui.ActionRow()
        for task in tasks[start : start + _BUTTONS_PER_ROW]:
            # 목록이 따로 있는 레이아웃이라 버튼에는 컨텐츠 이름이 필요하다
            _, style = _button_face(task)
            row.add_item(HomeworkToggle(task.task_id, task.label, style))
        view.add_item(row)
    return _with_switcher(view, user_id, character, roster)


def _with_switcher(
    view: discord.ui.LayoutView, user_id: str, character: str, roster: list[dict]
) -> discord.ui.LayoutView:
    if len(roster) > 1:
        view.add_item(
            discord.ui.ActionRow(HomeworkCharacterSelect(user_id, character, roster))
        )
    return view


async def _rerender(interaction: discord.Interaction, user_id: str, character: str) -> None:
    # 캐릭터를 넘길 때도 목록을 맞춘다. 안 그러면 처음 연 캐릭터만 갱신된다.
    await homework.sync_contents(user_id, character)
    tasks = await homework.load_tasks(user_id, character)
    roster = homework.same_roster(await homework.list_characters(user_id), character)
    view = homework_layout(character, tasks, user_id, roster)
    try:
        await interaction.response.edit_message(view=view, embed=None)
    except discord.HTTPException:
        # V2 전환 전에 보낸 임베드 메시지는 V2로 갈아끼울 수 없다(메시지 플래그가
        # 고정이다). 옛 메시지의 버튼을 누른 경우이므로 새로 열라고 안내한다.
        notice = common.notice_view("이 메시지는 옛 형식이에요", "`/숙제` 를 다시 열어주세요.")
        # edit이 실패하면 인터랙션이 응답되지 않은 채로 남는다. followup부터 부르면
        # 404가 나므로 어느 쪽인지 확인하고 보낸다.
        if interaction.response.is_done():
            await interaction.followup.send(view=notice, ephemeral=True)
        else:
            await interaction.response.send_message(view=notice, ephemeral=True)

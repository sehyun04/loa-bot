import discord
from discord import app_commands
from discord.ext import commands

from run.services import refine
from run.views import common, refine_view

_TYPE_CHOICES = [
    app_commands.Choice(name=label, value=value)
    for value, label in refine.ITEM_TYPE_LABELS.items()
]
_GRADE_CHOICES = [
    app_commands.Choice(name=label, value=grade)
    for grade, label in refine.GRADE_LABELS.items()
]

# 등급을 안 주면 지금 대부분이 재련하고 있는 최신 등급으로 본다. 헤더에 등급을 크게
# 적어 두니 다른 장비를 물어본 사람은 바로 알아채고 드롭다운으로 바꿀 수 있다.
_DEFAULT_GRADE = "t4_1730"


class RefineCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    async def _level_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[int]]:
        grade = getattr(interaction.namespace, "등급", None) or _DEFAULT_GRADE
        item_type = getattr(interaction.namespace, "부위", None) or "weapon"
        levels = refine.levels(item_type, grade)
        matches = [x for x in levels if not current or str(x).startswith(current)]
        return [
            app_commands.Choice(name=f"+{level - 1} → +{level}", value=level)
            for level in matches[:25]
        ]

    @app_commands.command(name="재련", description="재련 성공까지 평균 몇 번, 몇 골드 드는지 계산합니다")
    @app_commands.describe(
        부위="무기와 방어구는 재료도 확률도 다릅니다",
        단계="목표 단계. 22를 고르면 +21에서 +22로 가는 계산입니다",
        등급="장비 등급 (기본값: T4 1730)",
        기운="지금까지 쌓인 장인의 기운 (%)",
        누적="실패가 쌓여 이미 올라간 확률 (%). 재련 창에 표시된 값",
        지원="영지 연구·성장 지원처럼 추가로 붙은 확률 (%)",
    )
    @app_commands.choices(부위=_TYPE_CHOICES, 등급=_GRADE_CHOICES)
    @app_commands.autocomplete(단계=_level_autocomplete)
    async def refine_cost(
        self,
        interaction: discord.Interaction,
        부위: app_commands.Choice[str],
        단계: int,
        등급: app_commands.Choice[str] | None = None,
        기운: app_commands.Range[float, 0.0, 99.9] = 0.0,
        누적: app_commands.Range[float, 0.0, 100.0] = 0.0,
        지원: app_commands.Range[float, 0.0, 100.0] = 0.0,
    ) -> None:
        request = refine.Request(
            item_type=부위.value,
            grade=등급.value if 등급 else _DEFAULT_GRADE,
            target=단계,
            jangin=기운 / 100,
            prob_from_failure=누적 / 100,
            extra_prob=지원 / 100,
        )

        # 재료 종류마다 거래소를 한 번씩 찌르니 3초를 넘길 수 있다.
        await interaction.response.defer()
        try:
            report = await refine.report(request)
        except ValueError as exc:
            await interaction.followup.send(
                view=common.error_view("계산할 수 없어", str(exc)), ephemeral=True
            )
            return

        await interaction.followup.send(view=refine_view.RefineView(report))

import unittest

import discord

from run.cogs import ask
from run.services import help as help_svc
from run.views import help_view


def _registered() -> set[str]:
    """봇을 띄우지 않고 등록될 커맨드 이름을 모은다.

    CogMeta 가 클래스 만들 때 __cog_app_commands__ 를 채워 두므로 인스턴스가 필요 없다.
    (MerchantCog 는 __init__ 에서 루프를 돌려서 인스턴스를 못 만든다.)
    """
    from run.cogs import (
        character,
        gauntlet,
        gemnave,
        hellreward,
        homework,
        market,
        merchant,
        refine,
        specup,
    )

    cogs = [
        character.CharacterCog,
        gauntlet.GauntletCog,
        gemnave.GemnaveCog,
        hellreward.HellRewardCog,
        homework.HomeworkCog,
        market.MarketCog,
        merchant.MerchantCog,
        refine.RefineCog,
        specup.SpecUpCog,
    ]
    return {c.name for cog in cogs for c in cog.__cog_app_commands__}


class HelpCoversCommandsTest(unittest.TestCase):
    """자료가 코드와 어긋나면 봇이 없는 기능을 안내하게 된다."""

    def test_every_command_has_help(self) -> None:
        self.assertEqual(_registered() - set(help_svc.command_names()), set())

    def test_no_help_for_missing_command(self) -> None:
        self.assertEqual(set(help_svc.command_names()) - _registered(), set())

    def test_usage_starts_with_the_command(self) -> None:
        for c in help_svc.commands():
            self.assertTrue(c["usage"].startswith(f"/{c['name']}"), c["name"])

    def test_every_command_lands_in_a_known_group(self) -> None:
        groups = {g for g, _ in help_svc.grouped()}
        for c in help_svc.visible():
            self.assertIn(c["group"], groups, c["name"])


class FactSheetTest(unittest.TestCase):
    def test_mentions_every_visible_command(self) -> None:
        sheet = help_svc.fact_sheet()
        for c in help_svc.visible():
            self.assertIn(c["usage"], sheet, c["name"])

    def test_router_prompt_carries_the_sheet(self) -> None:
        from run.services import llm_router

        self.assertIn(help_svc.fact_sheet(), llm_router.SYSTEM)


class HelpViewTest(unittest.TestCase):
    """V2 화면은 컴포넌트 40개가 상한이다. 커맨드가 늘면 여기서 먼저 걸린다."""

    @staticmethod
    def _count(node: dict) -> int:
        total = 1
        for key in ("components", "accessory"):
            value = node.get(key)
            if isinstance(value, list):
                total += sum(HelpViewTest._count(x) for x in value)
            elif isinstance(value, dict):
                total += HelpViewTest._count(value)
        return total

    def _components(self, view: discord.ui.LayoutView) -> int:
        return sum(self._count(c) for c in view.to_components())

    def test_overview_fits(self) -> None:
        self.assertLessEqual(self._components(help_view.build_overview()), 40)

    def test_every_topic_fits(self) -> None:
        for c in help_svc.visible():
            self.assertLessEqual(self._components(help_view.build_topic(c)), 40, c["name"])

    def test_no_accent_colour(self) -> None:
        # 색 줄이 붙으면 임베드와 구별이 안 된다(.claude/skills/discord-v2).
        # 키 자체는 discord.py 가 항상 넣으므로 값이 비어 있는지를 본다.
        for payload in help_view.build_overview().to_components():
            self.assertIsNone(payload.get("accent_color"))


class HelpRoutingTest(unittest.IsolatedAsyncioTestCase):
    async def test_no_topic_gives_overview(self) -> None:
        view = (await ask._help())["view"]
        self.assertIn("니나브", self._first_text(view))

    async def test_topic_gives_detail(self) -> None:
        view = (await ask._help("숙제"))["view"]
        self.assertIn("/숙제", self._first_text(view))

    async def test_slash_prefix_is_tolerated(self) -> None:
        view = (await ask._help("/떠상"))["view"]
        self.assertIn("/떠상", self._first_text(view))

    async def test_unknown_topic_falls_back_to_overview(self) -> None:
        view = (await ask._help("없는커맨드xyz"))["view"]
        self.assertIn("니나브", self._first_text(view))

    @staticmethod
    def _first_text(view: discord.ui.LayoutView) -> str:
        return next(c.content for c in view.walk_children() if hasattr(c, "content"))


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import datetime, timedelta

from run.cogs import ask
from run.services.merchant import schedule as sch
from run.utils.timez import KST


def _at(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=KST)


class WindowForGroupTest(unittest.TestCase):
    """그룹으로 좁힌 창 조회. 전체 조회와 달리 하루를 넘길 수 있는 게 핵심이다."""

    def test_active_window_only_counts_matching_group(self) -> None:
        # 2026-09-07(월) 17시 - 16:00 창은 1·2그룹만 돈다
        now = _at(9, 7, 17)
        self.assertIsNotNone(sch.active_window_for(now, [1]))
        self.assertIsNotNone(sch.active_window_for(now, [2]))
        self.assertIsNone(sch.active_window_for(now, [3]))

    def test_next_window_for_skips_other_groups(self) -> None:
        now = _at(9, 7, 17)
        nxt = sch.next_window_for(now, [3])
        self.assertEqual(nxt.start, _at(9, 7, 22))
        self.assertIn(3, nxt.groups)

    def test_next_window_never_empty_across_a_week(self) -> None:
        # 한 그룹으로 좁히면 다음 창이 하루 뒤일 수 있어 탐색 범위를 일주일로 잡았다.
        # 어느 시각에서 물어도 비지 않아야 한다.
        moment = _at(9, 7, 0)
        for _ in range(24 * 8):
            for group in (1, 2, 3):
                self.assertIsNotNone(sch.next_window_for(moment, [group]), (moment, group))
            moment += timedelta(hours=1)

    def test_next_window_is_in_the_future(self) -> None:
        now = _at(9, 7, 17)
        for group in (1, 2, 3):
            self.assertGreater(sch.next_window_for(now, [group]).start, now)


class SellersTest(unittest.TestCase):
    def test_catalog_covers_more_than_cards(self) -> None:
        self.assertGreater(len(sch.item_catalog()), len(sch.card_names()))

    def test_regions_selling_known_card(self) -> None:
        regions = sch.regions_selling("발탄")
        self.assertTrue(regions)
        self.assertEqual({r.name for r in regions}, {"루테란 동부"})

    def test_every_catalog_name_has_a_seller(self) -> None:
        for name in sch.item_catalog():
            self.assertTrue(sch.regions_selling(name), name)

    def test_unknown_item_has_no_seller(self) -> None:
        self.assertEqual(sch.regions_selling("없는물건"), ())


class ResolveNameTest(unittest.TestCase):
    def test_exact(self) -> None:
        self.assertEqual(ask._resolve_name("발탄", sch.item_catalog()), "발탄")

    def test_kind_suffix_is_dropped(self) -> None:
        # 카탈로그는 '발탄'만 들고 있는데 사람은 '발탄 카드'라고 부른다
        for text in ("발탄 카드", "발탄카드", "발탄 아이템"):
            self.assertEqual(ask._resolve_name(text, sch.item_catalog()), "발탄", text)

    def test_ambiguous_returns_candidates(self) -> None:
        hits = ask._resolve_name("카", sch.item_catalog())
        self.assertIsInstance(hits, list)
        self.assertGreater(len(hits), 1)

    def test_unknown_returns_empty_list(self) -> None:
        self.assertEqual(ask._resolve_name("없는물건xyz", sch.item_catalog()), [])


class RouterWiringTest(unittest.TestCase):
    def test_every_tool_has_a_handler(self) -> None:
        from run.services import llm_router

        self.assertEqual({t["name"] for t in llm_router.TOOLS}, set(ask._HANDLERS))


if __name__ == "__main__":
    unittest.main()

"""스펙업에 붙는 재련 골드 검증.

시세를 타는 부분은 거래소를 부르지 않고 test_refine 의 고정 가격표로 바꿔 끼운다.
"""

import asyncio
import unittest
from unittest import mock

from run.services import refine, specup
from tests.test_refine import PRICES


def offline_report(request: refine.Request) -> refine.Report:
    return refine.evaluate(request, PRICES)


async def _fake_report(request: refine.Request) -> refine.Report:
    return offline_report(request)


def price(item: specup.SpecUpItem, grade: str) -> specup.SpecUpItem:
    with mock.patch.object(refine, "report", _fake_report):
        return asyncio.run(specup._priced_refine(item, grade))


EQUIPMENT = [
    {"Type": "무기", "Name": "+20 운명의 대검"},
    {"Type": "투구", "Name": "+22 운명의 투구"},
    {"Type": "상의", "Name": "+21 운명의 상의"},
    {"Type": "하의", "Name": "+21 운명의 하의"},
    {"Type": "장갑", "Name": "+22 운명의 장갑"},
    {"Type": "어깨", "Name": "+22 운명의 어깨"},
    {"Type": "완갑", "Name": "+4 운명의 완갑"},
]


class RefineStepTest(unittest.TestCase):
    def setUp(self) -> None:
        self.levels = specup._refine_levels(EQUIPMENT)

    def test_armor_group_carries_piece_count(self) -> None:
        items = specup._armor_items(self.levels)
        self.assertEqual(len(items), 1)
        # 상의·하의가 +21로 같이 처져 있으니 한 항목에 두 부위다.
        self.assertEqual(items[0].refine_step, ("armor", 22, 2))

    def test_weapon_carries_its_own_step(self) -> None:
        item = specup._weapon_item(self.levels)
        self.assertEqual(item.refine_step, ("weapon", 21, 1))

    def test_gauntlet_has_no_gold(self) -> None:
        item = specup._gauntlet_item(self.levels)
        self.assertIsNone(item.refine_step)
        self.assertIsNone(item.gold)
        self.assertIn("완갑", item.gold_note)


class RefineGoldTest(unittest.TestCase):
    def test_gold_is_multiplied_by_piece_count(self) -> None:
        items = specup._armor_items(specup._refine_levels(EQUIPMENT))
        priced = price(items[0], "t4_1730")

        one_piece = offline_report(refine.Request("armor", "t4_1730", 22)).recommended
        self.assertAlmostEqual(priced.gold, one_piece.expected_cost * 2)
        self.assertIn("T4 1730", priced.gold_note)
        self.assertIn("x 2", priced.gold_note)

    def test_single_piece_note_has_no_multiplier(self) -> None:
        priced = price(specup._weapon_item(specup._refine_levels(EQUIPMENT)), "t4_1730")
        self.assertNotIn("x 1", priced.gold_note)

    def test_step_missing_from_table_keeps_gold_empty(self) -> None:
        """장비 등급을 아이템 레벨로 추정하다 보니 표에 없는 단계가 나올 수 있다."""
        item = specup._weapon_item(specup._refine_levels(EQUIPMENT))
        priced = price(item, "t3_1250")  # 3~16단계밖에 없는 표
        self.assertIsNone(priced.gold)


class GradeGuessTest(unittest.TestCase):
    def test_thresholds(self) -> None:
        self.assertEqual(refine.grade_for_item_level(1753.33), "t4_1730")
        self.assertEqual(refine.grade_for_item_level(1620.0), "t4_1590")
        self.assertEqual(refine.grade_for_item_level(1575.0), "t3_1525")
        self.assertEqual(refine.grade_for_item_level(1400.0), "t3_1390")
        self.assertEqual(refine.grade_for_item_level(1302.5), "t3_1250")
        self.assertIsNone(refine.grade_for_item_level(None))


if __name__ == "__main__":
    unittest.main()

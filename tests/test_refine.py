"""재련 계산 검증.

기대값은 원본인 loa-calc(icepeng)의 TypeScript 계산기를 node 로 직접 돌려 받아
적었다. 이 숫자가 흔들리면 포팅이 원본과 갈라진 것이다.
"""

import unittest

from run.services import refine

# 시세가 움직여도 기대값이 안 흔들리게 고정한 가격표 (개당 골드).
PRICES = {
    "운명파편": 0.05, "파편": 0.018, "상급아비도스": 184.0, "아비도스": 136.0,
    "중급오레하": 50.0, "상급오레하": 80.0, "최상급오레하": 120.0,
    "운돌": 3.0, "위운돌": 11.0, "명돌": 5.0, "위명돌": 6.0, "경명돌": 8.0, "찬명돌": 20.0,
    "운명의수호석": 0.18, "운명의파괴석": 2.34, "운명의수호석결정": 1.02,
    "운명의파괴석결정": 11.98,
    "수결": 0.5, "파결": 1.2, "수호강석": 0.3, "파괴강석": 0.9,
    "정제된수호강석": 0.5, "정제된파괴강석": 1.5,
    "용암": 249.0, "빙하": 238.0, "은총": 30.0, "축복": 60.0, "가호": 200.0,
    "골드": 1.0,
}
PRICES.update({
    craft + book: 137.0
    for craft in ("재봉술", "야금술")
    for book in ("기본", "응용", "심화", "숙련", "특화", "전문", "복합", "업화A", "업화B", "업화C")
})


def evaluate(item_type, grade, target, **kwargs) -> refine.Report:
    return refine.evaluate(refine.Request(item_type, grade, target, **kwargs), PRICES)


class TableTest(unittest.TestCase):
    def test_amount_and_prob(self) -> None:
        table = refine.get_table("weapon", "t4_1730", 22)
        self.assertEqual(table.base_prob, 0.01)
        self.assertEqual(table.additional_prob, 0.0)
        self.assertEqual(table.amount, {
            "운명의파괴석결정": 3800, "위운돌": 39, "상급아비도스": 42,
            "운명파편": 35520, "골드": 9050,
        })
        self.assertEqual(table.breath, {"용암": (25, 0.0004)})

    def test_super_express_discount_stops_at_its_range(self) -> None:
        """할인 구간을 벗어나면 표 값이 그대로 나가야 한다."""
        inside = refine.get_table("armor", "t3_1390", 20)
        outside = refine.get_table("armor", "t3_1390", 21)
        self.assertEqual(inside.additional_prob, inside.base_prob)
        self.assertEqual(outside.additional_prob, 0.0)
        # 20단계는 절반 할인(780 -> 390), 21단계는 표에 적힌 810이 그대로 나간다.
        self.assertEqual(inside.amount["수호강석"], 390)
        self.assertEqual(outside.amount["수호강석"], 810)

    def test_unknown_target(self) -> None:
        with self.assertRaises(ValueError):
            refine.get_table("weapon", "t4_1730", 30)

    def test_levels_and_grades(self) -> None:
        self.assertEqual(refine.levels("weapon", "t4_1730")[0], 11)
        self.assertEqual(refine.grades("weapon")[0], "t4_1730")


class ExpectedCostTest(unittest.TestCase):
    """숫자는 전부 loa-calc 원본을 돌려 받은 값이다."""

    def assert_strategy(self, strategy, cost, tries, ceiling) -> None:
        self.assertAlmostEqual(strategy.expected_cost, cost, places=4)
        self.assertAlmostEqual(strategy.expected_tries, tries, places=8)
        self.assertEqual(strategy.ceiling_tries, ceiling)

    def test_weapon_t4_1730_22(self) -> None:
        report = evaluate("weapon", "t4_1730", 22)
        self.assert_strategy(report.strategies[0], 3041559.9869632605, 47.1508516434, 112)
        self.assert_strategy(report.strategies[1], 2224497.8677757462, 31.4594434649, 75)
        self.assertEqual(report.recommended.breaths, {"용암": 25})

    def test_armor_t4_1590_11(self) -> None:
        report = evaluate("armor", "t4_1590", 11)
        self.assert_strategy(report.strategies[0], 13581.3916919275, 6.6380213548, 15)
        self.assert_strategy(report.strategies[1], 9092.7071094663, 4.1705157722, 10)
        self.assert_strategy(report.strategies[2], 20752.2024062864, 3.0315527231, 8)
        # 확률만 보면 풀숨이 제일 좋지만 책값이 비싸서 가운데가 싸다.
        self.assertEqual(report.best, 1)

    def test_weapon_t3_1525_25(self) -> None:
        report = evaluate("weapon", "t3_1525", 25)
        self.assert_strategy(report.strategies[0], 1253927.8906614338, 91.3209446261, 219)
        self.assert_strategy(report.strategies[3], 768572.1221675072, 45.7392395456, 110)

    def test_jangin_shortens_everything(self) -> None:
        report = evaluate("weapon", "t4_1730", 15, jangin=0.9)
        self.assert_strategy(report.strategies[0], 206460.9609327932, 5.3616335931, 6)
        self.assert_strategy(report.strategies[1], 149737.7223325440, 3.5312806400, 4)

    def test_prob_from_failure_raises_first_try(self) -> None:
        plain = evaluate("weapon", "t4_1730", 22).no_breath
        stacked = evaluate("weapon", "t4_1730", 22, prob_from_failure=0.01).no_breath
        self.assertAlmostEqual(plain.try_prob, 0.01)
        self.assertAlmostEqual(stacked.try_prob, 0.02)
        self.assertLess(stacked.expected_cost, plain.expected_cost)

    def test_extra_prob_is_added_on_top(self) -> None:
        boosted = evaluate("weapon", "t4_1730", 22, extra_prob=0.005).no_breath
        self.assertAlmostEqual(boosted.try_prob, 0.015)

    def test_jangin_must_be_below_full(self) -> None:
        with self.assertRaises(ValueError):
            evaluate("weapon", "t4_1730", 22, jangin=1.0)


class BreathTest(unittest.TestCase):
    def test_first_option_is_no_breath(self) -> None:
        report = evaluate("weapon", "t4_1730", 22)
        self.assertEqual(report.no_breath.breaths, {})
        self.assertAlmostEqual(report.no_breath.try_prob, report.table.base_prob)

    def test_breath_boost_caps_at_base_prob(self) -> None:
        """숨결로 올릴 수 있는 확률은 기본 확률만큼이 상한이다."""
        report = evaluate("weapon", "t4_1730", 22)
        table = report.table
        self.assertAlmostEqual(
            report.full_breath.try_prob, table.base_prob * 2, places=4
        )

    def test_cheaper_breath_comes_first(self) -> None:
        report = evaluate("weapon", "t3_1525", 25)
        # 확률당 가격이 싼 순서로 쌓이므로 뒤로 갈수록 1회 비용이 는다.
        costs = [s.try_cost for s in report.strategies]
        self.assertEqual(costs, sorted(costs))


class GauntletCompatTest(unittest.TestCase):
    """완갑은 자기 표를 들고 와서 simulate 만 빌려 쓴다."""

    def test_simulate_matches_table_path(self) -> None:
        table_side = evaluate("weapon", "t4_1730", 22).no_breath
        bare = refine.simulate(0.01, cost_per_try=table_side.try_cost)
        self.assertAlmostEqual(bare.expected_tries, table_side.expected_tries)
        self.assertAlmostEqual(bare.expected_cost, table_side.expected_cost)

    def test_rejects_impossible_prob(self) -> None:
        with self.assertRaises(ValueError):
            refine.simulate(0.0)


class RequestTest(unittest.TestCase):
    def test_grade_change_clamps_target(self) -> None:
        request = refine.Request("weapon", "t4_1730", 25)
        moved = request.with_grade("t3_1250")  # 3~16단계밖에 없다
        self.assertEqual(moved.target, 16)

    def test_item_type_change_keeps_target(self) -> None:
        request = refine.Request("weapon", "t4_1730", 22, jangin=0.3)
        moved = request.with_item_type("armor")
        self.assertEqual((moved.item_type, moved.target, moved.jangin), ("armor", 22, 0.3))


if __name__ == "__main__":
    unittest.main()

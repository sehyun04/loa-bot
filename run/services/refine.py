"""재련 기대 비용 계산.

재련은 실패해도 재료가 그대로 나가고, 실패할수록 성공 확률과 장인의 기운이 함께
오른다. 그래서 "성공까지 평균 몇 골드"는 확률의 역수(1/p)가 아니라 실패 상태를
따라가며 누적해야 나온다. 로펙·로아업이 스펙업 효율표에서 쓰는 계산이 이것이다.
"""

from dataclasses import dataclass

# 재련에 실패하면 "기본 성공 확률의 46.5%"만큼이 성공 확률과 장인의 기운에 각각
# 누적된다. 게임에 고정된 값이라 패치 전까진 안 바뀐다.
FAIL_GAIN_RATIO = 0.465

# 장인의 기운이 이 값에 닿으면 다음 시도는 확정 성공한다 - 유저들이 "장기백"이라
# 부르는 천장이다.
ARTISAN_FULL = 1.0

# 실패로 인한 성공률 증가에는 상한이 있다. 공식 가이드가 "실패로 인한 성공률 증가가
# 최대치에 도달할 경우, 성공률이 더 이상 상승하지 않습니다"라고 못박아 뒀고, 로펙도
# 실패 횟수를 10에서 자른다. 이 상한이 없으면 확률이 계속 올라 성공까지의 횟수를
# 실제보다 적게 잡는다.
#
# 장인의 기운은 여기 걸리지 않고 계속 쌓인다. 그래서 확률이 멈춘 뒤에도 기운은
# 차오르고, 결국 장기백이 실제로 도달 가능한 천장이 된다.
FAIL_STACK_CAP = 10

# 확률이 0에 가까우면 시도 횟수가 발산한다. 게임에 그런 재련은 없지만, 잘못 입력된
# 값으로 계산이 멈추지 않게 막아둔다.
_MAX_TRIES = 10_000


@dataclass(frozen=True)
class Attempt:
    """성공까지 n번째 시도가 될 경우의 상태."""

    index: int  # 1부터 세는 시도 순번
    success_rate: float  # 이 시도의 성공 확률
    artisan: float  # 이 시도 직전의 장인의 기운
    guaranteed: bool  # 장인의 기운이 꽉 차서 확정 성공하는 시도인지


@dataclass(frozen=True)
class RefineOutcome:
    attempts: tuple[Attempt, ...]
    expected_tries: float
    max_tries: int  # 장기백 - 최악의 경우에도 여기서는 끝난다
    median_tries: int  # 절반은 이 횟수 안에 끝난다
    unlucky_tries: int  # 90%가 이 횟수 안에 끝난다
    first_try_rate: float
    cost_per_try: float | None
    # 순환/전이 돌파석을 쓰는 특수 재련은 실패해도 확률과 기운이 오르지 않아서
    # 천장이 없다. 그때는 계산을 도중에 끊은 것이라 max_tries 를 "확정"으로
    # 말하면 안 된다.
    has_ceiling: bool
    # 실패 1회당 오른 폭. 화면에서 attempts 를 뒤져 역산하지 않도록 그대로 실어 보낸다
    # - 확률이 상한에 걸린 구간에서는 역산값이 0이 나와 기운 상승까지 같이 지워진다.
    fail_gain: float

    @property
    def expected_cost(self) -> float | None:
        if self.cost_per_try is None:
            return None
        return self.expected_tries * self.cost_per_try

    @property
    def max_cost(self) -> float | None:
        """장기백까지 갔을 때 실제로 나가는 골드."""
        if self.cost_per_try is None:
            return None
        return self.max_tries * self.cost_per_try


def _percentile_tries(cumulative: list[float], target: float) -> int:
    for i, acc in enumerate(cumulative, start=1):
        if acc >= target:
            return i
    return len(cumulative)


def simulate(
    base_rate: float,
    *,
    cost_per_try: float | None = None,
    artisan: float = 0.0,
    fail_gain: float | None = None,
) -> RefineOutcome:
    """base_rate 는 실패 누적이 없는 상태의 성공 확률(0~1).

    이미 몇 번 실패해서 장인의 기운이 쌓여 있다면 artisan 에 그 값(0~1)을 준다.
    실패 1회당 오르는 폭은 기본 확률에서 유도하지만, 숨결 같은 보조 재료를 쓰면
    더 크게 오르므로 fail_gain 으로 직접 넣을 수도 있다.
    """
    if not 0 < base_rate <= 1:
        raise ValueError("성공 확률은 0 초과 1 이하여야 해요")
    if not 0 <= artisan < ARTISAN_FULL:
        raise ValueError("장인의 기운은 0 이상 100% 미만이어야 해요")

    gain = base_rate * FAIL_GAIN_RATIO if fail_gain is None else fail_gain
    if gain < 0:
        raise ValueError("실패 시 상승폭은 음수일 수 없어요")

    # 기운이 이미 쌓여 있다는 건 그만큼 실패했다는 뜻이고, 성공 확률도 같은 폭으로
    # 올라가 있다. 기운을 상승폭으로 나누면 그 실패 횟수가 나온다.
    failed = artisan / gain if gain > 0 else 0.0

    attempts: list[Attempt] = []
    cumulative: list[float] = []  # n번째 시도까지 성공했을 누적 확률
    expected = 0.0
    survive = 1.0  # 직전까지 전부 실패했을 확률
    acc = 0.0

    for i in range(_MAX_TRIES):
        current_artisan = min(artisan + gain * i, ARTISAN_FULL)
        guaranteed = current_artisan >= ARTISAN_FULL
        stack = min(failed + i, FAIL_STACK_CAP)
        rate = 1.0 if guaranteed else min(base_rate + gain * stack, 1.0)

        attempts.append(Attempt(
            index=i + 1, success_rate=rate, artisan=current_artisan, guaranteed=guaranteed
        ))

        hit = survive * rate
        expected += (i + 1) * hit
        acc += hit
        cumulative.append(acc)
        survive -= hit

        if rate >= 1.0:
            break

    return RefineOutcome(
        attempts=tuple(attempts),
        expected_tries=expected,
        max_tries=len(attempts),
        median_tries=_percentile_tries(cumulative, 0.5),
        unlucky_tries=_percentile_tries(cumulative, 0.9),
        first_try_rate=attempts[0].success_rate,
        cost_per_try=cost_per_try,
        has_ceiling=attempts[-1].success_rate >= 1.0,
        fail_gain=gain,
    )

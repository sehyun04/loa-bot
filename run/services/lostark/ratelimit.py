import asyncio
import time


class TokenBucket:
    """분당 요청 수를 제한한다.

    로스트아크 API의 100/min은 프로세스가 아니라 API 키 단위 한도다.
    같은 키를 다른 곳에서 쓰면 내 몫이 줄어들기 때문에, 응답 헤더가 알려주는
    잔량이 내 계산보다 적으면 그쪽을 믿고 내려잡는다.
    """

    def __init__(self, per_minute: int) -> None:
        self.capacity = float(per_minute)
        self.tokens = float(per_minute)
        self.refill_per_sec = per_minute / 60.0
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self._updated) * self.refill_per_sec)
        self._updated = now

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                self._refill()
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.refill_per_sec)

    def sync_from_header(self, remaining: int | None) -> None:
        if remaining is None:
            return
        self._refill()
        if remaining < self.tokens:
            self.tokens = float(remaining)

    @property
    def available(self) -> int:
        self._refill()
        return int(self.tokens)

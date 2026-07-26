import asyncio
import time
from typing import Any, Awaitable, Callable


class TTLCache:
    """TTL 캐시 + 중복 요청 합치기.

    같은 캐릭터를 여러 명이 동시에 조회하면 요청도 그만큼 나간다. 진행 중인
    호출이 있으면 그 결과를 같이 기다리게 해서 API 호출을 1회로 만든다.
    """

    def __init__(self) -> None:
        self._values: dict[str, tuple[Any, float]] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self.hits = 0
        self.misses = 0

    def get(self, key: str, ttl: float) -> Any | None:
        entry = self._values.get(key)
        if entry is None:
            return None
        value, stored_at = entry
        if time.monotonic() - stored_at > ttl:
            del self._values[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._values[key] = (value, time.monotonic())

    async def get_or_fetch(
        self, key: str, ttl: float, fetcher: Callable[[], Awaitable[Any]]
    ) -> Any:
        cached = self.get(key, ttl)
        if cached is not None:
            self.hits += 1
            return cached

        running = self._inflight.get(key)
        if running is not None:
            self.hits += 1
            return await asyncio.shield(running)

        self.misses += 1
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            value = await fetcher()
        except Exception as exc:
            future.set_exception(exc)
            # 대기자가 예외를 안 읽고 끝나면 경고가 뜨므로 미리 소비해둔다
            future.exception()
            raise
        else:
            self.set(key, value)
            future.set_result(value)
            return value
        finally:
            self._inflight.pop(key, None)

    def invalidate(self, key: str) -> None:
        self._values.pop(key, None)

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0

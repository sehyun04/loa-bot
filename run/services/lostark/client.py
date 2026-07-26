import asyncio
import logging
import random
import time
from typing import Any

import aiohttp

from run.core import config, errors
from run.services.lostark.cache import TTLCache
from run.services.lostark.ratelimit import TokenBucket

log = logging.getLogger("loabot.lostark")

BASE_URL = "https://developer-lostark.game.onstove.com"

# 점검 중에는 무엇을 요청해도 실패한다. 매번 두드리지 않고 잠시 통째로 쉰다.
MAINTENANCE_COOLDOWN = 300.0


class LostArkClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._session: aiohttp.ClientSession | None = None
        self._bucket = TokenBucket(config.LOA_RATE_LIMIT_PER_MIN)
        self._semaphore = asyncio.Semaphore(config.LOA_MAX_CONCURRENCY)
        self._cache = TTLCache()
        self._maintenance_until = 0.0

    async def start(self) -> None:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                base_url=BASE_URL,
                headers={
                    "accept": "application/json",
                    # 소문자 bearer + 공백 하나. 이 형식이 아니면 전부 401이다.
                    "authorization": f"bearer {self._api_key}",
                },
                timeout=aiohttp.ClientTimeout(total=config.LOA_TIMEOUT_SECONDS),
            )

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    @property
    def in_maintenance(self) -> bool:
        return time.monotonic() < self._maintenance_until

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "quota_available": self._bucket.available,
            "cache_hit_rate": round(self._cache.hit_rate, 3),
            "cache_hits": self._cache.hits,
            "cache_misses": self._cache.misses,
            "maintenance": self.in_maintenance,
        }

    async def _send(self, method: str, path: str, **kwargs) -> Any:
        if self.in_maintenance:
            raise errors.Maintenance()
        if self._session is None or self._session.closed:
            await self.start()

        await self._bucket.acquire()
        async with self._semaphore:
            assert self._session is not None
            async with self._session.request(method, path, **kwargs) as resp:
                remaining = resp.headers.get("X-RateLimit-Remaining")
                if remaining and remaining.isdigit():
                    self._bucket.sync_from_header(int(remaining))

                if resp.status == 200:
                    payload = await resp.json(content_type=None)
                    return payload

                if resp.status == 401:
                    log.error("로스트아크 API 키가 거부됐습니다 (401)")
                    raise errors.ApiKeyInvalid("API 키가 유효하지 않아요")

                if resp.status == 429:
                    reset = resp.headers.get("X-RateLimit-Reset")
                    retry_after = None
                    if reset and reset.isdigit():
                        retry_after = max(0.0, int(reset) - time.time())
                    raise errors.RateLimited(retry_after)

                if resp.status == 503:
                    self._maintenance_until = time.monotonic() + MAINTENANCE_COOLDOWN
                    raise errors.Maintenance()

                if resp.status == 404:
                    raise errors.LoaApiError(f"찾을 수 없어요 ({resp.status})")

                body = (await resp.text())[:200]
                raise errors.LoaApiError(f"API 오류 {resp.status}: {body}")

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        try:
            return await self._send(method, path, **kwargs)
        except errors.RateLimited as exc:
            # 한도 초과는 기다리면 풀린다. 단 재시도는 한 번만 — 무한 재시도는
            # 한도를 더 깎아먹고 커맨드 응답만 늦춘다.
            wait = min(exc.retry_after or 2.0, 30.0) + random.uniform(0, 0.5)
            log.warning("rate limit - %.1f초 후 재시도", wait)
            await asyncio.sleep(wait)
            return await self._send(method, path, **kwargs)
        except aiohttp.ClientError as exc:
            raise errors.LoaApiError(f"네트워크 오류: {exc}") from exc
        except TimeoutError as exc:
            raise errors.LoaApiError("응답 시간이 초과됐어요") from exc

    async def get(
        self, path: str, *, params: dict | None = None, ttl: float = 0, cache_key: str | None = None
    ) -> Any:
        if ttl <= 0:
            return await self._request("GET", path, params=params)
        key = cache_key or f"GET {path} {sorted((params or {}).items())}"
        return await self._cache.get_or_fetch(
            key, ttl, lambda: self._request("GET", path, params=params)
        )

    async def post(self, path: str, *, body: dict, ttl: float = 0) -> Any:
        if ttl <= 0:
            return await self._request("POST", path, json=body)
        key = f"POST {path} {sorted(body.items())}"
        return await self._cache.get_or_fetch(
            key, ttl, lambda: self._request("POST", path, json=body)
        )


_client: LostArkClient | None = None


def get_client() -> LostArkClient:
    if not config.has_lostark_api():
        raise errors.ApiKeyMissing("LOSTARK_API_KEY가 설정되지 않았어요")
    global _client
    if _client is None:
        _client = LostArkClient(config.LOSTARK_API_KEY)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None

"""kloa.gg(api.korlark.com) 떠상 제보 읽기.

'지금 어느 지역에서 무엇을 파는지'는 공식 API가 없고 유저 제보가 유일한 소스다.
등장 시각·지역은 스케줄로 계산되지만 **판매 품목은 서버마다 다르고 제보 없이는 알 수 없다.**

kloa가 인증 없는 공개 엔드포인트로 내주므로 그대로 읽는다. 남의 서비스이므로 두 가지를 지킨다.
  1. 반드시 캐시를 태운다. 같은 서버를 1분에 한 번보다 자주 때리지 않는다.
  2. 실패는 조용히 빈 결과로 흘린다. kloa가 죽어도 우리 봇의 나머지는 멀쩡해야 한다.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import aiohttp

from run.services.merchant import schedule as sch

log = logging.getLogger("loabot.kloa")

BASE_URL = "https://api.korlark.com"
TIMEOUT = aiohttp.ClientTimeout(total=6)
CACHE_TTL = 60.0
# 출처를 밝혀둔다. 문제가 되면 우리를 특정해서 막을 수 있어야 서로 편하다.
USER_AGENT = "loa-bot/0.1 (+https://github.com/2rami/loa-bot)"


@dataclass(frozen=True)
class Sighting:
    region_id: str
    region_name: str
    npc: str
    items: tuple[str, ...]
    reporter: str
    upvotes: int


_session: aiohttp.ClientSession | None = None
_cache: dict[int, tuple[float, tuple[Sighting, ...]]] = {}
_inflight: dict[int, asyncio.Future] = {}


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=TIMEOUT, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
        )
    return _session


async def close() -> None:
    global _session
    if _session and not _session.closed:
        await _session.close()
    _session = None


def _parse(payload: object, now: datetime) -> tuple[Sighting, ...]:
    """현재 진행 중인 윈도우의 제보만 골라낸다.

    응답은 최근 몇 개 윈도우가 함께 담긴 배열이라, 시각으로 거르지 않으면
    지난 회차의 품목을 지금 것처럼 보여주게 된다.
    """
    if not isinstance(payload, list):
        return ()

    moment = now.astimezone(timezone.utc)
    best: dict[str, Sighting] = {}

    for window in payload:
        if not isinstance(window, dict):
            continue
        try:
            start = datetime.fromisoformat(window["startTime"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(window["endTime"].replace("Z", "+00:00"))
        except (KeyError, AttributeError, ValueError):
            continue
        if not (start <= moment < end):
            continue

        for report in window.get("reports") or []:
            if not isinstance(report, dict):
                continue
            region_id = str(report.get("regionId", ""))
            region = sch.region_by_id(region_id)
            if region is None:
                continue

            names = sch.item_names(region_id, report.get("itemIds") or [])
            if not names:
                continue

            user = report.get("user") or {}
            sighting = Sighting(
                region_id=region_id,
                region_name=region.name,
                npc=region.npc,
                items=tuple(names),
                reporter=str(user.get("characterName") or "익명"),
                upvotes=int(report.get("upVoteCount") or 0),
            )
            # 한 지역에 제보가 여러 건 쌓인다. 추천을 더 받은 쪽이 맞을 확률이 높다.
            prev = best.get(region_id)
            if prev is None or sighting.upvotes > prev.upvotes:
                best[region_id] = sighting

    return tuple(best.values())


async def _fetch(server_id: int, now: datetime) -> tuple[Sighting, ...]:
    session = await _get_session()
    async with session.get(f"{BASE_URL}/lostark/merchant/reports", params={"server": server_id}) as resp:
        if resp.status != 200:
            log.warning("kloa 제보 응답 %s (server=%s)", resp.status, server_id)
            return ()
        # 서버가 text/plain 으로 주는 경우가 있어 content_type 검사를 끈다
        payload = await resp.json(content_type=None)
    return _parse(payload, now)


async def sightings(server_name: str, now: datetime) -> tuple[Sighting, ...]:
    """서버 이름으로 현재 윈도우의 제보를 가져온다. 실패하면 빈 튜플."""
    server_id = sch.server_id(server_name)
    if server_id is None:
        return ()

    cached = _cache.get(server_id)
    if cached and time.monotonic() - cached[0] < CACHE_TTL:
        return cached[1]

    # 여러 사람이 동시에 /떠상을 쳐도 실제 요청은 한 번만 나간다
    running = _inflight.get(server_id)
    if running is not None:
        return await running

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _inflight[server_id] = future
    try:
        result = await _fetch(server_id, now)
        _cache[server_id] = (time.monotonic(), result)
        future.set_result(result)
        return result
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        log.warning("kloa 제보 조회 실패 (server=%s): %s", server_name, exc)
        future.set_result(())
        return ()
    finally:
        _inflight.pop(server_id, None)

"""포트폴리오 사이트에 붙어 질문을 받아온다.

이 봇은 오라클 무료 인스턴스에 있고 인바운드 포트가 하나도 열려 있지 않다.
deploy/setup-server.sh 가 "봇은 아웃바운드만 쓴다"는 전제로 방화벽을 안 여는데,
포트를 열려면 오라클 콘솔을 고쳐야 하고 그러고도 Cloudflare 와 인스턴스 사이가
평문이라 키가 경로에 노출된다. 대신 방향을 뒤집었다 — 우리가 사이트로 붙는다.

나가는 연결이라 방화벽을 건드릴 이유가 없고, HTTPS 라 구간이 전부 암호화된다.

답을 만드는 건 service.answer 다. 여기는 그걸 어떻게 주고받는지만 담당한다 —
나중에 도메인이 생겨 터널로 바꾸면 이 파일만 끄면 되고, 이미 있는 api.py 를
켜면 같은 답이 나간다.
"""

import asyncio
import logging

import aiohttp

from run.core import config
from run.web import service

log = logging.getLogger("loabot.web")

# 롱폴링이라 서버가 25초까지 붙들고 있는다. 그보다 넉넉하게 잡아야
# 정상 대기를 타임아웃으로 오해하지 않는다.
_POLL_TIMEOUT = 40.0
_RESULT_TIMEOUT = 20.0

# 연결이 끊겼을 때 물러서는 간격. 사이트가 잠깐 흔들려도 로그를 도배하지 않는다.
_BACKOFF_START = 2.0
_BACKOFF_MAX = 60.0

# 한 번에 처리할 질문 수. 앞단에서 이미 조이고 있어 넉넉할 이유가 없고,
# 로스트아크 API 한도가 키 단위라 동시에 몰아치면 슬래시 커맨드가 밀린다.
_MAX_CONCURRENT = 2


async def _send_result(
    session: aiohttp.ClientSession, url: str, headers: dict, job_id: str, payload: dict
) -> None:
    try:
        async with session.post(
            f"{url}/api/ninav/result",
            headers=headers,
            json={"id": job_id, **payload},
            timeout=aiohttp.ClientTimeout(total=_RESULT_TIMEOUT),
        ) as res:
            if res.status != 200:
                log.warning("결과 전송 실패 (%s)", res.status)
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        # 브라우저는 어차피 타임아웃된다. 다음 질문을 받는 게 먼저다.
        log.warning("결과 전송 실패: %s", exc)


async def _handle(
    session: aiohttp.ClientSession,
    url: str,
    headers: dict,
    limiter: asyncio.Semaphore,
    job: dict,
) -> None:
    job_id = job.get("id") or ""
    async with limiter:
        try:
            payload = await service.answer(job.get("session") or "", job.get("message") or "")
        except service.Unavailable as exc:
            payload = {"error": "offline", "message": str(exc)}
        except ValueError as exc:
            payload = {"error": "body", "message": str(exc)}
        except Exception:
            log.exception("질문 처리 실패")
            payload = {"error": "unknown"}
    await _send_result(session, url, headers, job_id, payload)


async def run() -> None:
    """사이트에 계속 붙어 있는다. 취소될 때까지 돌아간다."""
    url = config.NINAV_SITE_URL.rstrip("/")
    headers = {"authorization": f"Bearer {config.WEB_API_KEY}"}
    limiter = asyncio.Semaphore(_MAX_CONCURRENT)
    backoff = _BACKOFF_START
    running: set[asyncio.Task] = set()

    log.info("니나브 폴링 시작: %s", url)

    async with aiohttp.ClientSession() as session:
        while True:
            try:
                async with session.get(
                    f"{url}/api/ninav/poll",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=_POLL_TIMEOUT),
                ) as res:
                    if res.status == 204:
                        # 일감 없이 붙들고 있다가 시간이 됐다. 곧바로 다시 붙는다.
                        backoff = _BACKOFF_START
                        continue
                    if res.status == 401:
                        # 키가 안 맞는다. 다시 붙어도 같은 결과라 로그만 남기고 쉰다.
                        log.error("폴링 인증 실패 - WEB_API_KEY 와 Worker 의 NINAV_KEY 가 다릅니다")
                        await asyncio.sleep(_BACKOFF_MAX)
                        continue
                    if res.status != 200:
                        raise aiohttp.ClientError(f"예상 못한 응답 {res.status}")
                    job = await res.json()

                backoff = _BACKOFF_START
                task = asyncio.create_task(_handle(session, url, headers, limiter, job))
                # 참조를 안 들고 있으면 GC 가 실행 중인 태스크를 거둬간다
                running.add(task)
                task.add_done_callback(running.discard)

            except asyncio.CancelledError:
                raise
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                log.warning("폴링 끊김 (%.0f초 뒤 재시도): %s", backoff, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _BACKOFF_MAX)


async def serve() -> asyncio.Task | None:
    """봇의 이벤트 루프에 폴러를 얹는다. 설정이 없으면 아무것도 하지 않는다."""
    if not config.NINAV_SITE_URL or not config.WEB_API_KEY:
        return None
    return asyncio.create_task(run(), name="ninav-poller")

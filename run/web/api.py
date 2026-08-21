"""포트폴리오 사이트가 부르는 HTTP 엔드포인트.

봇 프로세스 안에서 함께 뜬다. 별도 프로세스로 빼면 로스트아크 API의 분당
한도가 키 단위라 두 프로세스가 서로 모르는 채로 같은 할당량을 깎는다.
한 프로세스에 두면 기존 레이트리미터가 웹 요청까지 같이 센다.

이 서버는 인터넷에 직접 노출되지 않는다. 앞단의 Cloudflare Worker만 부르고,
Worker가 IP당 제한과 일일 상한을 건다. 여기 있는 검사는 그게 뚫렸을 때를
위한 두 번째 방어선이다.
"""

import asyncio
import logging
import time
from collections import OrderedDict

from run.core import config
from run.web import service

log = logging.getLogger("loabot.web")

# 앞단이 뚫렸을 때만 의미가 있는 값이라 넉넉하다. 진짜 조임은 Worker가 한다.
_WINDOW_SECONDS = 60.0
_MAX_PER_WINDOW = 20
_MAX_CLIENTS = 200

_hits: OrderedDict[str, list[float]] = OrderedDict()


def _too_many(client: str) -> bool:
    now = time.monotonic()
    recent = [t for t in _hits.get(client, []) if now - t < _WINDOW_SECONDS]
    recent.append(now)
    _hits[client] = recent
    _hits.move_to_end(client)
    while len(_hits) > _MAX_CLIENTS:
        _hits.popitem(last=False)
    return len(recent) > _MAX_PER_WINDOW


def create_app():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel, Field

    app = FastAPI(title="ninav-web", docs_url=None, redoc_url=None, openapi_url=None)

    class AskRequest(BaseModel):
        # 세션은 브라우저가 만들어 보낸다. 로그인이 없으므로 신원이 아니라
        # "같은 대화인지"만 구분하는 값이다.
        session: str = Field(min_length=1, max_length=64)
        message: str = Field(min_length=1, max_length=service.MAX_QUESTION)

    def _authorize(authorization: str | None) -> None:
        expected = config.WEB_API_KEY
        if not expected:
            raise HTTPException(status_code=503, detail="web api disabled")
        if authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="invalid key")

    @app.get("/web/health")
    async def health(authorization: str | None = Header(default=None)) -> dict:
        _authorize(authorization)
        return {"ok": True, "tools": sorted(service.WEB_TOOLS)}

    @app.post("/web/ask")
    async def ask(
        body: AskRequest, authorization: str | None = Header(default=None)
    ) -> dict:
        _authorize(authorization)

        if _too_many(body.session):
            raise HTTPException(status_code=429, detail="too many requests")

        try:
            return await service.answer(body.session, body.message)
        except service.Unavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception:
            # 스택트레이스가 응답으로 나가면 안 된다. 로그에만 남긴다.
            log.exception("웹 질의 처리 실패")
            raise HTTPException(status_code=500, detail="internal error") from None

    return app


async def serve() -> asyncio.Task | None:
    """봇의 이벤트 루프에 웹 서버를 얹는다. 키가 없으면 아무것도 하지 않는다."""
    if not config.WEB_API_KEY:
        log.info("WEB_API_KEY 미설정 - 웹 API를 띄우지 않습니다.")
        return None

    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(
            create_app(),
            host=config.WEB_API_HOST,
            port=config.WEB_API_PORT,
            log_level="warning",
            # 봇이 이미 로깅을 잡고 있다. uvicorn이 다시 잡으면 포맷이 갈린다.
            log_config=None,
            access_log=False,
        )
    )
    task = asyncio.create_task(server.serve(), name="web-api")
    log.info("웹 API 기동: %s:%s", config.WEB_API_HOST, config.WEB_API_PORT)
    return task

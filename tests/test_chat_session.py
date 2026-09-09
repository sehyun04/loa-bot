import pathlib
import tempfile
import time
import unittest

from run.core import config, db
from run.services import chat_session


class ChatSessionTest(unittest.IsolatedAsyncioTestCase):
    """이력은 SQLite 에 있다. 재시작해도 살아남는지가 핵심이다."""

    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self._saved = (config.DATA_DIR, config.DB_PATH)
        config.DATA_DIR = pathlib.Path(self._tmp.name)
        config.DB_PATH = config.DATA_DIR / "test.db"
        await db.amigrate()

    async def asyncTearDown(self) -> None:
        config.DATA_DIR, config.DB_PATH = self._saved
        self._tmp.cleanup()

    async def test_round_trip(self) -> None:
        await chat_session.remember("c1", "u1", "돌파석 얼마야", "조회할게요")
        self.assertEqual(
            await chat_session.history("c1", "u1"),
            [
                {"role": "user", "content": "돌파석 얼마야"},
                {"role": "assistant", "content": "조회할게요"},
            ],
        )

    async def test_survives_a_restart(self) -> None:
        # 프로세스 상태에 기대지 않는다는 뜻이다. 모듈을 다시 읽어도 같은 값이 나온다.
        await chat_session.remember("c1", "u1", "어느 서버세요", "루페온")
        import importlib

        reloaded = importlib.reload(chat_session)
        try:
            self.assertEqual(len(await reloaded.history("c1", "u1")), 2)
        finally:
            importlib.reload(chat_session)

    async def test_channels_and_users_do_not_mix(self) -> None:
        await chat_session.remember("c1", "u1", "질문A", "답A")
        await chat_session.remember("c1", "u2", "질문B", "답B")
        await chat_session.remember("c2", "u1", "질문C", "답C")
        for channel, user, expected in (("c1", "u1", "질문A"), ("c1", "u2", "질문B"), ("c2", "u1", "질문C")):
            rows = await chat_session.history(channel, user)
            self.assertEqual(rows[0]["content"], expected)

    async def test_keeps_only_the_last_turns(self) -> None:
        for i in range(chat_session.MAX_TURNS + 4):
            await chat_session.remember("c1", "u1", f"질문{i}", f"답{i}")
        rows = await chat_session.history("c1", "u1")
        self.assertEqual(len(rows), chat_session.MAX_TURNS * 2)
        self.assertEqual(rows[-2]["content"], f"질문{chat_session.MAX_TURNS + 3}")

    async def test_expired_history_is_dropped(self) -> None:
        await chat_session.remember("c1", "u1", "오래된 질문", "오래된 답")
        stale = int(time.time()) - chat_session.TTL_SECONDS - 1
        await db.aexecute("UPDATE chat_sessions SET updated_at=?", (stale,))
        self.assertEqual(await chat_session.history("c1", "u1"), [])
        # 읽으면서 지웠으므로 줄도 남지 않는다
        self.assertEqual(await db.aquery("SELECT 1 FROM chat_sessions"), [])

    async def test_forget(self) -> None:
        await chat_session.remember("c1", "u1", "질문", "답")
        await chat_session.forget("c1", "u1")
        self.assertEqual(await chat_session.history("c1", "u1"), [])

    async def test_empty_turn_is_not_stored(self) -> None:
        # 빈 content 는 API 가 400 으로 거부한다
        await chat_session.remember("c1", "u1", "질문", "")
        await chat_session.remember("c1", "u1", "", "답")
        self.assertEqual(await chat_session.history("c1", "u1"), [])

    async def test_broken_json_recovers(self) -> None:
        await chat_session.remember("c1", "u1", "질문", "답")
        await db.aexecute("UPDATE chat_sessions SET messages=?", ("{망가진",))
        self.assertEqual(await chat_session.history("c1", "u1"), [])

    async def test_missing_session_is_empty(self) -> None:
        self.assertEqual(await chat_session.history("없는채널", "없는사람"), [])


class SummarizeCallsTest(unittest.TestCase):
    def test_includes_arguments(self) -> None:
        text = chat_session.summarize_calls([("get_market_price", {"item": "돌파석"})])
        self.assertEqual(text, "get_market_price 실행 - item=돌파석")

    def test_no_argument_tool(self) -> None:
        self.assertEqual(chat_session.summarize_calls([("get_help", {})]), "get_help 실행")

    def test_does_not_leak_call_syntax(self) -> None:
        # 이력에 호출 문법을 남기면 모델이 평문으로 흘리는 걸 배운다
        text = chat_session.summarize_calls([("get_merchant", {"item": "발탄"})])
        for token in ("<", ">", "invoke", "{", "}"):
            self.assertNotIn(token, text)


if __name__ == "__main__":
    unittest.main()

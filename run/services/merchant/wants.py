import time
from dataclasses import dataclass

from run.core import db


@dataclass(frozen=True)
class Want:
    user_id: str
    guild_id: str
    channel_id: str
    server: str
    card_name: str


async def add(user_id: str, guild_id: str, channel_id: str, server: str, card_name: str) -> None:
    # 같은 (유저, 서버, 카드) 조합으로 다시 등록하면 채널만 최신으로 옮긴다
    await db.aexecute(
        "INSERT INTO merchant_card_wants "
        "  (user_id, guild_id, channel_id, server, card_name, created_at) "
        "VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(user_id, server, card_name) DO UPDATE SET "
        "  guild_id=excluded.guild_id, channel_id=excluded.channel_id, created_at=excluded.created_at",
        (user_id, guild_id, channel_id, server, card_name, int(time.time())),
    )


async def remove(user_id: str, server: str, card_name: str) -> int:
    return await db.aexecute(
        "DELETE FROM merchant_card_wants WHERE user_id=? AND server=? AND card_name=?",
        (user_id, server, card_name),
    )


async def for_user(user_id: str) -> list[Want]:
    rows = await db.aquery(
        "SELECT user_id, guild_id, channel_id, server, card_name FROM merchant_card_wants "
        "WHERE user_id=? ORDER BY server, card_name",
        (user_id,),
    )
    return [Want(**dict(r)) for r in rows]


async def all_wants() -> list[Want]:
    rows = await db.aquery(
        "SELECT user_id, guild_id, channel_id, server, card_name FROM merchant_card_wants"
    )
    return [Want(**dict(r)) for r in rows]

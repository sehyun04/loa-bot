import time

from run.core import db


async def subscribe(
    guild_id: str, channel_id: str, user_id: str, server: str | None, lead_minutes: int
) -> None:
    await db.aexecute(
        "INSERT INTO merchant_subs (user_id, guild_id, channel_id, server, lead_minutes, created_at) "
        "VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(user_id, guild_id, channel_id) DO UPDATE SET "
        "  server=excluded.server, lead_minutes=excluded.lead_minutes",
        (user_id, guild_id, channel_id, server, lead_minutes, int(time.time())),
    )


async def unsubscribe(guild_id: str, channel_id: str, user_id: str) -> int:
    return await db.aexecute(
        "DELETE FROM merchant_subs WHERE guild_id=? AND channel_id=? AND user_id=?",
        (guild_id, channel_id, user_id),
    )


async def subscriptions() -> list[dict]:
    rows = await db.aquery(
        "SELECT user_id, guild_id, channel_id, server, lead_minutes FROM merchant_subs"
    )
    return [dict(r) for r in rows]


async def unclaim(key: str) -> None:
    await db.aexecute("DELETE FROM notify_claims WHERE claim_key=?", (key,))


async def claim(key: str) -> bool:
    """이 알림을 내가 보낸다고 선점한다. 이미 보냈으면 False."""
    try:
        await db.aexecute(
            "INSERT INTO notify_claims (claim_key, claimed_at) VALUES (?,?)",
            (key, int(time.time())),
        )
        return True
    except Exception:
        return False

import json
import time
from dataclasses import dataclass

from run.core import db


@dataclass(frozen=True)
class Report:
    region: str
    npc: str | None
    items: list[str]
    reporter_id: str
    created_at: int


async def add(
    window_id: str,
    server: str,
    region: str,
    npc: str | None,
    items: list[str],
    reporter_id: str,
    guild_id: str | None,
) -> None:
    # 같은 사람이 같은 지역을 여러 번 올려도 한 건으로 유지된다
    await db.aexecute(
        "INSERT INTO merchant_reports "
        "  (window_id, server, region, npc, items, reporter_id, guild_id, created_at) "
        "VALUES (?,?,?,?,?,?,?,?) "
        "ON CONFLICT(window_id, server, region, reporter_id) DO UPDATE SET "
        "  items=excluded.items, npc=excluded.npc, created_at=excluded.created_at",
        (
            window_id,
            server,
            region,
            npc,
            json.dumps(items, ensure_ascii=False),
            reporter_id,
            guild_id,
            int(time.time()),
        ),
    )


async def active(window_id: str, server: str) -> list[Report]:
    rows = await db.aquery(
        "SELECT region, npc, items, reporter_id, created_at FROM merchant_reports "
        "WHERE window_id=? AND server=? ORDER BY created_at DESC",
        (window_id, server),
    )
    return [
        Report(
            region=r["region"],
            npc=r["npc"],
            items=json.loads(r["items"]) if r["items"] else [],
            reporter_id=r["reporter_id"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


async def purge_old(keep_windows: list[str]) -> int:
    if not keep_windows:
        return 0
    placeholders = ",".join("?" * len(keep_windows))
    return await db.aexecute(
        f"DELETE FROM merchant_reports WHERE window_id NOT IN ({placeholders})",
        tuple(keep_windows),
    )


async def subscribe(guild_id: str, channel_id: str, server: str | None, lead_minutes: int) -> None:
    await db.aexecute(
        "INSERT INTO merchant_subs (guild_id, channel_id, server, lead_minutes, created_at) "
        "VALUES (?,?,?,?,?) "
        "ON CONFLICT(guild_id, channel_id) DO UPDATE SET "
        "  server=excluded.server, lead_minutes=excluded.lead_minutes",
        (guild_id, channel_id, server, lead_minutes, int(time.time())),
    )


async def unsubscribe(guild_id: str, channel_id: str) -> int:
    return await db.aexecute(
        "DELETE FROM merchant_subs WHERE guild_id=? AND channel_id=?", (guild_id, channel_id)
    )


async def subscriptions() -> list[dict]:
    rows = await db.aquery("SELECT guild_id, channel_id, server, lead_minutes FROM merchant_subs")
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

import time

from run.core import db


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

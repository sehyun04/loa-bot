-- 제보는 등장 윈도우에 귀속된다. 윈도우가 끝나면 그 정보는 의미가 없다.
CREATE TABLE IF NOT EXISTS merchant_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    window_id   TEXT NOT NULL,
    server      TEXT NOT NULL,
    region      TEXT NOT NULL,
    npc         TEXT,
    items       TEXT,
    reporter_id TEXT NOT NULL,
    guild_id    TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (window_id, server, region, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_lookup ON merchant_reports(window_id, server);

CREATE TABLE IF NOT EXISTS merchant_subs (
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    server       TEXT,
    lead_minutes INTEGER NOT NULL DEFAULT 10,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
);

-- 같은 등장 알림을 두 번 보내지 않기 위한 기록
CREATE TABLE IF NOT EXISTS notify_claims (
    claim_key  TEXT PRIMARY KEY,
    claimed_at INTEGER NOT NULL
);

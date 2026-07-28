-- 유저가 특정 서버에서 특정 카드가 뜨면 알림받고 싶다고 등록한 목록.
-- 채널에 멘션으로 보내므로 어느 채널에서 등록했는지도 같이 저장한다.
CREATE TABLE IF NOT EXISTS merchant_card_wants (
    user_id    TEXT NOT NULL,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    server     TEXT NOT NULL,
    card_name  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, server, card_name)
);

CREATE INDEX IF NOT EXISTS idx_card_wants_server ON merchant_card_wants(server);

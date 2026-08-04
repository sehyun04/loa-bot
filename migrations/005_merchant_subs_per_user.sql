-- 떠상 알림을 채널 단위가 아니라 유저 단위로 등록한다 (카드 알림과 동일한 방식).
-- 기존 채널 단위 구독은 누가 걸었는지 기록이 없어 이어받을 수 없으니 정리하고 다시 등록받는다.
DROP TABLE IF EXISTS merchant_subs;

CREATE TABLE merchant_subs (
    user_id      TEXT NOT NULL,
    guild_id     TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    server       TEXT,
    lead_minutes INTEGER NOT NULL DEFAULT 10,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, guild_id, channel_id)
);

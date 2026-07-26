CREATE TABLE IF NOT EXISTS hw_characters (
    user_id        TEXT NOT NULL,
    character_name TEXT NOT NULL,
    server_name    TEXT,
    class_name     TEXT,
    item_level     REAL,
    sort_order     INTEGER DEFAULT 0,
    enabled        INTEGER DEFAULT 1,
    PRIMARY KEY (user_id, character_name)
);

CREATE TABLE IF NOT EXISTS hw_tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT NOT NULL,
    character_name TEXT NOT NULL,
    content_id     TEXT NOT NULL,
    gate_total     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (user_id, character_name, content_id)
);

CREATE INDEX IF NOT EXISTS idx_hw_tasks_owner ON hw_tasks(user_id, character_name);

-- 진행 상황은 '언제의 기록인지'를 period_key로 들고 있는다. 읽을 때 현재 주기와
-- 다르면 미완료로 취급하므로, 리셋 시각에 봇이 꺼져 있어도 결과가 정확하다.
CREATE TABLE IF NOT EXISTS hw_progress (
    task_id       INTEGER PRIMARY KEY REFERENCES hw_tasks(id) ON DELETE CASCADE,
    period_key    TEXT NOT NULL,
    cleared_gates INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hw_progress_period ON hw_progress(period_key);

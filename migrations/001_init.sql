CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id            TEXT PRIMARY KEY,
    merchant_channel_id TEXT,
    merchant_role_id    TEXT,
    updated_at          INTEGER
);

CREATE TABLE IF NOT EXISTS user_prefs (
    user_id        TEXT PRIMARY KEY,
    main_character TEXT,
    default_server TEXT,
    updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS command_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    command    TEXT NOT NULL,
    user_id    TEXT,
    guild_id   TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);

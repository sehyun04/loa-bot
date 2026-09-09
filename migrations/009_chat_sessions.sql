-- 멘션 대화의 맥락을 재시작 뒤에도 잇는다.
--
-- 메모리에만 두면 배포할 때마다 모두의 대화가 한꺼번에 끊긴다. 컨테이너는 main 에
-- 푸시할 때마다 새로 뜨므로 하루에도 여러 번이다. 되물어 놓고 사용자가 답하는 사이에
-- 배포가 끼면 봇이 자기가 뭘 물었는지 모른다.
CREATE TABLE IF NOT EXISTS chat_sessions (
    channel_id TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    messages   TEXT    NOT NULL,  -- JSON 배열. 도구 블록이 아니라 평문만 담는다
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);

-- 만료된 줄을 지울 때 훑는 열
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);

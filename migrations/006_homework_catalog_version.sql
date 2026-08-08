-- 이미 등록된 캐릭터는 등록 당시의 숙제 목록을 그대로 들고 있다. homework.json이
-- 바뀌어도(레이드 추가/삭제) 다시 /숙제설정 을 돌리기 전까지 옛 목록만 본다.
-- 어느 시점 카탈로그로 맞춰둔 목록인지 캐릭터마다 기록해두고, 달라졌을 때만 맞춘다.
-- NULL은 '한 번도 안 맞춤'이라 다음 /숙제 에서 갱신된다.
ALTER TABLE hw_characters ADD COLUMN catalog_version TEXT;

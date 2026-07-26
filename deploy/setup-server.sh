#!/usr/bin/env bash
# Oracle Cloud (Ubuntu, ARM) 인스턴스 최초 1회 셋업.
# 인스턴스에 SSH로 접속한 뒤 실행한다.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/2rami/loa-bot.git}"
APP_DIR="${APP_DIR:-$HOME/loa-bot}"

echo "[1/4] 패키지 갱신 및 Docker 설치"
sudo apt-get update -qq
if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    echo "  Docker 설치 완료 — 그룹 반영을 위해 재로그인이 필요할 수 있습니다"
fi

echo "[2/4] 방화벽 (아웃바운드만 쓰므로 인바운드 개방 불필요)"
# 봇은 디스코드로 나가는 연결만 쓴다. 포트를 열 이유가 없다.

echo "[3/4] 레포 클론"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
else
    git clone "$REPO_URL" "$APP_DIR"
fi

echo "[4/4] 데이터 디렉토리"
mkdir -p "$APP_DIR/data"

cat <<'GUIDE'

셋업 완료. 다음으로 시크릿을 올려야 합니다.

  방법 A) SOPS 사용 (권장)
    1. 서버 전용 age 키 생성:  age-keygen -o ~/.config/sops/age/keys.txt
    2. 출력된 공개키를 로컬 .sops.yaml 의 .env.prod.enc 규칙에 추가
    3. 로컬에서 재암호화:      sops updatekeys .env.prod.enc && git push
    4. 서버에서:               git pull && sops -d .env.prod.enc > .env

  방법 B) 직접 올리기 (간단)
    로컬에서:  scp .env ubuntu@<서버IP>:~/loa-bot/.env

그다음 실행:
    cd ~/loa-bot && docker compose up -d --build
    docker compose logs -f

GUIDE

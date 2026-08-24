# Gemma 4 E4B 라우터 파인튜닝

니나브봇의 Claude 라우터를 Gemma로 교체하기 위한 학습 자료다. 현재 봇에서 Claude는 대화를 생성하지 않고 시세 조회, 스펙 조회, 경매 계산 같은 도구를 선택한다. 따라서 먼저 도구 선택 형식을 학습한다.

## 1. 데이터 보강

`data/router_seed.json`은 파이프라인 검증용 최소 데이터다. 실제 학습 전에는 운영 질문을 개인정보 제거 후 추가하고, 표현이 겹치지 않는 평가 세트를 별도로 만든다. 최소 목표는 도구별 50개 이상, 전체 500개 이상이다.

각 assistant 답변은 다음 둘 중 하나여야 한다.

```json
{"tool_calls":[{"name":"get_market_price","arguments":{"item":"운명의 파괴석"}}]}
```

```json
{"text":"재련 성공 확률을 알려주세요."}
```

니나브 캐릭터 말투까지 넣으려면 도구 라우팅 데이터와 섞지 말고 별도 어댑터나 별도 대화 단계로 운영하는 편이 안전하다. 현재 도구 결과는 Discord 뷰가 직접 렌더링하므로 라우터 어댑터를 학습해도 결과 문구의 말투는 바뀌지 않는다.

## 2. 학습

A100 또는 24GB 이상 GPU 환경을 권장한다. Colab이나 Modal에서 저장소를 받은 뒤 다음을 실행한다.

비용 없이 Colab T4로 시도하려면 `Gemma4_E4B_Colab_Free.ipynb`를 Colab에 업로드하고 위에서부터 실행한다. T4 16GB에 맞게 사전 양자화 E4B, embedding CPU offload, text-only, batch 1, LoRA rank 8, 512 토큰으로 낮춰져 있다. 무료 GPU 할당은 보장되지 않으므로 checkpoint는 Google Drive에 저장한다.

```bash
pip install -r finetune/requirements.txt
python finetune/train_gemma4_e4b.py \
  --data finetune/data/router_seed.json \
  --output finetune/output/ninav-router \
  --epochs 3
```

학습 결과는 `finetune/output/ninav-router`의 LoRA adapter다. 폴더 전체를 추론 서버에 올려야 한다.

## 3. Modal 서빙

Modal CLI에 로그인한 뒤 서버 API 키를 Secret으로 만든다.

```bash
modal setup
modal secret create ninav-gemma-api GEMMA_API_KEY=충분히-긴-임의의-키
modal run finetune/modal_server.py --path finetune/output/ninav-router
modal deploy finetune/modal_server.py
```

배포 출력에 표시되는 `chat-completions` URL이 봇의 `GEMMA_API_URL`이다. Modal 함수 이름의 밑줄은 URL에서 하이픈으로 바뀐다.

## 4. 봇 연결

OpenAI 호환 `/v1/chat/completions` 엔드포인트에 base model과 LoRA adapter를 함께 올린다. 봇 환경변수는 다음과 같이 설정한다.

```dotenv
LLM_BACKEND=gemma
LLM_FALLBACK_BACKEND=anthropic
GEMMA_API_URL=https://YOUR-SERVER/v1/chat/completions
GEMMA_API_KEY=YOUR_SERVER_KEY
GEMMA_MODEL=ninav-gemma-4-e4b
```

초기 운영에서는 fallback을 켜고 Gemma의 JSON 파싱 실패율과 도구 선택 정확도를 기록한다. 안정화 후 `LLM_FALLBACK_BACKEND`와 `ANTHROPIC_API_KEY`를 비우면 Claude 의존성이 사라진다.

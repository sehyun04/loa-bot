import os
import time
import uuid
from pathlib import Path

import modal
from fastapi import Request


APP_NAME = "ninav-gemma4-router"
BASE_MODEL = "unsloth/gemma-4-E4B-it"
MODEL_DIR = "/model-cache/gemma4-e4b"
ADAPTER_DIR = "/adapter/ninav-router"

app = modal.App(APP_NAME)
volume = modal.Volume.from_name("ninav-gemma4-router", create_if_missing=True)


def download_model() -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(BASE_MODEL, local_dir=MODEL_DIR)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.6.0", extra_index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "accelerate",
        "fastapi[standard]",
        "huggingface_hub",
        "peft>=0.18.0",
        "transformers>=4.52.0",
    )
    # 모델을 이미지에 넣어두면 첫 요청이 다운로드 시간 때문에 실패하지 않는다.
    .run_function(download_model)
)


@app.cls(
    image=image,
    gpu="A10",
    timeout=300,
    volumes={"/adapter": volume},
    secrets=[modal.Secret.from_name("ninav-gemma-api")],
    scaledown_window=300,
    max_containers=1,
)
@modal.concurrent(max_inputs=3)
class GemmaRouter:
    @modal.enter()
    def load(self) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_DIR,
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )

        if Path(ADAPTER_DIR).exists():
            # Gemma 4의 래퍼 선형층을 PEFT가 찾는 표준 층으로 내려야 adapter가 붙는다.
            from transformers.models.gemma4.modeling_gemma4 import Gemma4ClippableLinear

            for name, module in list(self.model.named_modules()):
                if not isinstance(module, Gemma4ClippableLinear):
                    continue
                parts = name.split(".")
                parent = self.model
                for part in parts[:-1]:
                    parent = getattr(parent, part)
                setattr(parent, parts[-1], module.linear)

            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, ADAPTER_DIR)
        else:
            raise RuntimeError(f"LoRA adapter가 없어요: {ADAPTER_DIR}")
        self.model.eval()

    @modal.fastapi_endpoint(method="POST")
    async def chat_completions(self, body: dict, request: Request) -> dict:
        from fastapi import HTTPException
        import torch

        expected = os.environ.get("GEMMA_API_KEY", "")
        if not expected or request.headers.get("authorization") != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="invalid api key")

        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            raise HTTPException(status_code=400, detail="messages required")

        prompt = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = self.tokenizer(text=[prompt], return_tensors="pt").to(self.model.device)
        max_tokens = min(max(int(body.get("max_tokens", 512)), 1), 1024)
        temperature = float(body.get("temperature", 0))
        generation = {
            "max_new_tokens": max_tokens,
            "do_sample": temperature > 0,
        }
        if temperature > 0:
            generation.update({"temperature": temperature, "top_p": 0.9})

        started = time.time()
        with torch.no_grad():
            output = self.model.generate(**inputs, **generation)
        content = self.tokenizer.decode(
            output[0][inputs["input_ids"].shape[1] :],
            skip_special_tokens=True,
        ).strip()

        return {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(started),
            "model": body.get("model", "ninav-gemma-4-e4b"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
        }


@app.local_entrypoint()
def upload_adapter(path: str = "finetune/output/ninav-router") -> None:
    source = Path(path)
    if not source.is_dir():
        raise FileNotFoundError(source)

    with volume.batch_upload() as batch:
        for file in source.iterdir():
            if file.is_file() and not file.name.startswith("."):
                batch.put_file(str(file), f"/ninav-router/{file.name}")

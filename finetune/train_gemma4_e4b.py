import argparse
import json
from pathlib import Path


ROUTER_SYSTEM = (
    "너는 로스트아크 디스코드 봇의 라우터다. 한국어 요청에서 실행할 도구와 인자를 고른다. "
    "반드시 JSON 하나만 출력한다. 도구를 실행할 수 있으면 "
    '{"tool_calls":[{"name":"도구명","arguments":{}}]}, 정보가 부족하거나 지원하지 않으면 '
    '{"text":"한국어 안내"} 형식을 쓴다. 이모지를 쓰지 않는다.'
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("finetune/data/router_seed.json"))
    parser.add_argument("--output", type=Path, default=Path("finetune/output/ninav-router"))
    parser.add_argument("--model", default="unsloth/gemma-4-E4B-it")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--max-length", type=int, default=1024)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    import torch
    from datasets import Dataset
    from transformers import TrainingArguments
    from trl import SFTTrainer
    from unsloth import FastModel
    from unsloth.chat_templates import get_chat_template

    raw = json.loads(args.data.read_text(encoding="utf-8"))
    if len(raw) < 10:
        raise ValueError("라우팅 변화량을 확보하려면 최소 10개 이상의 학습 예시가 필요해요.")

    model, tokenizer = FastModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_length,
        load_in_4bit=True,
        full_finetuning=False,
    )
    model = FastModel.get_peft_model(
        model,
        r=16,
        lora_alpha=32,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")

    def format_example(example: dict) -> dict[str, str]:
        messages = [{"role": "system", "content": ROUTER_SYSTEM}, *example["messages"]]
        return {
            "text": tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )
        }

    dataset = Dataset.from_list(raw)
    dataset = dataset.map(format_example, remove_columns=dataset.column_names)
    args.output.mkdir(parents=True, exist_ok=True)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_length,
        args=TrainingArguments(
            output_dir=str(args.output),
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            num_train_epochs=args.epochs,
            learning_rate=5e-5,
            lr_scheduler_type="cosine",
            warmup_ratio=0.05,
            bf16=torch.cuda.is_bf16_supported(),
            fp16=not torch.cuda.is_bf16_supported(),
            logging_steps=1,
            save_strategy="epoch",
            save_total_limit=2,
            optim="adamw_8bit",
            seed=42,
            report_to="none",
        ),
    )
    result = trainer.train()
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"adapter={args.output} train_loss={result.metrics['train_loss']:.4f}")


if __name__ == "__main__":
    main()

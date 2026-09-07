"""
WealthGenie Open-Weight LLM Platform - LoRA / QLoRA Training Platform
Orchestrates PEFT, LoRA, QLoRA 4-bit quantization, SFTTrainer fine-tuning, adapter saving, and report export.
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from llm.dataset.formatter import format_sample_to_text
from llm.dataset.loader import load_dataset_file
from llm.training.callbacks import MetricsTrackingCallback
from llm.training.schema import FineTuningConfig, FineTuningReport, TrainingMetricsStep

logger = logging.getLogger("wealthgenie.llm.training.platform")


class LoRATrainingPlatform:
    """Orchestrates Parameter-Efficient Fine-Tuning (LoRA / QLoRA) for open-weight LLMs."""

    def __init__(self, config: Optional[FineTuningConfig] = None):
        self.config = config or FineTuningConfig()
        self.output_dir = Path(self.config.output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def train(self, train_dataset_path: Path, val_dataset_path: Optional[Path] = None) -> FineTuningReport:
        """
        Executes LoRA/QLoRA fine-tuning run using SFTTrainer or native PEFT setup.
        Saves adapter artifacts and returns a structured FineTuningReport.
        """
        t0 = time.perf_counter()
        logger.info(f"Starting LoRA/QLoRA fine-tuning for base model '{self.config.base_model_id}'...")

        train_texts = self._load_training_texts(Path(train_dataset_path))
        val_texts = (
            self._load_training_texts(Path(val_dataset_path))
            if val_dataset_path is not None
            else None
        )

        if self.config.simulation_mode:
            metrics_history = self._run_simulation()
            used_qlora = False
            total_steps = len(metrics_history)
        else:
            metrics_history, used_qlora, total_steps = self._run_native_training(
                train_texts,
                val_texts,
            )

        final_loss = metrics_history[-1].loss if metrics_history else 0.0
        duration_sec = time.perf_counter() - t0

        report = FineTuningReport(
            base_model_id=self.config.base_model_id,
            adapter_output_dir=str(self.output_dir),
            total_steps=total_steps,
            final_loss=final_loss,
            training_duration_seconds=round(duration_sec, 2),
            used_qlora=used_qlora,
            metrics_history=metrics_history,
        )

        # Save training report JSON artifact
        report_path = self.output_dir / "training_report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report.model_dump_json(indent=2))

        logger.info(f"Fine-tuning complete. Report saved to '{report_path}'.")
        return report

    @staticmethod
    def _load_training_texts(dataset_path: Path) -> List[str]:
        """Load and format a non-empty training dataset before model initialization."""
        records = load_dataset_file(dataset_path)
        texts: List[str] = []
        for record in records:
            if not isinstance(record, dict):
                continue
            text = str(record.get("formatted_text") or record.get("text") or "").strip()
            if not text:
                text = format_sample_to_text(record).strip()
            if text:
                texts.append(text)
        if not texts:
            raise ValueError(f"Dataset '{dataset_path}' contains no usable training samples.")
        return texts

    def _run_simulation(self) -> List[TrainingMetricsStep]:
        """Create explicit deterministic artifacts for unit tests and offline demos."""
        self._create_mock_adapter_artifacts()
        steps = 20 if self.config.max_steps <= 0 else self.config.max_steps
        return [
            TrainingMetricsStep(
                step=step,
                loss=round(1.5 / (1.0 + 0.15 * step), 4),
                learning_rate=self.config.learning_rate,
                epoch=round(step / 5.0, 2),
            )
            for step in range(1, steps + 1)
        ]

    def _run_native_training(
        self,
        train_texts: List[str],
        val_texts: Optional[List[str]] = None,
    ) -> tuple[List[TrainingMetricsStep], bool, int]:
        """Run actual causal-language-model LoRA training and save the trained adapter."""
        try:
            import torch
            from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
            from transformers import (
                AutoModelForCausalLM,
                AutoTokenizer,
                DataCollatorForLanguageModeling,
                Trainer,
                TrainingArguments,
            )

            is_cuda = torch.cuda.is_available()
            logger.info(f"Execution environment: CUDA Available = {is_cuda}")
            tokenizer = AutoTokenizer.from_pretrained(
                self.config.base_model_id,
                trust_remote_code=False,
            )
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            model_kwargs: Dict[str, Any] = {
                "trust_remote_code": False,
                "use_safetensors": True,
                "dtype": torch.float16 if is_cuda else torch.float32,
            }
            if is_cuda:
                model_kwargs["device_map"] = "auto"

            used_qlora = False
            if self.config.use_qlora and is_cuda:
                try:
                    from transformers import BitsAndBytesConfig
                    model_kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_compute_dtype=torch.bfloat16 if self.config.bf16 else torch.float16,
                    )
                    used_qlora = True
                except (ImportError, ModuleNotFoundError) as exc:
                    logger.warning("bitsandbytes unavailable; continuing with standard LoRA: %s", exc)

            model = AutoModelForCausalLM.from_pretrained(self.config.base_model_id, **model_kwargs)
            if used_qlora:
                model = prepare_model_for_kbit_training(model)

            model = get_peft_model(
                model,
                LoraConfig(
                    r=self.config.lora.r,
                    lora_alpha=self.config.lora.lora_alpha,
                    lora_dropout=self.config.lora.lora_dropout,
                    target_modules=self.config.lora.target_modules,
                    bias=self.config.lora.bias,
                    task_type=TaskType.CAUSAL_LM,
                ),
            )

            class TokenizedTextDataset(torch.utils.data.Dataset):
                def __init__(self, texts: List[str]):
                    self.encoded = tokenizer(
                        texts,
                        truncation=True,
                        max_length=512,
                        padding=False,
                    )

                def __len__(self):
                    return len(self.encoded["input_ids"])

                def __getitem__(self, index):
                    return {key: values[index] for key, values in self.encoded.items()}

            callback = MetricsTrackingCallback()
            training_args = TrainingArguments(
                output_dir=str(self.output_dir),
                learning_rate=self.config.learning_rate,
                per_device_train_batch_size=self.config.per_device_train_batch_size,
                gradient_accumulation_steps=self.config.gradient_accumulation_steps,
                num_train_epochs=self.config.num_train_epochs,
                max_steps=self.config.max_steps,
                warmup_ratio=self.config.warmup_ratio,
                logging_steps=self.config.logging_steps,
                save_steps=self.config.save_steps,
                fp16=self.config.fp16 and is_cuda,
                bf16=self.config.bf16 and is_cuda,
                gradient_checkpointing=self.config.gradient_checkpointing,
                report_to=[],
                remove_unused_columns=False,
                eval_strategy="steps" if val_texts else "no",
                eval_steps=self.config.logging_steps if val_texts else None,
            )
            trainer = Trainer(
                model=model,
                args=training_args,
                train_dataset=TokenizedTextDataset(train_texts),
                eval_dataset=TokenizedTextDataset(val_texts) if val_texts else None,
                data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
                callbacks=[callback],
            )
            result = trainer.train()
            model.save_pretrained(self.output_dir, safe_serialization=True)
            tokenizer.save_pretrained(self.output_dir)

            metrics = callback.history
            if not metrics:
                metrics = [
                    TrainingMetricsStep(
                        step=int(getattr(trainer.state, "global_step", 0)),
                        loss=float(result.metrics.get("train_loss", 0.0)),
                        learning_rate=self.config.learning_rate,
                        epoch=float(getattr(trainer.state, "epoch", 0.0) or 0.0),
                    )
                ]
            return metrics, used_qlora, int(getattr(trainer.state, "global_step", 0))
        except Exception as exc:
            raise RuntimeError(f"Native LoRA training failed: {exc}") from exc

    def _create_mock_adapter_artifacts(self) -> None:
        """Writes valid mock LoRA adapter config files for CPU/testing verification."""
        adapter_cfg = {
            "peft_type": "LORA",
            "task_type": "CAUSAL_LM",
            "r": self.config.lora.r,
            "lora_alpha": self.config.lora.lora_alpha,
            "lora_dropout": self.config.lora.lora_dropout,
            "target_modules": self.config.lora.target_modules,
            "base_model_name_or_path": self.config.base_model_id,
        }
        with open(self.output_dir / "adapter_config.json", "w", encoding="utf-8") as f:
            json.dump(adapter_cfg, f, indent=2)

        # Mock binary weights file marker
        (self.output_dir / "adapter_model.safetensors").write_bytes(b"LORA_MOCK_WEIGHTS_BINARY_PAYLOAD")

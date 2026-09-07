"""
WealthGenie Production Open-Weight LLM Platform - Fine-Tuning Test Suite (Phase 3.3)
Tests LoRA/QLoRA configuration, training pipeline execution, adapter saving, and report export.
"""

import json
import sys
import types
import pytest
from llm.training.schema import FineTuningConfig, LoRAConfigSchema
from llm.training.trainer import LoRATrainingPlatform


def test_lora_config_schema():
    lora_cfg = LoRAConfigSchema(r=16, lora_alpha=32, lora_dropout=0.1)
    assert lora_cfg.r == 16
    assert lora_cfg.lora_alpha == 32
    assert "q_proj" in lora_cfg.target_modules


def test_finetuning_config_defaults():
    cfg = FineTuningConfig(base_model_id="Qwen/Qwen2.5-0.5B-Instruct")
    assert cfg.base_model_id == "Qwen/Qwen2.5-0.5B-Instruct"
    assert cfg.use_qlora
    assert cfg.learning_rate == 2e-4


def test_lora_training_platform_execution(tmp_path):
    output_dir = tmp_path / "adapters"
    cfg = FineTuningConfig(
        base_model_id="Qwen/Qwen2.5-0.5B-Instruct",
        output_dir=str(output_dir),
        max_steps=10,
        simulation_mode=True,
    )
    platform = LoRATrainingPlatform(config=cfg)

    dataset_file = tmp_path / "train.jsonl"
    dataset_file.write_text('{"instruction": "Tax query", "output": "Tax answer"}\n', encoding="utf-8")

    report = platform.train(train_dataset_path=dataset_file)

    assert report.total_steps == 10
    assert report.final_loss > 0.0
    assert report.training_duration_seconds >= 0.0
    assert len(report.metrics_history) == 10

    assert (output_dir / "adapter_config.json").exists()
    assert (output_dir / "adapter_model.safetensors").exists()
    assert (output_dir / "training_report.json").exists()

    report_json = json.loads((output_dir / "training_report.json").read_text(encoding="utf-8"))
    assert report_json["total_steps"] == 10


def test_lora_training_rejects_missing_or_empty_datasets(tmp_path):
    cfg = FineTuningConfig(output_dir=str(tmp_path / "adapters"), simulation_mode=True)
    platform = LoRATrainingPlatform(config=cfg)

    with pytest.raises(FileNotFoundError):
        platform.train(tmp_path / "missing.jsonl")

    empty_dataset = tmp_path / "empty.jsonl"
    empty_dataset.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="no usable training samples"):
        platform.train(empty_dataset)


def test_native_training_uses_validation_data_and_reports_optimizer_steps(monkeypatch, tmp_path):
    captured = {}

    class FakeDataset:
        pass

    fake_torch = types.ModuleType("torch")
    fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    fake_torch.float16 = "float16"
    fake_torch.float32 = "float32"
    fake_torch.bfloat16 = "bfloat16"
    fake_torch.utils = types.SimpleNamespace(data=types.SimpleNamespace(Dataset=FakeDataset))

    class FakeTokenizer:
        pad_token = None
        eos_token = "<eos>"

        def __call__(self, texts, **_kwargs):
            return {
                "input_ids": [[1, 2] for _ in texts],
                "attention_mask": [[1, 1] for _ in texts],
            }

        def save_pretrained(self, _path):
            return None

    class FakeAutoTokenizer:
        @staticmethod
        def from_pretrained(_model_id, **kwargs):
            captured["tokenizer_kwargs"] = kwargs
            return FakeTokenizer()

    class FakeModel:
        def save_pretrained(self, _path, **kwargs):
            captured["save_kwargs"] = kwargs

    class FakeAutoModel:
        @staticmethod
        def from_pretrained(_model_id, **kwargs):
            captured["model_kwargs"] = kwargs
            return FakeModel()

    class FakeTrainingArguments:
        def __init__(self, **kwargs):
            captured["training_args"] = kwargs

    class FakeTrainer:
        def __init__(self, **kwargs):
            captured["trainer_kwargs"] = kwargs
            self.state = types.SimpleNamespace(global_step=7, epoch=1.0)

        def train(self):
            return types.SimpleNamespace(metrics={"train_loss": 0.25})

    fake_transformers = types.ModuleType("transformers")
    fake_transformers.AutoModelForCausalLM = FakeAutoModel
    fake_transformers.AutoTokenizer = FakeAutoTokenizer
    fake_transformers.DataCollatorForLanguageModeling = lambda **kwargs: kwargs
    fake_transformers.Trainer = FakeTrainer
    fake_transformers.TrainingArguments = FakeTrainingArguments

    fake_peft = types.ModuleType("peft")
    fake_peft.LoraConfig = lambda **kwargs: kwargs
    fake_peft.TaskType = types.SimpleNamespace(CAUSAL_LM="CAUSAL_LM")
    fake_peft.get_peft_model = lambda model, _config: model
    fake_peft.prepare_model_for_kbit_training = lambda model: model

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    monkeypatch.setitem(sys.modules, "peft", fake_peft)

    platform = LoRATrainingPlatform(FineTuningConfig(
        output_dir=str(tmp_path / "adapters"),
        use_qlora=False,
        max_steps=7,
    ))
    metrics, used_qlora, total_steps = platform._run_native_training(
        ["training sample"],
        ["validation sample"],
    )

    assert total_steps == 7
    assert used_qlora is False
    assert metrics[-1].loss == 0.25
    assert captured["training_args"]["eval_strategy"] == "steps"
    assert len(captured["trainer_kwargs"]["eval_dataset"]) == 1
    assert captured["model_kwargs"]["trust_remote_code"] is False
    assert captured["model_kwargs"]["use_safetensors"] is True
    assert captured["model_kwargs"]["dtype"] == "float32"
    assert "torch_dtype" not in captured["model_kwargs"]

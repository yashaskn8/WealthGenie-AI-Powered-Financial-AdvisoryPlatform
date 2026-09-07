"""
WealthGenie Open-Weight LLM Platform - Financial Dataset Pipeline Orchestrator
Executes loading, validation, cleaning, deduplication, formatting, stats computation, and splitting.
"""

import logging
import random
from pathlib import Path
from typing import Dict, Any, List, Optional

from llm.dataset.cleaner import clean_text, validate_sample, deduplicate_samples
from llm.dataset.formatter import format_sample_to_text
from llm.dataset.loader import load_dataset_file, save_dataset_file
from llm.dataset.schema import DatasetStats, QualityReport

logger = logging.getLogger("wealthgenie.llm.dataset.pipeline")


def compute_dataset_stats(samples: List[Dict[str, Any]], formatted_texts: List[str]) -> DatasetStats:
    """Computes comprehensive statistics over processed dataset samples."""
    if not samples or not formatted_texts:
        return DatasetStats(
            total_samples=0,
            total_tokens_approx=0,
            avg_tokens_per_sample=0.0,
            min_tokens=0,
            max_tokens=0,
            vocabulary_size_approx=0,
        )

    token_counts = []
    vocabulary = set()

    for text in formatted_texts:
        words = text.split()
        count = len(words)
        token_counts.append(count)
        vocabulary.update(w.lower() for w in words)

    total_samples = len(samples)
    total_tokens = sum(token_counts)
    avg_tokens = total_tokens / total_samples if total_samples > 0 else 0.0

    return DatasetStats(
        total_samples=total_samples,
        total_tokens_approx=total_tokens,
        avg_tokens_per_sample=round(avg_tokens, 2),
        min_tokens=min(token_counts) if token_counts else 0,
        max_tokens=max(token_counts) if token_counts else 0,
        vocabulary_size_approx=len(vocabulary),
    )


class FinancialDatasetPipeline:
    """Orchestrates end-to-end processing for fine-tuning dataset preparation."""

    def __init__(self, seed: int = 42):
        self.seed = seed
        random.seed(self.seed)

    def process(
        self,
        input_source: Any,
        train_ratio: float = 0.8,
        val_ratio: float = 0.1,
        test_ratio: float = 0.1,
        template_style: str = "chatml",
        output_dir: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """
        Executes end-to-end dataset pipeline: loading -> cleaning -> validation -> deduplication -> formatting -> splitting -> statistics.
        """
        # 1. Load Raw Samples
        if isinstance(input_source, (str, Path)):
            raw_samples = load_dataset_file(Path(input_source))
        elif isinstance(input_source, list):
            raw_samples = input_source
        else:
            raise ValueError("input_source must be a file path (str/Path) or a list of dict samples.")

        raw_count = len(raw_samples)
        logger.info(f"Loaded {raw_count} raw samples for dataset processing.")

        # 2. Text Cleaning & Schema Validation
        valid_samples = []
        invalid_count = 0

        for sample in raw_samples:
            if not validate_sample(sample):
                invalid_count += 1
                continue

            # Clean internal string fields
            cleaned_sample = {}
            for k, v in sample.items():
                if isinstance(v, str):
                    cleaned_sample[k] = clean_text(v)
                elif isinstance(v, list) and k == "messages":
                    cleaned_msgs = []
                    for msg in v:
                        cleaned_msgs.append({
                            "role": msg.get("role", "user"),
                            "content": clean_text(str(msg.get("content", ""))),
                        })
                    cleaned_sample[k] = cleaned_msgs
                else:
                    cleaned_sample[k] = v
            valid_samples.append(cleaned_sample)

        # 3. Content Deduplication
        clean_samples, duplicate_count = deduplicate_samples(valid_samples)
        clean_count = len(clean_samples)
        logger.info(f"Deduplicated dataset: {clean_count} clean samples ({duplicate_count} duplicates removed, {invalid_count} invalid removed).")

        # 4. Template Formatting & Text Generation
        formatted_texts = [format_sample_to_text(s, template_style=template_style) for s in clean_samples]
        for idx, s in enumerate(clean_samples):
            s["formatted_text"] = formatted_texts[idx]

        # 5. Reproducible Stratified Splitting
        shuffled = list(clean_samples)
        random.shuffle(shuffled)

        n_total = len(shuffled)
        n_train = int(n_total * train_ratio)
        n_val = int(n_total * val_ratio)

        train_samples = shuffled[:n_train]
        val_samples = shuffled[n_train:n_train + n_val]
        test_samples = shuffled[n_train + n_val:]

        split_distribution = {
            "train": len(train_samples),
            "val": len(val_samples),
            "test": len(test_samples),
        }

        # 6. Statistics Calculation
        overall_stats = compute_dataset_stats(clean_samples, formatted_texts)

        quality_report = QualityReport(
            raw_samples_count=raw_count,
            invalid_samples_removed=invalid_count,
            duplicates_removed=duplicate_count,
            clean_samples_count=clean_count,
            split_distribution=split_distribution,
            stats=overall_stats,
        )

        # 7. Export Outputs if output_dir specified
        if output_dir:
            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            save_dataset_file(train_samples, out_path / "train.jsonl")
            save_dataset_file(val_samples, out_path / "val.jsonl")
            save_dataset_file(test_samples, out_path / "test.jsonl")
            with open(out_path / "quality_report.json", "w", encoding="utf-8") as f:
                f.write(quality_report.model_dump_json(indent=2))

        return {
            "train_samples": train_samples,
            "val_samples": val_samples,
            "test_samples": test_samples,
            "quality_report": quality_report,
        }

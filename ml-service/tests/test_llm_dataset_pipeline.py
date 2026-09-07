"""
WealthGenie Production Open-Weight LLM Platform - Dataset Pipeline Test Suite (Phase 3.2)
Tests cleaning, deduplication, formatting, multi-format I/O (JSONL, JSON, CSV, Parquet), splitting, and quality reports.
"""

from llm.dataset.cleaner import clean_text, validate_sample, deduplicate_samples
from llm.dataset.formatter import format_alpaca_template, format_chatml_template
from llm.dataset.loader import load_dataset_file, save_dataset_file
from llm.dataset.pipeline import FinancialDatasetPipeline


def test_text_cleaner_and_normalizer():
    raw_text = "  Section 87A   rebate  \n\n\n\x00\x08details   for taxpayers.  "
    cleaned = clean_text(raw_text)
    assert cleaned == "Section 87A rebate\n\ndetails for taxpayers."


def test_sample_validation():
    # Valid Instruction Sample
    valid_inst = {"instruction": "Calculate tax rebate for 7 lakh income", "output": "Rebate under 87A is 25000"}
    assert validate_sample(valid_inst)

    # Invalid Instruction Sample (missing output)
    invalid_inst = {"instruction": "Calculate tax rebate"}
    assert not validate_sample(invalid_inst)

    # Valid Conversation Sample
    valid_conv = {
        "messages": [
            {"role": "user", "content": "What is Section 87A?"},
            {"role": "assistant", "content": "It provides tax rebate up to Rs 25,000."},
        ]
    }
    assert validate_sample(valid_conv)


def test_deduplication():
    samples = [
        {"instruction": "Tax Query A", "output": "Response A"},
        {"instruction": "Tax Query A", "output": "Response A"},  # Duplicate
        {"instruction": "Tax Query B", "output": "Response B"},
    ]
    unique, dupes_removed = deduplicate_samples(samples)
    assert len(unique) == 2
    assert dupes_removed == 1


def test_chat_template_formatters():
    sample = {
        "instruction": "Explain Section 87A",
        "output": "It provides ₹25,000 rebate.",
    }
    alpaca_text = format_alpaca_template(sample)
    assert "### Instruction:\nExplain Section 87A" in alpaca_text
    assert "### Response:\nIt provides ₹25,000 rebate." in alpaca_text

    chatml_text = format_chatml_template(sample)
    assert "<|im_start|>user\nExplain Section 87A<|im_end|>" in chatml_text
    assert "<|im_start|>assistant\nIt provides ₹25,000 rebate.<|im_end|>" in chatml_text


def test_multi_format_io(tmp_path):
    data = [
        {"instruction": "Query 1", "output": "Answer 1"},
        {"instruction": "Query 2", "output": "Answer 2"},
    ]

    # JSONL
    jsonl_path = tmp_path / "dataset.jsonl"
    save_dataset_file(data, jsonl_path)
    loaded_jsonl = load_dataset_file(jsonl_path)
    assert len(loaded_jsonl) == 2

    # CSV
    csv_path = tmp_path / "dataset.csv"
    save_dataset_file(data, csv_path)
    loaded_csv = load_dataset_file(csv_path)
    assert len(loaded_csv) == 2

    # Parquet
    parquet_path = tmp_path / "dataset.parquet"
    save_dataset_file(data, parquet_path)
    loaded_parquet = load_dataset_file(parquet_path)
    assert len(loaded_parquet) == 2


def test_end_to_end_financial_dataset_pipeline(tmp_path):
    raw_data = [
        {"instruction": f"Financial Query {i}", "output": f"Financial Answer details for query {i}."}
        for i in range(20)
    ]
    # Add duplicate to verify deduplication in pipeline
    raw_data.append({"instruction": "Financial Query 0", "output": "Financial Answer details for query 0."})

    pipeline = FinancialDatasetPipeline(seed=42)
    results = pipeline.process(
        input_source=raw_data,
        train_ratio=0.8,
        val_ratio=0.1,
        test_ratio=0.1,
        template_style="chatml",
        output_dir=tmp_path / "output",
    )

    report = results["quality_report"]
    assert report.raw_samples_count == 21
    assert report.duplicates_removed == 1
    assert report.clean_samples_count == 20
    assert report.split_distribution["train"] == 16
    assert report.split_distribution["val"] == 2
    assert report.split_distribution["test"] == 2

    assert (tmp_path / "output" / "train.jsonl").exists()
    assert (tmp_path / "output" / "val.jsonl").exists()
    assert (tmp_path / "output" / "test.jsonl").exists()
    assert (tmp_path / "output" / "quality_report.json").exists()

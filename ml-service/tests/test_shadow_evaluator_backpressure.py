import asyncio
import importlib
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from types import SimpleNamespace

import numpy as np

from model.registry.shadow_evaluator import ShadowEvaluator


# Importing the ASGI module constructs its configured vector store at module
# import time. Keep this focused contract test isolated from machine-level
# provider settings and restore the process environment immediately after the
# import so other tests retain their own setup.
_STORE_ENV = {name: os.environ.get(name) for name in ("ENVIRONMENT", "ML_STATE_BACKEND", "MONGODB_URI")}
os.environ["ENVIRONMENT"] = "local"
os.environ["ML_STATE_BACKEND"] = "local"
os.environ.pop("MONGODB_URI", None)
try:
    import main
finally:
    for _name, _value in _STORE_ENV.items():
        if _value is None:
            os.environ.pop(_name, None)
        else:
            os.environ[_name] = _value


_TARGETS = {"Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"}


def _active_result(primary="FD"):
    ranked = [primary, "Debt_MF", "RBI_Bond"]
    assert len(set(ranked)) == 3
    return {
        "primary": ranked[0],
        "secondary": ranked[1],
        "tertiary": ranked[2],
        "primary_confidence": 0.4,
        "confidence_scores": {
            "Equity_MF": 0.10,
            "ELSS": 0.10,
            "ETF": 0.10,
            "Debt_MF": 0.20,
            "FD": 0.30,
            "RBI_Bond": 0.20,
        },
        "low_confidence": False,
        "latency_ms": 1.0,
    }


class _BlockingPredictor:
    def __init__(self, result=None):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0
        self.result = result or _active_result("ETF")

    def predict(self, model_input):
        self.calls += 1
        self.started.set()
        if self.calls == 1:
            self.release.wait(timeout=5)
        return dict(self.result)


class _FailOncePredictor:
    def __init__(self):
        self.calls = 0

    def predict(self, model_input):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("candidate inference failed")
        return _active_result("ETF")


def _wait_for_evaluations(evaluator, expected, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        summary = evaluator.get_summary()
        if summary.get("total_evaluations") == expected and summary.get("in_flight") == 0:
            return summary
        time.sleep(0.01)
    raise AssertionError(f"shadow evaluations did not reach {expected}: {evaluator.get_summary()}")


def test_prediction_response_does_not_wait_for_shadow_model(monkeypatch):
    evaluator = ShadowEvaluator(history_capacity=4)
    blocking = _BlockingPredictor()
    evaluator.configure_shadow("shadow-v1", "RandomForest", blocking)
    shadow_module = importlib.import_module("model.registry.shadow_evaluator")
    monkeypatch.setattr(shadow_module, "shadow_evaluator", evaluator)

    active_predictor = SimpleNamespace(is_loaded=True, predict=lambda _features: _active_result("FD"))
    monkeypatch.setattr(main, "_ensure_serving_model", lambda _architecture: active_predictor)
    monkeypatch.setattr(main, "record_inference_features", lambda _features: None)
    monkeypatch.setattr(main, "build_model_input", lambda _data: ({}, np.asarray([[1.0]])))
    monkeypatch.setattr(main, "get_decision_path_description", lambda _data: [])
    monkeypatch.setattr(main, "get_live_model_version", lambda *_args: "active-v1")
    monkeypatch.setattr(main, "explainer_instance", None)

    future_executor = ThreadPoolExecutor(max_workers=1)
    future = future_executor.submit(asyncio.run, main.predict_enriched(SimpleNamespace()))
    response = None
    returned_before_shadow_completed = False
    try:
        assert blocking.started.wait(timeout=2)
        try:
            response = future.result(timeout=0.5)
            returned_before_shadow_completed = True
        except TimeoutError:
            pass
    finally:
        blocking.release.set()
        try:
            future.result(timeout=2)
        finally:
            future_executor.shutdown(wait=True)
            evaluator.clear_shadow()
            shutdown = getattr(evaluator, "shutdown", None)
            if shutdown is not None:
                shutdown(timeout=1)

    assert returned_before_shadow_completed
    assert response.primary == "FD"
    assert response.model_version == "active-v1"


def test_shadow_queue_is_bounded_and_drops_without_blocking():
    evaluator = ShadowEvaluator(history_capacity=4, queue_capacity=1)
    blocking = _BlockingPredictor()
    evaluator.configure_shadow("shadow-v1", "RandomForest", blocking)
    try:
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[1.0]])) is True
        assert blocking.started.wait(timeout=2)
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[2.0]])) is True
        started = time.monotonic()
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[3.0]])) is False
        assert time.monotonic() - started < 0.1
        summary = evaluator.get_summary()
        assert summary["pending"] == 1
        assert summary["in_flight"] == 1
        assert summary["dropped_evaluations"] == 1
        blocking.release.set()
        summary = _wait_for_evaluations(evaluator, 2)
        assert summary["agreement_rate"] == 0.0
    finally:
        blocking.release.set()
        shutdown = getattr(evaluator, "shutdown", None)
        if shutdown is not None:
            shutdown(timeout=1)
        else:
            evaluator.clear_shadow()


def test_reconfigured_shadow_discards_old_in_flight_result():
    evaluator = ShadowEvaluator(history_capacity=4, queue_capacity=2)
    old_predictor = _BlockingPredictor(_active_result("ETF"))
    new_predictor = _BlockingPredictor(_active_result("ELSS"))
    new_predictor.release.set()
    evaluator.configure_shadow("old-v1", "RandomForest", old_predictor)
    try:
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[1.0]])) is True
        assert old_predictor.started.wait(timeout=2)
        evaluator.configure_shadow("new-v1", "RandomForest", new_predictor)
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[2.0]])) is True
        old_predictor.release.set()
        summary = _wait_for_evaluations(evaluator, 1)
        assert summary["shadow_version_id"] == "new-v1"
        assert summary["recent_sample_comparisons"][-1]["shadow_primary"] == "ELSS"
        assert summary["discarded_evaluations"] == 1
    finally:
        old_predictor.release.set()
        shutdown = getattr(evaluator, "shutdown", None)
        if shutdown is not None:
            shutdown(timeout=1)
        else:
            evaluator.clear_shadow()


def test_shadow_worker_survives_candidate_inference_failure():
    evaluator = ShadowEvaluator(history_capacity=4, queue_capacity=2)
    predictor = _FailOncePredictor()
    evaluator.configure_shadow("shadow-v1", "RandomForest", predictor)
    try:
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[1.0]])) is True
        deadline = time.monotonic() + 2.0
        while predictor.calls < 1 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert predictor.calls == 1
        assert evaluator.evaluate(_active_result("FD"), np.asarray([[2.0]])) is True
        summary = _wait_for_evaluations(evaluator, 1)
        assert summary["recent_sample_comparisons"][-1]["shadow_primary"] == "ETF"
    finally:
        shutdown = getattr(evaluator, "shutdown", None)
        if shutdown is not None:
            shutdown(timeout=1)
        else:
            evaluator.clear_shadow()

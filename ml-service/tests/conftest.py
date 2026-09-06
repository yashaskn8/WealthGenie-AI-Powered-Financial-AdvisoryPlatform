"""Pytest-wide isolation for local ML state and retraining artifacts."""

import os
import shutil
import tempfile


_TEST_STATE_DIR = tempfile.mkdtemp(prefix="wealthgenie_ml_tests_")
os.environ.setdefault("ML_REGISTRY_DB_PATH", os.path.join(_TEST_STATE_DIR, "model_registry.db"))
os.environ.setdefault("ML_CANDIDATE_MODEL_DIR", os.path.join(_TEST_STATE_DIR, "candidates"))


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    shutil.rmtree(_TEST_STATE_DIR, ignore_errors=True)

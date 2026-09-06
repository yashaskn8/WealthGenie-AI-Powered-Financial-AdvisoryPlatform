"""Run the v4 feature-contract rigor audit.

This replaces the legacy benchmark generator that reconstructed gross annual
income and hidden goal_type values.
"""

import json

from model.evaluation.rigor_evaluator import run_full_rigor_audit


if __name__ == "__main__":
    print(json.dumps(run_full_rigor_audit(), indent=2))

from __future__ import annotations

from typing import Callable

BEHAVIOR_SCORERS: list[Callable] = []


def register_behavior_scorer(fn: Callable) -> Callable:
    BEHAVIOR_SCORERS.append(fn)
    return fn

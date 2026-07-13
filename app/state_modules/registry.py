from __future__ import annotations

from typing import Callable

STATE_MODULES: list[Callable] = []


def register_state_module(fn: Callable) -> Callable:
    STATE_MODULES.append(fn)
    return fn

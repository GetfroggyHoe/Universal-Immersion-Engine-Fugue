from __future__ import annotations


def clamp(value: float, min_value: float = 0.0, max_value: float = 100.0) -> float:
    return max(min_value, min(max_value, value))


def get_trait(character, key: str, default: float = 50.0) -> float:
    return character.traits.get(key, default)


def get_state(states: dict, key: str, default: float = 0.0) -> float:
    instance = states.get(key)
    if instance is None:
        return default
    return instance.value


def set_state(character, key: str, value: float) -> None:
    from app.models.state import StateInstance
    instance = character.runtime.states.get(key)
    if instance is not None:
        instance.value = clamp(value, instance.min_value, instance.max_value)
    else:
        character.runtime.states[key] = StateInstance(
            state_id=key,
            value=clamp(value),
        )


def add_state(character, key: str, amount: float) -> None:
    from app.models.state import StateInstance
    instance = character.runtime.states.get(key)
    if instance is not None:
        instance.value = clamp(
            instance.value + amount,
            instance.min_value,
            instance.max_value,
        )
    else:
        character.runtime.states[key] = StateInstance(
            state_id=key,
            value=clamp(amount),
        )


def get_rel(relationship, key: str, default: float = 0.0) -> float:
    if key in relationship.extra:
        return relationship.extra[key]
    return getattr(relationship, key, default)


def modify_rel(relationship, key: str, amount: float) -> None:
    if key in relationship.extra:
        relationship.extra[key] = clamp(relationship.extra[key] + amount)
    elif hasattr(relationship, key):
        current = getattr(relationship, key)
        setattr(relationship, key, clamp(current + amount))
    else:
        relationship.extra[key] = clamp(amount)

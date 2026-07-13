from __future__ import annotations

from typing import Any


class PromptCompiler:

    _STYLE_PRESETS: dict[str, str] = {
        "anime_game_art": "anime game art style, cel-shaded, vibrant colors, clean linework",
        "visual_novel_bg": "visual novel background, detailed environment, atmospheric lighting, 16:9",
        "portrait": "character portrait, upper body, expressive, detailed face, soft lighting",
        "dark_fantasy": "dark fantasy art style, moody, dramatic lighting, detailed textures",
        "cyberpunk": "cyberpunk art style, neon lights, rain-slicked streets, high contrast",
        "watercolor": "watercolor painting style, soft edges, pastel palette, artistic",
        "photorealistic": "photorealistic, high detail, natural lighting, photographic quality",
    }

    _NEGATIVE_PRESETS: dict[str, str] = {
        "default": "text, watermark, signature, logo, UI elements, blurry, low quality, deformed",
        "portrait": "text, watermark, extra fingers, deformed face, asymmetric eyes, blurry",
        "background": "text, watermark, people, characters, UI elements, blurry, low quality",
    }

    def compile_rp_prompt(
        self,
        *,
        character: dict[str, Any],
        context: dict[str, Any],
        user_input: str = "",
        provider: str = "default",
    ) -> str:
        parts: list[str] = []
        char_name = character.get("name", "")
        role = character.get("role", "NPC")
        personality = character.get("profile", {}).get("personality", "")
        bio = character.get("profile", {}).get("bio", "")[:300]
        parts.append(f"You are {char_name}, a {role}.")
        if personality:
            parts.append(f"Personality: {personality}.")
        if bio:
            parts.append(f"Background: {bio}")
        location = context.get("location", character.get("location", ""))
        if location:
            parts.append(f"Current location: {location}.")
        present = context.get("present_npcs", [])
        if present:
            names = ", ".join(str(n.get("name", "")) for n in present[:4])
            parts.append(f"Others present: {names}.")
        mood = context.get("mood", character.get("profile", {}).get("current_mood", "neutral"))
        if mood and mood != "neutral":
            parts.append(f"Current emotional state: {mood}.")
        memories = context.get("recent_memories", [])
        if memories:
            mem_text = "; ".join(str(m.get("text", ""))[:80] for m in memories[:3])
            parts.append(f"Relevant recent memories: {mem_text}.")
        secrets = context.get("active_secrets", [])
        if secrets:
            for s in secrets[:2]:
                knows = "knows" if s.get("character_knows") else "suspects"
                parts.append(f"{char_name} {knows} about: {str(s.get('summary', ''))[:100]}")
        relationships = context.get("relationships", [])
        if relationships:
            for r in relationships[:3]:
                parts.append(f"Toward {r.get('name', '')}: affinity={r.get('affinity', 50)}, trust={r.get('trust', 50)}")
        goal = character.get("desires", {}).get("current_goal", "")
        if goal:
            parts.append(f"Current goal: {goal}")
        system_prompt = "\n".join(parts)
        if provider in ("openai", "anthropic", "google"):
            return self._format_for_provider(system_prompt, user_input, provider)
        return f"{system_prompt}\n\n{user_input}".strip()

    def compile_image_prompt(
        self,
        *,
        visual_type: str = "",
        subject: str = "",
        description: str = "",
        style_preset: str = "anime_game_art",
        negative: str = "",
        provider: str = "default",
        extra_tags: list[str] | None = None,
    ) -> str:
        style = self._STYLE_PRESETS.get(style_preset, style_preset)
        parts: list[str] = []
        if visual_type == "background":
            parts.append("Wide 16:9 empty visual novel environment background, no people, no text, no UI.")
        elif visual_type == "portrait":
            parts.append("Character portrait, upper body framing, expressive face, no text, no UI.")
        elif visual_type == "instavibe_post":
            parts.append("Social media photo, casual candid style, no text overlay, no watermark.")
        elif visual_type == "item":
            parts.append("Game item icon, centered composition, clean background, no text.")
        if subject:
            parts.append(subject)
        if description:
            parts.append(description)
        parts.append(style)
        if extra_tags:
            parts.extend(extra_tags[:6])
        prompt = ", ".join(p for p in parts if p)
        if provider == "stability":
            return prompt[:1500]
        return prompt[:3000]

    def compile_negative_prompt(
        self,
        *,
        visual_type: str = "",
        provider: str = "default",
        override: str = "",
    ) -> str:
        if override:
            return override
        if visual_type == "background":
            return self._NEGATIVE_PRESETS.get("background", self._NEGATIVE_PRESETS["default"])
        if visual_type == "portrait":
            return self._NEGATIVE_PRESETS.get("portrait", self._NEGATIVE_PRESETS["default"])
        return self._NEGATIVE_PRESETS["default"]

    def compile_summary_prompt(self, text: str, max_length: int = 200) -> str:
        return f"Summarize the following in {max_length} characters or less, preserving key events and emotional beats:\n\n{text[:2000]}"

    def compile_npc_reaction_prompt(
        self,
        *,
        npc: dict[str, Any],
        trigger_event: str,
        relationship: dict[str, Any] | None = None,
    ) -> str:
        name = npc.get("name", "")
        personality = npc.get("profile", {}).get("personality", "")
        mood = npc.get("profile", {}).get("current_mood", "neutral")
        parts = [f"Write a brief in-character reaction from {name}."]
        if personality:
            parts.append(f"Personality: {personality}.")
        if mood and mood != "neutral":
            parts.append(f"Current mood: {mood}.")
        if relationship:
            trust = relationship.get("trust", 50)
            affinity = relationship.get("affinity", 50)
            parts.append(f"Relationship to the trigger: trust={trust}, affinity={affinity}.")
        parts.append(f"Event: {trigger_event}")
        parts.append("Respond in character with a short narrative description and optional dialogue.")
        return "\n".join(parts)

    def compile_quest_prompt(self, context: dict[str, Any]) -> str:
        parts = ["Generate a quest based on the following context:"]
        if context.get("location"):
            parts.append(f"Location: {context['location']}")
        if context.get("faction"):
            parts.append(f"Faction involved: {context['faction']}")
        if context.get("characters"):
            parts.append(f"Characters: {', '.join(str(c) for c in context['characters'][:4])}")
        if context.get("theme"):
            parts.append(f"Theme: {context['theme']}")
        if context.get("difficulty"):
            parts.append(f"Difficulty: {context['difficulty']}")
        parts.append("Provide: quest name, description, objectives (3-5), rewards, and a twist.")
        return "\n".join(parts)

    def compile_social_post_prompt(
        self,
        *,
        author: str,
        tag: str = "Cozy",
        tone: str = "Neutral",
        context: str = "",
    ) -> str:
        return f"Write a short social media post by {author} with tag '{tag}' and tone '{tone}'. {context}".strip()

    def _format_for_provider(self, system: str, user_input: str, provider: str) -> str:
        if provider == "anthropic":
            return f"<system>\n{system}\n</system>\n\n<human>\n{user_input}\n</human>"
        if provider == "google":
            return f"System: {system}\n\nUser: {user_input}"
        return f"{system}\n\n{user_input}"


_compiler: PromptCompiler | None = None


def get_prompt_compiler() -> PromptCompiler:
    global _compiler
    if _compiler is None:
        _compiler = PromptCompiler()
    return _compiler

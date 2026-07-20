import json
import unittest

from python.world_tools.map_generation import MAX_CONTEXT_CHARS, compact_map_context


class MapContextBudgetTests(unittest.TestCase):
    def test_bounds_deduplicates_and_keeps_valid_json(self):
        context, sizes = compact_map_context({
            "recentChat": "chat " * 2000,
            "sourceLocation": "Current Room " * 40,
            "lore": ["Important lore " * 100, "Important lore " * 100, "Other lore " * 100] + [{"bad": "nested"}],
            "unknown": {"nested": "dropped"},
        })
        self.assertLessEqual(sizes["total"], MAX_CONTEXT_CHARS)
        self.assertLessEqual(len(context.get("lore", [])), 4)
        self.assertEqual(len(context.get("lore", [])), len(set(context.get("lore", []))))
        json.dumps(context)

    def test_nested_values_are_dropped(self):
        context, _ = compact_map_context({"sourceLocation": {"not": "text"}, "lore": [{"bad": 1}]})
        self.assertNotIn("sourceLocation", context)
        self.assertNotIn("lore", context)


if __name__ == "__main__":
    unittest.main()

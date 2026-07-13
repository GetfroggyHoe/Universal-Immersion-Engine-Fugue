from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path
from typing import Any

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    return _SLUG_RE.sub("_", str(value or "").lower()).strip("_")


class SearchIndexer:

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = Path(db_path)
        self._lock = threading.RLock()

    def _conn(self) -> sqlite3.Connection:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def initialize(self) -> None:
        with self._lock, self._conn() as conn:
            conn.executescript("""
                create virtual table if not exists fts_entities using fts5(
                    entity_type, entity_id, name, content, tags,
                    tokenize='porter unicode61'
                );
                create table if not exists search_meta (
                    key text primary key,
                    value text not null
                );
            """)

    def index_entity(self, entity_type: str, entity_id: str, name: str, content: str, tags: list[str] | None = None) -> None:
        doc_id = f"{entity_type}:{entity_id}"
        tag_str = " ".join(str(t) for t in (tags or []))
        with self._lock, self._conn() as conn:
            conn.execute("delete from fts_entities where entity_type=? and entity_id=?", (entity_type, entity_id))
            conn.execute(
                "insert into fts_entities (entity_type, entity_id, name, content, tags) values (?, ?, ?, ?, ?)",
                (entity_type, entity_id, name, content, tag_str),
            )
            conn.execute(
                "insert or replace into search_meta (key, value) values (?, ?)",
                ("last_indexed", str(Path(self._db_path).stat().st_mtime if Path(self._db_path).exists() else 0)),
            )

    def index_batch(self, entities: list[dict[str, Any]]) -> int:
        count = 0
        for entity in entities:
            entity_type = str(entity.get("entity_type") or entity.get("type") or "unknown")
            entity_id = str(entity.get("entity_id") or entity.get("id") or "")
            name = str(entity.get("name") or "")
            content_parts = [
                str(entity.get("bio") or ""),
                str(entity.get("description") or ""),
                str(entity.get("text") or ""),
                str(entity.get("content") or ""),
            ]
            content = " ".join(p for p in content_parts if p)
            tags = entity.get("tags") if isinstance(entity.get("tags"), list) else []
            if entity_id:
                self.index_entity(entity_type, entity_id, name, content, tags)
                count += 1
        return count

    def search(self, query: str, *, entity_type: str = "", limit: int = 20) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        safe_limit = max(1, min(100, int(limit)))
        with self._lock, self._conn() as conn:
            try:
                if entity_type:
                    rows = conn.execute(
                        "select entity_type, entity_id, name, snippet(fts_entities, 3, '<b>', '</b>', '...', 20) as snippet, rank "
                        "from fts_entities where fts_entities match ? and entity_type=? order by rank limit ?",
                        (query, entity_type, safe_limit),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "select entity_type, entity_id, name, snippet(fts_entities, 3, '<b>', '</b>', '...', 20) as snippet, rank "
                        "from fts_entities where fts_entities match ? order by rank limit ?",
                        (query, safe_limit),
                    ).fetchall()
            except sqlite3.OperationalError:
                rows = []
        return [
            {
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "name": row["name"],
                "snippet": row["snippet"],
                "rank": row["rank"],
            }
            for row in rows
        ]

    def search_natural(self, query: str, *, limit: int = 20) -> list[dict[str, Any]]:
        cleaned = re.sub(r"[^\w\s]", " ", query)
        terms = [t for t in cleaned.split() if len(t) > 2]
        if not terms:
            return []
        fts_query = " OR ".join(terms)
        return self.search(fts_query, limit=limit)

    def remove_entity(self, entity_type: str, entity_id: str) -> None:
        with self._lock, self._conn() as conn:
            conn.execute("delete from fts_entities where entity_type=? and entity_id=?", (entity_type, entity_id))

    def reindex_all(self, entities: list[dict[str, Any]]) -> int:
        with self._lock, self._conn() as conn:
            conn.execute("delete from fts_entities")
        return self.index_batch(entities)

    def stats(self) -> dict[str, Any]:
        with self._lock, self._conn() as conn:
            try:
                total = conn.execute("select count(*) from fts_entities").fetchone()[0]
                by_type = conn.execute(
                    "select entity_type, count(*) as cnt from fts_entities group by entity_type order by cnt desc"
                ).fetchall()
            except sqlite3.OperationalError:
                total = 0
                by_type = []
        return {
            "total_documents": total,
            "by_type": {row["entity_type"]: row["cnt"] for row in by_type},
            "db_path": str(self._db_path),
        }


_indexer: SearchIndexer | None = None


def get_search_indexer(db_path: Path | str | None = None) -> SearchIndexer:
    global _indexer
    if _indexer is None:
        if db_path is None:
            root = Path(__file__).resolve().parents[2]
            db_path = root / "data" / "uie_search.sqlite3"
        _indexer = SearchIndexer(db_path)
    return _indexer

"""全文搜索:逐行匹配 + 多片段上下文 + 出现次数排序(Obsidian 搜索观感)。

覆盖 .md 与 .canvas;跳过 memory / .trash / 隐藏目录。
查询语法:`tag:#xxx` 走标签索引(由 API 层分流),这里只做全文。
"""
from __future__ import annotations

from ..core.config import VAULT_DIR
from .segmenter import tokenize

SKIP_DIRS = {"memory", ".trash", ".pylibs", ".venv", ".obsidian"}
SNIPPETS_PER_FILE = 4


def search(query: str, limit: int = 50) -> list[dict]:
    tokens = tokenize(query)
    if not tokens:
        return []
    tok_lowers = [t.lower() for t in tokens]
    results: list[dict] = []
    for f in VAULT_DIR.rglob("*"):
        if f.suffix not in (".md", ".canvas") or not f.is_file():
            continue
        rel = f.relative_to(VAULT_DIR)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()
        total = 0
        snippets: list[dict] = []
        for i, line in enumerate(lines):
            ll = line.lower()
            hit_here = False
            for tok in tok_lowers:
                start = 0
                while (j := ll.find(tok, start)) != -1:
                    total += 1
                    hit_here = True
                    start = j + len(tok)
            if hit_here and len(snippets) < SNIPPETS_PER_FILE:
                # 取首个命中位置,截上下文窗口
                j = min((ll.find(t) for t in tok_lowers if ll.find(t) != -1), default=0)
                lo = max(0, j - 30)
                hi = min(len(line), j + len(query) + 50)
                prefix = "…" if lo > 0 else ""
                suffix = "…" if hi < len(line) else ""
                snippets.append({"line": i + 1, "text": f"{prefix}{line[lo:hi].strip()}{suffix}"})
        if total:
            results.append(
                {
                    "path": str(rel),
                    "name": f.stem,
                    "count": total,
                    "score": total,
                    "snippets": snippets,
                }
            )
    results.sort(key=lambda r: (-r["count"], r["name"]))
    return results[:limit]

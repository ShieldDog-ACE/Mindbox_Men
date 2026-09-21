"""三层记忆服务:短期(会话) / 长期(过渡区) / 永久(知识图)。

M0 提供统一的条目存储/读取与摘要;升降级引擎、三元组图在 M1 实现。
条目为纯 JSON 文件,每条含时间/分类/置信度/引用与成败计数等元数据。
"""
from __future__ import annotations

import json
import time
import uuid

from ..core.config import MEMORY, VAULT_DIR
from .segmenter import tokenize

MEMORY_DIR = VAULT_DIR / "memory"
LAYERS = ("short", "long", "permanent")

# 长期记忆九类条目(任务书 2.2):key 为机读分类,value 为中文标签(参与检索)
LONG_CATEGORIES = {
    "task": "任务记录",
    "skill": "技能配方",
    "digest": "资料摘要",
    "preference": "用户偏好",
    "pending_triple": "待验证三元组",
    "error_case": "错误案例",
    "emotion": "情绪历史",
    "ai_effect": "外部大脑效果",
    "project": "项目上下文",
}


def _layer_dir(layer: str):
    if layer not in LAYERS:
        raise ValueError(f"unknown memory layer: {layer}")
    d = MEMORY_DIR / layer
    d.mkdir(parents=True, exist_ok=True)
    return d


def add_item(layer: str, category: str, content: str, meta: dict | None = None) -> dict:
    item = {
        "id": uuid.uuid4().hex[:12],
        "layer": layer,
        "category": category,
        "content": content,
        "created_at": time.time(),
        "updated_at": time.time(),
        "confidence": int((meta or {}).get("confidence", 50)),
        "refs": 0,
        "success": 0,
        "fail": 0,
        "meta": meta or {},
    }
    path = _layer_dir(layer) / f"{item['id']}.json"
    path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    return item


def list_items(layer: str, category: str | None = None) -> list[dict]:
    items: list[dict] = []
    for f in _layer_dir(layer).glob("*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "id" not in data:  # 跳过 triples.json 等非条目文件
            continue
        if category is None or data.get("category") == category:
            items.append(data)
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return items


def hit_item(layer: str, item_id: str, success: bool | None = None) -> dict | None:
    """记录一次引用/调用(升降级依据的数据来源)。"""
    path = _layer_dir(layer) / f"{item_id}.json"
    if not path.is_file():
        return None
    item = json.loads(path.read_text(encoding="utf-8"))
    item["refs"] += 1
    if success is True:
        item["success"] += 1
    elif success is False:
        item["fail"] += 1
    item["updated_at"] = time.time()
    path.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    return item


def query(layer: str, keyword: str, top_k: int = 10) -> list[dict]:
    """按分词匹配检索某层记忆,命中数 × 置信度排序。

    参与匹配的词 = 条目正文 + 分类中文标签,保证中英分类互通。
    """
    tokens = set(tokenize(keyword))
    scored: list[tuple[float, dict]] = []
    for item in list_items(layer):
        cat_text = LONG_CATEGORIES.get(item["category"], item["category"])
        words = set(tokenize(item["content"])) | set(tokenize(cat_text))
        overlap = len(tokens & words)
        if overlap == 0:
            continue
        score = overlap * (1 + item["confidence"] / 100)
        scored.append((score, item))
    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:top_k]]


def summary() -> dict:
    return {layer: len(list(_layer_dir(layer).glob("*.json"))) for layer in LAYERS}


def promote_thresholds() -> dict:
    return MEMORY

"""集中配置:vault 路径、端口等。优先级 环境变量 > vault/config.json > 默认值。"""
import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/
PROJECT_ROOT = BASE_DIR.parent  # Mindbox/

VAULT_DIR = Path(os.environ.get("MINDBOX_VAULT", PROJECT_ROOT / "vault"))

_cfg_path = VAULT_DIR / "config.json"
_cfg: dict = {}
if _cfg_path.exists():
    _cfg = json.loads(_cfg_path.read_text(encoding="utf-8"))

HOST = os.environ.get("MINDBOX_HOST", "127.0.0.1")
PORT = int(os.environ.get("MINDBOX_PORT", _cfg.get("port", 8765)))
API_PREFIX = "/api/v1"
APP_VERSION = "0.1.0"

# MCP 鉴权与访问控制(任务书第 6 节)
TOKEN = _cfg.get("token", "")
BLACKLIST: list[str] = _cfg.get("blacklist", [])  # vault 相对路径前缀黑名单

# 记忆引擎参数(集中定义,便于调参 —— 任务书 0.1 第 3 条)
MEMORY = {
    "promote_success_rate": 0.9,   # 成功率 > 90% 才可升级永久
    "promote_min_calls": 100,      # 且调用 > 100 次
    "confidence_pending": (60, 85),  # 待验证三元组置信度区间
    "short_term_ttl_days": 28,     # 短期任务记录保留 1-4 周
}

"""vault 服务:目录树扫描、笔记对(.md 正文 + .json 元数据)读写、白板(.canvas)、关系图。

约定:一切路径都以 vault 根为相对路径,严禁逃逸(防路径穿越)。
"""
from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path

from ..core.config import BLACKLIST, VAULT_DIR
from .snapshot_service import move_snapshots, snapshot_before_write

NOTE_EXTS = {".md"}
CANVAS_EXT = ".canvas"
WIKILINK = re.compile(r"\[\[([^\]]+)\]\]")


def _safe_path(path: str) -> Path:
    """把 vault 相对路径转为绝对路径,确保不逃逸且不命中黑名单。"""
    p = (VAULT_DIR / path).resolve()
    if not p.is_relative_to(VAULT_DIR.resolve()):
        raise ValueError(f"path escapes vault: {path}")
    for b in BLACKLIST:
        if path == b or path.startswith(b.rstrip("/") + "/"):
            raise ValueError(f"path is blacklisted: {path}")
    return p


def scan_tree() -> list[dict]:
    """返回 vault 目录树(目录 + .md,忽略隐藏项)。"""

    def walk(d: Path) -> list[dict]:
        items: list[dict] = []
        for child in sorted(d.iterdir(), key=lambda c: (c.is_file(), c.name.lower())):
            if child.name.startswith("."):
                continue
            rel = str(child.relative_to(VAULT_DIR))
            if child.is_dir():
                items.append({"name": child.name, "path": rel, "type": "dir", "children": walk(child)})
            elif child.suffix == CANVAS_EXT:
                items.append({"name": child.stem, "path": rel, "type": "canvas"})
            elif child.suffix in NOTE_EXTS:
                items.append({"name": child.stem, "path": rel, "type": "note"})
        return items

    return walk(VAULT_DIR)


def read_note(path: str) -> dict:
    p = _safe_path(path)
    if p.suffix == CANVAS_EXT:
        # 白板是自包含 JSON,没有配对元数据文件
        if not p.is_file():
            raise FileNotFoundError(path)
        return {"path": path, "name": p.stem, "content": p.read_text(encoding="utf-8"), "meta": {}}
    if p.suffix not in NOTE_EXTS or not p.is_file():
        raise FileNotFoundError(path)
    meta_path = p.with_suffix(".json")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    return {"path": path, "name": p.stem, "content": p.read_text(encoding="utf-8"), "meta": meta}


def write_note(path: str, content: str, meta: dict | None = None, overwrite: bool = True) -> dict:
    p = _safe_path(path)
    if p.suffix not in NOTE_EXTS and p.suffix != CANVAS_EXT:
        raise ValueError("only .md notes and .canvas boards are supported")
    if p.exists() and not overwrite:
        raise FileExistsError(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    snapshot_before_write(p, path)  # 覆盖前留快照(文件恢复用)
    p.write_text(content, encoding="utf-8")
    if meta is not None:
        p.with_suffix(".json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return {"path": path}


def delete_note(path: str) -> None:
    """删除进 vault/.trash(Obsidian 同款行为,可恢复)。文件夹则整体移入。"""
    p = _safe_path(path)
    trash = _safe_path(".trash")
    trash.mkdir(exist_ok=True)
    target = trash / p.name
    if p.is_dir():
        if target.exists():  # 重名加时间戳
            target = trash / f"{p.name} {int(time.time())}"
            shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(p), str(target))
        return
    if target.exists():  # 重名加时间戳
        target = trash / f"{p.stem} {int(time.time())}{p.suffix}"
    if p.is_file():
        p.replace(target)
    p.with_suffix(".json").unlink(missing_ok=True)


def _retarget_canvas_prefix(old_prefix: str, new_prefix: str) -> None:
    """文件夹改名/移动后,改写白板 file 节点的路径前缀(前缀一致才改,避免误伤)。"""
    for cv in VAULT_DIR.rglob(f"*{CANVAS_EXT}"):
        try:
            data = json.loads(cv.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        changed = False
        for n in data.get("nodes", []):
            f = n.get("file")
            if n.get("type") == "file" and isinstance(f, str) and (f == old_prefix or f.startswith(f"{old_prefix}/")):
                n["file"] = new_prefix + f[len(old_prefix):]
                changed = True
        if changed:
            cv.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_item(src: str, dst: str) -> dict:
    """复制笔记/白板,文件夹递归复制。"""
    s = _safe_path(src)
    d = _safe_path(dst)
    if not s.exists():
        raise FileNotFoundError(src)
    if d.exists():
        raise FileExistsError(dst)
    d.parent.mkdir(parents=True, exist_ok=True)
    if s.is_dir():
        shutil.copytree(s, d)
        return {"path": dst}
    shutil.copy2(s, d)
    meta = s.with_suffix(".json")
    if meta.is_file():
        shutil.copy2(meta, d.with_suffix(".json"))
    return {"path": dst}


def rename_note(path: str, new_path: str, update_links: bool = True) -> dict:
    """重命名/移动笔记或白板。update_links 时全库同步替换按标题引用的 [[双链]],
    并同步所有白板里的 file 节点引用。"""
    src = _safe_path(path)
    dst = _safe_path(new_path)
    if not src.exists():
        raise FileNotFoundError(path)
    if dst.exists():
        raise FileExistsError(new_path)
    if src.is_dir():
        if dst == src or dst.is_relative_to(src):
            raise ValueError("不能把文件夹移动到它自己的子目录")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        move_snapshots(path, new_path)
        _retarget_canvas_prefix(path, new_path)  # 白板里指向该目录的 file 路径同步
        return {"path": new_path}
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.replace(dst)
    meta = src.with_suffix(".json")
    if meta.is_file():
        meta.replace(dst.with_suffix(".json"))
    move_snapshots(path, new_path)  # 快照目录同步迁移

    old_stem, new_stem = src.stem, dst.stem
    if update_links and old_stem != new_stem:
        # [[old]], [[old|alias]], [[old#heading]] 三种形态(含 ![[old]] 嵌入)
        pat = re.compile(r"(\[\[!?)" + re.escape(old_stem) + r"(\]\]|\||#)")
        for md in VAULT_DIR.rglob("*.md"):
            text = md.read_text(encoding="utf-8")
            new_text = pat.sub(lambda m: f"{m.group(1)}{new_stem}{m.group(2)}", text)
            if new_text != text:
                md.write_text(new_text, encoding="utf-8")
    if path != new_path:
        # 白板 file 引用同步(重命名与移动均生效;含引用 .canvas 的情形)
        for cv in VAULT_DIR.rglob(f"*{CANVAS_EXT}"):
            try:
                data = json.loads(cv.read_text(encoding="utf-8"))
                changed = False
                for n in data.get("nodes", []):
                    if n.get("type") == "file" and n.get("file") == path:
                        n["file"] = new_path
                        changed = True
                if changed:
                    cv.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            except (json.JSONDecodeError, OSError):
                pass
    return {"path": new_path}


def create_folder(path: str) -> dict:
    p = _safe_path(path)
    p.mkdir(parents=True, exist_ok=True)
    return {"path": path}


def _note_links_context(text: str, p: Path) -> list[str]:
    """返回引用了该笔记的行片段(反链上下文)。支持 [[标题]] 与 [[目录/标题]] 两种写法。"""
    ref1 = re.escape(p.stem)
    ref2 = re.escape(p.with_suffix("").as_posix())
    pat = re.compile(r"\[\[!?(?:" + ref1 + r"|" + ref2 + r")(\]\]|\||#)")
    return [line.strip()[:120] for line in text.splitlines() if pat.search(line)]


def backlinks(path: str) -> list[dict]:
    """扫描全库,返回引用了 path 的笔记列表(含上下文片段)。链接按标题或路径解析。"""
    p = _safe_path(path)
    if not p.is_file():
        raise FileNotFoundError(path)
    out: list[dict] = []
    for md in VAULT_DIR.rglob("*.md"):
        rel_parts = md.relative_to(VAULT_DIR).parts
        if rel_parts[0] == "memory" or any(part.startswith(".") for part in rel_parts) or md == p:
            continue
        text = md.read_text(encoding="utf-8")
        ctx = _note_links_context(text, p)
        if ctx:
            out.append({"source": str(md.relative_to(VAULT_DIR)), "name": md.stem, "contexts": ctx})
    return out


def _title_index() -> dict[str, str]:
    """标题 → vault 相对路径(.md 与 .canvas),供双链解析。
    同时收录 目录/标题 形式,支持路径式 [[dir/note]] 引用。跳过隐藏目录(如 .trash)。"""
    index: dict[str, str] = {}
    for f in VAULT_DIR.rglob("*"):
        if f.suffix not in NOTE_EXTS and f.suffix != CANVAS_EXT:
            continue
        rel_path = f.relative_to(VAULT_DIR)
        if rel_path.parts[0] == "memory" or any(part.startswith(".") for part in rel_path.parts):
            continue
        rel = str(rel_path)
        index.setdefault(f.stem, rel)
        index.setdefault(rel_path.with_suffix("").as_posix(), rel)
    return index


def outlinks(path: str) -> list[dict]:
    """解析当前笔记的全部 [[链接]],返回 {target, resolved}。"""
    p = _safe_path(path)
    if not p.is_file():
        raise FileNotFoundError(path)
    text = p.read_text(encoding="utf-8")
    index = _title_index()
    seen: dict[str, str | None] = {}
    for m in WIKILINK.finditer(text):
        raw = m.group(1).split("|")[0].split("#")[0].strip()
        if raw and raw not in seen:
            seen[raw] = index.get(raw)
    return [{"target": k, "resolved": v} for k, v in seen.items()]


TAG_PAT = re.compile(r"(?:^|\s)#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/_-]*)", re.MULTILINE)


def all_tags() -> dict[str, int]:
    """全库标签索引:#tag → 出现次数。跳过 memory 目录、隐藏目录与代码块。"""
    counts: dict[str, int] = {}
    for md in VAULT_DIR.rglob("*.md"):
        rel_parts = md.relative_to(VAULT_DIR).parts
        if rel_parts[0] == "memory" or any(part.startswith(".") for part in rel_parts):
            continue
        text = md.read_text(encoding="utf-8")
        text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)  # 排除代码块
        for tag in TAG_PAT.findall(text):
            counts[tag] = counts.get(tag, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def search_tag(tag: str) -> list[dict]:
    """返回包含某标签的笔记。"""
    hits: list[dict] = []
    for md in VAULT_DIR.rglob("*.md"):
        rel_parts = md.relative_to(VAULT_DIR).parts
        if rel_parts[0] == "memory" or any(part.startswith(".") for part in rel_parts):
            continue
        text = re.sub(r"```.*?```", "", md.read_text(encoding="utf-8"), flags=re.DOTALL)
        if tag in TAG_PAT.findall(text):
            hits.append({"path": str(md.relative_to(VAULT_DIR)), "name": md.stem})
    return hits


def find_by_name(title: str) -> str | None:
    """按笔记名(不含扩展名)查找 vault 相对路径,.md 与 .canvas 均可,供双链跳转。"""
    return _title_index().get(title)


def build_graph() -> dict:
    """扫描全部 .md 的 [[双链]],构建关系图数据:节点(笔记/白板)+ 边(引用)。悬空链接以虚节点呈现。"""
    # 先建 标题->路径 索引(.md + .canvas)
    index = _title_index()

    nodes: dict[str, dict] = {}
    links: list[dict] = []
    for title, path in index.items():
        nodes[path] = {"id": path, "name": title}
        text = (VAULT_DIR / path).read_text(encoding="utf-8")
        for target in WIKILINK.findall(text):
            target = target.split("|")[0].split("#")[0].strip()
            if not target:
                continue
            tpath = index.get(target)
            if tpath is None:
                tpath = f"__missing__/{target}"
                nodes.setdefault(tpath, {"id": tpath, "name": target, "missing": True})
            links.append({"source": path, "target": tpath})

    # 链接度决定节点大小
    degree: dict[str, int] = {}
    for l in links:
        degree[l["source"]] = degree.get(l["source"], 0) + 1
        degree[l["target"]] = degree.get(l["target"], 0) + 1
    for nid, n in nodes.items():
        n["degree"] = degree.get(nid, 0)
    return {"nodes": list(nodes.values()), "links": links}


# ---------- 附件(图片/音视频) ----------

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}
MEDIA_EXTS = IMAGE_EXTS | {
    ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac",  # 音频
    ".mp4", ".webm", ".mkv", ".mov",  # 视频
}
ATTACH_DIR = "attachments"


def save_image(name: str, data_b64: str) -> dict:
    """保存剪贴板图片到 vault/attachments/,重名自动追加序号。返回 vault 相对路径。"""
    import base64
    import binascii

    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTS:
        suffix = ".png"
    try:
        raw = base64.b64decode(data_b64)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"invalid image data: {e}") from e
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("image too large (>20MB)")

    dest_dir = VAULT_DIR / ATTACH_DIR
    dest_dir.mkdir(exist_ok=True)
    stem = Path(name).stem or "pasted"
    stem = re.sub(r'[\\/:*?"<>|]', "_", stem)[:60]
    p = dest_dir / f"{stem}{suffix}"
    n = 1
    while p.exists():
        p = dest_dir / f"{stem} {n}{suffix}"
        n += 1
    p.write_bytes(raw)
    return {"path": f"{ATTACH_DIR}/{p.name}", "name": p.name}


def resolve_media(target: str) -> str | None:
    """按文件名(可带目录)查找 vault 内图片/音视频附件,返回 vault 相对路径。"""
    target = target.strip()
    direct = VAULT_DIR / target
    if direct.is_file() and direct.suffix.lower() in MEDIA_EXTS:
        return target
    wanted = target.split("/")[-1]
    for f in VAULT_DIR.rglob("*"):
        if f.is_file() and f.suffix.lower() in MEDIA_EXTS and f.name == wanted:
            rel = f.relative_to(VAULT_DIR)
            if not any(part.startswith(".") for part in rel.parts):
                return str(rel)
    return None

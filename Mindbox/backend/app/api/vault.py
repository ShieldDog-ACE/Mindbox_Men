"""vault:目录树、关系图、标签、文件夹、附件媒体。"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..models.schemas import FolderCreate, ImageSave, ItemCopy
from ..services import vault_service

router = APIRouter(tags=["vault"])


@router.get("/vault/tree")
def tree() -> list[dict]:
    return vault_service.scan_tree()


@router.get("/vault/graph")
def graph() -> dict:
    """双链关系图数据(节点+边),前端力导向渲染。"""
    return vault_service.build_graph()


@router.get("/vault/tags")
def tags() -> dict:
    """全库标签索引:tag → 次数。"""
    return vault_service.all_tags()


@router.get("/vault/tag-notes")
def tag_notes(tag: str = Query(...)) -> list[dict]:
    """包含某标签的笔记列表。"""
    return vault_service.search_tag(tag)


@router.post("/vault/folder")
def create_folder(body: FolderCreate):
    try:
        return vault_service.create_folder(body.path)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/vault/copy")
def copy_item(body: ItemCopy):
    """复制笔记/白板/文件夹(递归)。"""
    try:
        return vault_service.copy_item(body.src, body.dst)
    except FileNotFoundError:
        raise HTTPException(404, f"not found: {body.src}")
    except FileExistsError:
        raise HTTPException(409, f"already exists: {body.dst}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/vault/media")
def media(path: str = Query(...)):
    """读取 vault 内媒体附件(图片/音频/视频扩展名,防穿越由服务层保证)。"""
    resolved = vault_service.resolve_media(path)
    if not resolved:
        raise HTTPException(404, f"media not found: {path}")
    p = vault_service.VAULT_DIR / resolved
    return FileResponse(p)


@router.post("/vault/image")
def save_image(body: ImageSave):
    """剪贴板图片落盘 → vault/attachments/。"""
    try:
        return vault_service.save_image(body.name, body.data)
    except ValueError as e:
        raise HTTPException(400, str(e))

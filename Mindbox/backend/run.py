"""Mindbox 后端入口:python3 run.py"""
import os

import uvicorn

from app.core.config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=os.environ.get("MINDBOX_RELOAD") == "1",
        log_level="info",
    )

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import init_db
from .routers import ai as ai_router
from .routers import documents, meetings, projects, register, reports, templates
from .services import ai, scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    sched = scheduler.start()
    yield
    if sched:
        sched.shutdown(wait=False)


app = FastAPI(title="DXA PMU API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(ai.AIError)
async def ai_error(_: Request, e: ai.AIError):
    return JSONResponse({"detail": e.message}, status_code=e.status)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


for r in (projects.router, ai_router.router, reports.router, meetings.router, templates.router, register.router, documents.router):
    app.include_router(r, prefix="/api")

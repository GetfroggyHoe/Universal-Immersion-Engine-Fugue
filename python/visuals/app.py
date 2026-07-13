from __future__ import annotations

import logging

from fastapi import FastAPI

from .api.routes import router as visuals_router
from .tools import initialize_tools
from .providers.router import ensure_provider_router
from .jobs.queue import get_job_queue
from .workers.generation_worker import get_generation_worker
from .workers.health_monitor import get_health_monitor

log = logging.getLogger("visuals.app")


def create_visuals_app() -> FastAPI:
    app = FastAPI(
        title="UIE Visual Processing Pipeline",
        description="Modular visual generation and processing orchestration system",
        version="2.0.0",
    )

    app.include_router(visuals_router)

    @app.on_event("startup")
    async def startup_event() -> None:
        initialize_tools()
        ensure_provider_router()

        generation_worker = get_generation_worker()
        generation_worker.load_model()

        queue = get_job_queue()
        queue.start()

        health = get_health_monitor()
        health.check_all()

        log.info("Visual processing pipeline started (worker architecture v2)")

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        queue = get_job_queue()
        queue.stop()

        generation_worker = get_generation_worker()
        generation_worker.shutdown()

        log.info("Visual processing pipeline stopped")

    return app


def include_visuals_router(app: FastAPI) -> None:
    initialize_tools()
    ensure_provider_router()
    app.include_router(visuals_router)
    log.info("Visuals router included in main app")

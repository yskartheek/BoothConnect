"""``roll-parser worker``: consume ``extract-roll`` jobs from Redis (BullMQ)."""

import asyncio
import contextlib
import logging
import signal
from collections.abc import Awaitable
from typing import Any, cast

from bullmq import Worker
from redis.asyncio import Redis

from roll_parser.worker.contract import JOB_NAME
from roll_parser.worker.health import HealthState, serve
from roll_parser.worker.process import process
from roll_parser.worker.settings import Settings
from roll_parser.worker.storage import Storage

log = logging.getLogger("roll_parser.worker")

REDIS_PING_SECONDS = 15
# Extraction runs in a thread (and its own processes), so the event loop stays
# free to renew the job's lock every lockDuration / 2.
LOCK_DURATION_MS = 60_000


def make_processor(settings: Settings, storage: Storage, state: HealthState) -> Any:
    async def processor(job: Any, token: str) -> dict[str, Any]:
        if job.name != JOB_NAME:
            from bullmq import UnrecoverableError

            raise UnrecoverableError(f"Unknown job name {job.name!r}; expected {JOB_NAME!r}")
        with state.lock:
            state.jobs_active += 1
        try:
            envelope = await asyncio.to_thread(
                process, job.data, settings, storage, job_id=str(job.id)
            )
        except Exception as err:
            # Retried by BullMQ (attempts/backoff are set by the producer)
            log.warning(
                "job error, will be retried if attempts remain",
                extra={
                    "job_id": str(job.id),
                    "attempt": job.attemptsMade + 1,
                    "error_type": type(err).__name__,
                },
            )
            raise
        finally:
            with state.lock:
                state.jobs_active -= 1
                state.jobs_done += 1
        return envelope.model_dump(mode="json")

    return processor


async def _watch_redis(url: str, state: HealthState, stop: asyncio.Event) -> None:
    client = Redis.from_url(url)
    try:
        while not stop.is_set():
            try:
                await cast(Awaitable[bool], client.ping())
                with state.lock:
                    state.redis_ok_at = asyncio.get_running_loop().time()
            except Exception:  # noqa: S110 (reported through /health)
                pass
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), REDIS_PING_SECONDS)
    finally:
        await client.aclose()


async def run(settings: Settings, stop: asyncio.Event | None = None) -> None:
    stop = stop or asyncio.Event()
    state = HealthState()
    storage = Storage(settings)
    server = serve(state, settings.health_port)
    worker = Worker(
        settings.queue_name,
        make_processor(settings, storage, state),
        {
            "connection": settings.redis_url,
            "prefix": settings.queue_prefix,
            "concurrency": settings.concurrency,
            "lockDuration": LOCK_DURATION_MS,
        },
    )
    with state.lock:
        state.running = True
    log.info(
        "worker started",
        extra={
            "queue": settings.queue_name,
            "concurrency": settings.concurrency,
            "port": settings.health_port,
        },
    )
    watcher = asyncio.create_task(_watch_redis(settings.redis_url, state, stop))
    try:
        await stop.wait()
    finally:
        with state.lock:
            state.running = False
        log.info("worker stopping")
        await worker.close()
        await watcher
        server.shutdown()


def main(settings: Settings | None = None) -> None:
    from roll_parser.worker import logs

    logs.setup()
    settings = settings or Settings.from_env()

    async def _main() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            # Windows has no signal handlers here: Ctrl+C raises KeyboardInterrupt instead
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, stop.set)
        await run(settings, stop)

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_main())

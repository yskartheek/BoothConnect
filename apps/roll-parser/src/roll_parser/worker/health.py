"""``GET /health`` for Docker and orchestrators: 200 when the worker is running
and Redis answered recently, 503 otherwise."""

import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Redis must have answered within this many seconds
STALE_AFTER = 60


@dataclass
class HealthState:
    running: bool = False
    redis_ok_at: float = 0.0
    jobs_active: int = 0
    jobs_done: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> tuple[int, dict[str, object]]:
        with self.lock:
            redis_up = time.monotonic() - self.redis_ok_at < STALE_AFTER
            healthy = self.running and redis_up
            body: dict[str, object] = {
                "status": "ok" if healthy else "unavailable",
                "worker": "running" if self.running else "stopped",
                "redis": "up" if redis_up else "down",
                "jobsActive": self.jobs_active,
                "jobsDone": self.jobs_done,
            }
        return (200 if healthy else 503), body


def serve(state: HealthState, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path.rstrip("/") != "/health":
                self.send_error(404)
                return
            status, body = state.snapshot()
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: object) -> None:
            pass  # health checks would flood the logs

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)  # noqa: S104 (inside a container)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    return server

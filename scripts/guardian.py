"""
Standalone Guardian Monitor.
Runs as a separate process outside the main app.
Monitors the BTI backend process and restarts it if it crashes.
Also monitors disk/memory/CPU and sends alerts to a log file.

Usage: python scripts/guardian.py
"""

import subprocess
import time
import logging
import os
import sys
import json
import psutil
import signal
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
BACKEND_DIR = ROOT / "backend"
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [GUARDIAN] %(levelname)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOG_DIR / "guardian.log")),
    ]
)
logger = logging.getLogger("guardian")

PYTHON = str(BACKEND_DIR / "venv" / "Scripts" / "python.exe")
if not Path(PYTHON).exists():
    PYTHON = sys.executable

BACKEND_CMD = [PYTHON, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
MAX_RESTART_DELAY = 60
HEALTH_CHECK_URL = "http://localhost:8000/api/health"
RESOURCE_WARN_CPU = 85
RESOURCE_WARN_MEM = 85
RESOURCE_WARN_DISK = 90


class ProcessGuardian:
    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._restart_count = 0
        self._running = True
        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

    def _shutdown(self, *_):
        logger.info("Guardian shutting down…")
        self._running = False
        if self._proc:
            self._proc.terminate()

    def _start_backend(self):
        logger.info("Starting backend process (restart #%d)…", self._restart_count)
        try:
            self._proc = subprocess.Popen(
                BACKEND_CMD,
                cwd=str(BACKEND_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            logger.info("Backend PID: %d", self._proc.pid)
        except Exception as e:
            logger.error("Failed to start backend: %s", e)
            self._proc = None

    def _is_healthy(self) -> bool:
        """Check backend is responding via HTTP."""
        try:
            import urllib.request
            with urllib.request.urlopen(HEALTH_CHECK_URL, timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def _check_resources(self):
        cpu = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage(str(ROOT))

        if cpu > RESOURCE_WARN_CPU:
            logger.warning("HIGH CPU: %.1f%%", cpu)
        if mem.percent > RESOURCE_WARN_MEM:
            logger.warning("HIGH MEMORY: %.1f%%", mem.percent)
        if disk.percent > RESOURCE_WARN_DISK:
            logger.warning("LOW DISK: %.1f%% used", disk.percent)

        # Write health snapshot
        health = {
            "timestamp": datetime.now().isoformat(),
            "cpu_pct": cpu,
            "mem_pct": mem.percent,
            "disk_pct": disk.percent,
            "backend_pid": self._proc.pid if self._proc else None,
            "restart_count": self._restart_count,
        }
        with open(str(LOG_DIR / "health.json"), "w") as f:
            json.dump(health, f)

    def run(self):
        logger.info("Guardian started. Watching BTI backend.")
        self._start_backend()
        check_counter = 0

        while self._running:
            time.sleep(10)
            check_counter += 1

            # Check if process died
            if self._proc is None or self._proc.poll() is not None:
                exit_code = self._proc.returncode if self._proc else -1
                logger.error("Backend process died (exit code: %d). Restarting…", exit_code)
                self._restart_count += 1
                delay = min(5 * self._restart_count, MAX_RESTART_DELAY)
                logger.info("Waiting %ds before restart…", delay)
                time.sleep(delay)
                self._start_backend()
                continue

            # HTTP health check every 30s
            if check_counter % 3 == 0:
                if not self._is_healthy():
                    logger.warning("Backend not responding to health check — may be starting up")

            # Resource check every 60s
            if check_counter % 6 == 0:
                try:
                    self._check_resources()
                except Exception as e:
                    logger.debug("Resource check error: %s", e)

            # Drain stdout to prevent buffer fill
            if self._proc and self._proc.stdout:
                try:
                    line = self._proc.stdout.readline()
                    if line.strip():
                        logger.info("[BACKEND] %s", line.rstrip())
                except Exception:
                    pass

        logger.info("Guardian stopped.")


if __name__ == "__main__":
    pg = ProcessGuardian()
    pg.run()

"""
Guardian Agent: System monitor that:
- Tracks heartbeats from all other agents
- Detects crashes / hung processes
- Auto-restarts failed services
- Logs all errors to SQLite
- Exposes health status to dashboard

Runs in a dedicated thread (not async) to survive main loop failures.
"""

import asyncio
import threading
import logging
import time
import os
import sys
import subprocess
import json
import psutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, Callable, Any

logger = logging.getLogger(__name__)

SERVICES = {
    "backend": {
        "cmd": [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0",
                "--port", "8000", "--reload"],
        "cwd": str(Path(__file__).parent.parent),
        "port": 8000,
        "critical": True,
    },
}

HEARTBEAT_TIMEOUT = 180  # seconds before declaring an agent dead


class AgentHeartbeat:
    """Shared state for agent heartbeats — all agents call .beat(name)."""
    _beats: Dict[str, float] = {}
    _lock = threading.Lock()

    @classmethod
    def beat(cls, name: str):
        with cls._lock:
            cls._beats[name] = time.time()

    @classmethod
    def get_all(cls) -> Dict[str, float]:
        with cls._lock:
            return dict(cls._beats)

    @classmethod
    def is_alive(cls, name: str, timeout: float = HEARTBEAT_TIMEOUT) -> bool:
        with cls._lock:
            last = cls._beats.get(name, 0)
        return (time.time() - last) < timeout


async def heartbeat_sleep(name: str, seconds: float, slice_s: float = 25.0):
    """Drop-in replacement for ``asyncio.sleep`` in an agent's main loop.

    Beats the agent's heartbeat at the start and every ``slice_s`` seconds while
    sleeping, so long-cycle agents (macro 300s, technicals 900s, filings 120s)
    are NOT falsely declared dead and restarted by the Guardian during their
    normal idle interval. Without this, an agent that only does work every N>
    HEARTBEAT_TIMEOUT seconds never beats between cycles and gets churned.
    """
    AgentHeartbeat.beat(name)
    remaining = float(seconds)
    while remaining > 0:
        await asyncio.sleep(min(slice_s, remaining))
        remaining -= slice_s
        AgentHeartbeat.beat(name)


class GuardianAgent:
    def __init__(self, ws_broadcast: Optional[Callable] = None):
        self._broadcast = ws_broadcast
        self._running = False
        self._agent_refs: Dict[str, Any] = {}
        self._agent_tasks: Dict[str, asyncio.Task] = {}   # track running tasks to cancel on restart
        self._restart_counts: Dict[str, int] = {}
        self._last_errors: Dict[str, str] = {}

    def register_agent(self, name: str, agent_obj: Any, task: "asyncio.Task | None" = None):
        """Register an agent instance for monitoring."""
        self._agent_refs[name] = agent_obj
        if task is not None:
            self._agent_tasks[name] = task
        AgentHeartbeat.beat(name)

    def set_agent_task(self, name: str, task: "asyncio.Task"):
        """Store the asyncio Task for an already-registered agent so Guardian can cancel it on restart."""
        self._agent_tasks[name] = task

    async def start(self):
        self._running = True
        logger.info("GuardianAgent started — watching all services")

        while self._running:
            try:
                await self._check_all()
                await self._update_db()
            except Exception as e:
                logger.error("GuardianAgent check error: %s", e)
            await asyncio.sleep(30)

    async def stop(self):
        self._running = False

    async def _check_all(self):
        """Check all registered agents for liveness."""
        all_beats = AgentHeartbeat.get_all()

        for name, agent in self._agent_refs.items():
            last_beat = all_beats.get(name, 0)
            age = time.time() - last_beat

            if age > HEARTBEAT_TIMEOUT:
                logger.warning("Agent '%s' has not responded in %.0fs — attempting restart", name, age)
                await self._restart_agent(name, agent)
            elif age > HEARTBEAT_TIMEOUT // 2:
                logger.info("Agent '%s' last beat %.0fs ago (approaching timeout)", name, age)

        await self._check_system_resources()

    async def _restart_agent(self, name: str, agent: Any):
        """Attempt to restart a stuck/crashed agent task."""
        self._restart_counts[name] = self._restart_counts.get(name, 0) + 1
        restart_num = self._restart_counts[name]

        if restart_num > 10:
            logger.error("Agent '%s' has restarted %d times — may have permanent error", name, restart_num)

        try:
            # Cancel the old asyncio task first — prevents duplicate instances accumulating
            old_task = self._agent_tasks.get(name)
            if old_task and not old_task.done():
                old_task.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(old_task), timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            if hasattr(agent, "stop"):
                try:
                    await asyncio.wait_for(agent.stop(), timeout=5.0)
                except Exception:
                    pass

            if hasattr(agent, "start"):
                new_task = asyncio.create_task(agent.start())
                self._agent_tasks[name] = new_task
                AgentHeartbeat.beat(name)
                logger.info("Agent '%s' restarted (#%d)", name, restart_num)

                if self._broadcast:
                    await self._broadcast({
                        "type": "guardian_alert",
                        "data": {
                            "agent": name,
                            "event": "RESTARTED",
                            "restart_count": restart_num,
                            "timestamp": datetime.now().isoformat(),
                        }
                    })
        except Exception as e:
            self._last_errors[name] = str(e)
            logger.error("Failed to restart '%s': %s", name, e)

    async def _check_system_resources(self):
        """Monitor CPU, memory, disk."""
        try:
            cpu = psutil.cpu_percent(interval=1)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage(str(Path(__file__).parent.parent))

            alerts = []
            if cpu > 90:
                alerts.append(f"HIGH CPU: {cpu:.0f}%")
            if mem.percent > 85:
                alerts.append(f"HIGH MEMORY: {mem.percent:.0f}%")
            if disk.percent > 90:
                alerts.append(f"LOW DISK: {disk.percent:.0f}% used")

            if alerts and self._broadcast:
                await self._broadcast({
                    "type": "guardian_alert",
                    "data": {
                        "agent": "system",
                        "event": "RESOURCE_WARNING",
                        "alerts": alerts,
                        "cpu_pct": cpu,
                        "mem_pct": mem.percent,
                        "disk_pct": disk.percent,
                        "timestamp": datetime.now().isoformat(),
                    }
                })
        except Exception as e:
            logger.debug("system_resources: %s", e)

    async def _update_db(self):
        """Write health status to DB."""
        from db.database import get_sqlite
        try:
            db = await get_sqlite()
            now = datetime.now().isoformat()
            beats = AgentHeartbeat.get_all()

            for name, agent in self._agent_refs.items():
                last_beat = beats.get(name, 0)
                age = time.time() - last_beat
                status = "OK" if age < HEARTBEAT_TIMEOUT else "DEAD"
                last_error = self._last_errors.get(name, "")
                restarts = self._restart_counts.get(name, 0)

                await db.execute(
                    """INSERT OR REPLACE INTO system_health
                       (service, status, last_heartbeat, restart_count, last_error)
                       VALUES (?, ?, ?, ?, ?)""",
                    (name, status, now if age < HEARTBEAT_TIMEOUT else None, restarts, last_error)
                )
            await db.commit()
        except Exception as e:
            logger.debug("guardian_update_db: %s", e)

    async def get_health_report(self) -> Dict:
        """Return current health status of all agents."""
        from db.database import get_sqlite
        try:
            db = await get_sqlite()
            async with db.execute(
                "SELECT service, status, last_heartbeat, restart_count, last_error FROM system_health"
            ) as cur:
                rows = await cur.fetchall()
        except Exception:
            rows = []

        beats = AgentHeartbeat.get_all()
        agents = []
        for name in self._agent_refs:
            last_beat = beats.get(name, 0)
            age = time.time() - last_beat
            agents.append({
                "name": name,
                "status": "OK" if age < HEARTBEAT_TIMEOUT else "DEAD",
                "last_beat_seconds_ago": round(age, 0),
                "restart_count": self._restart_counts.get(name, 0),
                "last_error": self._last_errors.get(name, ""),
            })

        try:
            cpu = psutil.cpu_percent()
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage(str(Path(__file__).parent.parent))
            system = {
                "cpu_pct": cpu,
                "mem_pct": mem.percent,
                "mem_available_gb": round(mem.available / 1e9, 2),
                "disk_pct": disk.percent,
                "disk_free_gb": round(disk.free / 1e9, 2),
            }
        except Exception:
            system = {}

        return {
            "agents": agents,
            "system": system,
            "updated_at": datetime.now().isoformat(),
        }

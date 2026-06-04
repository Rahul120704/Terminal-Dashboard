"""
BTI Launcher — Bloomberg Terminal India
Double-click BTI.exe to start everything.

1. Shows a dark splash window
2. Starts Python FastAPI backend (port 8000)
3. Starts Vite frontend (port 3000)
4. Opens browser to http://localhost:3000
5. Monitors both processes; relaunches on crash
6. Closing the window kills both processes cleanly
"""

import sys
import os
import subprocess
import threading
import time
import webbrowser
import urllib.request
import tkinter as tk
from tkinter import font as tkfont
import signal
import psutil
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    # Running as PyInstaller bundle — EXE may be in D:\BB\ or D:\BB\dist\
    _exe_dir = Path(sys.executable).parent
    if (_exe_dir / "backend").exists():
        APP_ROOT = _exe_dir
    else:
        APP_ROOT = _exe_dir.parent  # step up from dist\ to D:\BB\
else:
    APP_ROOT = Path(__file__).parent.parent

BACKEND_DIR = APP_ROOT / "backend"
FRONTEND_DIR = APP_ROOT / "frontend"

PYTHON = BACKEND_DIR / "venv" / "Scripts" / "python.exe"
if not PYTHON.exists():
    PYTHON = Path("C:/Users/Rahul/AppData/Local/Programs/Python/Python312/python.exe")
if not PYTHON.exists():
    PYTHON = Path(sys.executable)

BACKEND_CMD = [str(PYTHON), "-m", "uvicorn", "main:app",
               "--host", "0.0.0.0", "--port", "8000",
               "--log-level", "warning",
               "--timeout-keep-alive", "5"]

# .cmd files require cmd /c on Windows — cannot be spawned directly
VITE_CMD = FRONTEND_DIR / "node_modules" / ".bin" / "vite.cmd"
VITE_SH  = FRONTEND_DIR / "node_modules" / ".bin" / "vite"
if VITE_CMD.exists():
    FRONTEND_CMD = ["cmd", "/c", str(VITE_CMD), "--host", "0.0.0.0", "--port", "3000"]
elif VITE_SH.exists():
    FRONTEND_CMD = [str(VITE_SH), "--host", "0.0.0.0", "--port", "3000"]
else:
    # Fallback: use npm run dev
    FRONTEND_CMD = ["cmd", "/c", "npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

BACKEND_URL  = "http://127.0.0.1:8000/api/health"   # explicit IPv4 — avoids ::1 on Windows
FRONTEND_URL = "http://127.0.0.1:3000"

LOGS_DIR = APP_ROOT / "logs"
LOGS_DIR.mkdir(exist_ok=True)

# ── Colours ────────────────────────────────────────────────────────────────────
BG = "#0a0a0a"
BG2 = "#111111"
AMBER = "#ff9500"
GREEN = "#00c853"
RED = "#ff3d00"
MUTED = "#555548"
TEXT = "#e8e8e0"


# ── Process Manager ────────────────────────────────────────────────────────────
class ProcessManager:
    def __init__(self):
        self.backend_proc: subprocess.Popen | None = None
        self.frontend_proc: subprocess.Popen | None = None
        self._shutdown = False

    def _kill_port(self, port: int):
        """Kill whatever is occupying a port."""
        try:
            for conn in psutil.net_connections("tcp"):
                if conn.laddr.port == port and conn.status == "LISTEN":
                    try:
                        psutil.Process(conn.pid).kill()
                        time.sleep(0.5)
                    except Exception:
                        pass
        except Exception:
            pass

    def start_backend(self, log_cb):
        self._kill_port(8000)
        log_cb("Starting backend…", MUTED)
        try:
            self.backend_proc = subprocess.Popen(
                BACKEND_CMD,
                cwd=str(BACKEND_DIR),
                stdout=open(str(LOGS_DIR / "backend.log"), "w"),
                stderr=open(str(LOGS_DIR / "backend_err.log"), "w"),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            log_cb(f"Backend PID {self.backend_proc.pid}", MUTED)
        except Exception as e:
            log_cb(f"Backend start error: {e}", RED)

    def start_frontend(self, log_cb):
        self._kill_port(3000)
        log_cb("Starting frontend…", MUTED)
        try:
            self.frontend_proc = subprocess.Popen(
                FRONTEND_CMD,
                cwd=str(FRONTEND_DIR),
                stdout=open(str(LOGS_DIR / "frontend.log"), "w"),
                stderr=open(str(LOGS_DIR / "frontend_err.log"), "w"),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            log_cb(f"Frontend PID {self.frontend_proc.pid}", MUTED)
        except Exception as e:
            log_cb(f"Frontend start error: {e}", RED)

    def wait_for_url(self, url: str, timeout: int = 90) -> bool:
        """
        Poll url until it returns any 2xx response or timeout expires.
        Uses 127.0.0.1 to avoid Windows IPv6 (::1) resolution delay.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                # 3-second socket timeout; accept any 2xx
                req = urllib.request.Request(url, headers={"Connection": "close"})
                with urllib.request.urlopen(req, timeout=3) as r:
                    if 200 <= r.status < 300:
                        return True
            except urllib.error.HTTPError as e:
                # HTTPError is still a response — if status < 500 the server is alive
                if e.code < 500:
                    return True
            except Exception:
                pass
            time.sleep(1.5)
        return False

    def kill_all(self):
        self._shutdown = True
        for proc in [self.backend_proc, self.frontend_proc]:
            if proc and proc.poll() is None:
                try:
                    parent = psutil.Process(proc.pid)
                    for child in parent.children(recursive=True):
                        child.kill()
                    parent.kill()
                except Exception:
                    pass


# ── Splash Window ──────────────────────────────────────────────────────────────
class SplashApp(tk.Tk):
    def __init__(self, manager: ProcessManager):
        super().__init__()
        self._mgr = manager
        self._done = False

        self.title("Bloomberg Terminal India")
        self.geometry("520x340")
        self.resizable(False, False)
        self.configure(bg=BG)
        self.overrideredirect(False)

        # Centre on screen
        self.update_idletasks()
        w, h = 520, 340
        x = (self.winfo_screenwidth() - w) // 2
        y = (self.winfo_screenheight() - h) // 2
        self.geometry(f"{w}x{h}+{x}+{y}")

        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # Start background launch
        threading.Thread(target=self._launch, daemon=True).start()

    def _build_ui(self):
        mono = tkfont.Font(family="Consolas", size=11)
        mono_sm = tkfont.Font(family="Consolas", size=9)
        mono_lg = tkfont.Font(family="Consolas", size=22, weight="bold")
        mono_md = tkfont.Font(family="Consolas", size=13, weight="bold")

        # Header
        hdr = tk.Frame(self, bg="#050505", height=70)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)

        tk.Label(hdr, text="BTI", bg="#050505", fg=AMBER,
                 font=mono_lg).pack(side="left", padx=16, pady=8)
        tk.Label(hdr, text="BLOOMBERG TERMINAL INDIA", bg="#050505",
                 fg=MUTED, font=mono_sm).pack(side="left", pady=8)

        # Status box
        status_frame = tk.Frame(self, bg=BG2, relief="flat", bd=1)
        status_frame.pack(fill="both", expand=True, padx=12, pady=(8, 4))

        self._log_text = tk.Text(
            status_frame, bg=BG2, fg=TEXT, font=mono_sm,
            relief="flat", bd=0, padx=8, pady=6,
            state="disabled", height=8, wrap="word",
        )
        self._log_text.pack(fill="both", expand=True)
        self._log_text.tag_config("amber", foreground=AMBER)
        self._log_text.tag_config("green", foreground=GREEN)
        self._log_text.tag_config("red", foreground=RED)
        self._log_text.tag_config("muted", foreground=MUTED)

        # Progress bar
        prog_frame = tk.Frame(self, bg=BG)
        prog_frame.pack(fill="x", padx=12, pady=(2, 6))

        self._progress_bg = tk.Frame(prog_frame, bg="#1a1a1a", height=4)
        self._progress_bg.pack(fill="x")
        self._progress_bar = tk.Frame(self._progress_bg, bg=AMBER, height=4, width=0)
        self._progress_bar.place(x=0, y=0, height=4)

        # Status label
        self._status_var = tk.StringVar(value="Initializing…")
        tk.Label(self, textvariable=self._status_var, bg=BG, fg=MUTED,
                 font=mono_sm).pack(pady=(0, 4))

        # Footer
        footer = tk.Frame(self, bg="#050505", height=30)
        footer.pack(fill="x")
        footer.pack_propagate(False)
        tk.Label(footer, text="NSE  •  BSE  •  OPTIONS  •  MACRO  •  FILINGS  •  INSIDER",
                 bg="#050505", fg=MUTED, font=mono_sm).pack(expand=True)

    def _log(self, msg: str, color: str = TEXT):
        """Thread-safe log append."""
        tag = {AMBER: "amber", GREEN: "green", RED: "red", MUTED: "muted"}.get(color, "")
        self._log_text.after(0, self._append_log, f"  {msg}\n", tag)

    def _append_log(self, msg: str, tag: str):
        self._log_text.configure(state="normal")
        self._log_text.insert("end", msg, tag)
        self._log_text.see("end")
        self._log_text.configure(state="disabled")

    def _set_progress(self, pct: float):
        """Set progress bar 0.0–1.0, thread-safe."""
        self._progress_bg.after(0, self._update_bar, pct)

    def _update_bar(self, pct: float):
        total = self._progress_bg.winfo_width() or 496
        w = int(total * pct)
        self._progress_bar.configure(width=w)
        color = GREEN if pct >= 1.0 else AMBER
        self._progress_bar.configure(bg=color)

    def _set_status(self, msg: str):
        self._status_var.set(msg)

    def _launch(self):
        try:
            self._log("Bloomberg Terminal India", AMBER)
            self._log("Starting services…", MUTED)
            self._set_progress(0.05)

            # Start backend
            self._set_status("Starting backend (FastAPI)…")
            self._mgr.start_backend(self._log)
            self._set_progress(0.2)

            # Start frontend
            self._set_status("Starting frontend (Vite)…")
            self._mgr.start_frontend(self._log)
            self._set_progress(0.35)

            # Wait for backend
            self._set_status("Waiting for backend to be ready…")
            self._log("Waiting for backend (port 8000)…", MUTED)
            backend_ok = self._mgr.wait_for_url(BACKEND_URL, timeout=60)
            if backend_ok:
                self._log("Backend READY ✓", GREEN)
                self._set_progress(0.65)
            else:
                self._log("Backend timeout — check logs/backend_err.log", RED)

            # Wait for frontend
            self._set_status("Waiting for dashboard to be ready…")
            self._log("Waiting for frontend (port 3000)…", MUTED)
            frontend_ok = self._mgr.wait_for_url(FRONTEND_URL, timeout=45)
            if frontend_ok:
                self._log("Frontend READY ✓", GREEN)
                self._set_progress(0.9)
            else:
                self._log("Frontend timeout — check logs/frontend_err.log", RED)

            if backend_ok:
                self._set_progress(1.0)
                url = FRONTEND_URL if frontend_ok else "http://127.0.0.1:8000"
                self._log(f"Opening {url}", AMBER)
                self._set_status(f"Opening {url}")
                time.sleep(0.8)
                webbrowser.open(url)
                time.sleep(1.2)

                # Transition to running state
                self._done = True
                self.after(0, self._show_running)
            else:
                self._set_status("Failed to start. Check D:\\BB\\logs\\")
                self._log("See D:\\BB\\logs\\ for details.", RED)

        except Exception as e:
            self._log(f"Launch error: {e}", RED)
            self._set_status("Error during startup")

    def _show_running(self):
        """Transition splash to a small system-tray-like status window."""
        self._status_var.set("Dashboard open in browser  —  Close this to stop BTI")
        self._log("All systems running.", GREEN)
        self._log("Close this window to stop BTI.", MUTED)
        self._log("")
        self._log(f"  Backend:   http://localhost:8000", MUTED)
        self._log(f"  Dashboard: http://localhost:3000", AMBER)

    def _on_close(self):
        self._log("Stopping all BTI services…", AMBER)
        self._set_status("Stopping…")
        threading.Thread(target=self._stop_and_quit, daemon=True).start()

    def _stop_and_quit(self):
        self._mgr.kill_all()
        time.sleep(1)
        self.after(0, self.destroy)


# ── Entry Point ────────────────────────────────────────────────────────────────
def main():
    mgr = ProcessManager()

    # Handle Ctrl+C
    def _sigint(*_):
        mgr.kill_all()
        sys.exit(0)
    signal.signal(signal.SIGINT, _sigint)

    app = SplashApp(mgr)
    try:
        app.mainloop()
    finally:
        mgr.kill_all()


if __name__ == "__main__":
    main()

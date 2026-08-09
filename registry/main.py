import os
import sqlite3
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

DB_PATH = Path(__file__).parent / "registry.db"
ALIVE_SECONDS = int(os.getenv("ALIVE_SECONDS", "90"))
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "").rstrip("/")
REGISTRY_TOKEN = os.getenv("REGISTRY_TOKEN", "")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    conn = _connect()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS servers (
            server_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            machine TEXT NOT NULL,
            ngrok_url TEXT NOT NULL,
            last_seen REAL NOT NULL,
            created REAL NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


class RegisterRequest(BaseModel):
    server_id: str | None = None
    name: str
    machine: str
    ngrok_url: str


def _expire_old() -> None:
    conn = _connect()
    now = time.time()
    conn.execute("DELETE FROM servers WHERE last_seen < ?", (now - ALIVE_SECONDS,))
    conn.commit()
    conn.close()


def _cleanup_loop() -> None:
    while True:
        time.sleep(ALIVE_SECONDS // 3)
        try:
            _expire_old()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    _expire_old()
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    yield


app = FastAPI(title="Stefie Server Registry", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/register")
async def register(req: RegisterRequest):
    server_id = req.server_id or str(uuid.uuid4())[:8]
    now = time.time()
    conn = _connect()
    conn.execute(
        """
        INSERT INTO servers (server_id, name, machine, ngrok_url, last_seen, created)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id) DO UPDATE SET
            name = excluded.name,
            machine = excluded.machine,
            ngrok_url = excluded.ngrok_url,
            last_seen = excluded.last_seen
        """,
        (server_id, req.name, req.machine, req.ngrok_url, now, now),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "server_id": server_id}


@app.post("/api/heartbeat")
async def heartbeat(server_id: str):
    conn = _connect()
    cur = conn.execute(
        "UPDATE servers SET last_seen = ? WHERE server_id = ?",
        (time.time(), server_id),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Unknown server_id")
    return {"status": "ok"}


@app.delete("/api/unregister")
async def unregister(server_id: str):
    conn = _connect()
    conn.execute("DELETE FROM servers WHERE server_id = ?", (server_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/api/servers")
async def list_servers():
    _expire_old()
    conn = _connect()
    rows = conn.execute("SELECT * FROM servers ORDER BY created DESC").fetchall()
    conn.close()
    return [
        {
            "server_id": r["server_id"],
            "name": r["name"],
            "machine": r["machine"],
            "ngrok_url": r["ngrok_url"],
            "last_seen": r["last_seen"],
        }
        for r in rows
    ]


@app.get("/s/{server_id}", response_class=RedirectResponse)
async def go_to_server(server_id: str):
    conn = _connect()
    row = conn.execute("SELECT * FROM servers WHERE server_id = ?", (server_id,)).fetchone()
    conn.close()
    if not row or time.time() - row["last_seen"] > ALIVE_SECONDS:
        raise HTTPException(status_code=404, detail="Server offline or expired")
    if FRONTEND_BASE_URL:
        return RedirectResponse(f"{FRONTEND_BASE_URL}/?server={row['ngrok_url']}")
    return RedirectResponse(row["ngrok_url"])


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stefie Servers</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0;
         margin: 0; padding: 2rem; }
  h1 { font-size: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem; margin-top: 1.5rem; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px;
          padding: 1.25rem; }
  .name { font-size: 1.1rem; font-weight: 600; }
  .machine { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; }
  .status { display: inline-block; margin-top: 0.75rem; padding: 2px 10px;
            border-radius: 999px; font-size: 0.75rem; background: #166534; color: #bbf7d0; }
  .go { display: inline-block; margin-top: 0.75rem; background: #2563eb; color: white;
        text-decoration: none; padding: 8px 16px; border-radius: 8px; font-size: 0.9rem; }
  .go:hover { background: #1d4ed8; }
  .empty { color: #94a3b8; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Stefie Live Servers</h1>
<div class="grid" id="grid"></div>
<p class="empty" id="empty">Loading...</p>
<script>
async function load() {
  const res = await fetch('/api/servers');
  const servers = await res.json();
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  grid.innerHTML = '';
  if (!servers.length) { empty.style.display = 'block';
    empty.textContent = 'No servers online right now. Start a server and it will appear here.'; return; }
  empty.style.display = 'none';
  for (const s of servers) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="name">' + s.name + '</div>' +
      '<div class="machine">' + s.machine + '</div>' +
      '<div class="status">ONLINE</div><br>' +
      '<a class="go" href="/s/' + s.server_id + '">Open Dashboard</a>';
    grid.appendChild(card);
  }
}
load();
setInterval(load, 5000);
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
async def index():
    return _PAGE


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)

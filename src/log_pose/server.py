import json
from pathlib import Path
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import psycopg

from .storage import evidence, list_companies, overview


WEB_ROOT = Path(__file__).parents[2] / "web"
STATIC_FILES = {
    "/": ("live-index.html", "text/html; charset=utf-8"),
    "/app.js": ("live-app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}


def serve(port):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path)
            if path.path in STATIC_FILES:
                filename, content_type = STATIC_FILES[path.path]
                self.respond_bytes(200, (WEB_ROOT / filename).read_bytes(), content_type)
                return
            try:
                self.handle_api(path)
            except psycopg.OperationalError:
                self.respond(503, {"error": "local database unavailable"})

        def handle_api(self, path):
            if path.path in ("/api/companies", "/api/overview"):
                from .storage import connect
                with connect() as request_conn:
                    result = list_companies(request_conn) if path.path == "/api/companies" else overview(request_conn)
                self.respond(200, result)
                return
            parts = path.path.strip("/").split("/")
            if len(parts) != 3 or parts[:2] != ["api", "companies"]:
                self.respond(404, {"error": "not found"})
                return
            value = parse_qs(path.query).get("cutoff", [None])[0]
            try:
                cutoff = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if cutoff.tzinfo is None:
                    raise ValueError("cutoff requires timezone")
                # Each request owns its connection; psycopg cursors are not shared across threads.
                from .storage import connect
                with connect() as request_conn:
                    result = evidence(request_conn, parts[2], cutoff)
                self.respond(200, result)
            except (ValueError, AttributeError):
                self.respond(400, {"error": "use ?cutoff=2021-12-31T23:59:59Z"})
            except KeyError:
                self.respond(404, {"error": "unknown company"})

        def respond(self, code, payload):
            body = json.dumps(payload).encode()
            self.respond_bytes(code, body, "application/json; charset=utf-8")

        def respond_bytes(self, code, body, content_type):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"local preview: http://127.0.0.1:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

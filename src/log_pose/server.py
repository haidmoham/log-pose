import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .storage import evidence


def serve(port):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path)
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
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"read API: http://127.0.0.1:{port}/api/companies/dbt-labs?cutoff=2021-12-31T23:59:59Z")
    server.serve_forever()

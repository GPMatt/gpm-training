"""
Local-only demo server. Holds the Rentvine sandbox credentials server-side
(pipeline.py) so index.html never sees them. Run with:

    python3 server.py

Then open http://localhost:8420 and click the button.
"""
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(HERE, "assets")
PORT = 8420


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self._serve_file("index.html", "text/html")
        elif self.path == "/api/invoices":
            self._json(200, pipeline.preview_invoices())
        elif self.path == "/api/ledger":
            self._json(200, pipeline.current_ledger())
        elif self.path.startswith("/assets/"):
            self._serve_asset(self.path[len("/assets/"):])
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/api/run":
            try:
                result = pipeline.run_demo()
                self._json(200, result)
            except Exception as e:  # noqa: BLE001
                self._json(500, {"error": str(e)})
        elif self.path == "/api/reset":
            try:
                self._json(200, pipeline.reset_ledger())
            except Exception as e:  # noqa: BLE001
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def _serve_file(self, name, content_type):
        path = os.path.join(HERE, name)
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_asset(self, name):
        # no path traversal outside assets/
        safe_name = os.path.basename(name)
        path = os.path.join(ASSETS_DIR, safe_name)
        if not os.path.isfile(path):
            self._json(404, {"error": "not found"})
            return
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("[server]", fmt % args)


if __name__ == "__main__":
    print(f"Vendor AP demo running at http://localhost:{PORT}")
    ThreadingHTTPServer(("localhost", PORT), Handler).serve_forever()

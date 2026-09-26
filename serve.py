#!/usr/bin/env python3
"""Local server for UltraEdge (no-cache so code updates always load).
Usage: python3 serve.py [port]   → http://localhost:8001/
Camera/mic only work on http://localhost or https — open it on this computer."""
import http.server, sys, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
print(f'UltraEdge running at http://localhost:{port}/  (Ctrl+C to stop)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()

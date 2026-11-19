"""HTTP server for the forum application."""

import http.server
import socketserver
import threading
import signal
import sys
from typing import Optional

from .router import Router
from .config import HOST, PORT


class ForumRequestHandler(http.server.BaseHTTPRequestHandler):
    """Custom request handler that uses the router."""
    
    router = Router()
    
    def do_GET(self):
        if not self.router.route(self):
            self.send_error(404, "Not found")
    
    def do_POST(self):
        if not self.router.route(self):
            self.send_error(404, "Not found")
    
    def do_PUT(self):
        if not self.router.route(self):
            self.send_error(404, "Not found")
    
    def do_DELETE(self):
        if not self.router.route(self):
            self.send_error(404, "Not found")
    
    def log_message(self, format: str, *args):
        """Override to customize logging."""
        # Simplified logging
        print(f"{self.address_string()} - {format % args}")


class ForumServer:
    """Manages the forum HTTP server."""
    
    def __init__(self, host: str = HOST, port: int = PORT):
        self.host = host
        self.port = port
        self.server: Optional[socketserver.TCPServer] = None
        self.server_thread: Optional[threading.Thread] = None
        
    def start(self):
        """Start the server in a background thread."""
        self.server = socketserver.TCPServer((self.host, self.port), ForumRequestHandler)
        self.server.allow_reuse_address = True
        
        print(f"Starting forum server on {self.host}:{self.port}")
        print("Press Ctrl+C to stop")
        
        # Set up signal handler for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        
        self.server_thread = threading.Thread(target=self.server.serve_forever)
        self.server_thread.daemon = True
        self.server_thread.start()
        
    def stop(self):
        """Stop the server."""
        if self.server:
            print("Shutting down server...")
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        
        if self.server_thread:
            self.server_thread.join(timeout=5)
            self.server_thread = None
    
    def _signal_handler(self, signum, frame):
        """Handle interrupt signal."""
        self.stop()
        sys.exit(0)
    
    def wait(self):
        """Wait for server thread to complete."""
        if self.server_thread:
            self.server_thread.join()


def main():
    """Main entry point."""
    server = ForumServer()
    server.start()
    server.wait()


if __name__ == '__main__':
    main()
"""URL router for the forum server."""

from http.server import BaseHTTPRequestHandler
from typing import Dict, Callable, Any
from urllib.parse import urlparse

from .handlers.user_handler import UserHandler
from .storage.user_storage import UserStorage
from .config import USERS_FILE


class Router:
    """Routes requests to appropriate handlers."""
    
    def __init__(self):
        self.user_storage = UserStorage(USERS_FILE)
        self.routes: Dict[str, Callable] = {
            '/api/users': self._handle_user_request,
            '/api/users/login': self._handle_user_request,
            '/api/users/logout': self._handle_user_request,
            '/api/users/avatar': self._handle_user_request,
            '/api/users/me': self._handle_user_request,
        }
    
    def route(self, handler: BaseHTTPRequestHandler) -> bool:
        """
        Route the request to the appropriate handler.
        
        Returns:
            True if request was handled, False if no route matched
        """
        parsed = urlparse(handler.path)
        path = parsed.path
        
        # Check for exact matches first
        if path in self.routes:
            return self.routes[path](handler)
        
        # Check for patterns like /api/users/{id}
        if path.startswith('/api/users/') and len(path.split('/')) == 4:
            return self._handle_user_request(handler)
        
        return False
    
    def _handle_user_request(self, handler: BaseHTTPRequestHandler) -> bool:
        """Handle user-related requests."""
        # Create a UserHandler with the shared storage
        user_handler = UserHandler(
            handler.request,
            handler.client_address,
            handler.server,
            user_storage=self.user_storage
        )
        
        # Copy attributes to make it work
        user_handler.headers = handler.headers
        user_handler.rfile = handler.rfile
        user_handler.wfile = handler.wfile
        user_handler.path = handler.path
        user_handler.command = handler.command
        
        # Handle the request
        method = handler.command.lower()
        if hasattr(user_handler, f'do_{method}'):
            getattr(user_handler, f'do_{method}')()
            return True
        
        return False
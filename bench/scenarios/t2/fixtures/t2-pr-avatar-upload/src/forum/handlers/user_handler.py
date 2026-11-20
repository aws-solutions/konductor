"""User-related HTTP request handlers."""

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Dict, Any
from urllib.parse import parse_qs, urlparse

from ..storage.user_storage import UserStorage
from ..utils.image_helpers import process_image_upload
from ..config import UPLOAD_DIR, MAX_UPLOAD_SIZE, ALLOWED_MIME_TYPES


class UserHandler(BaseHTTPRequestHandler):
    """Handles user-related HTTP requests."""
    
    def __init__(self, *args, user_storage: UserStorage, **kwargs):
        self.user_storage = user_storage
        super().__init__(*args, **kwargs)
    
    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        
        if path == '/api/users/me':
            self._handle_get_current_user()
        elif path.startswith('/api/users/'):
            user_id = path.split('/')[-1]
            self._handle_get_user(user_id)
        else:
            self.send_error(404, "Not found")
    
    def do_POST(self):
        """Handle POST requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        
        if path == '/api/users':
            self._handle_create_user()
        elif path == '/api/users/login':
            self._handle_login()
        elif path == '/api/users/logout':
            self._handle_logout()
        elif path == '/api/users/avatar':
            self._handle_upload_avatar()
        else:
            self.send_error(404, "Not found")
    
    def do_PUT(self):
        """Handle PUT requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        
        if path.startswith('/api/users/'):
            user_id = path.split('/')[-1]
            self._handle_update_user(user_id)
        else:
            self.send_error(404, "Not found")
    
    def _handle_get_current_user(self):
        """Get current authenticated user."""
        # Simplified auth - in real code would check session/cookie
        user_id = self._get_current_user_id()
        if not user_id:
            self.send_error(401, "Unauthorized")
            return
        
        user = self.user_storage.get_user(user_id)
        if not user:
            self.send_error(404, "User not found")
            return
        
        self._send_json_response({
            'user_id': user.user_id,
            'email': user.email,
            'username': user.username,
            'avatar_url': user.avatar_url,
            'post_count': user.post_count,
            'created_at': user.created_at
        })
    
    def _handle_get_user(self, user_id: str):
        """Get user by ID."""
        user = self.user_storage.get_user(user_id)
        if not user:
            self.send_error(404, "User not found")
            return
        
        self._send_json_response({
            'user_id': user.user_id,
            'username': user.username,
            'avatar_url': user.avatar_url,
            'post_count': user.post_count,
            'created_at': user.created_at
        })
    
    def _handle_create_user(self):
        """Create a new user."""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty request body")
            return
        
        try:
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return
        
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        if not all([email, username, password]):
            self.send_error(400, "Missing required fields")
            return
        
        user = self.user_storage.create_user(email, username, password)
        if not user:
            self.send_error(409, "User already exists")
            return
        
        self._send_json_response({
            'user_id': user.user_id,
            'email': user.email,
            'username': user.username,
            'created_at': user.created_at
        }, status=201)
    
    def _handle_login(self):
        """Handle user login."""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty request body")
            return
        
        try:
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            self.send_error(400, "Missing email or password")
            return
        
        user = self.user_storage.get_user_by_email(email)
        if not user or not user.verify_password(password):
            self.send_error(401, "Invalid credentials")
            return
        
        user.update_last_login()
        self.user_storage.update_user(user)
        
        # Simplified session - just set a cookie
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Set-Cookie', f'session={user.user_id}; HttpOnly')
        self.end_headers()
        
        self.wfile.write(json.dumps({
            'user_id': user.user_id,
            'username': user.username,
            'avatar_url': user.avatar_url
        }).encode('utf-8'))
    
    def _handle_logout(self):
        """Handle user logout."""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Set-Cookie', 'session=; Max-Age=0; HttpOnly')
        self.end_headers()
        self.wfile.write(json.dumps({'message': 'Logged out'}).encode('utf-8'))
    
    def _handle_update_user(self, user_id: str):
        """Update user information."""
        # Check authorization
        current_user_id = self._get_current_user_id()
        if current_user_id != user_id:
            self.send_error(403, "Forbidden")
            return
        
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty request body")
            return
        
        try:
            data = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return
        
        user = self.user_storage.get_user(user_id)
        if not user:
            self.send_error(404, "User not found")
            return
        
        # Update fields
        if 'username' in data:
            user.username = data['username']
        
        if 'avatar_url' in data:
            user.avatar_url = data['avatar_url']
        
        self.user_storage.update_user(user)
        
        self._send_json_response({
            'user_id': user.user_id,
            'username': user.username,
            'avatar_url': user.avatar_url,
            'updated': True
        })
    
    def _handle_upload_avatar(self):
        """Handle avatar image upload."""
        # Check authorization
        user_id = self._get_current_user_id()
        if not user_id:
            self.send_error(401, "Unauthorized")
            return
        
        user = self.user_storage.get_user(user_id)
        if not user:
            self.send_error(404, "User not found")
            return
        
        # Check content type
        content_type = self.headers.get('Content-Type', '')
        if not content_type.startswith('multipart/form-data'):
            self.send_error(400, "Expected multipart/form-data")
            return
        
        # Parse multipart data (simplified)
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self.send_error(400, "Empty request body")
            return
        
        # Read the file data
        # In real code, we'd properly parse multipart
        # For this example, assume file is the entire body
        file_data = self.rfile.read(content_length)
        
        # Get filename from headers
        content_disposition = self.headers.get('Content-Disposition', '')
        filename = None
        for part in content_disposition.split(';'):
            part = part.strip()
            if part.startswith('filename='):
                filename = part[9:].strip('"\'')
                break
        
        if not filename:
            self.send_error(400, "No filename provided")
            return
        
        # Process the upload
        success, saved_path, error = process_image_upload(
            file_data=file_data,
            content_type=content_type,
            original_filename=filename,
            upload_dir=UPLOAD_DIR
        )
        
        if not success:
            self.send_error(400, error)
            return
        
        # Generate public URL
        public_url = f"/uploads/{user.email}/{os.path.basename(saved_path)}"
        
        # Update user with new avatar URL
        user.avatar_url = public_url
        self.user_storage.update_user(user)
        
        self._send_json_response({
            'avatar_url': public_url,
            'message': 'Avatar uploaded successfully'
        })
    
    def _get_current_user_id(self) -> Optional[str]:
        """Get current user ID from session cookie."""
        cookie_header = self.headers.get('Cookie', '')
        cookies = dict(cookie.split('=', 1) for cookie in cookie_header.split('; ') if '=' in cookie)
        return cookies.get('session')
    
    def _send_json_response(self, data: Dict[str, Any], status: int = 200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
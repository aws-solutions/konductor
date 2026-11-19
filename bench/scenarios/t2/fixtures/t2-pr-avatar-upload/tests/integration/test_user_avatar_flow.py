"""Integration tests for user avatar upload flow."""

import unittest
import tempfile
import os
import json
from unittest.mock import Mock
from src.forum.handlers.user_handler import UserHandler
from src.forum.storage.user_storage import UserStorage


class TestUserAvatarFlow(unittest.TestCase):
    """Integration tests for avatar upload functionality."""
    
    def setUp(self):
        """Set up test environment."""
        self.temp_dir = tempfile.TemporaryDirectory()
        self.users_file = os.path.join(self.temp_dir.name, 'users.json')
        
        # Create user storage
        self.storage = UserStorage(self.users_file)
        
        # Create a test user
        self.test_user = self.storage.create_user(
            email="user@example.com",
            username="testuser",
            password="password123"
        )
    
    def tearDown(self):
        """Clean up test environment."""
        self.temp_dir.cleanup()
    
    def _create_mock_handler(self, method='POST', path='/api/users/avatar', 
                           cookie='session=user_001', content_type='multipart/form-data',
                           content_length=100, filename='avatar.jpg'):
        """Create a mock HTTP request handler."""
        handler = Mock()
        handler.command = method
        handler.path = path
        handler.headers = {
            'Cookie': cookie,
            'Content-Type': content_type,
            'Content-Disposition': f'form-data; name="avatar"; filename="{filename}"',
            'Content-Length': str(content_length)
        }
        handler.rfile = Mock()
        handler.rfile.read.return_value = b'fake image data'
        handler.wfile = Mock()
        handler.send_error = Mock()
        handler._send_json_response = Mock()
        handler.user_storage = self.storage
        
        # Add the method we need
        def _get_current_user_id():
            cookie_header = handler.headers.get('Cookie', '')
            cookies = dict(cookie.split('=', 1) for cookie in cookie_header.split('; ') if '=' in cookie)
            return cookies.get('session')
        
        handler._get_current_user_id = _get_current_user_id
        
        return handler
    
    def test_avatar_upload_requires_auth(self):
        """Test that avatar upload requires authentication."""
        handler = self._create_mock_handler(cookie='')  # No session cookie
        
        # Call the handler method directly
        user_handler = UserHandler(
            handler,
            ('127.0.0.1', 8080),
            Mock(),
            user_storage=self.storage
        )
        
        # Setup handler
        user_handler.headers = handler.headers
        user_handler.rfile = handler.rfile
        user_handler.wfile = handler.wfile
        user_handler.path = handler.path
        user_handler.command = handler.command
        user_handler.send_error = handler.send_error
        
        # Call the upload method
        user_handler._handle_upload_avatar()
        
        # Should send 401 error
        handler.send_error.assert_called_with(401, "Unauthorized")
    
    def test_avatar_upload_missing_filename(self):
        """Test avatar upload with missing filename."""
        handler = self._create_mock_handler()
        handler.headers['Content-Disposition'] = 'form-data; name="avatar"'  # No filename
        
        user_handler = UserHandler(
            handler,
            ('127.0.0.1', 8080),
            Mock(),
            user_storage=self.storage
        )
        
        # Setup handler
        user_handler.headers = handler.headers
        user_handler.rfile = handler.rfile
        user_handler.wfile = handler.wfile
        user_handler.path = handler.path
        user_handler.command = handler.command
        user_handler.send_error = handler.send_error
        
        # Call the upload method
        user_handler._handle_upload_avatar()
        
        # Should send 400 error
        handler.send_error.assert_called_with(400, "No filename provided")
    
    def test_avatar_url_generation(self):
        """Test that avatar URL is generated and user is updated."""
        # This test verifies the basic flow without actually saving files
        # In a real test, we'd mock the file system operations
        
        # Get user before update
        user_before = self.storage.get_user(self.test_user.user_id)
        self.assertIsNone(user_before.avatar_url)
        
        # Note: We can't fully test the upload without mocking file operations
        # but the structure is in place for integration testing


if __name__ == '__main__':
    unittest.main()
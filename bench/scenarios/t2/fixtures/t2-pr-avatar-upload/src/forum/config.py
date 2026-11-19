"""Configuration settings for the forum application."""

import os

# Server configuration
HOST = os.environ.get('FORUM_HOST', 'localhost')
PORT = int(os.environ.get('FORUM_PORT', '8080'))

# Database configuration
DATA_DIR = os.environ.get('FORUM_DATA_DIR', './data')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
POSTS_FILE = os.path.join(DATA_DIR, 'posts.json')

# Upload configuration
UPLOAD_DIR = os.environ.get('FORUM_UPLOAD_DIR', './uploads')
MAX_UPLOAD_SIZE = int(os.environ.get('FORUM_MAX_UPLOAD_SIZE', '2097152'))  # 2MB

# Allowed file types for uploads
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif'}
ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/gif'}

# Security settings
SESSION_TIMEOUT = 3600  # 1 hour
PASSWORD_MIN_LENGTH = 8

# Logging
LOG_LEVEL = os.environ.get('FORUM_LOG_LEVEL', 'INFO')
LOG_FILE = os.environ.get('FORUM_LOG_FILE', './forum.log')
"""User model for the forum application."""

import json
import time
from typing import Optional, Dict, Any
from hashlib import sha256


class User:
    """Represents a forum user."""
    
    def __init__(self, user_id: str, email: str, username: str, password_hash: str, 
                 created_at: float = None, avatar_url: Optional[str] = None):
        self.user_id = user_id
        self.email = email
        self.username = username
        self.password_hash = password_hash
        self.created_at = created_at or time.time()
        self.avatar_url = avatar_url
        self.last_login = None
        self.post_count = 0
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert user to dictionary for serialization."""
        return {
            'user_id': self.user_id,
            'email': self.email,
            'username': self.username,
            'password_hash': self.password_hash,
            'created_at': self.created_at,
            'avatar_url': self.avatar_url,
            'last_login': self.last_login,
            'post_count': self.post_count
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'User':
        """Create user from dictionary."""
        user = cls(
            user_id=data['user_id'],
            email=data['email'],
            username=data['username'],
            password_hash=data['password_hash'],
            created_at=data.get('created_at'),
            avatar_url=data.get('avatar_url')
        )
        user.last_login = data.get('last_login')
        user.post_count = data.get('post_count', 0)
        return user
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using SHA-256."""
        return sha256(password.encode('utf-8')).hexdigest()
    
    def verify_password(self, password: str) -> bool:
        """Verify a password against the stored hash."""
        return self.password_hash == User.hash_password(password)
    
    def update_last_login(self):
        """Update the last login timestamp."""
        self.last_login = time.time()
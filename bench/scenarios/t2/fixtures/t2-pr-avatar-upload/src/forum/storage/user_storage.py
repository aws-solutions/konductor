"""User storage implementation."""

import json
import os
import threading
from typing import Optional, Dict, List
from ..models.user import User


class UserStorage:
    """Manages user data persistence."""
    
    def __init__(self, data_file: str):
        self.data_file = data_file
        self._lock = threading.RLock()
        self._users: Dict[str, User] = {}
        self._load()
    
    def _load(self):
        """Load users from disk."""
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for user_data in data.get('users', []):
                        user = User.from_dict(user_data)
                        self._users[user.user_id] = user
            except (json.JSONDecodeError, IOError):
                # Start with empty storage if file is corrupted
                self._users = {}
        else:
            self._users = {}
    
    def _save(self):
        """Save users to disk."""
        with self._lock:
            data = {
                'users': [user.to_dict() for user in self._users.values()]
            }
            os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
            with open(self.data_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
    
    def create_user(self, email: str, username: str, password: str) -> Optional[User]:
        """Create a new user."""
        with self._lock:
            # Check if email already exists
            for user in self._users.values():
                if user.email == email:
                    return None
            
            user_id = f"user_{len(self._users) + 1:06d}"
            password_hash = User.hash_password(password)
            user = User(user_id, email, username, password_hash)
            self._users[user.user_id] = user
            self._save()
            return user
    
    def get_user(self, user_id: str) -> Optional[User]:
        """Get user by ID."""
        return self._users.get(user_id)
    
    def get_user_by_email(self, email: str) -> Optional[User]:
        """Get user by email."""
        for user in self._users.values():
            if user.email == email:
                return user
        return None
    
    def get_user_by_username(self, username: str) -> Optional[User]:
        """Get user by username."""
        for user in self._users.values():
            if user.username == username:
                return user
        return None
    
    def update_user(self, user: User) -> bool:
        """Update user data."""
        with self._lock:
            if user.user_id in self._users:
                self._users[user.user_id] = user
                self._save()
                return True
            return False
    
    def delete_user(self, user_id: str) -> bool:
        """Delete a user."""
        with self._lock:
            if user_id in self._users:
                del self._users[user_id]
                self._save()
                return True
            return False
    
    def list_users(self, skip: int = 0, limit: int = 100) -> List[User]:
        """List users with pagination."""
        users = list(self._users.values())
        return users[skip:skip + limit]
    
    def user_count(self) -> int:
        """Get total number of users."""
        return len(self._users)
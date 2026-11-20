"""Unit tests for user model."""

import unittest
import time
from src.forum.models.user import User


class TestUserModel(unittest.TestCase):
    """Test cases for User model."""
    
    def test_user_creation(self):
        """Test creating a user."""
        user = User(
            user_id="user_001",
            email="test@example.com",
            username="testuser",
            password_hash="hash123"
        )
        
        self.assertEqual(user.user_id, "user_001")
        self.assertEqual(user.email, "test@example.com")
        self.assertEqual(user.username, "testuser")
        self.assertEqual(user.password_hash, "hash123")
        self.assertIsNotNone(user.created_at)
        self.assertIsNone(user.avatar_url)
    
    def test_password_hashing(self):
        """Test password hashing and verification."""
        password = "securepassword123"
        hashed = User.hash_password(password)
        
        # Should produce consistent hash
        self.assertEqual(hashed, User.hash_password(password))
        
        # Different password should produce different hash
        self.assertNotEqual(hashed, User.hash_password("different"))
    
    def test_password_verification(self):
        """Test password verification."""
        password = "securepassword123"
        hashed = User.hash_password(password)
        
        user = User(
            user_id="user_001",
            email="test@example.com",
            username="testuser",
            password_hash=hashed
        )
        
        self.assertTrue(user.verify_password(password))
        self.assertFalse(user.verify_password("wrongpassword"))
    
    def test_to_dict_and_from_dict(self):
        """Test serialization and deserialization."""
        original = User(
            user_id="user_001",
            email="test@example.com",
            username="testuser",
            password_hash="hash123",
            avatar_url="/uploads/avatar.jpg"
        )
        
        # Convert to dict
        data = original.to_dict()
        
        # Convert back to User
        restored = User.from_dict(data)
        
        # Should match original
        self.assertEqual(restored.user_id, original.user_id)
        self.assertEqual(restored.email, original.email)
        self.assertEqual(restored.username, original.username)
        self.assertEqual(restored.password_hash, original.password_hash)
        self.assertEqual(restored.avatar_url, original.avatar_url)
    
    def test_update_last_login(self):
        """Test updating last login timestamp."""
        user = User(
            user_id="user_001",
            email="test@example.com",
            username="testuser",
            password_hash="hash123"
        )
        
        self.assertIsNone(user.last_login)
        
        user.update_last_login()
        self.assertIsNotNone(user.last_login)
        
        # Should be recent
        self.assertAlmostEqual(user.last_login, time.time(), delta=1)


if __name__ == '__main__':
    unittest.main()
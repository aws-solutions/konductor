"""Unit tests for user storage."""

import unittest
import tempfile
import os
import json
from src.forum.storage.user_storage import UserStorage


class TestUserStorage(unittest.TestCase):
    """Test cases for UserStorage."""
    
    def setUp(self):
        """Set up test environment."""
        # Create a temporary file for testing
        self.temp_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json')
        self.temp_file.close()
        
        self.storage = UserStorage(self.temp_file.name)
    
    def tearDown(self):
        """Clean up test environment."""
        if os.path.exists(self.temp_file.name):
            os.unlink(self.temp_file.name)
    
    def test_create_user(self):
        """Test creating a new user."""
        user = self.storage.create_user(
            email="test@example.com",
            username="testuser",
            password="password123"
        )
        
        self.assertIsNotNone(user)
        self.assertEqual(user.email, "test@example.com")
        self.assertEqual(user.username, "testuser")
        self.assertTrue(user.verify_password("password123"))
        
        # User should be retrievable
        retrieved = self.storage.get_user(user.user_id)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.email, user.email)
    
    def test_duplicate_email(self):
        """Test that duplicate emails are rejected."""
        user1 = self.storage.create_user(
            email="test@example.com",
            username="user1",
            password="pass1"
        )
        self.assertIsNotNone(user1)
        
        user2 = self.storage.create_user(
            email="test@example.com",  # Same email
            username="user2",
            password="pass2"
        )
        self.assertIsNone(user2)
    
    def test_get_user_by_email(self):
        """Test retrieving user by email."""
        user = self.storage.create_user(
            email="test@example.com",
            username="testuser",
            password="password123"
        )
        
        found = self.storage.get_user_by_email("test@example.com")
        self.assertIsNotNone(found)
        self.assertEqual(found.user_id, user.user_id)
        
        not_found = self.storage.get_user_by_email("nonexistent@example.com")
        self.assertIsNone(not_found)
    
    def test_update_user(self):
        """Test updating user information."""
        user = self.storage.create_user(
            email="test@example.com",
            username="testuser",
            password="password123"
        )
        
        # Update username
        user.username = "updateduser"
        user.avatar_url = "/uploads/avatar.jpg"
        
        success = self.storage.update_user(user)
        self.assertTrue(success)
        
        # Verify update
        updated = self.storage.get_user(user.user_id)
        self.assertEqual(updated.username, "updateduser")
        self.assertEqual(updated.avatar_url, "/uploads/avatar.jpg")
    
    def test_delete_user(self):
        """Test deleting a user."""
        user = self.storage.create_user(
            email="test@example.com",
            username="testuser",
            password="password123"
        )
        
        # Should exist
        self.assertIsNotNone(self.storage.get_user(user.user_id))
        
        # Delete
        success = self.storage.delete_user(user.user_id)
        self.assertTrue(success)
        
        # Should not exist
        self.assertIsNone(self.storage.get_user(user.user_id))
    
    def test_list_users(self):
        """Test listing users with pagination."""
        # Create multiple users
        for i in range(5):
            self.storage.create_user(
                email=f"user{i}@example.com",
                username=f"user{i}",
                password=f"password{i}"
            )
        
        users = self.storage.list_users()
        self.assertEqual(len(users), 5)
        
        # Test pagination
        first_two = self.storage.list_users(skip=0, limit=2)
        self.assertEqual(len(first_two), 2)
        
        next_two = self.storage.list_users(skip=2, limit=2)
        self.assertEqual(len(next_two), 2)
    
    def test_persistence(self):
        """Test that data persists across instances."""
        # Create user with first storage instance
        user = self.storage.create_user(
            email="test@example.com",
            username="testuser",
            password="password123"
        )
        
        # Create new storage instance with same file
        new_storage = UserStorage(self.temp_file.name)
        
        # Should find the user
        found = new_storage.get_user(user.user_id)
        self.assertIsNotNone(found)
        self.assertEqual(found.email, user.email)


if __name__ == '__main__':
    unittest.main()
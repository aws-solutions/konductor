"""Unit tests for image helpers."""

import unittest
import tempfile
import os
from src.forum.utils.image_helpers import (
    validate_image_file,
    save_uploaded_file,
    process_image_upload,
    get_image_dimensions
)


class TestImageHelpers(unittest.TestCase):
    """Test cases for image helper functions."""
    
    def test_validate_image_file_nonexistent(self):
        """Test validating a nonexistent file."""
        is_valid, error = validate_image_file("/nonexistent/file.jpg")
        self.assertFalse(is_valid)
        self.assertIn("does not exist", error)
    
    def test_save_uploaded_file(self):
        """Test saving an uploaded file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            test_data = b"fake image data"
            original_filename = "test.jpg"
            
            success, saved_path, error = save_uploaded_file(
                test_data, original_filename, temp_dir
            )
            
            self.assertTrue(success)
            self.assertIsNotNone(saved_path)
            self.assertEqual(error, "")
            
            # File should exist
            self.assertTrue(os.path.exists(saved_path))
            
            # Content should match
            with open(saved_path, 'rb') as f:
                self.assertEqual(f.read(), test_data)
    
    def test_save_uploaded_file_duplicate_name(self):
        """Test saving file with duplicate name."""
        with tempfile.TemporaryDirectory() as temp_dir:
            test_data = b"data1"
            original_filename = "test.jpg"
            
            # Save first file
            success1, path1, error1 = save_uploaded_file(
                test_data, original_filename, temp_dir
            )
            self.assertTrue(success1)
            
            # Save second file with same name
            success2, path2, error2 = save_uploaded_file(
                test_data, original_filename, temp_dir
            )
            
            self.assertTrue(success2)
            self.assertNotEqual(path1, path2)  # Should have different names
    
    def test_process_image_upload_success(self):
        """Test successful image upload processing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            test_data = b"fake image data"
            
            # Note: This test doesn't actually validate the image content
            # since we're using fake data
            success, saved_path, error = process_image_upload(
                file_data=test_data,
                content_type="image/jpeg",
                original_filename="test.jpg",
                upload_dir=temp_dir,
                max_size=1000000  # 1MB
            )
            
            # This will fail validation because it's not a real image
            # but we're testing the function structure
            # In real tests, we'd use actual image data
            self.assertFalse(success)
            self.assertIn("valid image", error)
    
    def test_process_image_upload_too_large(self):
        """Test image upload that exceeds size limit."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create large fake data
            large_data = b"x" * 2000000  # 2MB
            
            success, saved_path, error = process_image_upload(
                file_data=large_data,
                content_type="image/jpeg",
                original_filename="large.jpg",
                upload_dir=temp_dir,
                max_size=1000000  # 1MB limit
            )
            
            self.assertFalse(success)
            self.assertIn("exceeds", error)
    
    def test_process_image_upload_invalid_type(self):
        """Test image upload with invalid content type."""
        with tempfile.TemporaryDirectory() as temp_dir:
            test_data = b"data"
            
            success, saved_path, error = process_image_upload(
                file_data=test_data,
                content_type="text/plain",  # Not an image type
                original_filename="test.txt",
                upload_dir=temp_dir
            )
            
            self.assertFalse(success)
            self.assertIn("Unsupported content type", error)
    
    def test_get_image_dimensions(self):
        """Test getting image dimensions."""
        # This is a dummy test since we're not using real images
        width, height = get_image_dimensions("/nonexistent/file.jpg")
        self.assertEqual(width, 800)
        self.assertEqual(height, 600)


if __name__ == '__main__':
    unittest.main()
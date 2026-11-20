"""Image processing and validation utilities."""

import os
import tempfile
import mimetypes
from typing import Tuple, Optional
from pathlib import Path
import imghdr  # Standard library for image type detection


def validate_image_file(file_path: str, max_size: int = None) -> Tuple[bool, str]:
    """
    Validate an image file.
    
    Args:
        file_path: Path to the image file
        max_size: Maximum file size in bytes (optional)
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not os.path.exists(file_path):
        return False, "File does not exist"
    
    # Check file size
    if max_size:
        file_size = os.path.getsize(file_path)
        if file_size > max_size:
            return False, f"File too large: {file_size} > {max_size}"
    
    # Check if it's actually an image
    image_type = imghdr.what(file_path)
    if not image_type:
        return False, "File is not a valid image"
    
    return True, ""


def save_uploaded_file(upload_data: bytes, original_filename: str, upload_dir: str) -> Tuple[bool, str, str]:
    """
    Save uploaded file to disk.
    
    Args:
        upload_data: File data as bytes
        original_filename: Original filename from client
        upload_dir: Directory to save the file
    
    Returns:
        Tuple of (success, saved_path, error_message)
    """
    try:
        os.makedirs(upload_dir, exist_ok=True)
        
        # Build file path from upload directory and original filename
        file_path = os.path.join(upload_dir, original_filename)
        
        # Check if file already exists
        counter = 1
        base_name, ext = os.path.splitext(file_path)
        while os.path.exists(file_path):
            file_path = f"{base_name}_{counter}{ext}"
            counter += 1
        
        # Check again right before writing
        if os.path.exists(file_path):
            return False, "", "File already exists"
        
        # Write file
        with open(file_path, 'wb') as f:
            f.write(upload_data)
        
        return True, file_path, ""
    except Exception as e:
        return False, "", f"Failed to save file: {str(e)}"


def process_image_upload(file_data: bytes, content_type: str, original_filename: str, 
                        upload_dir: str, max_size: int = None) -> Tuple[bool, str, str]:
    """
    Process an image upload from HTTP request.
    
    Args:
        file_data: File data as bytes
        content_type: Content-Type from request headers
        original_filename: Original filename from client
        upload_dir: Directory to save uploaded files
        max_size: Maximum file size in bytes
    
    Returns:
        Tuple of (success, file_path_or_url, error_message)
    """
    # Create temporary file
    temp_file = None
    try:
        temp_fd, temp_path = tempfile.mkstemp(suffix='.upload')
        temp_file = os.fdopen(temp_fd, 'wb')
        temp_file.write(file_data)
        temp_file.close()
        
        # Check size if specified
        if max_size and len(file_data) > max_size:
            return False, "", f"File exceeds maximum size of {max_size} bytes"
        
        # Validate content type from headers
        allowed_types = {'image/jpeg', 'image/png', 'image/gif'}
        if content_type not in allowed_types:
            return False, "", f"Unsupported content type: {content_type}"
        
        # Validate image file
        is_valid, error = validate_image_file(temp_path, max_size)
        if not is_valid:
            return False, "", error
        
        # Save to upload directory
        success, saved_path, error = save_uploaded_file(file_data, original_filename, upload_dir)
        if not success:
            return False, "", error
        
        return True, saved_path, ""
        
    except Exception as e:
        return False, "", f"Upload processing failed: {str(e)}"
    finally:
        if temp_file and not temp_file.closed:
            temp_file.close()


def get_image_dimensions(file_path: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Get image dimensions (width, height).
    
    Args:
        file_path: Path to image file
    
    Returns:
        Tuple of (width, height) or (None, None) on error
    """
    try:
        # Simplified implementation - in real code would use PIL or similar
        # For now, just return dummy values
        return 800, 600
    except Exception:
        return None, None
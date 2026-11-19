"""Validation utilities."""
import re
from datetime import datetime
from typing import Optional


def validate_email(email: str) -> bool:
    """Validate email format.
    
    Args:
        email: Email address to validate
        
    Returns:
        True if email is valid
    """
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_date(date_str: str, date_format: str = '%Y-%m-%d') -> bool:
    """Validate date string format.
    
    Args:
        date_str: Date string to validate
        date_format: Expected date format
        
    Returns:
        True if date is valid
    """
    try:
        datetime.strptime(date_str, date_format)
        return True
    except (ValueError, TypeError):
        return False


def validate_status(status: str) -> bool:
    """Validate customer status.
    
    Args:
        status: Status to validate
        
    Returns:
        True if status is valid
    """
    valid_statuses = {'active', 'inactive', 'pending', 'suspended'}
    return status in valid_statuses


def validate_sale_status(status: str) -> bool:
    """Validate sale status.
    
    Args:
        status: Status to validate
        
    Returns:
        True if status is valid
    """
    valid_statuses = {'completed', 'refunded', 'pending'}
    return status in valid_statuses


def validate_pagination_params(limit: Optional[int], offset: Optional[int]) -> tuple[int, int]:
    """Validate and normalize pagination parameters.
    
    Args:
        limit: Maximum results per page
        offset: Number of results to skip
        
    Returns:
        Tuple of (normalized_limit, normalized_offset)
    """
    if limit is None or limit < 1:
        limit = 100
    if limit > 1000:  # Cap at 1000
        limit = 1000
    
    if offset is None or offset < 0:
        offset = 0
    
    return limit, offset
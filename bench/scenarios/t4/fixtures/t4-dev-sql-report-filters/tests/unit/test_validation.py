"""Unit tests for validation utilities."""
import unittest
from src.utils import validation


class TestValidation(unittest.TestCase):
    """Test validation functions."""
    
    def test_validate_email(self):
        """Test email validation."""
        self.assertTrue(validation.validate_email('test@example.com'))
        self.assertTrue(validation.validate_email('user.name@domain.co.uk'))
        self.assertFalse(validation.validate_email('invalid-email'))
        self.assertFalse(validation.validate_email('@example.com'))
        self.assertFalse(validation.validate_email('test@'))
    
    def test_validate_date(self):
        """Test date validation."""
        self.assertTrue(validation.validate_date('2023-01-15'))
        self.assertTrue(validation.validate_date('2023-12-31'))
        self.assertFalse(validation.validate_date('2023-13-01'))
        self.assertFalse(validation.validate_date('invalid-date'))
        self.assertFalse(validation.validate_date('2023/01/15'))
    
    def test_validate_status(self):
        """Test status validation."""
        self.assertTrue(validation.validate_status('active'))
        self.assertTrue(validation.validate_status('inactive'))
        self.assertTrue(validation.validate_status('pending'))
        self.assertTrue(validation.validate_status('suspended'))
        self.assertFalse(validation.validate_status('invalid'))
        self.assertFalse(validation.validate_status(''))
    
    def test_validate_sale_status(self):
        """Test sale status validation."""
        self.assertTrue(validation.validate_sale_status('completed'))
        self.assertTrue(validation.validate_sale_status('refunded'))
        self.assertTrue(validation.validate_sale_status('pending'))
        self.assertFalse(validation.validate_sale_status('invalid'))
        self.assertFalse(validation.validate_sale_status(''))
    
    def test_validate_pagination_params(self):
        """Test pagination parameter validation."""
        # Test defaults
        limit, offset = validation.validate_pagination_params(None, None)
        self.assertEqual(limit, 100)
        self.assertEqual(offset, 0)
        
        # Test valid values
        limit, offset = validation.validate_pagination_params(50, 100)
        self.assertEqual(limit, 50)
        self.assertEqual(offset, 100)
        
        # Test capping
        limit, offset = validation.validate_pagination_params(1500, -10)
        self.assertEqual(limit, 1000)  # Capped at 1000
        self.assertEqual(offset, 0)    # Negative offset normalized to 0


if __name__ == '__main__':
    unittest.main()
# Changes for this request; see the commit message for the reasoning.
"""WSGI server for the reporting service - SECURE VERSION."""
import json
import csv
import io
import traceback
from typing import Dict, Any, Optional, List
from urllib.parse import parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import logging

from . import database

logger = logging.getLogger(__name__)


class RequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the reporting API - SECURE VERSION."""
    
    def do_GET(self):
        """Handle GET requests."""
        try:
            if self.path.startswith('/api/customers'):
                self._handle_customers()
            elif self.path.startswith('/api/sales'):
                self._handle_sales()
            else:
                self.send_error(404, "Not found")
        except Exception as e:
            logger.error(f"Error handling request: {e}")
            logger.debug(f"Traceback: {traceback.format_exc()}")
            # Don't leak error details to client
            self.send_error(500, "Internal server error")
    
    def _parse_query_params(self) -> Dict[str, Any]:
        """Parse query parameters from the request."""
        if '?' not in self.path:
            return {}
        
        query_string = self.path.split('?', 1)[1]
        params = parse_qs(query_string)
        
        # Convert single-element lists to single values
        result = {}
        for key, value in params.items():
            if len(value) == 1:
                result[key] = value[0]
            else:
                result[key] = value
        
        return result
    
    def _parse_list_param(self, value: Optional[str]) -> Optional[list]:
        """Parse a comma-separated list parameter."""
        if not value:
            return None
        return [item.strip() for item in value.split(',') if item.strip()]
    
    def _parse_int_param(self, value: Optional[str], default: int, min_val: int = 0, max_val: Optional[int] = None) -> int:
        """Parse and validate integer parameter."""
        if not value:
            return default
        
        try:
            num = int(value)
            if num < min_val:
                return default
            if max_val is not None and num > max_val:
                return max_val
            return num
        except (ValueError, TypeError):
            return default
    
    def _parse_float_param(self, value: Optional[str]) -> Optional[float]:
        """Parse and validate float parameter."""
        if not value:
            return None
        
        try:
            return float(value)
        except (ValueError, TypeError):
            return None
    
    def _handle_customers(self):
        """Handle customers API endpoints."""
        params = self._parse_query_params()
        
        # Parse filters
        name_filter = params.get('name')
        status_filter = self._parse_list_param(params.get('status'))
        start_date = params.get('start_date')
        end_date = params.get('end_date')
        sort_by = params.get('sort_by', 'name')
        sort_dir = params.get('sort_dir', 'ASC').upper()
        
        # Parse pagination with validation
        limit = self._parse_int_param(params.get('limit'), 100, 1, 1000)
        offset = self._parse_int_param(params.get('offset'), 0, 0)
        
        if self.path.endswith('.csv'):
            # CSV export
            try:
                results = database.db.get_customers_csv(
                    name_filter=name_filter,
                    status_filter=status_filter,
                    start_date=start_date,
                    end_date=end_date,
                    sort_by=sort_by,
                    sort_dir=sort_dir
                )
                
                self._send_csv_response(results, 'customers.csv')
            except Exception as e:
                logger.error(f"Error generating CSV: {e}")
                self.send_error(500, "Internal server error")
        else:
            # JSON response with pagination
            try:
                results, total = database.db.get_customers(
                    name_filter=name_filter,
                    status_filter=status_filter,
                    start_date=start_date,
                    end_date=end_date,
                    sort_by=sort_by,
                    sort_dir=sort_dir,
                    limit=limit,
                    offset=offset
                )
                
                response = {
                    'data': results,
                    'pagination': {
                        'total': total,
                        'limit': limit,
                        'offset': offset,
                        'has_more': offset + len(results) < total
                    }
                }
                
                self._send_json_response(response)
            except Exception as e:
                logger.error(f"Error fetching customers: {e}")
                self.send_error(500, "Internal server error")
    
    def _handle_sales(self):
        """Handle sales API endpoints."""
        params = self._parse_query_params()
        
        # Parse filters
        customer_name = params.get('customer')
        product_filter = self._parse_list_param(params.get('product'))
        start_date = params.get('start_date')
        end_date = params.get('end_date')
        
        # Parse amount filters
        min_amount = self._parse_float_param(params.get('min_amount'))
        max_amount = self._parse_float_param(params.get('max_amount'))
        
        sort_by = params.get('sort_by', 'sale_date')
        sort_dir = params.get('sort_dir', 'DESC').upper()
        
        # Parse pagination with validation
        limit = self._parse_int_param(params.get('limit'), 100, 1, 1000)
        offset = self._parse_int_param(params.get('offset'), 0, 0)
        
        if self.path.endswith('.csv'):
            # CSV export
            try:
                results = database.db.get_sales_csv(
                    customer_name=customer_name,
                    product_filter=product_filter,
                    start_date=start_date,
                    end_date=end_date,
                    min_amount=min_amount,
                    max_amount=max_amount,
                    sort_by=sort_by,
                    sort_dir=sort_dir
                )
                
                self._send_csv_response(results, 'sales.csv')
            except Exception as e:
                logger.error(f"Error generating sales CSV: {e}")
                self.send_error(500, "Internal server error")
        else:
            # JSON response with pagination
            try:
                results, total = database.db.get_sales(
                    customer_name=customer_name,
                    product_filter=product_filter,
                    start_date=start_date,
                    end_date=end_date,
                    min_amount=min_amount,
                    max_amount=max_amount,
                    sort_by=sort_by,
                    sort_dir=sort_dir,
                    limit=limit,
                    offset=offset
                )
                
                response = {
                    'data': results,
                    'pagination': {
                        'total': total,
                        'limit': limit,
                        'offset': offset,
                        'has_more': offset + len(results) < total
                    }
                }
                
                self._send_json_response(response)
            except Exception as e:
                logger.error(f"Error fetching sales: {e}")
                self.send_error(500, "Internal server error")
    
    def _send_json_response(self, data: Dict[str, Any]):
        """Send JSON response."""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        json_data = json.dumps(data, default=str)
        self.wfile.write(json_data.encode('utf-8'))
    
    def _send_csv_response(self, data: List[Dict[str, Any]], filename: str):
        """Send CSV response."""
        if not data:
            self.send_response(404)
            self.end_headers()
            return
        
        # Convert data to CSV
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/csv')
        self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        self.wfile.write(output.getvalue().encode('utf-8'))
    
    def log_message(self, format, *args):
        """Override to use our logger."""
        logger.info(format % args)


def run_server(host: str = 'localhost', port: int = 8080):
    """Run the HTTP server."""
    server_address = (host, port)
    httpd = HTTPServer(server_address, RequestHandler)
    logger.info(f'Starting server on http://{host}:{port}')
    httpd.serve_forever()


if __name__ == '__main__':
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    host = 'localhost'
    port = 8080
    
    if len(sys.argv) > 1:
        host = sys.argv[1]
    if len(sys.argv) > 2:
        port = int(sys.argv[2])
    
    run_server(host, port)
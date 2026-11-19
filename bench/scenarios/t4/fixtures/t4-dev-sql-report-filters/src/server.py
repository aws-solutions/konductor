"""WSGI server for the reporting service."""
import json
import csv
import io
from typing import Dict, Any, Optional, List
from urllib.parse import parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import logging

from . import database

logger = logging.getLogger(__name__)


class RequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the reporting API."""
    
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
            self.send_error(500, f"Internal server error: {str(e)}")
    
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
        
        # Parse pagination
        try:
            limit = int(params.get('limit', 100))
            offset = int(params.get('offset', 0))
        except (ValueError, TypeError):
            limit = 100
            offset = 0
        
        if self.path.endswith('.csv'):
            # CSV export
            results = database.db.get_customers_csv(
                name_filter=name_filter,
                status_filter=status_filter,
                start_date=start_date,
                end_date=end_date,
                sort_by=sort_by,
                sort_dir=sort_dir
            )
            
            self._send_csv_response(results, 'customers.csv')
        else:
            # JSON response with pagination
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
    
    def _handle_sales(self):
        """Handle sales API endpoints."""
        params = self._parse_query_params()
        
        # Parse filters
        customer_name = params.get('customer')
        product_filter = self._parse_list_param(params.get('product'))
        start_date = params.get('start_date')
        end_date = params.get('end_date')
        
        # Parse amount filters
        min_amount = None
        max_amount = None
        if params.get('min_amount'):
            try:
                min_amount = float(params['min_amount'])
            except (ValueError, TypeError):
                pass
        if params.get('max_amount'):
            try:
                max_amount = float(params['max_amount'])
            except (ValueError, TypeError):
                pass
        
        sort_by = params.get('sort_by', 'sale_date')
        sort_dir = params.get('sort_dir', 'DESC').upper()
        
        # Parse pagination
        try:
            limit = int(params.get('limit', 100))
            offset = int(params.get('offset', 0))
        except (ValueError, TypeError):
            limit = 100
            offset = 0
        
        if self.path.endswith('.csv'):
            # CSV export
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
        else:
            # JSON response with pagination
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
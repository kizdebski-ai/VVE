import logging
import json
import time

logger = logging.getLogger('api.debug')

class APIDebugMiddleware:
    """
    Middleware do debugowania API - loguje wszystkie żądania i odpowiedzi
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Przetwarzanie przed widokiem
        
        # Pomijamy statyczne pliki i admin
        if '/static/' in request.path or '/admin/' in request.path:
            return self.get_response(request)
        
        # Logujemy tylko żądania API
        if '/api/' in request.path:
            start_time = time.time()
            
            method = request.method
            path = request.path
            
            # Logujemy dane żądania
            try:
                if method in ['POST', 'PUT', 'PATCH'] and request.body:
                    # Zapisz tylko pierwsze 1000 znaków danych dla czytelności logów
                    body_preview = str(request.body)[:1000]
                    if len(request.body) > 1000:
                        body_preview += "... [truncated]"
                    logger.debug(f"API Request: {method} {path} - Body: {body_preview}")
                else:
                    logger.debug(f"API Request: {method} {path}")
            except Exception as e:
                logger.error(f"Error logging request: {e}")
            
            # Przetwarzanie żądania
            response = self.get_response(request)
            
            # Przetwarzanie po widoku
            duration = time.time() - start_time
            
            # Logujemy odpowiedź
            try:
                status = response.status_code
                
                # Logujemy zawartość odpowiedzi (tylko JSON)
                response_preview = None
                if hasattr(response, 'content'):
                    if response.get('Content-Type', '') == 'application/json':
                        # Zapisz tylko pierwsze 1000 znaków odpowiedzi dla czytelności logów
                        response_preview = str(response.content)[:1000]
                        if len(response.content) > 1000:
                            response_preview += "... [truncated]"
                
                if response_preview:
                    logger.debug(f"API Response: {status} - Duration: {duration:.4f}s - Content: {response_preview}")
                else:
                    logger.debug(f"API Response: {status} - Duration: {duration:.4f}s")
            except Exception as e:
                logger.error(f"Error logging response: {e}")
            
            return response
        
        # Standardowe przetwarzanie dla nie-API żądań
        return self.get_response(request)

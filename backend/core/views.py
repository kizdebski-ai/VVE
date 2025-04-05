# views.py
from django.shortcuts import render
from django.views import View
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.conf import settings
import logging
import datetime
import traceback # Add traceback
from . import db_utils, consumers # Add consumers instead of room_manager
from .models import WhiteboardRoom # Add WhiteboardRoom

logger = logging.getLogger('core.views')

# REST API endpoints
def hello_api(request):
    """
    Simple hello endpoint to test REST API.
    """
    return JsonResponse({
        'message': 'Cześć z Django API!'
    })

def health_check(request):
    """
    Health check endpoint to verify the server is running.
    """
    return JsonResponse({
        'status': 'ok',
        'message': 'Whiteboard server is running'
    })

@api_view(['GET'])
def load_whiteboard_state(request, room_id):
    """
    Endpoint to load whiteboard state from the database.
    """
    try:
        # Get state as base64
        base64_state = db_utils.get_room_state_base64(room_id)
        
        if base64_state:
            return Response({
                "success": True,
                "state": base64_state,
                "room_id": room_id,
                "timestamp": datetime.datetime.now().isoformat()
            })
        else:
            return Response({
                "success": False,
                "message": "No state found for this room",
                "room_id": room_id
            })
    except Exception as e:
        logger.error(f"Error loading whiteboard state: {e}")
        return Response({"error": str(e)}, status=500)

@api_view(['POST'])
def save_whiteboard_state(request, room_id):
    """
    Endpoint to save whiteboard state to the database.
    
    Expected request format:
    {
        "state": "base64-encoded-state-data"
    }
    """
    try:
        # Validate input
        if not request.data or 'state' not in request.data:
            return Response({"error": "Missing state data"}, status=400)
            
        base64_state = request.data['state']
        
        # Save to database
        room = db_utils.save_room_state_base64(room_id, base64_state)
        
        if room:
            return Response({
                "success": True,
                "message": "State saved successfully",
                "room_id": room_id,
                "timestamp": datetime.datetime.now().isoformat()
            })
        else:
            return Response({
                "error": "Failed to save state to database"
            }, status=500)
    except Exception as e:
        logger.error(f"Error saving whiteboard state: {e}")
        return Response({"error": str(e)}, status=500)

# Dodaj na końcu pliku views.py:

@api_view(['GET'])
def debug_rooms(request):
    """
    Endpoint diagnostyczny do wyświetlania aktywnych pokojów Whiteboard
    i ich stanu w pamięci
    """
    try:
        # Importuj moduł consumers, aby uzyskać dostęp do izolowanych słowników
        # from . import consumers # Moved import to top
        
        # Informacje o pokojach w pamięci
        memory_docs = {}
        for room_id in consumers.isolated_docs:
            doc = consumers.isolated_docs[room_id]
            memory_docs[room_id] = {
                "doc_id": id(doc),  # Identyfikator obiektu w pamięci
                "has_lock": room_id in consumers.isolated_locks,
                "drawings_count": len(doc.get_array('drawings')) if doc else 0
            }
        
        # Informacje o stanie w bazie danych
        # from .models import WhiteboardRoom # Moved import to top
        db_rooms = {}
        for room in WhiteboardRoom.objects.all():
            db_rooms[room.room_id] = {
                "updated_at": room.updated_at.isoformat() if hasattr(room, 'updated_at') else None,
                "state_size": len(room.state) if room.state else 0
            }
        
        # Analiza kanałów WebSocket
        channels_info = {}
        for room_id in consumers.isolated_docs:
            group_name = f'exact_{room_id}'
            # Note: This doesn't actually check channel layer group membership, just assumes based on doc presence.
            channels_info[room_id] = { 
                "group_name": group_name
            }
        
        return Response({
            "success": True,
            "memory_rooms_count": len(memory_docs),
            "database_rooms_count": len(db_rooms),
            "memory_rooms": memory_docs,
            "database_rooms": db_rooms,
            "channels_info": channels_info,
            "timestamp": datetime.datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Error in debug_rooms: {e}")
        # import traceback # Moved import to top
        logger.error(traceback.format_exc())
        return Response({"error": str(e)}, status=500)


# Whiteboard view to serve the Vue.js application
class WhiteboardView(View):
    """
    Main view for rendering the whiteboard application.
    """
    def get(self, request):
        return render(request, 'whiteboard/index.html')

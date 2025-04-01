# db_utils.py
# Contains synchronous database operations for whiteboard state persistence.
# This file is imported only within consumer methods to avoid early model loading issues.

from .models import WhiteboardRoom # Import model here

def get_room_state_sync(room_id: str) -> bytes | None:
    """Synchronous helper to fetch state."""
    try:
        room = WhiteboardRoom.objects.get(pk=room_id) # Use pk for primary key lookup
        return room.state
    except WhiteboardRoom.DoesNotExist:
        return None

def save_room_state_sync(room_id: str, state: bytes):
    """Synchronous helper to save state."""
    WhiteboardRoom.objects.update_or_create(
        room_id=room_id, # Use room_id for lookup
        defaults={'state': state}
    )
    # print(f"Saved state for room {room_id} (size: {len(state)} bytes)") # Optional: for debugging

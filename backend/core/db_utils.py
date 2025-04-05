import logging
from .models import WhiteboardRoom
import base64

logger = logging.getLogger('db-utils')

# Removed normalize_room_id function

def get_room_state_sync(room_id):
    """
    Synchronously get the state for a room from the database.
    
    Args:
        room_id: The ID of the room to get the state for
        
    Returns:
        Bytes containing the binary Yjs update, or None if not found
    """
    try:
        # WAŻNA ZMIANA: Używaj dokładnie tego room_id bez próby normalizacji
        logger.info(f"Looking for exact room_id: '{room_id}' in database")
        
        try:
            room = WhiteboardRoom.objects.get(room_id=room_id)
            logger.info(f"Found room {room_id} in database with state size: {len(room.state) if room.state else 0} bytes")
            return room.state
        except WhiteboardRoom.DoesNotExist:
            # Spróbuj znaleźć domyślny pokój tylko, jeśli room_id to 'default'
            # This fallback logic might be removed if 'default' is treated like any other ID
            # if room_id == 'default':
            #     logger.info(f"Room '{room_id}' not found in database")
            # else:
            #     logger.info(f"Room '{room_id}' not found in database")
            logger.info(f"Room '{room_id}' not found in database") # Simplified logging
            return None
    except Exception as e:
        logger.error(f"Error getting room state for {room_id}: {e}")
        return None

def get_room_state_base64(room_id):
    """
    Get the state for a room from the database and convert to base64.
    
    Args:
        room_id: The ID of the room to get the state for
        
    Returns:
        Base64 string of the state, or None if not found
    """
    binary_state = get_room_state_sync(room_id) # Uses the updated function
    if binary_state:
        try:
            base64_state = base64.b64encode(binary_state).decode('utf-8')
            return base64_state
        except Exception as e:
            logger.error(f"Error converting state to base64 for {room_id}: {e}")
    return None

def save_room_state_sync(room_id, state_update):
    """
    Synchronously save the state for a room to the database.
    
    Args:
        room_id: The ID of the room
        state_update: Bytes containing the binary Yjs update
        
    Returns:
        The WhiteboardRoom instance that was updated or created
    """
    try:
        # WAŻNA ZMIANA: Używaj dokładnie tego room_id bez próby normalizacji
        logger.info(f"Saving state for exact room_id: '{room_id}'")
        
        room, created = WhiteboardRoom.objects.update_or_create(
            room_id=room_id, # Use the exact room_id
            defaults={'state': state_update}
        )
        action = "Created" if created else "Updated"
        logger.info(f"{action} room {room_id} in database with state size: {len(state_update)} bytes")
        return room
    except Exception as e:
        logger.error(f"Error saving room state for {room_id}: {e}")
        return None

def save_room_state_base64(room_id, base64_state):
    """
    Save the state for a room from a base64 string.
    
    Args:
        room_id: The ID of the room
        base64_state: Base64 encoded state string
        
    Returns:
        The WhiteboardRoom instance that was updated or created, or None on error
    """
    try:
        binary_state = base64.b64decode(base64_state)
        return save_room_state_sync(room_id, binary_state) # Uses the updated function
    except Exception as e:
        logger.error(f"Error decoding base64 state for {room_id}: {e}")
        return None

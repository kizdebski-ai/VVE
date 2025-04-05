import logging
from .models import WhiteboardRoom
import base64

logger = logging.getLogger('db-utils')

def normalize_room_id(room_id):
    """
    Normalizuje identyfikator pokoju, aby obsługiwać różne formaty.
    Obsługuje przypadki:
    - UUID (np. '1a65e14b-405f-49e9-8294-df9f77c2f876')
    - Prefix + ID (np. 'board_fctg3y5kl')
    - Domyślny ('default')
    
    Zwraca znormalizowany identyfikator.
    """
    if not room_id:
        return 'default'
    
    # Jeśli to UUID, nie zmieniaj go
    if len(room_id) > 30 and '-' in room_id:
        return room_id
        
    # Jeśli to prefiks + ID, nie zmieniaj go
    if room_id.startswith('board_'):
        return room_id
        
    # W innym przypadku dodaj prefiks "board_" dla zgodności
    if room_id != 'default' and room_id != 'landing_page' and not room_id.startswith('board_'):
        return f"board_{room_id}"
        
    return room_id

def get_room_state_sync(room_id):
    """
    Synchronously get the state for a room from the database.
    
    Args:
        room_id: The ID of the room to get the state for
        
    Returns:
        Bytes containing the binary Yjs update, or None if not found
    """
    try:
        # Normalizuj room_id
        normalized_id = normalize_room_id(room_id)
        
        # Najpierw spróbuj wyszukać dokładne dopasowanie
        try:
            room = WhiteboardRoom.objects.get(room_id=room_id)
            logger.info(f"Found room {room_id} in database with state size: {len(room.state) if room.state else 0} bytes")
            return room.state
        except WhiteboardRoom.DoesNotExist:
            # Jeśli nie znaleziono, spróbuj znormalizowanego ID
            if normalized_id != room_id:
                try:
                    room = WhiteboardRoom.objects.get(room_id=normalized_id)
                    logger.info(f"Found room with normalized ID {normalized_id} in database with state size: {len(room.state) if room.state else 0} bytes")
                    return room.state
                except WhiteboardRoom.DoesNotExist:
                    pass
            
            # Ostatnia szansa - spróbuj pobrać domyślny pokój, jeśli żaden inny nie pasuje
            if room_id != 'default' and normalized_id != 'default':
                try:
                    room = WhiteboardRoom.objects.get(room_id='default')
                    logger.info(f"Room {room_id} not found, using 'default' room with state size: {len(room.state) if room.state else 0} bytes")
                    return room.state
                except WhiteboardRoom.DoesNotExist:
                    pass
            
            logger.info(f"Room {room_id} not found in database")
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
    binary_state = get_room_state_sync(room_id)
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
        # Normalizuj room_id
        normalized_id = normalize_room_id(room_id)
        
        # Jeśli identyfikator został znormalizowany, zapisz używając znormalizowanego ID
        id_to_use = normalized_id if normalized_id != room_id else room_id
        
        room, created = WhiteboardRoom.objects.update_or_create(
            room_id=id_to_use,
            defaults={'state': state_update}
        )
        action = "Created" if created else "Updated"
        logger.info(f"{action} room {id_to_use} in database with state size: {len(state_update)} bytes")
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
        return save_room_state_sync(room_id, binary_state)
    except Exception as e:
        logger.error(f"Error decoding base64 state for {room_id}: {e}")
        return None

"""
Moduł do zarządzania pokojami Whiteboard
"""
import logging
import y_py as Y
import anyio

logger = logging.getLogger('room-manager')

# Przechowuj dokumenty i zamki pogrupowane według room_id
room_docs = {}  # room_id -> Y.YDoc
room_locks = {}  # room_id -> anyio.Lock


def is_room_initialized(room_id):
    """
    Sprawdza, czy pokój został już zainicjalizowany
    """
    group_name = get_group_name(room_id)
    return group_name in room_locks and group_name in room_docs


def get_group_name(room_id):
    """
    Generuje nazwę grupy WebSocket na podstawie room_id
    """
    return f'whiteboard_{room_id}'


def get_or_create_lock(room_id):
    """
    Pobiera lub tworzy nowy zamek dla pokoju
    """
    group_name = get_group_name(room_id)
    if group_name not in room_locks:
        logger.info(f"Creating new lock for room '{room_id}'")
        room_locks[group_name] = anyio.Lock()
    
    return room_locks[group_name]


def get_doc(room_id):
    """
    Pobiera dokument Yjs dla pokoju
    """
    group_name = get_group_name(room_id)
    if group_name not in room_docs:
        return None
    
    return room_docs[group_name]


def set_doc(room_id, doc):
    """
    Ustawia dokument Yjs dla pokoju
    """
    group_name = get_group_name(room_id)
    room_docs[group_name] = doc
    logger.info(f"Set Y.Doc for room '{room_id}'")


def create_new_doc():
    """
    Tworzy nowy dokument Yjs
    """
    return Y.YDoc()


def clear_room(room_id):
    """
    Czyści zasoby pokoju (używane przy zamykaniu serwera)
    """
    group_name = get_group_name(room_id)
    if group_name in room_docs:
        del room_docs[group_name]
    if group_name in room_locks:
        del room_locks[group_name]
    logger.info(f"Cleared resources for room '{room_id}'")


def get_room_info():
    """
    Zwraca informacje diagnostyczne o wszystkich pokojach
    """
    import datetime # Import datetime here for timestamp
    rooms = {}
    for group_name in list(room_docs.keys()): # Use list() to avoid runtime dict size change error
        # Usuń prefiks 'whiteboard_'
        room_id = group_name[11:] if group_name.startswith('whiteboard_') else group_name
        doc = room_docs.get(group_name) # Use .get() for safety
        if doc: # Check if doc exists
            try:
                drawings_array = doc.get_array('drawings')
                drawings_count = len(drawings_array)
            except Exception as e:
                logger.error(f"Error getting drawings count for room {room_id}: {e}")
                drawings_count = 'Error' # Indicate error in count
        else:
            drawings_count = 0 # No doc, no drawings

        rooms[room_id] = {
            'has_lock': group_name in room_locks,
            'has_doc': group_name in room_docs,
            'doc_id': id(doc) if doc else None,
            'drawings_count': drawings_count,
        }
    
    return {
        'total_rooms': len(rooms),
        'rooms': rooms
    }

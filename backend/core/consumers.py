# consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
import anyio  # Use anyio for async locks compatible with asyncio/trio
import y_py as Y  # Import y-py
from channels.db import database_sync_to_async
import logging

# Define message types (must match frontend)
MESSAGE_SYNC = 0
MESSAGE_AWARENESS = 1

# Create dedicated logger
logger = logging.getLogger('board.sync')

# IZOLOWANE słowniki dla każdego uniqueID pokoju
# Używamy dokładnie tego identyfikatora, który jest w URL
isolated_docs = {}  # key: exact room_id -> value: Y.YDoc
isolated_locks = {}  # key: exact room_id -> value: anyio.Lock

class WhiteboardConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer using y-py for backend document persistence.
    """
    doc: Y.YDoc | None = None
    lock: anyio.Lock | None = None


    async def connect(self):
        """
        Called when the WebSocket is handshaking as part of the connection process.
        """
        # Extract room_id from the URL route - używamy dokładnie tej wartości
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        
        # KLUCZOWA ZMIANA: Używamy dokładnego room_id dla nazwy grupy
        # Dodajemy prefiks aby uniknąć kolizji ale zachowujemy oryginalny identyfikator
        self.room_group_name = f'exact_{self.room_id}'
        
        # Dodaj szczegółowe logi
        logger.warning(f"CONNECT: WebSocket connecting for room_id: '{self.room_id}'")
        logger.warning(f"CONNECT: Using isolated group name: '{self.room_group_name}'")
        logger.warning(f"CONNECT: Current isolated_docs keys: {list(isolated_docs.keys())}")

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,  # Group name
            self.channel_name      # Channel name to add
        )

        # Get or create lock for this specific room_id
        if self.room_id not in isolated_locks:
            logger.warning(f"CONNECT: Creating NEW lock for room_id: '{self.room_id}'")
            self.lock = anyio.Lock()
            isolated_locks[self.room_id] = self.lock
        else:
            logger.warning(f"CONNECT: Reusing EXISTING lock for room_id: '{self.room_id}'")
            self.lock = isolated_locks[self.room_id]
        
        # Now use the lock to manage the document
        async with self.lock:
            # Check if doc already exists for this specific room_id
            if self.room_id not in isolated_docs:
                logger.warning(f"CONNECT: Creating NEW doc for room_id: '{self.room_id}'")
                
                # Create a new doc
                self.doc = Y.YDoc()
                
                # Load initial state from DB if available
                try:
                    from . import db_utils
                    initial_state = await database_sync_to_async(db_utils.get_room_state_sync)(self.room_id)
                    if initial_state:
                        Y.apply_update(self.doc, initial_state)
                        logger.warning(f"CONNECT: Loaded state for room_id '{self.room_id}' from DB (size: {len(initial_state)} bytes)")
                    else:
                        logger.warning(f"CONNECT: No state found for room_id '{self.room_id}'. Starting fresh.")
                except Exception as e:
                    logger.warning(f"CONNECT: Error loading initial state: {e}")
                
                # Store doc in isolated dictionary using exact room_id
                isolated_docs[self.room_id] = self.doc
            else:
                logger.warning(f"CONNECT: Reusing EXISTING doc for room_id: '{self.room_id}'")
                self.doc = isolated_docs[self.room_id]

        # Accept the WebSocket connection
        await self.accept()
        logger.warning(f"CONNECT: WebSocket connected: {self.channel_name} to room_id '{self.room_id}'")

        # Send the current document state to the new client
        async with self.lock:
            full_state_update = Y.encode_state_as_update(self.doc)

        # Prefix the state update with the sync message type
        message = bytes([MESSAGE_SYNC]) + full_state_update
        logger.warning(f"CONNECT: Sending initial state to {self.channel_name} for room_id '{self.room_id}' (size: {len(message)} bytes)")
        await self.send(bytes_data=message)


    async def disconnect(self, close_code):
        """
        Called when the WebSocket closes for any reason.
        """
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

        logger.warning(f"DISCONNECT: WebSocket disconnected: {self.channel_name} from room_id '{self.room_id}'")


    async def receive(self, text_data=None, bytes_data=None):
        """
        Called when we get a frame from the client.
        We expect binary Yjs messages for synchronization and awareness.
        """
        if bytes_data:
            if not self.doc or not self.lock:
                 logger.warning(f"RECEIVE: ERROR: YDoc or lock not initialized for {self.channel_name} in room_id '{self.room_id}'. Disconnecting.")
                 await self.close()
                 return

            # Decode message type (first byte)
            message_type = bytes_data[0]
            payload = bytes_data[1:]  # Extract the actual payload

            if message_type == MESSAGE_SYNC:
                # Apply the update to the backend YDoc
                try:
                    # Apply the update within the lock
                    async with self.lock:
                        Y.apply_update(self.doc, payload)  # Apply raw payload directly
                        
                        # Save state after applying update
                        current_state = Y.encode_state_as_update(self.doc)
                        from . import db_utils
                        await database_sync_to_async(db_utils.save_room_state_sync)(self.room_id, current_state)
                except Exception as e:
                    logger.warning(f"RECEIVE: ERROR: Applying sync update or saving state in room_id '{self.room_id}': {e}")

            # Broadcast the message ONLY to others in the ISOLATED group
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'yjs_update',
                    'sender_channel_name': self.channel_name,
                    'bytes_data': bytes_data,
                }
            )


    async def yjs_update(self, event):
        """
        Sends the received Yjs binary data to this specific WebSocket client.
        """
        # Don't send the message back to the original sender
        if self.channel_name != event['sender_channel_name']:
            await self.send(bytes_data=event['bytes_data'])

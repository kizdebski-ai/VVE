# consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
# from channels.db import database_sync_to_async # Moved import lower
import anyio # Use anyio for async locks compatible with asyncio/trio
from collections import defaultdict
try:
    import y_py as Y
except ImportError:
    Y = None
# from .models import WhiteboardRoom # Import moved lower

# Define message types (must match frontend)
MESSAGE_SYNC = 0
MESSAGE_AWARENESS = 1

# In-memory storage for YDoc instances per room
# In-memory storage for YDoc instances per room.
# Docs are now loaded from DB on first access and saved back on updates.
room_docs = {}
room_locks = {}
room_members = defaultdict(int)

# Database helper functions moved to db_utils.py

# Import database_sync_to_async once for use below
from channels.db import database_sync_to_async

# --- Consumer ---

class WhiteboardConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer using y-py for backend document persistence.
    """
    doc = None
    lock = None


    async def connect(self):
        """
        Called when the WebSocket is handshaking as part of the connection process.
        """
        if Y is None:
            # Backend lacks y-py; refuse websocket gracefully with guidance
            await self.accept()
            await self.close(code=1013)
            print("WebSocket closed: y-py dependency missing. Install 'y-py' to enable realtime persistence.")
            return
        # Extract room_id from the URL route
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'whiteboard_{self.room_id}'

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name, # Group name
            self.channel_name     # Channel name to add
        )

        # Get or create the YDoc and lock for this room
        if self.room_group_name not in room_locks: # Use lock presence to check initialization
            self.lock = anyio.Lock()
            room_locks[self.room_group_name] = self.lock
            print(f"Created new lock for room {self.room_id}")

            # Lock before accessing/creating the shared doc
            async with self.lock:
                # Double-check if another connection initialized the doc while waiting for the lock
                if self.room_group_name not in room_docs:
                    self.doc = Y.YDoc()
                    # --- Load initial state from DB ---
                    print(f"Attempting to load state for room {self.room_id} from DB...")
                    # Import utils and call function inline
                    try:
                        from . import db_utils # Import utils here
                        initial_state = await database_sync_to_async(db_utils.get_room_state_sync)(self.room_id)
                        if initial_state:
                            Y.apply_update(self.doc, initial_state)
                            print(f"Successfully loaded state for room {self.room_id} from DB (size: {len(initial_state)} bytes)")
                        else:
                             print(f"No existing state found for room {self.room_id}. Starting fresh.")
                    except Exception as e: # Catch potential import or db errors during load
                        print(f"Error loading initial state for room {self.room_id}: {e}. Starting fresh.")
                        initial_state = None # Ensure it's None if loading failed

                    # --- End Load initial state ---
                    room_docs[self.room_group_name] = self.doc
                    print(f"Initialized YDoc for room {self.room_id}")
                else:
                    # Doc was initialized by another connection while we waited
                    self.doc = room_docs[self.room_group_name]
                    print(f"Reusing YDoc initialized by another connection for room {self.room_id}")

        else: # Lock already exists, implies doc might exist too (or is being initialized)
            self.lock = room_locks[self.room_group_name]
            # Correct indentation for this block
            async with self.lock: # Ensure doc is available before proceeding
                 if self.room_group_name in room_docs:
                     self.doc = room_docs[self.room_group_name]
                     print(f"Reusing existing YDoc and lock for room {self.room_id}")
                 else:
                     # This case should ideally not happen if lock creation and doc creation are atomic
                     # but as a fallback, initialize it here.
                     print(f"Warning: Lock existed but doc didn't for room {self.room_id}. Initializing doc.")
                     self.doc = Y.YDoc()
                     # Attempt load again just in case
                     try:
                         from . import db_utils # Import utils here
                         initial_state = await database_sync_to_async(db_utils.get_room_state_sync)(self.room_id)
                         if initial_state:
                             Y.apply_update(self.doc, initial_state)
                     except Exception as e:
                         print(f"Error applying initial state (fallback): {e}")
                     room_docs[self.room_group_name] = self.doc


        # Track active members to allow cleanup on disconnect
        room_members[self.room_group_name] += 1

        # Accept the WebSocket connection
        await self.accept()
        print(f"WebSocket connected: {self.channel_name} to room {self.room_id}")

        # Send the current document state (potentially loaded from DB) to the new client
        async with self.lock:
            # Use encode_state_as_update to send the whole doc state
            state_vector = Y.encode_state_vector(self.doc) # Get state vector for diff update later if needed
            full_state_update = Y.encode_state_as_update(self.doc)

        # Prefix the state update with the sync message type
        message = bytes([MESSAGE_SYNC]) + full_state_update
        print(f"Sending initial state to {self.channel_name} for room {self.room_id} (size: {len(message)} bytes)")
        await self.send(bytes_data=message)

        # Note: Client still needs to send its initial awareness state

        # Note: Client still needs to send its initial awareness state

    async def disconnect(self, close_code):
        """
        Called when the WebSocket closes for any reason.
        """
        room_key = getattr(self, 'room_group_name', None)
        lock = room_locks.get(room_key)

        # Leave room group
        if room_key:
            await self.channel_layer.group_discard(
            room_key,
            self.channel_name
        )

        print(f"WebSocket disconnected: {self.channel_name} from room {self.room_id}")
        # Yjs awareness protocol handles presence updates, no need for custom 'user_left' message
        if room_key:
            remaining = max(room_members.get(room_key, 1) - 1, 0)
            if remaining <= 0:
                room_members.pop(room_key, None)
                if lock:
                    async with lock:
                        room_docs.pop(room_key, None)
                else:
                    room_docs.pop(room_key, None)
                room_locks.pop(room_key, None)
                print(f"Cleaned up YDoc and lock for room {self.room_id}")
            else:
                room_members[room_key] = remaining

    async def receive(self, text_data=None, bytes_data=None):
        """
        Called when we get a frame from the client.
        We expect binary Yjs messages for synchronization and awareness.
        """
        if bytes_data:
            if not self.doc or not self.lock:
                 print(f"Error: YDoc or lock not initialized for {self.channel_name} in room {self.room_id}. Disconnecting.")
                 await self.close()
                 return

            # Decode message type (first byte)
            message_type = bytes_data[0]
            payload = bytes_data[1:] # Extract the actual payload

            if message_type == MESSAGE_SYNC:
                # Apply the update to the backend YDoc
                try:
                    # Apply the update within the lock
                    async with self.lock:
                        Y.apply_update(self.doc, payload) # Apply raw payload directly
                        # --- Save state after applying update ---
                        current_state = Y.encode_state_as_update(self.doc)
                        # Import utils and call function inline
                        from . import db_utils # Import utils here
                        await database_sync_to_async(db_utils.save_room_state_sync)(self.room_id, current_state)
                        # --- End Save state ---
                    # print(f"Applied sync update from {self.channel_name} to backend doc for room {self.room_id} and saved state.")
                except Exception as e:
                    print(f"Error applying sync update or saving state in room {self.room_id}: {e}")
                    # Decide on error handling: broadcast original message anyway?
                    # For now, we'll still broadcast the original message.

            elif message_type == MESSAGE_AWARENESS:
                # Awareness messages are just relayed, not applied to backend doc
                # print(f"Relaying awareness update from {self.channel_name} for room {self.room_id}")
                pass # No specific backend action needed for awareness relay

            else:
                print(f"Received unknown message type {message_type} from {self.channel_name}")
                # Don't broadcast unknown types

            # Broadcast the original, prefixed message (sync or awareness) to others in the group
            # The frontend will handle decoding based on the prefix.
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'yjs_update',
                    'sender_channel_name': self.channel_name,
                    'bytes_data': bytes_data,
                }
            )
        elif text_data:
            # Could potentially handle specific text commands if needed in the future
            # For now, just log unexpected text data
            print(f"Received unexpected text data from {self.channel_name}: {text_data[:100]}...") # Log truncated data

    # --- Handler for Yjs messages broadcasted via channel layer ---
    async def yjs_update(self, event):
        """
        Sends the received Yjs binary data (from the channel layer)
        to this specific WebSocket client.
        """
        # Don't send the message back to the original sender
        if self.channel_name != event['sender_channel_name']:
            await self.send(bytes_data=event['bytes_data'])

    # Removed old methods:
    # - send_initial_state (Yjs handles sync)
    # - user_joined (Yjs awareness handles presence)
    # - user_left (Yjs awareness handles presence)
    # - whiteboard_action (Yjs handles state sync)
    # - cursor_position (Yjs awareness handles cursors)
    # - get_timestamp (Not essential for relay)
    # - get_room_state (No in-memory state needed)
    # - update_room_state (No in-memory state needed)
    # Removed old class variable:
    # - room_states = {}

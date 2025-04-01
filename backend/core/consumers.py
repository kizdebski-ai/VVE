# consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
import anyio # Use anyio for async locks compatible with asyncio/trio
import y_py as Y # Import y-py

# Define message types (must match frontend)
MESSAGE_SYNC = 0
MESSAGE_AWARENESS = 1

# In-memory storage for YDoc instances per room
# NOTE: This state is lost when the Django server restarts.
# For production, use a persistent store (DB, Redis with y-redis).
room_docs: dict[str, Y.YDoc] = {}
room_locks: dict[str, anyio.Lock] = {}


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
        # Extract room_id from the URL route
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'whiteboard_{self.room_id}'

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.room_group_name,
            self.channel_name
        )

        # Get or create the YDoc and lock for this room
        if self.room_group_name not in room_docs:
            self.doc = Y.YDoc()
            self.lock = anyio.Lock()
            room_docs[self.room_group_name] = self.doc
            room_locks[self.room_group_name] = self.lock
            print(f"Created new YDoc for room {self.room_id}")
        else:
            self.doc = room_docs[self.room_group_name]
            self.lock = room_locks[self.room_group_name]
            print(f"Reusing existing YDoc for room {self.room_id}")

        # Accept the WebSocket connection
        await self.accept()
        print(f"WebSocket connected: {self.channel_name} to room {self.room_id}")

        # Send the current document state to the new client
        async with self.lock:
            state_update = Y.encode_state_as_update(self.doc)
        # Prefix the state update with the sync message type
        message = bytes([MESSAGE_SYNC]) + state_update
        print(f"Sending initial state to {self.channel_name} for room {self.room_id} (size: {len(message)} bytes)")
        await self.send(bytes_data=message)

        # Note: Client still needs to send its initial awareness state

    async def disconnect(self, close_code):
        """
        Called when the WebSocket closes for any reason.
        """
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

        print(f"WebSocket disconnected: {self.channel_name} from room {self.room_id}")
        # Yjs awareness protocol handles presence updates, no need for custom 'user_left' message

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
                    update = Y.read_update(payload)
                    async with self.lock:
                        self.doc.apply_update(update)
                    # print(f"Applied sync update from {self.channel_name} to backend doc for room {self.room_id}")
                except Exception as e:
                    print(f"Error applying sync update in room {self.room_id}: {e}")
                    # Don't broadcast potentially corrupted update? Or maybe still broadcast?
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

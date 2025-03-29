# consumers.py
import json # Keep json for potential future use or debugging text messages
from channels.generic.websocket import AsyncWebsocketConsumer

class WhiteboardConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for the whiteboard application.
    Acts as a simple relay for Yjs binary messages within a room group.
    """

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
            self.channel_name
        )

        # Accept the WebSocket connection
        await self.accept()

        print(f"WebSocket connected: {self.channel_name} to room {self.room_id}")

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
        # Yjs primarily uses binary messages
        if bytes_data:
            # Broadcast the received binary message to the room group
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'yjs_update', # Custom type for our handler
                    'sender_channel_name': self.channel_name, # To avoid sending back to sender
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

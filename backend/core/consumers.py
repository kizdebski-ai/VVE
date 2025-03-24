# consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async

class WhiteboardConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for the whiteboard application.
    Handles real-time collaboration between clients.
    """
    
    async def connect(self):
        """
        Called when the WebSocket is handshaking as part of the connection process.
        """
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
        
        # Notify other users that this user has left
        if hasattr(self, 'user_id') and hasattr(self, 'username'):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_left',
                    'user_id': self.user_id,
                    'username': self.username,
                    'timestamp': self.get_timestamp()
                }
            )
        
        print(f"WebSocket disconnected: {self.channel_name} from room {self.room_id}")

    async def receive(self, text_data):
        """
        Called when we get a text frame from the client.
        """
        # Parse the received JSON data
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            # Store user info if this is a join message
            if message_type == 'join':
                self.user_id = data.get('userId')
                self.username = data.get('username')
                
                # Broadcast user joined message
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_joined',
                        'user_id': self.user_id,
                        'username': self.username,
                        'timestamp': data.get('timestamp', self.get_timestamp())
                    }
                )
                
                # Send initial state
                await self.send_initial_state()
                
            # Handle whiteboard actions
            elif message_type == 'whiteboard_action':
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'whiteboard_action',
                        'action': data.get('action'),
                        'data': data.get('data'),
                        'user_id': data.get('userId'),
                        'username': data.get('username'),
                        'timestamp': data.get('timestamp', self.get_timestamp())
                    }
                )
            
            # Handle cursor position updates
            elif message_type == 'cursor_position':
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'cursor_position',
                        'x': data.get('x'),
                        'y': data.get('y'),
                        'user_id': data.get('userId'),
                        'username': data.get('username'),
                        'timestamp': data.get('timestamp', self.get_timestamp())
                    }
                )
            
            # Handle state requests
            elif message_type == 'request_state':
                await self.send_initial_state()
            
            # Handle heartbeat messages
            elif message_type == 'heartbeat':
                await self.send(text_data=json.dumps({
                    'type': 'heartbeat_ack',
                    'timestamp': self.get_timestamp()
                }))
                
        except json.JSONDecodeError:
            print(f"Invalid JSON received: {text_data}")
        except Exception as e:
            print(f"Error processing message: {e}")

    async def send_initial_state(self):
        """
        Send the initial whiteboard state to the client.
        """
        # Get room state from memory
        room_state = self.get_room_state()
        
        # Get connected users
        users = []
        
        # Send the initial state to the client
        await self.send(text_data=json.dumps({
            'type': 'init_whiteboard',
            'elements': room_state.get('elements', []),
            'users': users,
            'timestamp': self.get_timestamp()
        }))

    # Event handlers for messages from other consumers
    async def user_joined(self, event):
        """
        Called when a user joins the room.
        """
        # Skip sending to the user who joined
        if hasattr(self, 'user_id') and event['user_id'] == self.user_id:
            return
            
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'userId': event['user_id'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

    async def user_left(self, event):
        """
        Called when a user leaves the room.
        """
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'userId': event['user_id'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

    async def whiteboard_action(self, event):
        """
        Called when a whiteboard action is received.
        """
        # Skip sending back to the user who sent it
        if hasattr(self, 'user_id') and event['user_id'] == self.user_id:
            return
            
        # Update room state (maintained in memory)
        await self.update_room_state(event)
        
        await self.send(text_data=json.dumps({
            'type': 'whiteboard_action',
            'action': event['action'],
            'data': event['data'],
            'userId': event['user_id'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

    async def cursor_position(self, event):
        """
        Called when a cursor position update is received.
        """
        # Skip sending back to the user who sent it
        if hasattr(self, 'user_id') and event['user_id'] == self.user_id:
            return
            
        await self.send(text_data=json.dumps({
            'type': 'cursor_position',
            'x': event['x'],
            'y': event['y'],
            'userId': event['user_id'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

    # Helper methods
    def get_timestamp(self):
        """
        Get current timestamp.
        """
        import time
        return int(time.time() * 1000)

    # Room state management (in memory for simplicity)
    # In a production app, you might want to use Redis or another storage
    room_states = {}

    def get_room_state(self):
        """
        Get the current state of the room.
        """
        if self.room_id not in self.room_states:
            self.room_states[self.room_id] = {
                'elements': [],
                'last_update': self.get_timestamp()
            }
        return self.room_states[self.room_id]

    async def update_room_state(self, event):
        """
        Update the room state based on the received event.
        """
        state = self.get_room_state()
        action = event['action']
        data = event['data']
        
        if action == 'add':
            state['elements'].append(data)
        elif action == 'update':
            for i, element in enumerate(state['elements']):
                if element.get('id') == data.get('id'):
                    state['elements'][i] = data
                    break
        elif action == 'delete':
            state['elements'] = [e for e in state['elements'] if e.get('id') != data.get('id')]
        elif action == 'clear':
            state['elements'] = []
            
        state['last_update'] = self.get_timestamp()
        self.room_states[self.room_id] = state
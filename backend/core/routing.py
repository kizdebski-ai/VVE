# routing.py
from django.urls import path
from . import consumers

websocket_urlpatterns = [
    # Allow UUID-style identifiers with dashes/underscores
    path('ws/whiteboard/<str:room_id>/', consumers.WhiteboardConsumer.as_asgi()),
]

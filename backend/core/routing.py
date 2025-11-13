# routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # Allow UUID-style identifiers with dashes/underscores and optional trailing slash
    re_path(r'ws/whiteboard/(?P<room_id>[-\w]+)/?$', consumers.WhiteboardConsumer.as_asgi()),
]

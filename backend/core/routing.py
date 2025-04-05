# routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # Poprawiony wzorzec - akceptuje szerszy zakres znaków w room_id
    # Ważne: wzorzec musi być wystarczająco elastyczny, aby obsługiwał UUID
    re_path(r'ws/whiteboard/(?P<room_id>[\w\-]+)/?$', consumers.WhiteboardConsumer.as_asgi()),
]

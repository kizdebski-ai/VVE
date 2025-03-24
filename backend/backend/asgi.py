import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.conf import settings
from django.conf.urls.static import static
from django.urls import re_path
from django.views.static import serve
import core.routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# Obsługa statycznych plików (np. DRF CSS/JS) – tylko w DEBUG
static_urlpatterns = []
if settings.DEBUG:
    static_urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

application = ProtocolTypeRouter({
    "http": URLRouter(
        static_urlpatterns + [
            re_path(r"", get_asgi_application()),  # obsługa pozostałych routów Django
        ]
    ),
    "websocket": AuthMiddlewareStack(
        URLRouter(core.routing.websocket_urlpatterns)
    ),
})


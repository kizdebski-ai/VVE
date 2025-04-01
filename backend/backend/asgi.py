import os
import django
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup() # Initialize Django settings FIRST

# Get the application instance *after* setup
django_asgi_app = get_asgi_application()

# Import Channels items *after* setup
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

# Define a function to get the websocket application
# This delays the import of core.routing until the function is called
def get_websocket_app():
    import core.routing # Import routing here
    return AuthMiddlewareStack(
        URLRouter(
            core.routing.websocket_urlpatterns
        )
    )

# Define the application router
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    # Call the function to get the websocket app, delaying imports
    "websocket": get_websocket_app(),
})

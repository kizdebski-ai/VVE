from django.urls import path
from . import views

urlpatterns = [
    # Web view
    path('', views.WhiteboardView.as_view(), name='whiteboard'),
    
    # REST API endpoints
    path('api/hello/', views.hello_api, name='hello_api'),
    path('api/health/', views.health_check, name='health_check'),
    path('api/load/<str:room_id>/', views.load_whiteboard_state, name='load_whiteboard_state'),
    path('api/save/<str:room_id>/', views.save_whiteboard_state, name='save_whiteboard_state'),
]

from django.urls import path
from . import views

urlpatterns = [
    # Web view
    path('', views.WhiteboardView.as_view(), name='whiteboard'),
    
    # REST API endpoints
    path('api/hello/', views.hello_api, name='hello_api'),
    path('api/health/', views.health_check, name='health_check'),
]
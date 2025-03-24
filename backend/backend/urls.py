from django.contrib import admin
from django.urls import path, include  # ← to MUSI być

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('core.urls')),  # ← to dodaje nasze API
]

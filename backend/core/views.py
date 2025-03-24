# views.py
from django.shortcuts import render
from django.views import View
from django.http import JsonResponse

# REST API endpoints
def hello_api(request):
    """
    Simple hello endpoint to test REST API.
    """
    return JsonResponse({
        'message': 'Cześć z Django API!'
    })

def health_check(request):
    """
    Health check endpoint to verify the server is running.
    """
    return JsonResponse({
        'status': 'ok',
        'message': 'Whiteboard server is running'
    })

# Whiteboard view to serve the Vue.js application
class WhiteboardView(View):
    """
    Main view for rendering the whiteboard application.
    """
    def get(self, request):
        return render(request, 'whiteboard/index.html')


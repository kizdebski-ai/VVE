# views.py
import base64
import binascii
import json

from django.http import JsonResponse
from django.shortcuts import render
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from .ai_service import analyze_board_image

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


@csrf_exempt
def board_math_assistant(request):
    """Process a whiteboard screenshot with the AI math assistant."""

    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        payload = json.loads(request.body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON body'}, status=400)

    image_base64 = payload.get('imageBase64')
    if not image_base64:
        return JsonResponse({'error': 'imageBase64 is required'}, status=400)

    try:
        encoded_part = image_base64.split(',', 1)[1] if ',' in image_base64 else image_base64
        image_bytes = base64.b64decode(encoded_part)
    except (ValueError, IndexError, binascii.Error):
        return JsonResponse({'error': 'Invalid base64 image data'}, status=400)

    response = analyze_board_image(image_bytes)
    return JsonResponse(response)

# Whiteboard view to serve the Vue.js application
class WhiteboardView(View):
    """
    Main view for rendering the whiteboard application.
    """
    def get(self, request):
        return render(request, 'whiteboard/index.html')


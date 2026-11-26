from django.http import JsonResponse
from django.views.decorators.http import require_safe
from rest_framework.decorators import api_view
from rest_framework.response import Response


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


@api_view(["GET"])
def capabilities(request):
    return Response(
        {
            "languages": ["c", "cpp", "java", "python"],
            "execution": {"available": False, "interactive": False},
            "analysis": {"available": False},
        }
    )

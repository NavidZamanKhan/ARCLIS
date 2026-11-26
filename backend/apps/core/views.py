from django.http import JsonResponse
from django.views.decorators.http import require_safe
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.execution.api import local_execution_allowed


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


@api_view(["GET"])
def capabilities(request):
    available = local_execution_allowed(request.META.get("REMOTE_ADDR"))
    return Response(
        {
            "languages": ["c", "cpp", "java", "python"],
            "execution": {"available": available, "interactive": available},
            "analysis": {"available": False},
        }
    )

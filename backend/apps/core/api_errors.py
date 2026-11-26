import logging

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler, set_rollback

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        set_rollback()
        logger.error("Unhandled REST API exception", exc_info=exc)
        response = Response(status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    if response.status_code >= 500:
        code = "internal_error"
        details = {"detail": "An internal error occurred."}
    else:
        details = response.data
        detail = details.get("detail") if isinstance(details, dict) else None
        code = (
            "validation_error"
            if isinstance(exc, ValidationError)
            else getattr(detail, "code", "request_error")
        )

    response.data = {"error": {"code": code, "details": details}}
    return response

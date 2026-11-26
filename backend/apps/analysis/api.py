from threading import BoundedSemaphore

from django.conf import settings
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, Throttled
from rest_framework.response import Response

from apps.execution.api import BoundedJSONParser, TextField, is_loopback

from .service import MAX_SOURCE_BYTES, AnalysisLimit, AnalysisUnavailable, analyze_c, analyze_python

_slot = BoundedSemaphore(1)
ANALYSIS_LANGUAGES = ("c", "python")


def local_analysis_allowed(address):
    return settings.LOCAL_ANALYSIS_ENABLED and is_loopback(address)


class AnalysisJSONParser(BoundedJSONParser):
    max_bytes = 512 * 1024
    limit_detail = "Analysis requests are limited to 512 KiB of JSON."


class AnalysisRequestSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=ANALYSIS_LANGUAGES, default="c")
    source = TextField(max_length=MAX_SOURCE_BYTES, allow_blank=True, trim_whitespace=False)

    def validate(self, attrs):
        try:
            size = len(attrs["source"].encode("utf-8"))
        except UnicodeEncodeError as error:
            raise serializers.ValidationError({"source": "Source must be valid UTF-8."}) from error
        if size > MAX_SOURCE_BYTES:
            raise serializers.ValidationError({"source": "Source is limited to 64 KiB of UTF-8."})
        return {"content": attrs["source"], "source_size": size, "language": attrs["language"]}


class AnalysisLimitError(APIException):
    status_code = 422
    default_code = "analysis_limit"


class AnalysisUnavailableError(APIException):
    status_code = 503


@api_view(["POST"])
@parser_classes([AnalysisJSONParser])
def analyze_source(request):
    if not local_analysis_allowed(request.META.get("REMOTE_ADDR")):
        raise NotFound()
    origin = request.headers.get("Origin")
    if origin is not None and origin not in settings.FRONTEND_ORIGINS:
        raise PermissionDenied("This origin cannot analyze source.")
    serializer = AnalysisRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if not _slot.acquire(blocking=False):
        raise Throttled(detail="The analyzer is busy. Try again shortly.")
    args = serializer.validated_data
    analyzer = analyze_python if args["language"] == "python" else analyze_c
    try:
        report = analyzer(content=args["content"], source_size=args["source_size"])
    except AnalysisLimit as error:
        raise AnalysisLimitError(str(error)) from error
    except AnalysisUnavailable as error:
        raise AnalysisUnavailableError() from error
    finally:
        _slot.release()
    return Response(report, headers={"Cache-Control": "no-store"})

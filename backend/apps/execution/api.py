from io import BytesIO
from ipaddress import ip_address

from django.conf import settings
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, Throttled
from rest_framework.parsers import JSONParser
from rest_framework.response import Response

from .java import prepare_java
from .native import NativeLanguage, prepare_native
from .python import prepare_python
from .sessions import SessionCapacityError, sessions
from .worker import MAX_STDIN_BYTES
from .workspace import MAX_FILES, MAX_SOURCE_BYTES, InvalidWorkspace, SourceFile

MAX_JSON_BYTES = 2 * 1024 * 1024


def local_execution_allowed(address):
    if not settings.LOCAL_EXECUTION_ENABLED or not address:
        return False
    try:
        return ip_address(address).is_loopback
    except ValueError:
        return False


class RequestTooLarge(APIException):
    status_code = 413
    default_detail = "Execution requests are limited to 2 MiB of JSON."
    default_code = "request_too_large"


class BoundedJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        data = stream.read(MAX_JSON_BYTES + 1)
        if len(data) > MAX_JSON_BYTES:
            raise RequestTooLarge()
        return super().parse(BytesIO(data), media_type, parser_context)


class TextField(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class SourceSerializer(serializers.Serializer):
    path = TextField(max_length=240, trim_whitespace=False)
    content = TextField(max_length=MAX_SOURCE_BYTES, allow_blank=True, trim_whitespace=False)


class SessionRequestSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=("c", "cpp", "java", "python"))
    entry_file = TextField(max_length=240, trim_whitespace=False)
    main_class = TextField(max_length=240, trim_whitespace=False, required=False)
    files = SourceSerializer(many=True, allow_empty=False, max_length=MAX_FILES)
    interactive = serializers.BooleanField(default=True)
    stdin = TextField(
        max_length=MAX_STDIN_BYTES, default="", allow_blank=True, trim_whitespace=False,
    )

    def validate(self, attrs):
        if not attrs["interactive"]:
            raise serializers.ValidationError({"interactive": "This endpoint creates interactive jobs."})
        files = [SourceFile(**file) for file in attrs["files"]]
        language, entry = attrs["language"], attrs["entry_file"]
        try:
            stdin = attrs["stdin"].encode("utf-8")
        except UnicodeEncodeError as error:
            raise serializers.ValidationError({"stdin": "Input must be valid UTF-8."}) from error
        if len(stdin) > MAX_STDIN_BYTES:
            raise serializers.ValidationError({"stdin": "Input is limited to 64 KiB."})

        try:
            if language == "java":
                job = prepare_java(attrs.get("main_class"), files, entry_file=entry)
            elif language == "python":
                job = prepare_python(entry, files)
            else:
                job = prepare_native(NativeLanguage(language), files, entry_file=entry)
        except InvalidWorkspace as error:
            raise serializers.ValidationError({"files": str(error)}) from error
        return {"job": job, "stdin": stdin}


@api_view(["POST"])
@parser_classes([BoundedJSONParser])
def create_execution(request):
    if not local_execution_allowed(request.META.get("REMOTE_ADDR")):
        raise NotFound()
    origin = request.headers.get("Origin")
    if origin is not None and origin not in settings.FRONTEND_ORIGINS:
        raise PermissionDenied("This origin cannot create execution sessions.")
    serializer = SessionRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        session = sessions.create(**serializer.validated_data)
    except SessionCapacityError as error:
        raise Throttled(detail=str(error)) from error
    return Response(
        {
            "id": session.id,
            "owner_token": session.owner_token,
            "websocket_path": f"/ws/executions/{session.id}/",
            "expires_in": sessions.ttl,
        },
        status=201,
        headers={"Cache-Control": "no-store"},
    )

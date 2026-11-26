from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings
from django.urls import path, reverse
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from config.origins import parse_frontend_origins


class InputFixture(serializers.Serializer):
    count = serializers.IntegerField(min_value=1)


@api_view(["POST"])
def validate_input(request):
    serializer = InputFixture(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(serializer.validated_data)


@api_view(["GET"])
def raise_unexpected_error(request):
    raise RuntimeError("private error details")


urlpatterns = [
    path("validate/", validate_input),
    path("unexpected/", raise_unexpected_error),
]


@override_settings(LOCAL_EXECUTION_ENABLED=False, LOCAL_ANALYSIS_ENABLED=False)
class CapabilitiesTests(SimpleTestCase):
    def test_capabilities_report_current_availability(self):
        response = self.client.get(reverse("capabilities"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "languages": ["c", "cpp", "java", "python"],
                "execution": {"available": False, "interactive": False},
                "analysis": {"available": False},
            },
        )

    def test_unsupported_method_preserves_allow_header(self):
        response = self.client.delete(reverse("capabilities"))

        self.assertEqual(response.status_code, 405)
        self.assertIn("GET", response.headers["Allow"])
        self.assertEqual(response.json()["error"]["code"], "method_not_allowed")


@override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"])
class FrontendCorsTests(SimpleTestCase):
    def test_allowed_origin_receives_preflight_permission(self):
        response = self.client.options(
            reverse("capabilities"),
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"], "http://localhost:5173"
        )

    def test_other_port_does_not_receive_cors_permission(self):
        response = self.client.get(
            reverse("capabilities"), headers={"Origin": "http://localhost:5174"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)


@override_settings(ROOT_URLCONF=__name__)
class ApiErrorTests(SimpleTestCase):
    def test_valid_json_is_parsed_and_validated(self):
        response = self.client.post(
            "/validate/", {"count": 2}, content_type="application/json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"count": 2})

    def test_invalid_field_returns_structured_validation_error(self):
        response = self.client.post(
            "/validate/", {"count": 0}, content_type="application/json"
        )

        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertEqual(error["code"], "validation_error")
        self.assertTrue(error["details"]["count"])

    def test_malformed_json_returns_structured_parse_error(self):
        response = self.client.post(
            "/validate/", "{", content_type="application/json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "parse_error")

    def test_unexpected_exception_is_sanitized(self):
        with self.assertLogs("apps.core.api_errors", level="ERROR"):
            response = self.client.get("/unexpected/")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(),
            {
                "error": {
                    "code": "internal_error",
                    "details": {"detail": "An internal error occurred."},
                }
            },
        )


class FrontendOriginConfigTests(SimpleTestCase):
    def test_explicit_origins_and_empty_list(self):
        self.assertEqual(
            parse_frontend_origins(" https://ide.example.test,http://[::1]:5173 "),
            ["https://ide.example.test", "http://[::1]:5173"],
        )
        self.assertEqual(parse_frontend_origins(""), [])

    def test_rejects_wildcards_and_non_origins(self):
        for origin in (
            "*",
            "https://*.example.test",
            "https://.example.test",
            "https://user@example.test",
            "https://example.test/path",
            "https://example.test:",
            "https://example.test:65536",
            "file://example.test",
        ):
            with self.subTest(origin=origin):
                with self.assertRaises(ImproperlyConfigured):
                    parse_frontend_origins(origin)

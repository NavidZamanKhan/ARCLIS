from threading import Event
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from .sessions import SessionCapacityError, SessionRegistry

REQUEST = {
    "language": "python",
    "entry_file": "main.py",
    "files": [{"path": "main.py", "content": "print('fixture')"}],
}


class SessionRegistryTests(SimpleTestCase):
    def test_only_owner_claims_once_and_running_quota_is_released(self):
        registry = SessionRegistry(pending=1, running=1)
        first = registry.create(None, b"")
        with self.assertRaises(SessionCapacityError):
            registry.create(None, b"")
        self.assertIsNone(registry.claim(first.id, "invalid"))
        self.assertIs(registry.claim(first.id, first.owner_token), first)
        self.assertIsNone(registry.claim(first.id, first.owner_token))
        second = registry.create(None, b"")
        with self.assertRaises(SessionCapacityError):
            registry.claim(second.id, second.owner_token)
        registry.finish(first.id)
        self.assertIs(registry.claim(second.id, second.owner_token), second)
        registry.finish(second.id)

    def test_unclaimed_session_expires_and_releases_pending_quota(self):
        registry = SessionRegistry(ttl=0.02, pending=1)
        expired = Event()
        expire = registry._expire

        def observe_expiry(session_id):
            expire(session_id)
            expired.set()

        with patch.object(registry, "_expire", side_effect=observe_expiry):
            first = registry.create(None, b"")
            self.assertTrue(expired.wait(timeout=2))
        self.assertIsNone(registry.claim(first.id, first.owner_token))
        self.assertIsNotNone(registry.create(None, b""))


class SessionAPITests(SimpleTestCase):
    def post(self, payload, **kwargs):
        return self.client.post(
            reverse("create_execution"), payload, content_type="application/json", **kwargs,
        )

    @override_settings(LOCAL_EXECUTION_ENABLED=False)
    def test_execution_is_disabled_by_default(self):
        self.assertEqual(self.post(REQUEST).status_code, 404)

    @override_settings(
        LOCAL_EXECUTION_ENABLED=True, FRONTEND_ORIGINS=["http://localhost:5173"],
    )
    def test_invalid_origin_or_non_loopback_client_cannot_create(self):
        self.assertEqual(self.post(REQUEST, HTTP_ORIGIN="https://invalid.test").status_code, 403)
        self.assertEqual(self.post(REQUEST, REMOTE_ADDR="192.0.2.1").status_code, 404)

    @override_settings(LOCAL_EXECUTION_ENABLED=True)
    def test_valid_session_is_private_and_plan_is_ready_before_claim(self):
        registry = SessionRegistry()
        with patch("apps.execution.api.sessions", registry):
            response = self.post({**REQUEST, "stdin": "initial\n"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        body = response.json()
        self.assertEqual(body["websocket_path"], f"/ws/executions/{body['id']}/")
        session = registry.claim(body["id"], body["owner_token"])
        self.assertEqual(session.stdin, b"initial\n")
        self.assertEqual(session.job.workspace[next(iter(session.job.workspace))], b"print('fixture')")
        registry.finish(session.id)

    @override_settings(LOCAL_EXECUTION_ENABLED=True)
    def test_invalid_entry_plan_and_oversize_request_are_rejected(self):
        invalid = self.post({**REQUEST, "entry_file": "../main.py"})
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")
        with patch("apps.execution.api.MAX_JSON_BYTES", 16):
            self.assertEqual(self.post(REQUEST).status_code, 413)

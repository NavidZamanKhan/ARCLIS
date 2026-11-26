from django.test import SimpleTestCase
from django.urls import reverse


class HealthTests(SimpleTestCase):
    def test_get_returns_health_status(self):
        response = self.client.get(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Type"], "application/json")
        self.assertEqual(response.json(), {"status": "ok"})

    def test_head_returns_no_body(self):
        response = self.client.head(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"")

    def test_post_is_rejected(self):
        response = self.client.post(reverse("health"))

        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.headers["Allow"], "GET, HEAD")

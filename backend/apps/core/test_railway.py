from importlib.util import module_from_spec, spec_from_file_location
from os import environ
from pathlib import Path
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key
from django.test import SimpleTestCase

from config import settings


class RailwaySettingsTests(SimpleTestCase):
    def load_settings(self, **overrides):
        variables = {
            "ARCLIS_RAILWAY_DEPLOYMENT": "1",
            "DJANGO_SECRET_KEY": get_random_secret_key(),
            "RAILWAY_PUBLIC_DOMAIN": "arclis-api.up.railway.app",
            "DJANGO_FRONTEND_ORIGINS": "https://arclis.vercel.app",
            **overrides,
        }
        spec = spec_from_file_location("config.railway_test_settings", Path(settings.__file__))
        loaded = module_from_spec(spec)
        with patch.dict(environ, variables, clear=True):
            spec.loader.exec_module(loaded)
        return loaded

    def test_railway_disables_local_execution_even_with_debug_flags(self):
        loaded = self.load_settings(
            DJANGO_DEBUG="1", ARCLIS_ENABLE_LOCAL_EXECUTION="1", ARCLIS_ENABLE_LOCAL_ANALYSIS="1",
        )
        self.assertTrue(loaded.RESTRICTED_DEPLOYMENT)
        self.assertFalse(loaded.DEBUG)
        self.assertFalse(loaded.LOCAL_EXECUTION_ENABLED)
        self.assertFalse(loaded.LOCAL_ANALYSIS_ENABLED)
        self.assertTrue(loaded.SECURE_SSL_REDIRECT)
        self.assertEqual(loaded.SECURE_REDIRECT_EXEMPT, [r"^api/v1/health/$"])
        self.assertEqual(loaded.ALLOWED_HOSTS, ["arclis-api.up.railway.app", "healthcheck.railway.app"])
        self.assertEqual(loaded.CORS_ALLOWED_ORIGINS, ["https://arclis.vercel.app"])

    def test_requires_a_strong_secret_and_explicit_https_origins(self):
        for variables in (
            {"DJANGO_SECRET_KEY": ""},
            {"DJANGO_ALLOWED_HOSTS": "*"},
            {"DJANGO_FRONTEND_ORIGINS": "http://arclis.vercel.app"},
        ):
            with self.subTest(variables=variables), self.assertRaises(ImproperlyConfigured):
                self.load_settings(**variables)

    def test_local_restricted_compose_still_requires_its_secret_file(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "DJANGO_SECRET_KEY_FILE"):
            self.load_settings(ARCLIS_RAILWAY_DEPLOYMENT="0", ARCLIS_RESTRICTED_DEPLOYMENT="1")

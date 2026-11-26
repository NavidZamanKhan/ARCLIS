"""Verify the running loopback deployment with its local TLS certificate."""

import json
import ssl
import sys
from http.client import HTTPConnection, HTTPSConnection

from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

ORIGIN = "https://localhost:8443"


def request(connection, path, *, method="GET", body=None, headers=None):
    try:
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


def verify(certificate):
    context = ssl.create_default_context(cafile=certificate)

    def https(path, **kwargs):
        return request(HTTPSConnection("localhost", 8443, context=context, timeout=5), path, **kwargs)

    status, headers, _ = request(HTTPConnection("localhost", 8080, timeout=5), "/api/v1/health/")
    assert status == 308 and headers["Location"] == ORIGIN + "/api/v1/health/"
    status, headers, page = https("/")
    assert status == 200 and b"<title>ARCLIS" in page and b'src="/assets/' in page
    assert headers["Strict-Transport-Security"] == "max-age=300"
    assert headers["X-Frame-Options"] == "DENY"
    assert https("/", headers={"Host": "other.example.test"})[0] == 400

    status, _, body = https("/api/v1/health/")
    assert status == 200 and json.loads(body) == {"status": "ok"}
    status, headers, body = https("/api/v1/capabilities/", headers={"Origin": ORIGIN})
    assert status == 200 and headers["Access-Control-Allow-Origin"] == ORIGIN
    capabilities = json.loads(body)
    assert capabilities["execution"] == {"available": False, "interactive": False}
    assert capabilities["analysis"] == {"available": False}
    foreign_origin = "https://other.example.test"
    status, headers, _ = https("/api/v1/capabilities/", headers={"Origin": foreign_origin})
    assert status == 200 and "Access-Control-Allow-Origin" not in headers

    json_headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    for path in ("/api/v1/executions/", "/api/v1/analysis/"):
        assert https(path, method="POST", body=b"{}", headers=json_headers)[0] == 404
    oversized = json.dumps("a" * (2 * 1024 * 1024)).encode()
    assert https("/api/v1/analysis/", method="POST", body=oversized, headers=json_headers)[0] == 413

    options = {"ssl": context, "open_timeout": 5, "close_timeout": 2, "proxy": None}
    with connect("wss://localhost:8443/ws/health/", origin=ORIGIN, **options) as socket:
        assert json.loads(socket.recv(timeout=5)) == {"status": "ok"}
    denied_handshakes = (
        ("/ws/health/", foreign_origin, None),
        ("/ws/executions/" + "a" * 24 + "/", ORIGIN, ["arclis.v1", "owner." + "b" * 43]),
    )
    for path, origin, subprotocols in denied_handshakes:
        try:
            with connect("wss://localhost:8443" + path, origin=origin, subprotocols=subprotocols, **options):
                raise AssertionError(f"Unexpected WebSocket acceptance at {path}")
        except InvalidStatus as error:
            assert error.response.status_code == 403


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python deployment/smoke.py PATH_TO_LOCALHOST_CERTIFICATE")
    verify(sys.argv[1])
    print("Restricted deployment checks passed.")

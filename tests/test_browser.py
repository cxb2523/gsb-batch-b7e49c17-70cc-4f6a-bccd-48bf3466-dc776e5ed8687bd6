import functools
import http.server
import json
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

import lightpanda

TOOLS_LIST = b'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'


def request_json(url, data=None, timeout=10):
    req = urllib.request.Request(
        url, data, {"Content-Type": "application/json", "Accept": "application/json"}
    )
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(req) as resp:
                return json.load(resp)
        except OSError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.1)


def test_version():
    pinned = (Path(__file__).parents[1] / ".browser-version").read_text().strip()
    assert lightpanda.version().text == pinned


def test_cli(url):
    result = subprocess.run([sys.executable, "-m", "lightpanda", "fetch", "--dump", "markdown", url], capture_output=True, check=True)
    assert b"Hello" in result.stdout


def test_fetch(url):
    result = lightpanda.fetch(
        url,
        dump="markdown",
        strip_mode=["js", "css"],
        with_base=True,
        with_frames=True,
        dump_selector="h1",
        dump_max_bytes=1000,
        wait_ms=5000,
        wait_until="load",
        wait_selector="h1",
        wait_script="true",
        inject_script=["1", "2"],
        terminate_ms=5000,
        fail_on_http_error=True,
        http_timeout=5000,
    )
    assert "Hello" in result.text


def test_fetch_multiple_urls(url):
    assert len(lightpanda.fetch([url, url]).json()["results"]) == 2


def test_fetch_http_error(url):
    with pytest.raises(lightpanda.Error) as exc_info:
        lightpanda.fetch(f"{url}/missing", fail_on_http_error=True)
    assert exc_info.value.code == 22


class _SlowHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        time.sleep(30)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"slow")


@pytest.fixture
def slow_url():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SlowHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/slow"
    server.shutdown()


def test_fetch_multiple_mixed_http_errors(url):
    ok = f"{url}/index.html"
    missing = f"{url}/missing"
    result = lightpanda.fetch([ok, missing], fail_on_http_error=True)
    results = result.json()["results"]

    assert len(results) == 2
    assert [item["url"] for item in results] == [ok, missing]

    success, failure = results
    assert success["http_status"] == 200
    assert "Hello" in success["content"]
    assert "error" not in success

    assert failure["http_status"] == 404
    assert failure["content"] == ""
    assert isinstance(failure["error"], str) and failure["error"]
    assert "404" in failure["error"]

    # A successful page fetched in a batch is identical to a single-URL fetch.
    single = lightpanda.fetch(ok, json=True).json()
    single.pop("error", None)
    assert success == single


def test_fetch_multiple_all_fail(url):
    first = f"{url}/missing-1"
    second = f"{url}/missing-2"
    result = lightpanda.fetch([first, second], fail_on_http_error=True)
    results = result.json()["results"]

    assert len(results) == 2
    assert [item["url"] for item in results] == [first, second]
    for item in results:
        assert item["http_status"] == 404
        assert item["content"] == ""
        assert isinstance(item["error"], str) and item["error"]


def test_fetch_multiple_preserves_order_with_failures(url):
    ok = f"{url}/index.html"
    missing = f"{url}/missing"
    requested = [missing, ok, missing, ok]
    results = lightpanda.fetch(requested, fail_on_http_error=True).json()["results"]

    assert len(results) == len(requested)
    assert [item["url"] for item in results] == requested
    assert [item["http_status"] for item in results] == [404, 200, 404, 200]
    assert ["error" in item for item in results] == [True, False, True, False]


def test_fetch_multiple_without_fail_flag_unchanged(url):
    ok = f"{url}/index.html"
    missing = f"{url}/missing"
    result = lightpanda.fetch([ok, missing])
    results = result.json()["results"]

    assert len(results) == 2
    assert [item["url"] for item in results] == [ok, missing]
    # Without fail_on_http_error the browser's payload is passed through untouched.
    assert "error" in results[0]
    assert "error" in results[1]
    assert results[1]["http_status"] == 404
    assert results[1]["content"]  # the 404 error page content is still delivered


def test_fetch_multiple_all_success_has_no_error_fields(url):
    ok = f"{url}/index.html"
    results = lightpanda.fetch([ok, ok], dump="markdown", fail_on_http_error=True).json()["results"]

    assert len(results) == 2
    for item in results:
        assert item["http_status"] == 200
        assert "error" not in item

    # Each successful batch entry matches the equivalent single-URL fetch.
    single = lightpanda.fetch(ok, dump="markdown", json=True).json()
    single.pop("error", None)
    assert results[0] == single


def test_fetch_multiple_timeout_reports_zero_status_and_error(url, slow_url):
    results = lightpanda.fetch(
        [f"{url}/index.html", slow_url],
        fail_on_http_error=True,
        http_timeout=1000,
    ).json()["results"]

    assert len(results) == 2
    success, timed_out = results
    assert success["http_status"] == 200
    assert "error" not in success
    assert timed_out["http_status"] == 0
    assert timed_out["content"] == ""
    assert isinstance(timed_out["error"], str) and timed_out["error"]


def test_serve(port):
    with lightpanda.serve(
        port=port,
        advertise_host="localhost",
        cdp_max_connections=4,
        cdp_max_pending_connections=4,
        protocol=["cdp", "webdriver"],
        remote_allow_origins="*",
        http_timeout=5000,
    ) as server:
        info = request_json(f"{server.endpoint}/json/version")
        assert info["webSocketDebuggerUrl"] == f"ws://localhost:{port}/"
    assert server.process.poll() is not None


def test_mcp_stdio(port):
    with lightpanda.mcp(http_timeout=5000, cdp_port=port) as mcp:
        assert mcp.request("tools/list")["tools"]
        with pytest.raises(lightpanda.Error, match="Method not found") as exc_info:
            mcp.request("nope")
        assert exc_info.value.code == -32601


def test_mcp_http(port):
    with lightpanda.mcp(host="127.0.0.1", port=port) as mcp:
        request_json(mcp.endpoint, TOOLS_LIST)  # wait until the server is up
        assert mcp.request("tools/list")["tools"]


def test_run(url):
    script = f'''
        const page = new Page();
        await page.goto("{url}");
        console.log(await page.evaluate("document.querySelector('h1').textContent"));
    '''
    assert lightpanda.run(script).text.strip() == "Hello"


def test_agent(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    attachment = tmp_path / "notes.txt"
    attachment.write_text("notes")
    with pytest.raises(lightpanda.Error, match="Missing API key"):
        lightpanda.agent(
            "Say hi",
            provider="openai_compatible",
            model="none",
            base_url="http://127.0.0.1:1/v1",
            url="http://127.0.0.1:1/",
            attach=[str(attachment), str(attachment)],
            effort="low",
            search_engine="keenable",
            system_prompt="Be brief",
            save=str(tmp_path / "script.js"),
            trace=str(tmp_path / "trace.jsonl"),
            trace_results=True,
            verbosity="low",
        )


def test_version_check():
    assert lightpanda.version().text in lightpanda.version(check=True).text

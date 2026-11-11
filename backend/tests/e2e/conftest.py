import pytest
from tests.support.process_server import RunningBackend


@pytest.fixture
def backend_server(tmp_path, request):
    server = RunningBackend(tmp_path / "backend", scenario=getattr(request, "param", "complete"))
    try:
        yield server.start()
    finally:
        server.close()

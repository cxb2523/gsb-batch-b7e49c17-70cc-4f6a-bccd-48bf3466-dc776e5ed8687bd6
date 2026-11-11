"""Listeners del servidor: conservar Tailscale y evitar puertos duplicados."""

def test_loopback_listener_keeps_tailscale_address():
    from run_server import listen_addresses
    assert listen_addresses("100.79.63.46", True) == ["100.79.63.46", "127.0.0.1"]
    assert listen_addresses("127.0.0.1", True) == ["127.0.0.1"]
    assert listen_addresses("0.0.0.0", True) == ["0.0.0.0"]


def test_occupied_port_reports_actionable_error(monkeypatch):
    import socket
    import sys
    import pytest
    from run_server import main
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        monkeypatch.setattr(sys, "argv", ["run_server.py", "--host", "127.0.0.1", "--port", str(port)])
        with pytest.raises(SystemExit, match=f"El puerto {port} ya esta ocupado"):
            main()

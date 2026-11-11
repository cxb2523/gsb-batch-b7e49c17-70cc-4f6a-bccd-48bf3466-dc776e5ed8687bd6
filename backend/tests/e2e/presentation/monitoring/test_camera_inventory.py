def test_camera_inventory_register_update_delete_over_http(backend_server):
    client = backend_server.client
    camera = {"source_id": "e2e_inventory", "name": "Entrada", "stream_path": "camera01",
              "password": "test-only"}
    registered = client.post("/cameras", json=camera)
    assert registered.status_code == 201
    assert registered.json()["has_password"] is True
    assert "password" not in registered.json()
    assert any(row["source_id"] == camera["source_id"] for row in client.get("/cameras").json())
    update = client.put("/cameras/e2e_inventory", json={**camera, "stream_path": "camera02"})
    assert update.status_code == 200
    assert client.get("/cameras/e2e_inventory").json()["stream_path"] == "camera02"
    assert client.delete("/cameras/e2e_inventory").status_code == 200
    assert client.get("/cameras/e2e_inventory").status_code == 404

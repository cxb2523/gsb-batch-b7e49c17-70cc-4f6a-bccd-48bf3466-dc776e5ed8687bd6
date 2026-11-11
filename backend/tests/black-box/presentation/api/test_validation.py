import pytest


@pytest.mark.parametrize("body", [
    {"timestamp": -1, "frames": [[[[0., 0., 0.]]]]},
    {"timestamp": 1, "frames": []},
    {"timestamp": 1, "frames": [[[[0., 0.]]]]},
])
def test_predict_rejects_invalid_windows_without_creating_detections(api_client, body):
    response = api_client.post("/predict", json=body)
    assert response.status_code == 422
    assert api_client.get("/detections").json() == []


def test_camera_duplicate_conflict_and_update_id_validation(api_client):
    camera = {"source_id": "contract_cam", "stream_path": "camera01"}
    assert api_client.post("/cameras", json=camera).status_code == 201
    assert api_client.post("/cameras", json=camera).status_code == 409
    assert api_client.put("/cameras/contract_cam", json={**camera, "source_id": "another"}).status_code == 422
    assert api_client.delete("/cameras/contract_cam").status_code == 200
    assert api_client.get("/cameras/contract_cam").status_code == 404


@pytest.mark.parametrize("path", ["/detections?limit=0", "/alerts?limit=501", "/inference-logs?offset=-1"])
def test_history_rejects_invalid_pagination(api_client, path):
    assert api_client.get(path).status_code == 422


def test_api_key_is_required_for_prediction_and_source_control(api_client):
    for path, body in (("/predict", {"timestamp": 1, "frames": [[[[0., 0., 0.]]]]}),
                       ("/sources/start", {"source_id": "camara1"})):
        response = api_client.post(path, json=body, headers={"X-API-Key": "incorrect"})
        assert response.status_code == 401

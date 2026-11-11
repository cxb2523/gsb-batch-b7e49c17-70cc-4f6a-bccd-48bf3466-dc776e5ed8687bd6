def test_video_inference_detections_closed_alert_and_logs_over_http(backend_server):
    client = backend_server.client
    identifier = "e2e_flow"
    assert client.post("/cameras", json={"source_id": identifier, "stream_path": "controlled"}).status_code == 201
    assert client.post("/sources/start", json={"source_id": identifier}).status_code == 200
    status = backend_server.wait_for(f"/sources/{identifier}/status", lambda row: row["windows_processed"] == 5)
    assert status["active"] is True and status["status"] == "receiving"
    assert status["frames_received"] == 5 and status["processing_errors"] == 0
    assert status["latest_result"]["simulated"] is True
    assert status["latest_result"]["clase"] == "Normal"

    detections = client.get("/detections", params={"camera": identifier}).json()
    assert len(detections) == 5
    assert sorted(row["timestamp"] for row in detections) == [.25, .5, .75, 1., 1.25]
    alerts = client.get("/alerts", params={"camera": identifier}).json()
    assert alerts["total"] == 1
    event = alerts["items"][0]
    assert event["status"] == "closed" and event["clase"] == "Hurto"
    assert event["timestamp_inicio"] == .5 and event["timestamp_fin"] == 1.25
    assert {event["detection_id"], event["end_detection_id"]} <= {row["id"] for row in detections}
    assert client.get(f"/alerts/{event['id']}").json()["id"] == event["id"]
    logs = client.get("/inference-logs", params={"camera": identifier}).json()["items"]
    assert {"source_connected", "inference_completed", "alert_opened", "alert_closed"} <= {row["event_type"] for row in logs}

    assert client.delete(f"/sources/{identifier}").status_code == 200
    assert client.get(f"/sources/{identifier}/status").json()["active"] is False
    assert client.delete(f"/cameras/{identifier}").status_code == 200
    assert len(client.get("/detections", params={"camera": identifier}).json()) == 5

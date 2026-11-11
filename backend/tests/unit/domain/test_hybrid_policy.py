"""Política del híbrido: VadCLIP abre y cierra; VideoMAE solo pone la clase."""
import pytest

from app.domain.hybrid import HybridConfig, HybridPolicy

STEP = 16 / 30
CRIME = [0.0, 0.0, 0.0, 3.0, 0.0]    # gana agresión física
NORMAL = [4.0, 0.0, 1.0, 0.0, 0.0]   # gana normal; la criminal más probable es robo


def feed(policy, scores, start=0.0, span_ready=True):
    decisions = []
    for index, score in enumerate(scores):
        decisions.append(policy.update(start + index * STEP, score, span_ready=span_ready))
    return decisions


def test_opens_on_first_high_score_and_releases_after_three_low():
    policy = HybridPolicy()
    d = feed(policy, [.1, .95, .95, .95, .1, .1, .1, .1])
    # Suavizado de 2: (0,1 + 0,95) / 2 < 0,85; (0,95 + 0,95) / 2 ≥ 0,85.
    assert [x["started"] for x in d].index(True) == 2
    # Con suavizado, la primera baja aún promedia 0,525: tres actualizaciones bajo el umbral desde ahí.
    assert [x["released"] for x in d].index(True) == 6
    assert d[6]["open"] is True and d[6]["incident"] is False  # espera de unión: la alerta sigue abierta
    assert d[6]["pending_end"] == pytest.approx(6 * STEP)


def test_reactivation_within_merge_gap_is_the_same_event_and_end_is_where_vadclip_released():
    policy = HybridPolicy()
    d = feed(policy, [.95] * 3 + [.1] * 4 + [.95] * 3 + [.1] * 4)
    assert sum(x["started"] for x in d) == 1
    assert sum(x["resumed"] for x in d) == 1
    released_at = [x["timestamp"] for x in d if x["released"]][-1]
    # La espera de unión (8 s) vence sin otra reactivación: cierre con el fin que marcó VadCLIP.
    later = feed(policy, [.1] * 20, start=d[-1]["timestamp"] + STEP)
    ended = [x["ended"] for x in later if x["ended"]]
    assert len(ended) == 1
    # Sin historial, el primer puntaje alto ya promedia ≥ 0,85: abre en la primera actualización.
    assert ended[0]["start"] == pytest.approx(0.0) and ended[0]["end"] == pytest.approx(released_at)
    assert later[-1]["open"] is False


def test_reactivation_after_merge_gap_is_a_new_event():
    policy = HybridPolicy(HybridConfig(merge_gap=1.0))
    d = feed(policy, [.95] * 3 + [.1] * 8 + [.95] * 3)
    assert sum(x["started"] for x in d) == 2
    assert sum(x["ended"] is not None for x in d) == 1
    assert not any(x["resumed"] for x in d)


def test_final_class_is_videomae_mean_but_never_normal():
    policy = HybridPolicy(HybridConfig(merge_gap=0.0))
    ended = None
    for index, score in enumerate([.95] * 3 + [.1] * 6):
        ts = index * STEP
        decision = policy.update(ts, score, span_ready=True)
        ended = ended or decision["ended"]
        if decision["run_videomae"]:
            policy.add_videomae(ts, NORMAL)
    assert ended["videomae_normal"] is True
    assert ended["clase"] == "robo"   # VadCLIP manda: la criminal más probable
    assert ended["windows"] >= 2


def test_live_class_and_final_class_follow_videomae():
    policy = HybridPolicy(HybridConfig(merge_gap=0.0))
    ended = None
    for index, score in enumerate([.95] * 6 + [.1] * 6):
        ts = index * STEP
        decision = policy.update(ts, score, span_ready=True)
        ended = ended or decision["ended"]
        if decision["run_videomae"]:
            _, smoothed = policy.add_videomae(ts, CRIME)
            assert policy.live_class(smoothed)[0] == "agresion_fisica"
    assert ended["clase"] == "agresion_fisica" and ended["videomae_normal"] is False


def test_videomae_runs_only_with_an_open_event_every_four_blocks():
    policy = HybridPolicy(HybridConfig(merge_gap=0.0))
    quiet = feed(policy, [.1] * 10)
    assert not any(x["run_videomae"] for x in quiet)
    runs = []
    for index, score in enumerate([.95] * 12, start=10):
        decision = policy.update(index * STEP, score, span_ready=True)
        if decision["run_videomae"]:
            runs.append(index)
            policy.add_videomae(index * STEP, CRIME)
    # Al abrir (segunda alta, por el suavizado) y luego cada 4 bloques.
    assert runs == [11, 15, 19]


def test_without_span_the_event_opens_but_videomae_waits():
    policy = HybridPolicy()
    d = feed(policy, [.95, .95], span_ready=False)
    assert d[0]["started"] is True and not d[0]["run_videomae"]
    assert policy.update(2 * STEP, .95, span_ready=True)["run_videomae"] is True


def test_long_events_are_split_in_technical_segments():
    policy = HybridPolicy(HybridConfig(max_event_seconds=3.0))
    d = feed(policy, [.95] * 14)
    splits = [x for x in d if x["split"]]
    assert len(splits) == 2
    assert splits[0]["ended"]["end"] == pytest.approx(splits[0]["timestamp"])
    assert splits[0]["started"] and splits[0]["start_timestamp"] == pytest.approx(splits[0]["timestamp"])


def test_reset_forgets_everything():
    policy = HybridPolicy()
    feed(policy, [.95] * 3)
    policy.reset()
    assert policy.update(0.0, .1, span_ready=True)["open"] is False


@pytest.mark.parametrize("kwargs", [dict(threshold=1.5), dict(release=0), dict(sampling_stride=8),
                                    dict(queue_size=0), dict(merge_gap=-1)])
def test_invalid_configuration(kwargs):
    with pytest.raises(ValueError):
        HybridConfig(**kwargs)


def test_invalid_videomae_logits():
    policy = HybridPolicy()
    with pytest.raises(ValueError):
        policy.add_videomae(0.0, [0.0, float("nan"), 0.0, 0.0, 0.0])

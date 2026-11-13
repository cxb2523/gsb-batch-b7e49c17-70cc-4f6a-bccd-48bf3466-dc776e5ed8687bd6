# tests/hooks/test_extract_hook.py

"""Contract tests for the ``extract`` and ``unzip`` file-stage hooks.

Extraction is delegated to ``fetchez.utils.p_f_extract``; these tests pin the
hook-level behaviour around it: entry pass-through, error handling, child
entries, archive removal, and forwarding of the optional limits.
"""

import gzip
import io
import logging
import tarfile
import warnings
import zipfile
from pathlib import Path

import pytest

from fetchez import utils
from fetchez.hooks.extract import Extract
from fetchez.hooks.unzip import Unzip
from fetchez.registry import HookRegistry


def _make_zip(path: Path, entries) -> Path:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # duplicate names warn in zipfile
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, data in entries:
                zf.writestr(name, data)
    return path


def _make_tar(path: Path, entries) -> Path:
    with tarfile.open(path, "w") as tf:
        for name, data in entries:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return path


def _payloads(entries):
    return [entry["dst_fn"] for _mod, entry in entries]


@pytest.fixture
def quiet_caplog(caplog):
    with caplog.at_level(logging.ERROR):
        yield caplog


# ---------------------------------------------------------------------------
# Existing contract: pass-through and child entries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [1, 2, -1, "failed"])
def test_entries_with_nonzero_status_pass_through(tmp_path, status):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"a")])
    entry = {"dst_fn": str(archive), "status": status}

    out = Extract().run([(None, entry)])

    assert out == [(None, entry)]
    assert not (archive.parent / "a.txt").exists()


@pytest.mark.parametrize("dst_fn", [None, ""])
def test_entries_without_dst_fn_pass_through(tmp_path, dst_fn):
    entry = {"status": 0}
    if dst_fn is not None:
        entry["dst_fn"] = dst_fn

    out = Extract().run([(None, entry)])

    assert out == [(None, entry)]


def test_successful_extraction_emits_child_entries(tmp_path):
    archive = _make_zip(tmp_path / "a.zip", [("dir/a.txt", b"a")])
    entry = {
        "dst_fn": str(archive),
        "status": 0,
        "data_type": "generic",
        "profile": "some-profile",
    }

    out = Extract().run([(None, entry)])

    assert len(out) == 1
    _mod, child = out[0]
    assert child["dst_fn"] == str((tmp_path / "dir" / "a.txt").resolve())
    assert child["src_fn"] == str(archive)
    assert child["status"] == 0
    assert "data_type" not in child
    assert "profile" not in child
    assert (tmp_path / "dir" / "a.txt").read_bytes() == b"a"


def test_failure_keeps_entry_and_continues_with_later_entries(tmp_path, quiet_caplog):
    broken = tmp_path / "broken.zip"
    broken.write_bytes(b"not a zip")
    good = _make_zip(tmp_path / "good.zip", [("good.txt", b"g")])
    first = {"dst_fn": str(broken), "status": 0}
    second = {"dst_fn": str(good), "status": 0}

    out = Extract().run([(None, first), (None, second)])

    assert out[0] == (None, first)
    assert out[1][1]["dst_fn"] == str((tmp_path / "good.txt").resolve())
    assert (tmp_path / "good.txt").read_bytes() == b"g"
    assert "Extraction failed" in quiet_caplog.text


def test_unsupported_format_passes_through_without_error(tmp_path, quiet_caplog):
    plain = tmp_path / "notes.txt"
    plain.write_text("hello")
    entry = {"dst_fn": str(plain), "status": 0}

    out = Extract().run([(None, entry)])

    assert out == [(None, entry)]
    assert "Extraction failed" not in quiet_caplog.text


@pytest.mark.parametrize("hook_cls", [Extract, Unzip])
def test_remove_deletes_archive_after_success(tmp_path, hook_cls):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"a")])
    entry = {"dst_fn": str(archive), "status": 0}

    out = hook_cls(remove=True).run([(None, entry)])

    assert not archive.exists()
    assert len(out) == 1


@pytest.mark.parametrize("hook_cls", [Extract, Unzip])
def test_remove_keeps_archive_after_failure(tmp_path, hook_cls):
    archive = _make_zip(tmp_path / "a.zip", [("../evil.txt", b"evil")])
    entry = {"dst_fn": str(archive), "status": 0}

    out = hook_cls(remove=True).run([(None, entry)])

    assert out == [(None, entry)]
    assert archive.exists()


# ---------------------------------------------------------------------------
# Unzip hook is the safe implementation
# ---------------------------------------------------------------------------


def test_unzip_hook_is_registered_and_shares_the_safe_implementation():
    HookRegistry.load_all()

    extract_cls = HookRegistry.get_class("extract")
    unzip_cls = HookRegistry.get_class("unzip")

    assert extract_cls is Extract
    assert unzip_cls is Unzip
    assert issubclass(Unzip, Extract)


def test_unzip_hook_forwarded_arguments_are_available_to_the_cli():
    args = HookRegistry.load_all() and HookRegistry.get_info("unzip")["cli_args"]

    for name in ("remove", "overwrite", "members", "max_members", "max_total_size"):
        assert name in args


def test_unzip_hook_rejects_traversal_like_extract(tmp_path, quiet_caplog):
    archive = _make_zip(tmp_path / "a.zip", [("../evil.txt", b"evil")])
    entry = {"dst_fn": str(archive), "status": 0}

    out = Unzip().run([(None, entry)])

    assert out == [(None, entry)]
    assert "Refusing to extract" in quiet_caplog.text
    assert not (tmp_path / "evil.txt").exists()


def test_unzip_hook_does_not_create_tar_links_or_special_files(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    archive = tmp_path / "a.tar"

    with tarfile.open(archive, "w") as tf:
        sym = tarfile.TarInfo("link")
        sym.type = tarfile.SYMTYPE
        sym.linkname = str(outside)
        tf.addfile(sym)

        hard = tarfile.TarInfo("hard.txt")
        hard.type = tarfile.LNKTYPE
        hard.linkname = str(outside / "target.txt")
        tf.addfile(hard)

        fifo = tarfile.TarInfo("pipe")
        fifo.type = tarfile.FIFOTYPE
        tf.addfile(fifo)

        data = b"data"
        info = tarfile.TarInfo("data.txt")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))

    entry = {"dst_fn": str(archive), "status": 0}
    out = Unzip().run([(None, entry)])

    assert _payloads(out) == [str((tmp_path / "data.txt").resolve())]
    assert not (tmp_path / "link").exists()
    assert not (tmp_path / "link").is_symlink()
    assert not (tmp_path / "hard.txt").exists()
    assert not (tmp_path / "pipe").exists()
    assert list(outside.iterdir()) == []


# ---------------------------------------------------------------------------
# Forwarded options: members, overwrite, limits
# ---------------------------------------------------------------------------


def test_members_filter_is_forwarded(tmp_path):
    archive = _make_zip(
        tmp_path / "a.zip", [("keep.dat", b"keep"), ("skip.txt", b"skip")]
    )
    entry = {"dst_fn": str(archive), "status": 0}

    out = Extract(members=["*.dat"]).run([(None, entry)])

    assert _payloads(out) == [str((tmp_path / "keep.dat").resolve())]
    assert not (tmp_path / "skip.txt").exists()


def test_members_given_as_a_single_string_are_one_pattern(tmp_path):
    # Iterating a bare string would match single characters; the CLI passes
    # ``members=.tif`` this way.
    archive = _make_zip(tmp_path / "a.zip", [("tile.tif", b"t"), ("notes.txt", b"n")])
    entry = {"dst_fn": str(archive), "status": 0}

    out = Extract(members=".tif").run([(None, entry)])

    assert _payloads(out) == [str((tmp_path / "tile.tif").resolve())]


def test_overwrite_false_reuses_a_matching_existing_output(tmp_path):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"data")])
    output = tmp_path / "a.txt"
    output.write_bytes(b"data")
    before = output.stat().st_mtime_ns

    out = Extract(overwrite=False).run([(None, {"dst_fn": str(archive), "status": 0})])

    assert _payloads(out) == [str(output.resolve())]
    assert output.stat().st_mtime_ns == before


def test_overwrite_true_rewrites_an_existing_output(tmp_path):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"new")])
    output = tmp_path / "a.txt"
    output.write_bytes(b"old")

    out = Extract(overwrite=True).run([(None, {"dst_fn": str(archive), "status": 0})])

    assert _payloads(out) == [str(output.resolve())]
    assert output.read_bytes() == b"new"


@pytest.mark.parametrize("hook_cls", [Extract, Unzip])
def test_max_members_rejects_the_whole_archive(tmp_path, hook_cls, quiet_caplog):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"a"), ("b.txt", b"b")])
    entry = {"dst_fn": str(archive), "status": 0}

    out = hook_cls(max_members=1).run([(None, entry)])

    assert out == [(None, entry)]
    assert not (tmp_path / "a.txt").exists()
    assert not (tmp_path / "b.txt").exists()
    assert "Refusing to extract" in quiet_caplog.text


@pytest.mark.parametrize("hook_cls", [Extract, Unzip])
def test_max_total_size_rejects_the_whole_archive(tmp_path, hook_cls, quiet_caplog):
    archive = _make_zip(tmp_path / "a.zip", [("a.txt", b"x" * 100)])
    entry = {"dst_fn": str(archive), "status": 0}

    out = hook_cls(max_total_size=99).run([(None, entry)])

    assert out == [(None, entry)]
    assert not (tmp_path / "a.txt").exists()
    assert "Refusing to extract" in quiet_caplog.text


def test_max_total_size_counts_decompressed_gzip_bytes(tmp_path):
    archive = tmp_path / "data.dat.gz"
    with gzip.open(archive, "wb") as handle:
        handle.write(bytes(1024 * 1024))
    entry = {"dst_fn": str(archive), "status": 0}

    out = Extract(max_total_size=1024).run([(None, entry)])

    assert out == [(None, entry)]
    assert not (tmp_path / "data.dat").exists()


@pytest.mark.parametrize("value,expected", [(5, 5), ("5", 5), (None, None)])
def test_limits_accept_integers_and_cli_strings(value, expected):
    hook = Extract(max_members=value, max_total_size=value)

    assert hook.max_members == expected
    assert hook.max_total_size == expected


@pytest.mark.parametrize(
    "value,expected", [(True, True), ("true", True), ("false", False), (False, False)]
)
def test_boolean_options_accept_cli_strings(value, expected):
    hook = Extract(remove=value, overwrite=value)

    assert hook.remove is expected
    assert hook.overwrite is expected


def test_colliding_member_paths_reject_the_archive(tmp_path, quiet_caplog):
    archive = _make_zip(
        tmp_path / "a.zip",
        [("first.txt", b"1"), ("dir/a.txt", b"2"), ("dir//a.txt", b"3")],
    )
    entry = {"dst_fn": str(archive), "status": 0}

    out = Extract().run([(None, entry)])

    assert out == [(None, entry)]
    assert not (tmp_path / "first.txt").exists()
    assert "Refusing to extract" in quiet_caplog.text


def test_utils_unsafe_error_is_a_value_error():
    assert issubclass(utils.UnsafeArchiveError, ValueError)

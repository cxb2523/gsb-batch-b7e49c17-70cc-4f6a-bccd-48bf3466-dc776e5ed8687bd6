"""Acceptance for the stinger cover gate (ADR-032), runnable fully offline against the fake engine, which writes real
PNGs (so alpha.alpha_coverage reads actual pixels, no mocks).

Every path the change has to give a judgeable conclusion on is covered:
  1. full cover at the cut frame        -> the concat runs and is delivered, cover_measured says covered
  2. a partially transparent cut frame  -> INVALID_INPUT stinger_not_covering ("不覆盖"), with the frame index, the
                                           lowest alpha, the pixel count under the threshold, the total pixels, their
                                           share and the threshold itself; no output is delivered
  3. the frame is extracted but its alpha cannot be read
                                       -> INVALID_INPUT stinger_cover_unmeasured ("未测到"), never treated as opaque;
                                           no output is delivered (both "look wrote no file" and "wrote a PNG with no
                                           alpha channel")
  4. stinger frame rate != edit rate    -> INVALID_INPUT stinger_fps before the join tool is called
  5. cut point not on a stinger frame   -> INVALID_REQUEST cut_point_not_on_frame before the join tool is called
  6. reuse: a successful run is reused without measuring again; changing a parameter changes the idempotency key, so
     the result is re-measured and re-run; an intermediate recorded under an old key (a version without the measurement
     rule) is never delivered

Assertions cover the error code, every required details field, and whether the final output was actually delivered.
"""
import json
import os
import shutil
import tempfile
import unittest

from fake_engine import make_fake_skill, set_mode
from helpers import cli, make_workspace, request, write_fake_media

from video_editing_skill.errors import EXIT_CODES
from video_editing_skill.response import check_response


def write_header_media(path, **header):
    """A fake video whose probe facts come from its FAKE{...} header (the fake engine's probe reads them verbatim)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"FAKE" + json.dumps(header).encode())
    return path


class StingerCoverGateAcceptanceTests(unittest.TestCase):
    """The whole chain, end to end through the CLI with a fake ffmpeg-skill and real PNG alpha reads."""

    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp(prefix="fake-ffmpeg-skill-cover-")
        make_fake_skill(cls.root)
        cls.env = {"VIDEO_EDITING_FFMPEG_SKILL_DIR": cls.root}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def setUp(self):
        set_mode(self.root, "ok")
        self._reset_look_calls()
        self.ws = make_workspace()
        write_fake_media(os.path.join(self.ws, "in", "a.mp4"))
        write_fake_media(os.path.join(self.ws, "in", "b.mp4"))
        write_fake_media(os.path.join(self.ws, "in", "stinger_alpha.mov"))      # opaque cut frame, 30 fps, 640x360
        write_fake_media(os.path.join(self.ws, "in", "stinger_alpha_holey.mov"))  # left half transparent at the cut
        self.out_path = os.path.join(self.ws, "out", "c.mp4")

    def _reset_look_calls(self):
        try:
            os.remove(os.path.join(self.root, "LOOK_CALLS"))
        except FileNotFoundError:
            pass

    def look_calls(self):
        try:
            with open(os.path.join(self.root, "LOOK_CALLS"), encoding="utf-8") as fh:
                return int(fh.read().strip() or "0")
        except OSError:
            return 0

    def doc(self, stinger="ST", cut_point=0.5, cover=None, stinger_file="in/stinger_alpha.mov"):
        src = [{"id": "A", "path": "in/a.mp4"}, {"id": "B", "path": "in/b.mp4"},
               {"id": stinger, "path": stinger_file}]
        tr = {"type": "stinger", "stinger": stinger, "cut_point": cut_point,
              "cover": cover or {"start": 0.4, "end": 0.6}}
        return request(src, [{"id": "c", "type": "CONCAT", "inputs": ["A", "B"], "params": {"transition": tr}}],
                       [{"id": "x", "operation": "c", "path": "out/c.mp4"}], options={"overwrite": True})

    def run_(self, doc, expect=None):
        rc, out, err = cli(["run", "-", "--json", "--workspace", self.ws], stdin=json.dumps(doc).encode(), env=self.env)
        self.assertIsInstance(out, dict, err)
        self.assertEqual(check_response(out, "run"), [], out)
        if expect is not None:
            self.assertEqual(rc, expect, json.dumps(out.get("error"), indent=1) + err)
        return rc, out

    def assert_nothing_delivered(self, out):
        """Neither the final output nor any partial / measured-frame file may survive a refusal. A refusal raised while the
        sources are checked (before Executor.run) has no execution block at all: nothing started, so nothing delivered."""
        self.assertFalse(os.path.exists(self.out_path), "a refused stinger must leave no deliverable output")
        work = os.path.join(self.ws, ".video-editing", "work")
        leftovers = [f for _, _, fs in os.walk(work) for f in fs if ".partial" in f or f.endswith(".png")]
        self.assertEqual(leftovers, [], "no partial render or measured PNG may survive a refusal")
        for o in out.get("execution", {}).get("outputs", []):
            self.assertFalse(o["delivered"])

    # ------------------------------------------------------------ 1. full cover
    def test_full_cover_runs_and_is_delivered(self):
        rc, out = self.run_(self.doc(), expect=0)
        self.assertTrue(out["ok"])
        rec = out["execution"]["operations"][0]
        m = rec["stinger"]["cover_measured"]
        self.assertEqual((m["measured"], m["covered"]), (True, True))
        self.assertEqual(m["frame"], 15, "cut point 0.5 s at 30 fps is the stinger's frame 15")
        self.assertEqual((m["pixels_below"], m["pixels"], m["share_below"]), (0, 640 * 360, 0.0))
        self.assertEqual((m["min_alpha"], m["threshold"]), (255.0, 253))
        delivered = out["execution"]["outputs"][0]
        self.assertTrue(delivered["delivered"] and os.path.isfile(delivered["path"]))
        self.assertEqual(self.look_calls(), 1, "the cut frame is measured once before the join")

    # ------------------------------------------------------------ 2. partial transparency -> "不覆盖"
    def test_partial_transparency_is_refused_with_full_figures(self):
        doc = self.doc(stinger="HO", stinger_file="in/stinger_alpha_holey.mov")
        rc, out = self.run_(doc, expect=EXIT_CODES["INVALID_INPUT"])
        err = out["error"]
        self.assertEqual((err["code"], err["details"]["reason"]), ("INVALID_INPUT", "stinger_not_covering"), err)
        m = err["details"]["measured"]
        pixels = 640 * 360
        below = 320 * 360
        # every figure the refusal has to be judged on
        self.assertEqual(m["frame"], 15)
        self.assertEqual(m["min_alpha"], 0.0)
        self.assertEqual(m["pixels_below"], below)
        self.assertEqual(m["pixels"], pixels)
        self.assertAlmostEqual(m["share_below"], below / pixels)
        self.assertEqual(m["threshold"], 253)
        self.assertFalse(m["covered"])
        self.assertEqual(err["details"]["operation"], "c")
        self.assertEqual(err["details"]["input"], "HO")
        self.assert_nothing_delivered(out)
        self.assertEqual([r["status"] for r in out["execution"]["operations"]], ["skipped"])
        self.assertEqual(self.look_calls(), 1, "the frame was looked at, the join was never called")

    # ------------------------------------------------------------ 3. alpha unreadable -> "未测到"
    def test_alpha_unreadable_is_refused_and_never_taken_as_opaque(self):
        # 3a. look.py exits 0 but writes no frame file at all
        set_mode(self.root, "no_output")
        rc, out = self.run_(self.doc(), expect=EXIT_CODES["INVALID_INPUT"])
        err = out["error"]
        self.assertEqual((err["code"], err["details"]["reason"]), ("INVALID_INPUT", "stinger_cover_unmeasured"), err)
        self.assertEqual(err["details"]["frame"], 15, "the unmeasured frame is still identified")
        self.assertEqual(err["details"]["input"], "ST")
        self.assert_nothing_delivered(out)

        # 3b. look.py writes a frame, but an RGB PNG: extraction succeeded, there is no alpha to read
        set_mode(self.root, "look_no_alpha")
        self._reset_look_calls()
        rc, out = self.run_(self.doc(), expect=EXIT_CODES["INVALID_INPUT"])
        err = out["error"]
        self.assertEqual((err["code"], err["details"]["reason"]), ("INVALID_INPUT", "stinger_cover_unmeasured"), err)
        self.assertEqual(err["details"]["frame"], 15)
        self.assert_nothing_delivered(out)
        self.assertEqual(self.look_calls(), 1, "the frame was extracted; it was refused on the alpha read, not assumed opaque")

    # ------------------------------------------------------------ 4. frame rate mismatch -> before the join
    def test_stinger_frame_rate_mismatch_is_refused_before_the_join(self):
        # edit inputs run at 30 fps; this stinger has an alpha plane but runs at 24 fps
        write_header_media(os.path.join(self.ws, "in", "stinger_24.mov"), fps=24.0, width=640, height=360,
                           pix_fmt="yuva444p10le", duration=1.2)
        doc = self.doc(stinger="S24", stinger_file="in/stinger_24.mov")
        rc, out = self.run_(doc, expect=EXIT_CODES["INVALID_INPUT"])
        err = out["error"]
        self.assertEqual((err["code"], err["details"]["reason"]), ("INVALID_INPUT", "stinger_fps"), err)
        self.assertIn("24", err["message"])
        self.assertIn("30", err["message"])
        self.assert_nothing_delivered(out)
        self.assertEqual(self.look_calls(), 0, "the cover is never measured when the rate rule already fails")

    # ------------------------------------------------------------ 5. cut point not on a frame -> before the join
    def test_cut_point_not_on_a_frame_is_refused_before_the_join(self):
        # 0.51 s at 30 fps is 15.3 frames: inside the declared cover window, but not on a whole frame
        doc = self.doc(cut_point=0.51, cover={"start": 0.5, "end": 0.6})
        rc, out = self.run_(doc, expect=EXIT_CODES["INVALID_REQUEST"])
        err = out["error"]
        self.assertEqual((err["code"], err["details"]["reason"]), ("INVALID_REQUEST", "cut_point_not_on_frame"), err)
        self.assert_nothing_delivered(out)
        self.assertEqual(self.look_calls(), 0, "no measurement and no join for a cut point between frames")

    # ------------------------------------------------------------ 6. reuse
    def test_reuse_then_a_changed_parameter_re_measures_and_re_runs(self):
        # first run: measured and rendered
        rc, first = self.run_(self.doc(), expect=0)
        first_rec = first["execution"]["operations"][0]
        self.assertEqual(first_rec["status"], "completed")
        self.assertEqual(self.look_calls(), 1)

        # identical request: the intermediate is reused, the cover is not measured again
        rc, again = self.run_(self.doc(), expect=0)
        self.assertEqual(again["status"], "reused")
        self.assertEqual(again["execution"]["operations"][0]["status"], "reused")
        self.assertEqual(self.look_calls(), 1, "a reused result is not measured again")

        # change a parameter (the cut point, still fully covered): another idempotency key, so re-measure and re-run
        doc2 = self.doc(cut_point=0.4, cover={"start": 0.3, "end": 0.5})
        rc, changed = self.run_(doc2, expect=0)
        rec = changed["execution"]["operations"][0]
        self.assertEqual(rec["status"], "completed", "the changed request is rendered again, not served from the old file")
        self.assertEqual(rec["stinger"]["cover_measured"]["frame"], 12, "0.4 s at 30 fps is frame 12")
        self.assertEqual(self.look_calls(), 2)
        self.assertTrue(changed["execution"]["outputs"][0]["delivered"])

    def test_an_intermediate_recorded_without_the_measurement_rule_is_never_delivered(self):
        rc, out = self.run_(self.doc(), expect=0)
        rec = out["execution"]["operations"][0]
        record = os.path.join(self.ws, ".video-editing", "work", rec["operation_id"] + ".json")
        with open(record, encoding="utf-8") as fh:
            saved = json.load(fh)
        # simulate an intermediate produced by a version whose idempotency key did not include the measurement rule
        saved["idempotency_key"] = "made-before-the-cover-was-measured"
        with open(record, "w", encoding="utf-8") as fh:
            json.dump(saved, fh)
        self._reset_look_calls()
        rc, redone = self.run_(self.doc(), expect=0)
        rec = redone["execution"]["operations"][0]
        self.assertEqual(rec["status"], "completed", "the old intermediate is not reused")
        self.assertTrue(rec["stinger"]["cover_measured"]["measured"], "the cover is measured again before rendering")
        self.assertEqual(self.look_calls(), 1)
        self.assertTrue(redone["execution"]["outputs"][0]["delivered"], "only the freshly validated output is delivered")

    def test_a_failed_gate_run_does_not_replace_or_claim_an_existing_output(self):
        """With overwrite, a good run first delivers out/c.mp4. A later request that fails the cover gate must not touch that
        file and its failure document must not claim a delivered output."""
        rc, out = self.run_(self.doc(), expect=0)
        good = out["execution"]["outputs"][0]["path"]
        with open(good, "rb") as fh:
            before = fh.read()
        bad = self.doc(stinger="HO", stinger_file="in/stinger_alpha_holey.mov")
        rc, out = self.run_(bad, expect=EXIT_CODES["INVALID_INPUT"])
        self.assertEqual(out["error"]["details"]["reason"], "stinger_not_covering")
        for o in out.get("execution", {}).get("outputs", []):
            self.assertFalse(o["delivered"], "a failed run never reports a delivery")
        self.assertTrue(os.path.isfile(good), "the previously delivered output is not deleted by a failed run")
        with open(good, "rb") as fh:
            self.assertEqual(fh.read(), before, "the previous output's bytes are untouched")

    def test_a_reuse_candidate_that_fails_revalidation_is_rerun(self):
        rc, out = self.run_(self.doc(), expect=0)
        self.assertEqual(self.look_calls(), 1)
        rec = out["execution"]["operations"][0]
        media = os.path.join(self.ws, ".video-editing", "work",
                             rec["operation_id"] + os.path.splitext(self.out_path)[1])
        # corrupt the cached intermediate while keeping its record: the sha256 no longer matches, so it must be re-run
        with open(media, "wb") as fh:
            fh.write(b"corrupt bytes")
        rc, redone = self.run_(self.doc(), expect=0)
        self.assertEqual(redone["execution"]["operations"][0]["status"], "completed")
        self.assertEqual(self.look_calls(), 2, "the failed reuse candidate is measured again before the operation re-runs")
        self.assertTrue(redone["execution"]["outputs"][0]["delivered"])


if __name__ == "__main__":
    unittest.main()

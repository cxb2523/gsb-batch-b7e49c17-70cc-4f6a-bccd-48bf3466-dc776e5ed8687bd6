"""
test_stream_section_reassembly.py

Hand-built local MPEG-TS byte samples for SCTE-35 section
reassembly in threefive.Stream.

Coverage:
  1. complete single-packet SCTE-35 message
  2. two-packet section reassembled in arrival order
  3. reassembled length that disagrees with section_length is dropped
  4. illegal section_length is dropped and the same pid recovers
  5. a corrupt pid never disturbs reassembly on another pid
  6. tri-state return values of Stream._section_incomplete

No network, no files, no third party test dependency.
"""

import io
import sys
import unittest
from base64 import b64decode

sys.path.insert(0, ".")

from threefive.stream import Stream  # noqa: E402

PID = 0x100  # scte35 test pid
OTHER_PID = 0x200

# A real, CRC-valid SCTE-35 Time Signal section (50 bytes on the wire,
# section_length field == 47).
GOOD_B64 = "/DAvAAAAAAAA///wBQb+dGKQoAAZAhdDVUVJSAAAjn+fCAgAAAAALKChijUCAKnMZ1g="
GOOD_SECTION = b64decode(GOOD_B64)


def make_pkt(pid, payload, pusi=True, cc=0):
    """
    Build one 188 byte MPEG-TS packet carrying payload.
    Any payload shorter than 184 bytes is padded with an
    adaptation field (never with 0xff payload bytes, which
    would corrupt section reassembly).
    """
    if len(payload) > 184:
        raise ValueError("payload too large for one packet")
    header = bytearray(4)
    header[0] = 0x47
    header[1] = (0x40 if pusi else 0x00) | ((pid >> 8) & 0x1F)
    header[2] = pid & 0xFF
    header[3] = 0x10 | (cc & 0x0F)  # payload only
    body = bytearray(payload)
    if len(body) < 184:
        pad_len = 184 - len(body)
        # adaptation_field_length + flags byte, rest is stuffing
        af = bytes([pad_len - 1, 0x00]) + b"\xff" * (pad_len - 2)
        header[3] = 0x30 | (cc & 0x0F)  # adaptation + payload
        body = af + body
    pkt = bytes(header) + bytes(body)
    assert len(pkt) == 188
    return pkt


def make_stream():
    """
    A Stream whose scte35 pid is registered directly, bypassing
    PAT/PMT discovery.
    """
    strm = Stream(io.BytesIO(b""))
    strm.pids.scte35.add(PID)
    strm.pids.scte35.add(OTHER_PID)
    # _mk_packet_data looks the pid up here
    strm.maps.pid_prgm[PID] = 1
    strm.maps.pid_prgm[OTHER_PID] = 1
    return strm


def section_pkts(section, split_at):
    """
    Split a section across two TS packets on PID.
    split_at is the number of section bytes in the first packet.
    """
    first = make_pkt(PID, section[:split_at], pusi=True, cc=0)
    second = make_pkt(PID, section[split_at:], pusi=False, cc=1)
    return first, second


class TestSectionReassembly(unittest.TestCase):
    def test_01_single_packet_complete(self):
        """A complete section in one packet parses to one Cue."""
        strm = make_stream()
        pkt = make_pkt(PID, GOOD_SECTION, pusi=True, cc=0)
        cue = strm.parse(pkt)
        self.assertIsNotNone(cue)
        self.assertEqual(cue.command.name, "Time Signal")
        self.assertEqual(cue.info_section.section_length, 47)
        self.assertNotIn(PID, strm.maps.partial)

    def test_02_two_packet_reassembly(self):
        """A section split across two packets is joined in order and parsed."""
        strm = make_stream()
        first, second = section_pkts(GOOD_SECTION, split_at=30)

        cue1 = strm.parse(first)
        self.assertFalse(cue1)
        self.assertIn(PID, strm.maps.partial)

        cue2 = strm.parse(second)
        self.assertIsNotNone(cue2)
        self.assertEqual(cue2.command.name, "Time Signal")
        self.assertEqual(cue2.info_section.section_length, 47)
        self.assertNotIn(PID, strm.maps.partial)

    def test_03_reassembled_length_mismatch_dropped(self):
        """
        A continuation packet whose concatenated length does not
        match section_length must be dropped (no Cue, cache cleared).
        """
        strm = make_stream()
        # section claims 47, but the two fragments only total 40 bytes
        short_section = GOOD_SECTION[:40]
        first, second = section_pkts(short_section, split_at=30)

        self.assertFalse(strm.parse(first))
        self.assertIn(PID, strm.maps.partial)

        cue = strm.parse(second)
        self.assertFalse(cue)
        self.assertNotIn(PID, strm.maps.partial)

    def test_04_bad_length_then_same_pid_recovers(self):
        """
        A section_length below the minimum legal SCTE-35 size is
        rejected, and a following valid message on the same pid
        still parses normally.
        """
        strm = make_stream()
        bad = bytearray(GOOD_SECTION)
        # force section_length to 3 (way below the 18 byte minimum)
        bad[1] = (bad[1] & 0xF0) | 0x00
        bad[2] = 0x03
        bad_pkt = make_pkt(PID, bytes(bad), pusi=True, cc=0)

        cue = strm.parse(bad_pkt)
        self.assertFalse(cue)
        self.assertNotIn(PID, strm.maps.partial)

        good_pkt = make_pkt(PID, GOOD_SECTION, pusi=True, cc=1)
        cue = strm.parse(good_pkt)
        self.assertIsNotNone(cue)
        self.assertEqual(cue.command.name, "Time Signal")
        self.assertEqual(cue.info_section.section_length, 47)

    def test_05_other_pid_unaffected(self):
        """
        A fragment cached on PID must not influence reassembly
        on a different pid, and a corrupt PID must not block
        another pid's valid message.
        """
        strm = make_stream()
        # start an incomplete section on PID
        first, _ = section_pkts(GOOD_SECTION, split_at=30)
        strm.parse(first)
        self.assertIn(PID, strm.maps.partial)

        # a complete, valid message arrives on OTHER_PID
        other_pkt = make_pkt(OTHER_PID, GOOD_SECTION, pusi=True, cc=0)
        cue = strm.parse(other_pkt)
        self.assertIsNotNone(cue)
        self.assertEqual(cue.command.name, "Time Signal")

        # PID's own fragment is still waiting, untouched
        self.assertIn(PID, strm.maps.partial)
        self.assertNotIn(OTHER_PID, strm.maps.partial)

    def test_06_pusi_while_cached_drops_fragment(self):
        """
        A new payload-unit-start packet arriving while an old
        fragment is cached invalidates the old fragment instead
        of silently concatenating it.
        """
        strm = make_stream()
        first, _ = section_pkts(GOOD_SECTION, split_at=30)
        strm.parse(first)
        self.assertIn(PID, strm.maps.partial)

        # new section start, not a continuation
        restart = make_pkt(PID, GOOD_SECTION, pusi=True, cc=1)
        cue = strm.parse(restart)
        self.assertIsNotNone(cue)
        self.assertNotIn(PID, strm.maps.partial)

    def test_07_section_incomplete_tristate(self):
        """
        _section_incomplete distinguishes need-more-data from
        illegal length, and has no caching side effects.
        """
        strm = make_stream()
        pid = PID
        full = b"\xfc" + b"\x00\x2f" + b"\x00" * 47  # len == seclen + 3

        self.assertFalse(
            strm._section_incomplete(full, pid, 47, min_seclen=18)
        )
        self.assertEqual(
            strm._section_incomplete(full[:20], pid, 47, min_seclen=18),
            Stream.INCOMPLETE,
        )
        self.assertEqual(
            strm._section_incomplete(full, pid, 3, min_seclen=18),
            Stream.BAD_LENGTH,
        )
        # pure function: nothing was cached
        self.assertEqual(strm.maps.partial, {})

    def test_08_end_to_end_decode_next(self):
        """decode_next returns the cue from a two-packet section."""
        first, second = section_pkts(GOOD_SECTION, split_at=30)
        data = first + second
        strm = Stream(io.BytesIO(data))
        strm.pids.scte35.add(PID)
        strm.maps.pid_prgm[PID] = 1
        cue = strm.decode_next()
        self.assertIsNotNone(cue)
        self.assertEqual(cue.command.name, "Time Signal")


if __name__ == "__main__":
    unittest.main(verbosity=2)

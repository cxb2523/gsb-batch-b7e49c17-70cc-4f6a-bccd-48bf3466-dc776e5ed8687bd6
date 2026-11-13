from __future__ import annotations


class HarvestError(RuntimeError):
    """Raised when a run cannot produce a trustworthy dataset at all.

    Ordinary per-source and per-URL problems never raise: they are recorded in
    ``failed-geofeeds.csv`` and ``manifest.json`` so the rest of the run can
    proceed. This error is reserved for the case where continuing would publish
    a dataset that says nothing about the network it is supposed to describe.
    """

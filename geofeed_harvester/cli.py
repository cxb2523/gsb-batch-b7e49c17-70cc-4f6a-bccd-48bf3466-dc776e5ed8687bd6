from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from geofeed_harvester.errors import HarvestError
from geofeed_harvester.pipeline import run_harvest
from geofeed_harvester.rdap import discover_arin_rdap_refs
from geofeed_harvester.sources import DIRECT_GEOFEED_SOURCES, PreparedInputs, prepare_inputs


def main() -> int:
    parser = argparse.ArgumentParser(description="Harvest RFC 8805 geofeed datasets.")
    parser.add_argument(
        "--rir-dump",
        action="append",
        type=Path,
        help="Path to a bulk/RDAP-style RIR text dump. Can be passed multiple times.",
    )
    parser.add_argument(
        "--auto-discover",
        action="store_true",
        help="Download public RIR bulk sources, normalize geofeed references, then harvest.",
    )
    parser.add_argument("--bulk-dir", type=Path, default=Path(".cache/rir-bulk"))
    parser.add_argument("--normalized-rir-dump", type=Path, default=Path("data/rir.txt"))
    parser.add_argument("--direct-geofeed-dir", type=Path, default=Path(".cache/direct-geofeeds"))
    parser.add_argument(
        "--skip-lacnic",
        action="store_true",
        help="Skip LACNIC's direct public geofeed CSV during auto discovery.",
    )
    parser.add_argument("--out-dir", type=Path, default=Path("dist"))
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/geofeeds"))
    parser.add_argument("--rdap-cache-dir", type=Path, default=Path(".cache/rdap"))
    parser.add_argument("--previous-jsonl", type=Path)
    parser.add_argument(
        "--signature-verdicts",
        type=Path,
        help="Optional JSON mapping geofeed URL to CMS/RPKI signature validity.",
    )
    parser.add_argument("--arin-rdap-seed", type=Path)
    parser.add_argument("--arin-rdap-max-queries", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument(
        "--bgp-validator",
        choices=["none", "cymru"],
        default="none",
        help="Optional bulk BGP announcement validator. 'cymru' uses Team Cymru TCP/43 bulk WHOIS.",
    )
    args = parser.parse_args()

    rir_dumps = list(args.rir_dump or [])
    direct_geofeeds: list[tuple[str, str, Path]] = []
    prepared_inputs: PreparedInputs | None = None
    if args.auto_discover:
        prepared_inputs = prepare_inputs(
            raw_dir=args.bulk_dir,
            normalized_rir_path=args.normalized_rir_dump,
            direct_geofeed_dir=args.direct_geofeed_dir,
            include_lacnic=not args.skip_lacnic,
        )
        for source in prepared_inputs.failed:
            print(
                f"source failed: {source.kind} {source.name} "
                f"({source.stage}/{source.error})",
                file=sys.stderr,
            )
        if not args.skip_lacnic:
            # Only feed successfully downloaded direct sources into the harvest;
            # failed ones are already recorded in prepared_inputs.sources.
            for source in DIRECT_GEOFEED_SOURCES:
                if any(
                    result.name == source.name and result.status != "failed"
                    for result in prepared_inputs.direct
                ):
                    direct_geofeeds.append(
                        (source.rir, source.url, args.direct_geofeed_dir / f"{source.name}.csv")
                    )

    if args.arin_rdap_seed:
        arin_refs = asyncio.run(
            discover_arin_rdap_refs(
                args.arin_rdap_seed,
                cache_dir=args.rdap_cache_dir,
                max_queries=args.arin_rdap_max_queries,
            )
        )
        if arin_refs:
            arin_refs_path = args.rdap_cache_dir / "arin-rdap-geofeeds.txt"
            arin_refs_path.parent.mkdir(parents=True, exist_ok=True)
            with arin_refs_path.open("w", encoding="utf-8") as fh:
                for ref in arin_refs:
                    fh.write(f"inetnum: {ref.inetnum}\n")
                    fh.write(f"remarks: {ref.url}\n")
                    fh.write("source: ARIN\n\n")
            rir_dumps.append(arin_refs_path)

    if not rir_dumps and not direct_geofeeds and prepared_inputs is None:
        parser.error("pass --rir-dump or use --auto-discover")

    try:
        stats = asyncio.run(
            run_harvest(
                rir_dump_paths=rir_dumps,
                out_dir=args.out_dir,
                cache_dir=args.cache_dir,
                concurrency=args.concurrency,
                bgp_validator=args.bgp_validator,
                direct_geofeed_paths=direct_geofeeds,
                previous_jsonl=args.previous_jsonl,
                signature_verdicts_path=args.signature_verdicts,
                prepared_inputs=prepared_inputs,
            )
        )
    except HarvestError as exc:
        print(f"harvest failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(stats, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

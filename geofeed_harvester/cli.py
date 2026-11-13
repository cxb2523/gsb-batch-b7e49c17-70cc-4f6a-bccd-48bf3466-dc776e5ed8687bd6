from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from geofeed_harvester.pipeline import run_harvest
from geofeed_harvester.rdap import discover_arin_rdap_refs
from geofeed_harvester.sources import DIRECT_GEOFEED_SOURCES, prepare_inputs


def main() -> None:
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

    input_stats = {}
    rir_dumps = list(args.rir_dump or [])
    direct_geofeeds = []
    if args.auto_discover:
        input_stats = prepare_inputs(
            raw_dir=args.bulk_dir,
            normalized_rir_path=args.normalized_rir_dump,
            direct_geofeed_dir=args.direct_geofeed_dir,
            include_lacnic=not args.skip_lacnic,
        )
        rir_dumps.append(args.normalized_rir_dump)
        if not args.skip_lacnic:
            for source in DIRECT_GEOFEED_SOURCES:
                direct_geofeeds.append(
                    (source.rir, source.url, args.direct_geofeed_dir / f"{source.name}.csv")
                )

    arin_refs_path = None
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

    if not rir_dumps and not direct_geofeeds:
        parser.error("pass --rir-dump or use --auto-discover")

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
        )
    )
    stats = {**input_stats, **stats}
    print(json.dumps(stats, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

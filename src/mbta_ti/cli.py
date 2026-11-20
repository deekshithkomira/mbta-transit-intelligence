"""Command-line entry point: ``mbta-ti ingest | build | analyze | all``."""
from __future__ import annotations

import argparse
import logging


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mbta-ti", description=__doc__)
    parser.add_argument("stage", choices=["ingest", "build", "analyze", "all"])
    parser.add_argument("--force", action="store_true", help="re-download raw data")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.stage in ("ingest", "all"):
        from mbta_ti.ingest import sources
        sources.run(force=args.force)
    if args.stage in ("build", "all"):
        from mbta_ti.warehouse import build
        build.run()
    if args.stage in ("analyze", "all"):
        from mbta_ti import export
        export.run()


if __name__ == "__main__":
    main()

"""Command-line entry point: ``roll-parser <command>``."""

import argparse
import sys
from pathlib import Path

from roll_parser import __version__, ocr


def _check() -> int:
    """Print the versions of the OCR tools and fail if English OCR is missing."""
    import cv2
    import pymupdf

    try:
        tesseract = ocr.tesseract_version()
        langs = ocr.languages()
    except Exception as err:  # pytesseract raises several unrelated types
        print(f"Tesseract not found: {err}", file=sys.stderr)
        print("Install Tesseract 5 or set TESSERACT_CMD (see docs/SETUP.md).", file=sys.stderr)
        return 1

    print(f"roll-parser {__version__}")
    print(f"tesseract   {tesseract} (languages: {', '.join(langs)})")
    print(f"pymupdf     {pymupdf.__version__}")
    print(f"opencv      {cv2.__version__}")
    if "eng" not in langs:
        print("The English language pack (eng) is missing.", file=sys.stderr)
        return 1
    return 0


def _synth(names: list[str], out_dir: Path) -> int:
    """Write synthetic roll PDFs with their ground truth."""
    from roll_parser import synthetic

    for name in names or list(synthetic.PRESETS):
        pdf, truth = synthetic.write(synthetic.PRESETS[name], out_dir)
        print(f"{pdf}  (ground truth: {truth.name})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="roll-parser", description=__doc__)
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="check that Tesseract, PyMuPDF and OpenCV work")
    synth = commands.add_parser("synth", help="write synthetic roll PDFs (fake data) for testing")
    synth.add_argument(
        "presets",
        nargs="*",
        metavar="PRESET",
        help="small, ac40 or ac40-degraded (default: all)",
    )
    synth.add_argument("--out", type=Path, default=Path("synthetic-rolls"), help="output folder")

    args = parser.parse_args(argv)
    if args.command == "check":
        return _check()
    if args.command == "synth":
        return _synth(args.presets, args.out)
    return 2  # pragma: no cover  (argparse rejects unknown commands)


if __name__ == "__main__":
    sys.exit(main())

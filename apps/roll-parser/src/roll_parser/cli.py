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


def _header(pdf: Path, as_json: bool) -> int:
    """Read the cover and summary pages of a roll PDF and print what was found."""
    import pymupdf

    from roll_parser.extract.header import extract_header

    if not pdf.is_file():
        print(f"No such file: {pdf}", file=sys.stderr)
        return 1
    result = extract_header(pymupdf.open(pdf))
    if as_json:
        print(result.model_dump_json(indent=2))
        return 0

    print(f"pages: {len(result.pages)} ({', '.join(result.pages)})")
    if result.header is not None:
        h = result.header
        print(f"state:   {h.state_code.value} {h.state_name.value}")
        print(f"AC:      {h.ac_number.value} {h.ac_name.value} ({h.ac_reservation.value})")
        print(f"PC:      {h.pc_number.value} {h.pc_name.value} ({h.pc_reservation.value})")
        print(
            f"part:    {h.part_number.value}, sections: {len(h.sections)}, "
            f"auxiliary stations: {h.auxiliary_station_count.value}"
        )
    if result.printed_totals is not None:
        c = result.printed_totals.counts
        print(
            f"totals:  {c.male.value} male / {c.female.value} female / "
            f"{c.third_gender.value} third gender / {c.total.value} total"
        )
    print(f"issues:  {len(result.issues)}" + (" (needs review)" if result.needs_review else ""))
    for issue in result.issues:
        print(f"  [{issue.severity}] {issue.code}: {issue.message}")
    return 0


def _extract(pdf: Path, out: Path | None, truth: Path | None, workers: int | None) -> int:
    """Read every voter row. Prints counts and issue codes only (no voter data);
    the full result, which does contain voter data, goes to ``out``."""
    from collections import Counter

    from roll_parser.extract.roll import extract_roll

    if not pdf.is_file():
        print(f"No such file: {pdf}", file=sys.stderr)
        return 1
    result = extract_roll(pdf, workers=workers)
    printed = result.header.printed_totals
    c = result.extracted_totals
    print(f"pages:     {result.page_count}, voter rows: {len(result.rows)}")
    print(
        f"extracted: {c.male} male / {c.female} female / {c.third_gender} third gender / "
        f"{c.total} total (deleted entries excluded)"
    )
    if printed is not None:
        p = printed.counts
        print(
            f"printed:   {p.male.value} male / {p.female.value} female / "
            f"{p.third_gender.value} third gender / {p.total.value} total"
        )
    print(
        f"quality:   {result.quality_score:.2f}"
        + ("  (needs review)" if result.needs_review else "")
    )
    print(f"time:      {result.timings.total_seconds:.1f} s")
    codes = Counter(i.code for i in [*result.header.issues, *result.issues])
    rows = Counter(i.code for row in result.rows for i in row.issues)
    print(f"file issues: {dict(codes) or 'none'}")
    print(f"row issues:  {dict(rows) or 'none'} on {sum(1 for r in result.rows if r.issues)} rows")
    if out is not None:
        out.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        print(f"full result (contains voter data, keep it private): {out}")
    if truth is not None:
        from roll_parser.model import RollTruth
        from roll_parser.synthetic.accuracy import compare

        expected = RollTruth.model_validate_json(truth.read_text(encoding="utf-8"))
        print(compare(result, expected).report())
    return 0


def _id_crops(pdf: Path, page: int, out: Path) -> int:
    """Write one image showing, for every box on a page, the top of the box
    and the serial and EPIC crops the parser reads. For checking the crops on
    a real roll: the image shows EPIC numbers, so keep it private."""
    import cv2
    import numpy as np
    import pymupdf

    from roll_parser.extract.images import render
    from roll_parser.extract.voters import find_boxes, id_crops

    with pymupdf.open(pdf) as doc:
        if not 1 <= page <= doc.page_count:
            print(f"Page {page} is outside 1-{doc.page_count}", file=sys.stderr)
            return 1
        image = render(doc[page - 1])
    boxes = find_boxes(image)
    if not boxes:
        print(f"No voter boxes found on page {page}", file=sys.stderr)
        return 1
    width = max(b.w for b in boxes) + 8
    pieces = []
    missing = 0
    for box in boxes:
        serial, epic = id_crops(image, box)
        missing += serial is None or epic is None
        top = image[box.y : box.y + box.h // 3, box.x : box.x + box.w]
        for piece in (top, serial, epic):
            piece = piece if piece is not None else np.full((12, 60), 128, np.uint8)
            piece = piece[:, : width - 8]
            pieces.append(
                cv2.copyMakeBorder(
                    piece, 4, 4, 4, width - piece.shape[1] - 4, cv2.BORDER_CONSTANT, value=160
                )
            )
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.vstack(pieces))
    print(f"{len(boxes)} boxes; serial or EPIC not found in {missing}")
    print(f"image (shows EPIC numbers, keep it private): {out}")
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
        help="small, small-framed, ac40 or ac40-degraded (default: all)",
    )
    synth.add_argument("--out", type=Path, default=Path("synthetic-rolls"), help="output folder")
    header = commands.add_parser(
        "header", help="read a roll's cover and summary pages (header and printed totals)"
    )
    header.add_argument("pdf", type=Path)
    header.add_argument("--json", action="store_true", help="print every field as JSON")
    commands.add_parser("worker", help="consume extract-roll jobs from Redis (settings from env)")
    contract = commands.add_parser("contract", help="print or write the job/result JSON Schemas")
    contract.add_argument("--write", action="store_true", help="write them to contract/")
    extract = commands.add_parser("extract", help="read every voter row of a roll PDF")
    extract.add_argument("pdf", type=Path)
    extract.add_argument("--out", type=Path, help="write the full result (with voter data) here")
    extract.add_argument("--truth", type=Path, help="ground-truth JSON of a synthetic roll")
    extract.add_argument("--workers", type=int, help="parallel processes (default: CPU count)")

    crops = commands.add_parser(
        "id-crops", help="show the serial/EPIC crops read from one page's boxes (debugging)"
    )
    crops.add_argument("pdf", type=Path)
    crops.add_argument("--page", type=int, default=3, help="1-based page number (default 3)")
    crops.add_argument("--out", type=Path, required=True, help="PNG to write (keep it private)")

    args = parser.parse_args(argv)
    if args.command == "check":
        return _check()
    if args.command == "synth":
        return _synth(args.presets, args.out)
    if args.command == "header":
        return _header(args.pdf, args.json)
    if args.command == "worker":
        from roll_parser.worker.main import main as worker_main

        worker_main()
        return 0
    if args.command == "contract":
        from roll_parser.worker.schemas import write_or_print

        return write_or_print(write=args.write)
    if args.command == "extract":
        return _extract(args.pdf, args.out, args.truth, args.workers)
    if args.command == "id-crops":
        return _id_crops(args.pdf, args.page, args.out)
    return 2  # pragma: no cover  (argparse rejects unknown commands)


if __name__ == "__main__":
    sys.exit(main())

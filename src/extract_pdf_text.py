"""
Step 4 helper: extract raw text from NCERT PDF chapters.

Usage:
    python extract_pdf_text.py ../pdfs/grade4_fractions.pdf

Prints extracted text to console AND saves it to a .txt file next to
the PDF, so you can read through it and manually mark chunk boundaries
in Step 5.
"""

import sys
import pdfplumber
from pathlib import Path


def extract_text(pdf_path: str) -> str:
    text_parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            text_parts.append(f"\n--- Page {i + 1} ---\n{page_text}")
    return "\n".join(text_parts)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_pdf_text.py <path_to_pdf>")
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    text = extract_text(str(pdf_path))

    out_path = pdf_path.with_suffix(".txt")
    out_path.write_text(text, encoding="utf-8")

    print(f"Extracted {len(text)} characters.")
    print(f"Saved to: {out_path}")
    print("\n--- Preview (first 500 chars) ---")
    print(text[:500])

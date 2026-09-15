# src/_pdf_topics.py
import pdfplumber
from pathlib import Path

for pdf in sorted(Path("../pdfs").glob("*.pdf")):
    try:
        with pdfplumber.open(pdf) as p:
            first = (p.pages[0].extract_text() or "")[:200].replace("\n", " ")
        print(f"{pdf.name:25s} | {first}")
    except Exception as e:
        print(f"{pdf.name:25s} | ERROR: {e}")
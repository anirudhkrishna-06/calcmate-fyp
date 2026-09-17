"""
demo.py - Teacher Copilot, terminal chat.

Clean REPL around retrieve.py + copilot.py. Type a question, get a
streamed, grounded answer. Type 'help' for commands.

Design goals:
    - Clean output: the answer is the only thing on screen
    - Live: tokens stream as they arrive, so the panel sees the model think
    - Honest: one small line under the answer shows the source PDF
    - Fast: model and index load once, queries respond in seconds
    - Debuggable: 'chunks on' / 'scores on' reveal the retrieval layer

Usage:
    python demo.py
    python demo.py --grade 4
    python demo.py --no-llm                 # retrieval only
    python demo.py --model llama3.2:3b

Commands:
    help                    show commands
    grade N                 switch grade (3, 4, 5)
    subject NAME            switch subject (default: Math)
    k N                     number of retrieved chunks (1-10)
    chunks on|off           show retrieved chunks under each answer
    scores on|off           show retrieval scores
    sources on|off          show source PDFs (on by default: one line)
    no-llm on|off           toggle LLM generation
    clear                   clear the screen
    quit / exit / q         exit
"""

from __future__ import annotations

import argparse
import os
import sys
import textwrap
import threading
import time
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))

from retrieve import get_default_retriever, Retriever, RetrievedChunk  # noqa: E402
from copilot import (  # noqa: E402
    DEFAULT_MODEL,
    MIN_SCORE_THRESHOLD,
    PROMPT_TEMPLATE,
    build_context,
    call_llm,
)


# --------------------------------------------------------------------------- #
# ANSI + terminal setup
# --------------------------------------------------------------------------- #
 
if os.name == "nt":
    os.system("")  # enable ANSI on Windows terminals
 
R = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
CYAN = "\033[36m"
YELLOW = "\033[33m"
RED = "\033[31m"
MAGENTA = "\033[35m"
GREY = "\033[90m"
 
 
# --------------------------------------------------------------------------- #
# Boot banner
# --------------------------------------------------------------------------- #
 
_FONT = {
    "C": [" ██████ ", "██      ", "██      ", "██      ", "██      ", " ██████ "],
    "A": ["  ████  ", " ██  ██ ", "██    ██", "████████", "██    ██", "██    ██"],
    "L": ["██      ", "██      ", "██      ", "██      ", "██      ", "████████"],
    "M": ["██    ██", "███  ███", "██ ██ ██", "██ ██ ██", "██    ██", "██    ██"],
    "T": ["████████", "   ██   ", "   ██   ", "   ██   ", "   ██   ", "   ██   "],
    "E": ["████████", "██      ", "██████  ", "██      ", "██      ", "████████"],
    " ": ["   ", "   ", "   ", "   ", "   ", "   "],
}
 
BANNER_TEXT = "CALCMATE"
 
# Row-by-row gradient: top rows cyan, lower rows green
_BANNER_GRADIENT = [CYAN, CYAN, GREEN, GREEN, GREEN, GREEN]
 
 
def render_banner(text: str) -> list[str]:
    """Build big block-letter banner lines for `text` using _FONT."""
    rows = ["" for _ in range(6)]
    for ch in text.upper():
        glyph = _FONT.get(ch, _FONT[" "])
        for i in range(6):
            rows[i] += glyph[i] + " "
    return [row.rstrip() for row in rows]
 
 
def print_banner() -> None:
    """Big colored wordmark shown once at boot."""
    print()
    for line, color in zip(render_banner(BANNER_TEXT), _BANNER_GRADIENT):
        print(f"{color}{BOLD}{line}{R}")
    print()
    print(f"{GREY}  Teacher Copilot · grounded answers from your curriculum PDFs{R}")
    print()
 
# --------------------------------------------------------------------------- #
# Rendering primitives
# --------------------------------------------------------------------------- #

def hr(ch: str = "─", width: int = 68, color: str = GREY) -> str:
    return f"{color}{ch * width}{R}"


def wrap(text: str, width: int = 68, indent: str = "") -> str:
    out = []
    for para in text.split("\n"):
        if not para.strip():
            out.append("")
            continue
        out.append(textwrap.fill(
            para, width=width,
            initial_indent=indent, subsequent_indent=indent,
        ))
    return "\n".join(out)


def print_header(session: "Session") -> None:
    print()
    print(f"{BOLD}Calcmate · Teacher Copilot{R}")
    print(f"{GREY}Grade {session.grade} · {session.subject} · model {session.model}{R}")
    print(hr("─"))
    print(f"{GREY}Ask a question. Type {R}{CYAN}help{R}{GREY} for commands.{R}")
    print()


def print_question(q: str) -> None:
    print()
    print(f"{CYAN}❯ {BOLD}{q}{R}")
    print()


def print_answer_header(elapsed_ms: float) -> None:
    print(f"{GREEN}▎{R} {BOLD}Answer{R}  {GREY}({elapsed_ms / 1000:.1f}s){R}")
    print()


def print_source_footer(sources: list[str], top_score: float | None,
                        refused: bool = False) -> None:
    """Single-line footer under the answer. Never noisy."""
    if refused and top_score is not None:
        print(f"\n{GREY}  ── best match {top_score:.2f} · below confidence threshold{R}")
    elif sources:
        srcs = ", ".join(sources)
        if top_score is not None:
            print(f"\n{GREY}  ── {srcs}")
        else:
            print(f"\n{GREY}  ── {srcs}{R}")


def print_chunks_debug(chunks: list[RetrievedChunk], session: "Session") -> None:
    """Only shown when the user has typed 'chunks on'."""
    if not chunks:
        return
    print(f"\n{GREY}{hr('·')}{R}")
    for i, c in enumerate(chunks, 1):
        meta = []
        if session.show_scores:
            meta.append(f"score={c.score:.3f}")
        meta.append(c.source_pdf)
        meta.append(f"grade {c.grade}")
        meta.append(f"concepts={','.join(c.concept_ids)}")
        print(f"{GREY}  [{i}] {' · '.join(meta)}{R}")
        if session.show_chunks:
            preview = textwrap.fill(c.text, width=64,
                                    initial_indent="      ",
                                    subsequent_indent="      ")
            lines = preview.split("\n")
            if len(lines) > 6:
                lines = lines[:6] + [f"      {GREY}…{R}"]
            print("\n".join(lines))
    print(f"{GREY}{hr('·')}{R}")


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #

class Session:
    def __init__(self, grade: int, subject: str, k: int,
                 model: str, use_llm: bool):
        self.grade = grade
        self.subject = subject
        self.k = k
        self.model = model
        self.use_llm = use_llm
        self.show_chunks = False
        self.show_scores = True
        self.show_sources = True
        self.retriever: Retriever | None = None


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #

HELP = f"""{BOLD}Commands{R}
  {CYAN}help{R}                       this message
  {CYAN}grade N{R}                    switch grade ({GREEN}3{R}, {GREEN}4{R}, {GREEN}5{R})
  {CYAN}subject NAME{R}               switch subject (default: {GREEN}Math{R})
  {CYAN}k N{R}                        number of chunks to retrieve (1–10)
  {CYAN}chunks on|off{R}              show full retrieved chunk text
  {CYAN}scores on|off{R}              show retrieval scores
  {CYAN}sources on|off{R}             show source PDF footer
  {CYAN}no-llm on|off{R}              toggle LLM (retrieval only)
  {CYAN}clear{R}                      clear screen
  {CYAN}quit{R} / {CYAN}exit{R} / {CYAN}q{R}             exit
"""


def handle_command(line: str, session: Session) -> bool:
    parts = line.strip().split(maxsplit=1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if cmd in ("quit", "exit", "q"):
        print(f"\n{GREY}bye{R}\n")
        sys.exit(0)

    if cmd == "help":
        print()
        print(HELP)
        return True

    if cmd == "clear":
        os.system("cls" if os.name == "nt" else "clear")
        print_header(session)
        return True

    if cmd == "grade":
        try:
            g = int(arg)
        except ValueError:
            print(f"{RED}usage: grade <3|4|5>{R}")
            return True
        if g not in (3, 4, 5):
            print(f"{RED}grade must be 3, 4, or 5{R}")
            return True
        session.grade = g
        print(f"{GREY}→ grade {g}{R}")
        return True

    if cmd == "subject":
        if not arg:
            print(f"{RED}usage: subject <name>{R}")
            return True
        session.subject = arg
        print(f"{GREY}→ subject {arg}{R}")
        return True

    if cmd == "k":
        try:
            k = int(arg)
        except ValueError:
            print(f"{RED}usage: k <1-10>{R}")
            return True
        if not 1 <= k <= 10:
            print(f"{RED}k must be 1–10{R}")
            return True
        session.k = k
        print(f"{GREY}→ k = {k}{R}")
        return True

    if cmd in ("chunks", "scores", "sources"):
        if arg not in ("on", "off"):
            print(f"{RED}usage: {cmd} on|off{R}")
            return True
        val = arg == "on"
        setattr(session, f"show_{cmd}", val)
        print(f"{GREY}→ {cmd} {arg}{R}")
        return True

    if cmd == "no-llm":
        if arg not in ("on", "off"):
            print(f"{RED}usage: no-llm on|off{R}")
            return True
        session.use_llm = (arg == "off")
        print(f"{GREY}→ LLM generation {'disabled' if not session.use_llm else 'enabled'}{R}")
        return True

    return False


# --------------------------------------------------------------------------- #
# Streaming generation
# --------------------------------------------------------------------------- #

def stream_answer(prompt: str, model: str) -> str:
    """
    Stream tokens from Ollama to stdout as they arrive. Returns the full
    concatenated text.
    """
    try:
        import ollama
    except ImportError:
        raise RuntimeError("Install the ollama Python package: pip install ollama")

    pieces: list[str] = []
    # Wrap to 68 columns with 2-space indent as we stream
    current_line = "  "
    try:
        for chunk in ollama.generate(
            model=model, prompt=prompt, stream=True,
            options={"temperature": 0.2, "num_predict": 300},
        ):
            token = chunk.get("response", "")
            if not token:
                continue
            pieces.append(token)
            # Simple word-wrap while streaming
            for word in token.split(" "):
                # Skip empty tokens that result from double spaces
                if not word and current_line != "  ":
                    continue
                if len(current_line) + len(word) + 1 > 68:
                    sys.stdout.write(current_line.rstrip() + "\n")
                    current_line = "  " + word
                else:
                    current_line += ("" if current_line == "  " else " ") + word
                sys.stdout.flush()
        if current_line.strip():
            sys.stdout.write(current_line.rstrip() + "\n")
        sys.stdout.flush()
    except Exception as e:
        msg = str(e).lower()
        if "connection" in msg or "refused" in msg or "not running" in msg:
            raise RuntimeError("Cannot reach Ollama. Start with: ollama serve")
        if "model" in msg and "not found" in msg:
            raise RuntimeError(f"Model '{model}' not pulled. Run: ollama pull {model}")
        raise

    return "".join(pieces).strip()


def warmup_spinner(label: str) -> tuple[threading.Thread, dict]:
    """Return (thread, done_flag) that runs a spinner in the background."""
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    state = {"i": 0, "done": False}

    def _run():
        while not state["done"]:
            f = frames[state["i"] % len(frames)]
            sys.stdout.write(f"\r  {GREY}{f} {label}…{R}")
            sys.stdout.flush()
            state["i"] += 1
            time.sleep(0.08)
        sys.stdout.write("\r" + " " * 72 + "\r")
        sys.stdout.flush()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t, state


# --------------------------------------------------------------------------- #
# Answer pipeline
# --------------------------------------------------------------------------- #

def run_question(q: str, session: Session) -> None:
    print_question(q)
    t0 = time.perf_counter()

    # --- retrieval (fast; no spinner needed) ---
    chunks = session.retriever.retrieve(
        q, grade=session.grade, subject=session.subject, k=session.k,
    )

    if not chunks:
        elapsed = (time.perf_counter() - t0) * 1000
        print_answer_header(elapsed)
        print("  I couldn't find any curriculum content for this question.")
        print_source_footer([], None, refused=True)
        return

    top_score = chunks[0].score

    # --- refusal path ---
    if top_score < MIN_SCORE_THRESHOLD:
        elapsed = (time.perf_counter() - t0) * 1000
        print_answer_header(elapsed)
        print("  I don't have confident curriculum content for this question.")
        print("  It may not be covered in the current corpus, or the question")
        print("  may need rephrasing.")
        print_source_footer([], top_score, refused=True)
        if session.show_chunks:
            print_chunks_debug(chunks, session)
        return

    # --- retrieval-only mode ---
    if not session.use_llm:
        elapsed = (time.perf_counter() - t0) * 1000
        print_answer_header(elapsed)
        print(f"  {GREY}[retrieval-only mode]{R}")
        sources = sorted({c.source_pdf for c in chunks})
        print_source_footer(sources, top_score)
        print_chunks_debug(chunks, session)
        return

    # --- full generation with streaming ---
    # Show a brief spinner while the LLM starts producing tokens
    print(f"{GREEN}▎{R} {BOLD}Answer{R}")
    print()
    prompt = PROMPT_TEMPLATE.format(
        context=build_context(chunks),
        question=q,
        grade=session.grade,
    )

    # Peek: launch streaming directly; the first token arrives in ~1s when warm
    try:
        answer = stream_answer(prompt, session.model)
    except RuntimeError as e:
        print(f"  {RED}{e}{R}")
        return

    elapsed_ms = (time.perf_counter() - t0) * 1000
    # Overwrite the answer header with the real timing
    # (we print a timing line under the answer instead)
    sources = sorted({c.source_pdf for c in chunks})
    print_source_footer(sources, top_score)

    if session.show_chunks:
        print_chunks_debug(chunks, session)


# --------------------------------------------------------------------------- #
# Boot
# --------------------------------------------------------------------------- #

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--grade", type=int, default=4, choices=(3, 4, 5))
    p.add_argument("--subject", default="Math")
    p.add_argument("--k", type=int, default=3)
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--no-llm", action="store_true",
                   help="retrieval only; do not call Ollama")
    p.add_argument("--show-chunks", action="store_true",
                   help="start with chunk text visible")
    return p.parse_args()


def warmup() -> Retriever:
    t, state = warmup_spinner("loading vector store and embedding model")
    try:
        return get_default_retriever()
    finally:
        state["done"] = True
        t.join(timeout=0.2)


def main() -> None:
    args = parse_args()

    session = Session(
        grade=args.grade, subject=args.subject, k=args.k,
        model=args.model, use_llm=not args.no_llm,
    )
    session.show_chunks = args.show_chunks

    print_banner()          # <-- add this line


    # Load retriever
    session.retriever = warmup()

    # Check Ollama
    if session.use_llm:
        try:
            import ollama
            ollama.list()
        except Exception:
            print(f"{YELLOW}Note: Ollama is not running. "
                  f"Generation is disabled.{R}")
            print(f"{GREY}      Start it with: ollama serve{R}\n")
            session.use_llm = False

    print_header(session)

    # Main loop
    while True:
        try:
            raw = input(f"{CYAN}❯{R} ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{GREY}bye{R}\n")
            return

        if not raw:
            continue

        if handle_command(raw, session):
            continue

        try:
            run_question(raw, session)
        except KeyboardInterrupt:
            print(f"\n{GREY}interrupted{R}")
            continue
        except Exception as e:
            print(f"\n{RED}error: {e}{R}")


if __name__ == "__main__":
    main()
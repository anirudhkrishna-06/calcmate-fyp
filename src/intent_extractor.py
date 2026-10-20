"""
CALCMATE — Stage 3: Intent Extractor
src/intent_extractor.py

Deterministic regex/keyword-based intent extraction with optional LLM assist.
Returns IntentResult with the detected intent and extracted parameters.

Design principles:
- Deterministic first: regex patterns handle common phrasing reliably.
- No fabrication: if parameters cannot be extracted, they go into missing_parameters.
- LLM optional: if Ollama is available, try structured extraction, validate schema,
  fall back to deterministic on any failure.
- Concept resolution: fuzzy-match concept name phrases against concepts.csv titles.
"""
from __future__ import annotations

import csv
import json
import os
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from src.copilot_contract import CopilotIntent, CopilotRequest, IntentResult

# ─── Load concept alias table ────────────────────────────────────────────────

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_CONCEPTS_CSV = _DATA_DIR / "concepts.csv"


def _load_concept_alias_table() -> dict[str, dict]:
    """
    Returns {concept_id: {id, concept, grade, subject_area}} from concepts.csv.
    Also builds a reverse map from lowercase title tokens to concept_id.
    """
    concepts: dict[str, dict] = {}
    try:
        with open(_CONCEPTS_CSV, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cid = row.get("id", "").strip()
                if cid:
                    concepts[cid] = {
                        "id": cid,
                        "concept": row.get("concept", "").strip(),
                        "grade": int(row.get("grade", 0) or 0),
                        "subject_area": row.get("subject_area", "Math").strip(),
                    }
    except FileNotFoundError:
        pass
    return concepts


_CONCEPT_TABLE: dict[str, dict] = _load_concept_alias_table()


def resolve_concept_id(phrase: str, grade_hint: Optional[int] = None) -> Optional[str]:
    """
    Fuzzy-match a natural-language concept phrase to a canonical concept_id.
    Returns the best-match concept_id or None if no confident match.
    """
    if not phrase or not _CONCEPT_TABLE:
        return None

    phrase_lower = phrase.lower().strip()

    # 1. Direct ID match (M101, M302, etc.)
    if re.match(r"^m\d{3}$", phrase_lower, re.IGNORECASE):
        cid = phrase_lower.upper()
        if cid in _CONCEPT_TABLE:
            return cid

    best_id: Optional[str] = None
    best_score = 0.0

    for cid, data in _CONCEPT_TABLE.items():
        # Grade filter when a hint is available
        if grade_hint and data["grade"] != grade_hint:
            continue
        title_lower = data["concept"].lower()
        score = SequenceMatcher(None, phrase_lower, title_lower).ratio()
        # Boost for substring containment
        if phrase_lower in title_lower or title_lower in phrase_lower:
            score += 0.2
        if score > best_score:
            best_score = score
            best_id = cid

    return best_id if best_score >= 0.45 else None


# ─── Regex patterns ───────────────────────────────────────────────────────────

# Student query patterns
_STUDENT_PATTERNS = [
    r"\bwho\s+(is|are)\s+(struggling|struggling\s+with|having\s+trouble|having\s+difficulty|needs?\s+(help|support|revision|attention))\b",
    r"\bstudents?\s+(struggling|with\s+difficulty|who\s+need|needing)\b",
    r"\bwhich\s+students?\b",
    r"\bfind\s+students?\b",
    r"\blist\s+students?\b",
    r"\bshow\s+(me\s+)?students?\b",
    r"\bstudents?\s+in\s+(grade|class)\b",
    r"\bwho\s+needs?\s+(help|support|revision)\b",
]

_ATTENTION_PATTERNS = [
    r"\bwho\s+needs?\s+(more\s+)?attention\b",
    r"\bwhich\s+students?\s+need\s+(more\s+)?attention\s*[?!]*$",
    r"\bstudents?\s+who\s+need\s+(more\s+)?attention\s*[?!]*$",
    r"\bwho\s+needs?\s+help\s*[?!]*$",
    r"\bwhich\s+(students?|learners?)\s+are\s+struggling\s*[?!]*$",
    r"\bwhat\s+are\s+my\s+students?\s+struggling\s+with\s*[?!]*$",
    r"\bshow\s+me\s+(the\s+)?students?\s+who\s+need\s+support\s*[?!]*$",
    r"\bwhich\s+concepts?\s+are\s+my\s+students?\s+weak\s+in\s*[?!]*$",
    r"\bwho\s+should\s+i\s+check\s+on\s+today\s*[?!]*$",
    r"\bwhere\s+(is|are)\s+(my|the|most|a\s+majority\s+of\s+the)\s+students?.*\bweak\b",
    r"\b(my|the)\s+(majority\s+of\s+the\s+)?students?.*\bweak\b",
    r"\bhow\s+are\s+my\s+students?\b",
]

_STUDENT_STATE_PATTERNS = [
    r"\b(what|how)\s+(is|does|has)\s+\w+('s)?\s+(knowledge|state|progress|mastery|understanding)\b",
    r"\b(check|show)\s+(state|mastery|progress)\s+(of|for)\s+\w+\b",
    r"\b\w+('s)?\s+(mastery|state|progress)\s+(on|for|in)\b",
    r"\bhow\s+(well|much)\s+(does|is)\s+\w+\s+(know|understand|doing)\b",
]

_PREREQUISITE_PATTERNS = [
    r"\bprerequisite[s]?\b",
    r"\bwhat\s+(should|must|do)\s+(students?|they|he|she)\s+(know|learn|have)\s+(before|first)\b",
    r"\bwhat\s+comes\s+before\b",
    r"\bneeded\s+(to\s+)?(know|learn|understand)\s+before\b",
    r"\bdepend[s]?\s+on\b",
    r"\bbefore\s+(learning|teaching|starting)\b",
]

_DIFFICULTY_PATTERNS = [
    r"\bwhy\s+(?:is|does)\s+\w+(?:\s+\w+){0,3}\s+(?:struggling|having trouble)\b",
    r"\bwhy\s+(is|are|do|does)\s+\w+\s+(struggling|having\s+trouble|finding\s+(it\s+)?hard)\b",
    r"\bexplain\s+(the\s+)?(difficulty|challenges?|struggle)\b",
    r"\bwhy\s+(is|are)\s+(this|it|that)\s+(hard|difficult|challenging)\b",
    r"\bcause[s]?\s+of\s+(difficulty|struggle|problem)\b",
]

_ACTIVITY_PATTERNS = [
    r"\b(suggest|recommend|give|provide)\s+(an?\s+)?(activity|activities|exercise|exercises|task|tasks|lesson)\b",
    r"\b(suggest|recommend|give|provide)\b.*\b(activity|activities|exercise|exercises|task|tasks|lesson)\b",
    r"\bwhat\s+(activity|activities|exercise[s]?)\b",
    r"\bhow\s+(can|do)\s+(i|we)\s+teach\b",
    r"\bteaching\s+(idea|ideas|suggestion|approach)\b",
    r"\b(classroom|teaching)\s+(activity|activity|task)\b",
]

_NCERT_PATTERNS = [
    r"\bncert\b",
    r"\btextbook\b",
    r"\bcurriculum\s+(material|content|resource[s]?)\b",
    r"\b(retrieve|find|show|get)\s+(the\s+)?(curriculum|textbook|ncert)\b",
    r"\bwhat\s+does\s+(the\s+)?(textbook|ncert|curriculum)\s+say\b",
    r"\bsource\s+material\b",
]

_SCHEDULE_PATTERNS = [
    r"\b(generate|create|make|build|plan)\s+(a\s+)?(schedule|plan|timetable|rotation)\b",
    r"\bwho\s+(should|do\s+i)\s+(teach|work\s+with)\s+(first|next)\b",
    r"\binstruction(al)?\s+(schedule|plan|allocation)\b",
    r"\bwhich\s+group\s+(should|to)\s+(i\s+)?(teach|focus\s+on|start\s+with)\b",
    r"\ballocat(e|ion)\s+(teacher|my|instruction)\s+attention\b",
    r"\bteacher\s+attention\b",
    r"\bmultigrade\s+schedule\b",
    r"\bwhat\s+should\s+i\s+teach\s+(next|first)\b",
    r"\bwhat\s+do\s+i\s+teach\s+(next|first)\b",
]

_CLASSROOM_SUMMARY_PATTERNS = [
    r"\b(classroom|class|group)\s+(summary|overview|status|snapshot)\b",
    r"\bhow\s+is\s+the\s+(class|grade|group)\s+doing\b",
    r"\boverall\s+(progress|performance|status)\b",
    r"\bclass(-wide|room\s+wide)?\s+(learning|progress)\b",
    r"\bsummary\s+(of\s+)?(the\s+)?class\b",
    r"\bwhere\s+(is|are)\s+(the\s+)?(class|group|grade)\b",
]

_GROUP_READINESS_PATTERNS = [
    r"\b(is|are)\s+(the\s+)?(class|group|grade|students?)\s+ready\b",
    r"\bgroup\s+(prerequisite|readiness)\b",
    r"\bready\s+(to\s+learn|for)\b",
    r"\bprerequisite\s+readiness\b",
]

_PROGRESS_PATTERNS = [
    r"\bprogress\s+(of|for|report|on)\s+\w+\b",
    r"\b\w+('s)?\s+progress\b",
    r"\bhow\s+(far|much)\s+(has|have)\s+\w+\s+(come|progress|learned)\b",
]

_CONCEPT_EXPLAIN_PATTERNS = [
    r"\bexplain\s+(the\s+concept\s+of\s+)?\w[\w\s]+\b",
    r"\bwhat\s+is\s+\w[\w\s]+\b",
    r"\bdefine\s+\w[\w\s]+\b",
    r"\bhow\s+do[es]?\s+\w[\w\s]+\s+work\b",
    r"\bteach\s+me\s+(about\s+)?\w[\w\s]+\b",
]

# ─── Grade extraction ─────────────────────────────────────────────────────────

_GRADE_PATTERN = re.compile(
    r"\b(grade|class|std|standard)\s*([1-5])\b"
    r"|\b([1-5])(st|nd|rd|th)\s+(grade|class|std|standard)\b",
    re.IGNORECASE,
)


def _extract_grade(text: str, default: int) -> int:
    m = _GRADE_PATTERN.search(text)
    if m:
        raw = m.group(2) or m.group(3)
        g = int(raw)
        return g if 1 <= g <= 5 else default
    word = re.search(r"\b(?:grade|class|standard)\s+(one|two|three|four|five)\b", text, re.I)
    return {"one":1,"two":2,"three":3,"four":4,"five":5}[word[1].lower()] if word else default


# ─── Concept phrase extraction ────────────────────────────────────────────────

_CONCEPT_PHRASES = [
    # "fractions", "multiplication", "addition", etc.
    r"\b(fractions?|fraction\s+representation|equivalent\s+fractions?|comparing\s+fractions?)\b",
    r"\b(multiplications?|multiplication\s+table[s]?|times\s+table[s]?)\b",
    r"\b(division|dividing|equal\s+sharing)\b",
    r"\b(addition|adding|add)\b",
    r"\b(subtraction|subtracting|subtract)\b",
    r"\b(place\s+value|tens?\s+and\s+ones?)\b",
    r"\b(counting|count)\b",
    r"\b(number\s+(names?|sequence|order|patterns?))\b",
    r"\b(shapes?|2[Dd]\s+shapes?|basic\s+shapes?)\b",
    r"\b(perimeter|area)\b",
    r"\b(symmetry)\b",
    r"\b(time|clock|calendar)\b",
    r"\b(weight|measurement|capacity|length|volume)\b",
    r"\b(bar\s+graph[s]?|pictograph[s]?|data|charts?)\b",
    r"\b(angles?|lines?|line\s+segment[s]?)\b",
    r"\b(factors?|multiples?)\b",
    r"\b(large\s+numbers?|big\s+numbers?)\b",
    r"\b(skip\s+counting)\b",
    r"\b(zero)\b",
]

_CONCEPT_RE = re.compile("|".join(_CONCEPT_PHRASES), re.IGNORECASE)


def _extract_concept_phrase(text: str) -> Optional[str]:
    # Check for direct concept ID tokens (e.g., M101, M203, M425)
    m_id = re.search(r"\b(m\d{3})\b", text, re.IGNORECASE)
    if m_id:
        return m_id.group(1).upper()
    specific = re.search(r"\b(long division|division with remainder|division as equal sharing|equivalent fractions?|fraction representation|addition of fractions(?: with (?:un)?like denominators)?|skip counting)\b", text, re.I)
    if specific:
        return specific[0]
    if re.search(r"\blong\s+and\s+short\b", text, re.I):
        return "comparison of lengths"
    m = _CONCEPT_RE.search(text)
    return m.group(0).strip() if m else None


# ─── Student name extraction ──────────────────────────────────────────────────

def _extract_student_name(text: str) -> Optional[str]:
    """
    Very lightweight name extraction. Looks for possessive patterns like
    "Aarav's state" or "for Priya" after known trigger words.
    Returns the name string or None.
    """
    patterns = [
        r"\b(for|about|on|check|show|how\s+is|how\s+well\s+is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b",
        r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(mastery|state|progress|knowledge|understanding|score)\b",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            name = m.group(2) if pat == patterns[0] else m.group(1)
            if name.lower() not in {
                "grade", "class", "group", "the", "all", "this",
                "they", "their", "she", "her", "he", "his",
            }:
                return name.strip()
    return None


# ─── Deterministic intent classification ─────────────────────────────────────

def _matches_any(text: str, patterns: list[str]) -> bool:
    normalized = re.sub(r"[’‘`]", "'", text.strip())
    normalized = re.sub(r"\s+", " ", normalized).lower()
    normalized = re.sub(r"[.!?]+$", "", normalized).strip()
    tl = normalized
    return any(re.search(p, tl) for p in patterns)


def _classify_deterministic(text: str, request: CopilotRequest) -> IntentResult:
    tl = text.lower()
    grade = _extract_grade(text, request.grade)
    concept_phrase = _extract_concept_phrase(text)
    concept_id = (
        (resolve_concept_id(concept_phrase, grade) if concept_phrase else request.concept_id)
    )
    student_name = _extract_student_name(text)

    params: dict = {"grade": grade}
    if concept_id:
        params["concept_id"] = concept_id
    if concept_phrase:
        params["concept_phrase"] = concept_phrase
    if student_name:
        params["student_name"] = student_name
    if request.student_id:
        params["student_id"] = request.student_id

    from src.classroom_queries import classify_record_query
    record_query = classify_record_query(text, request, params)
    if record_query is not None:
        return record_query

    missing: list[str] = []

    # ── Schedule ──────────────────────────────────────────────────────────────
    if _matches_any(text, _SCHEDULE_PATTERNS):
        return IntentResult(
            intent=CopilotIntent.GENERATE_INSTRUCTIONAL_SCHEDULE,
            parameters=params, missing_parameters=missing,
        )

    # ── Group readiness ───────────────────────────────────────────────────────
    if _matches_any(text, _GROUP_READINESS_PATTERNS):
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.GROUP_PREREQUISITE_READINESS,
            parameters=params, missing_parameters=missing,
        )

    # ── Classroom summary ─────────────────────────────────────────────────────
    if (
        (_matches_any(text, _ATTENTION_PATTERNS) and not concept_id)
        or _matches_any(text, _CLASSROOM_SUMMARY_PATTERNS)
    ):
        return IntentResult(
            intent=CopilotIntent.CLASSROOM_LEARNING_SUMMARY,
            parameters=params, missing_parameters=missing,
        )

    # ── Prerequisite query ────────────────────────────────────────────────────
    if _matches_any(text, _PREREQUISITE_PATTERNS):
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.EXPLAIN_PREREQUISITES,
            parameters=params, missing_parameters=missing,
        )

    # ── Difficulty explanation ────────────────────────────────────────────────
    if _matches_any(text, _DIFFICULTY_PATTERNS):
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.EXPLAIN_LEARNING_DIFFICULTY,
            parameters=params, missing_parameters=missing,
        )

    # ── Student concept state ─────────────────────────────────────────────────
    if _matches_any(text, _STUDENT_STATE_PATTERNS):
        if not params.get("student_id") and not student_name:
            missing.append("student_id")
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.GET_STUDENT_CONCEPT_STATE,
            parameters=params, missing_parameters=missing,
        )

    # ── Students by concept ───────────────────────────────────────────────────
    if _matches_any(text, _STUDENT_PATTERNS):
        if not concept_id and concept_phrase:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.FIND_STUDENTS_BY_CONCEPT,
            parameters=params, missing_parameters=missing,
        )

    # ── Student progress ──────────────────────────────────────────────────────
    if _matches_any(text, _PROGRESS_PATTERNS) and (student_name or request.student_id):
        return IntentResult(
            intent=CopilotIntent.GET_STUDENT_PROGRESS,
            parameters=params, missing_parameters=missing,
        )

    # ── Activity recommendation ───────────────────────────────────────────────
    if _matches_any(text, _ACTIVITY_PATTERNS):
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.RECOMMEND_CURRICULUM_ACTIVITY,
            parameters=params, missing_parameters=missing,
        )

    # ── NCERT resource retrieval ──────────────────────────────────────────────
    if _matches_any(text, _NCERT_PATTERNS):
        if not concept_id:
            missing.append("concept_id")
        return IntentResult(
            intent=CopilotIntent.RETRIEVE_NCERT_RESOURCE,
            parameters=params, missing_parameters=missing,
        )

    # ── Concept explanation ───────────────────────────────────────────────────
    if _matches_any(text, _CONCEPT_EXPLAIN_PATTERNS) and concept_phrase:
        return IntentResult(
            intent=CopilotIntent.EXPLAIN_CONCEPT,
            parameters=params, missing_parameters=missing,
        )

    # ── General question (fallback to RAG) ───────────────────────────────────
    return IntentResult(
        intent=CopilotIntent.GENERAL_QUESTION,
        parameters=params, missing_parameters=missing,
        confidence=0.5,
    )


# ─── Optional LLM-assisted extraction ────────────────────────────────────────

_LLM_EXTRACTION_PROMPT = """\
You are a classroom assistant intent extractor. Given a teacher's message, extract the intent and parameters as JSON.

Valid intents (choose one):
  find_students_by_concept, get_student_concept_state, get_student_progress,
  explain_learning_difficulty, explain_prerequisites, explain_concept,
  classroom_learning_summary, group_prerequisite_readiness,
  recommend_curriculum_activity, retrieve_ncert_resource,
  generate_instructional_schedule, general_question

Parameters to extract (include only what is present):
  grade (int 1-5), concept_phrase (str), student_name (str)

Output ONLY valid JSON with keys: intent (str), parameters (object).
Do not add any explanation.

Teacher message: {message}

JSON:"""


def _try_llm_extraction(request: CopilotRequest) -> Optional[IntentResult]:
    """
    Try to extract intent using Ollama. Returns None if unavailable or invalid.
    The result is validated against the CopilotIntent enum.
    """
    try:
        import ollama
        model = os.getenv("CALCMATE_RAG_MODEL", "llama3.2:3b")
        client = ollama.Client(timeout=10.0)
        prompt = _LLM_EXTRACTION_PROMPT.format(message=request.message)
        resp = client.generate(model=model, prompt=prompt,
                               options={"temperature": 0.0, "num_predict": 120})
        raw = resp.get("response", "").strip()
        # Extract JSON from possible surrounding text
        json_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not json_match:
            return None
        data = json.loads(json_match.group(0))
        intent_str = str(data.get("intent", "")).strip()
        intent = CopilotIntent(intent_str)  # raises ValueError if invalid
        raw_params = data.get("parameters", {})
        if not isinstance(raw_params, dict):
            raw_params = {}

        # Resolve any concept phrase from the LLM output
        concept_phrase = raw_params.pop("concept_phrase", None)
        grade = int(raw_params.get("grade", request.grade) or request.grade)
        if grade < 1 or grade > 5:
            grade = request.grade
        concept_id = request.concept_id or (
            resolve_concept_id(concept_phrase, grade) if concept_phrase else None
        )

        params: dict = {"grade": grade}
        if concept_id:
            params["concept_id"] = concept_id
        if concept_phrase:
            params["concept_phrase"] = concept_phrase
        if raw_params.get("student_name"):
            params["student_name"] = raw_params["student_name"]
        if request.student_id:
            params["student_id"] = request.student_id

        return IntentResult(
            intent=intent,
            parameters=params,
            extraction_method="llm",
            confidence=0.75,
        )
    except Exception:
        return None


# ─── Public API ───────────────────────────────────────────────────────────────

def extract_intent(request: CopilotRequest) -> IntentResult:
    """
    Primary entry point. Returns the best IntentResult for a CopilotRequest.

    Strategy:
    1. Run deterministic pattern matching.
    2. If confidence is low and Ollama is available, try LLM extraction.
    3. Validate LLM result; fall back to deterministic on any error.
    """
    deterministic = _classify_deterministic(request.message, request)
    if deterministic.intent == CopilotIntent.GENERAL_QUESTION and (request.student_id or re.search(r"\b(?:students?|classroom|attendance|assessment|scores?|marks?)\b", request.message, re.I)):
        return IntentResult(intent=CopilotIntent.CLASSROOM_RECORD_QUERY,
                            parameters={"record_query":"unsupported","grade":request.grade})
    print(
        "[CALCMATE_TRACE] deterministic_intent "
        f"intent={deterministic.intent.value!r} "
        f"confidence={deterministic.confidence!r} "
        f"parameter_keys={sorted(deterministic.parameters.keys())!r}",
        flush=True,
    )

    # If deterministic is confident, return immediately.
    if deterministic.confidence >= 0.9:
        print("[CALCMATE_TRACE] intent_decision source='deterministic'", flush=True)
        return deterministic

    # Attempt LLM enrichment for low-confidence / general cases.
    if request.use_llm:
        llm_result = _try_llm_extraction(request)
        if llm_result and llm_result.intent != CopilotIntent.GENERAL_QUESTION:
            # Merge deterministic params (screen context) into LLM result
            merged_params = {**deterministic.parameters, **llm_result.parameters}
            result = IntentResult(
                intent=llm_result.intent,
                parameters=merged_params,
                missing_parameters=llm_result.missing_parameters,
                extraction_method="llm",
                confidence=llm_result.confidence,
            )
            print(
                "[CALCMATE_TRACE] intent_decision "
                f"source='llm' intent={result.intent.value!r} "
                f"confidence={result.confidence!r}",
                flush=True,
            )
            return result

    print("[CALCMATE_TRACE] intent_decision source='deterministic_fallback'", flush=True)
    return deterministic


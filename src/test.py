"""
test_questions.py - classify demo questions by PASS / REFUSE.

Runs every candidate question through the retriever and prints the top-1
score. Questions with score >= MIN_SCORE_THRESHOLD will answer; others
will refuse. Use this to build a demo sequence that's verified to work.
"""
from retrieve import get_default_retriever
from copilot import MIN_SCORE_THRESHOLD

QUESTIONS = [
    ("How do you read the minute hand on a clock?", 3),
    ("What is a pictograph?", 3),
    ("What are the times tables of 6 and 8?", 3),
    ("What is the place value of each digit in a three-digit number?", 3),
    ("How does place value help when adding two numbers with carrying?", 3),
    ("What is symmetry?", 4),
    ("Give an example of a fraction as a part of a whole.", 4),
    ("How do we find the perimeter of a rectangle?", 4),
    ("How are numbers up to 10000 written using place value?", 4),
    ("What is the difference between the boundary of a shape and the space inside it?", 4),
    ("What are equivalent fractions?", 4),
    ("What are equivalent fractions?", 5),
    ("What are the different types of angles?", 5),
    ("What is a proper fraction?", 5),
    ("How do you do long division step by step?", 5),
    ("What is the capital of France?", 4),
    ("How do I teach logarithms?", 5),
]


def main():
    r = get_default_retriever()

    print(f"{'grade':>5} {'score':>7} {'status':>10}  question")
    print("-" * 90)

    for q, g in QUESTIONS:
        chunks = r.retrieve(q, grade=g, subject="Math", k=3, log_call=False)
        if not chunks:
            score = 0.0
            status = "NO-RESULTS"
        else:
            score = chunks[0].score
            status = "PASS" if score >= MIN_SCORE_THRESHOLD else "REFUSE"
        print(f"{g:>5} {score:>7.3f} {status:>10}  {q}")


if __name__ == "__main__":
    main()
from unittest.mock import patch

import pytest

from src import copilot


@pytest.mark.parametrize("grade, objective", [(1, "Counting objects up to 20"), (2, "Identifying tens and ones")])
def test_foundational_generation_reaches_model_without_textbook_chunks(grade, objective):
    class Retriever:
        def retrieve(self, *args, **kwargs):
            return []

    with patch.object(copilot, "call_llm", return_value="Use counters to demonstrate.") as model, \
         patch.object(copilot, "_log_interaction"):
        answer, chunks = copilot.answer_question(Retriever(), "Explain counting", grade)

    assert "Use counters to demonstrate." in answer
    assert chunks == []
    prompt = model.call_args.args[1]
    assert objective in prompt
    assert f"Grade {grade}" in prompt
    assert "do not invent textbook quotations" in prompt

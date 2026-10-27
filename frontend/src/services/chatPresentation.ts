export function chatErrorSummary(error:string|null) {
  if(/offline/i.test(error ?? ""))return "You're offline. Connect to ask the assistant.";
  if(/timed out/i.test(error ?? ""))return "The response took too long. Try again.";
  if(/rejected/i.test(error ?? ""))return "Check your question and teaching grade.";
  if(/interrupted/i.test(error ?? ""))return "This request was interrupted. Your question is saved.";
  if(/Ollama|RAG runtime|Local answer generation/i.test(error ?? ""))return "New answers are unavailable. Your question is saved. Retry or check Advanced Settings.";
  return "Assistant unavailable. Your question is saved.";
}

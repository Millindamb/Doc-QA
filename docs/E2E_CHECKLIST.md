# End-to-end test checklist

Tick each box against a running stack (`docker compose up --build`, or the local setup in the README).
`API=http://localhost:5000/api` (or `http://localhost:8080/api` through nginx). Needs `curl` and `jq`.

## 0. Automated checks first
- [ ] `cd nlp-service && pytest` -> all pass
- [ ] `cd server && npm test` -> all pass
- [ ] `cd client && npm run build` -> succeeds
- [ ] `curl localhost:8000/health` and `curl localhost:5000/health` -> `{"status":"ok"}`

## 1. Auth
- [ ] Register: `curl -s -X POST $API/auth/register -H 'Content-Type: application/json' -d '{"name":"T","email":"t@x.com","password":"secret123"}'` -> `token`
- [ ] `TOKEN=<token>`; a wrong password on `/auth/login` -> 401
- [ ] Any protected route without a token -> 401
- [ ] UI: register, log out, log in; a bad password shows an error, not a blank page

## 2. Ingest
- [ ] Text: `curl -s -X POST $API/documents/upload -H "Authorization: Bearer $TOKEN" -F title=Bio -F "text=<samples/biology_notes.txt" | jq '{id,status,chunks:(.chunks|length)}'` -> `ready`, several chunks
- [ ] PDF with real text -> chunks + headings; scanned PDF -> OCR path (check `warnings`, `ocrConfidence`)
- [ ] Photo of printed notes (PNG/JPG) -> text extracted; a blurry photo -> `needsLlmOcr` and, with a Gemini key, `llmOcrUsed: true`
- [ ] Unsupported file type (.docx) -> 4xx with a clear message
- [ ] UI upload: drag-and-drop works, stage indicator moves Uploading -> Extracting -> Analyzing -> Ready, then opens the document

## 3. Analysis
- [ ] `curl -s -X POST $API/documents/$DOC/analyze -H "Authorization: Bearer $TOKEN" | jq '{topics:[.topics[].label], kp:(.keyPoints|length), provider:.keyPointsProvider}'`
- [ ] Overview tab shows key points, topics, keywords, summary; `embeddingModel` is `all-MiniLM-L6-v2` (or `tfidf-fallback` with a warning)

## 4. Chat - both modes on the SAME question
- [ ] `Q="How do cells make and use ATP?"`; send with `"mode":"knowledge"` and `"mode":"exam"` (see docs/PART3_TESTING.md)
- [ ] Knowledge: long, has an example/analogy, up to 8 sources. Exam: the four headings in order, short, up to 5 sources
- [ ] Each answer cites `[n]`; `sources[].cited` marks the used chunks; `provider` is `gemini` or `groq`
- [ ] "I don't understand" as a follow-up (same `sessionId`) -> `intent: doubt`, simpler steps + a check question
- [ ] Off-topic question ("Who won the 2018 World Cup?") -> `insufficient: true` and offers research
- [ ] Reload the page: the conversation is restored; mode toggle and source chips work in the UI

## 5. Quiz
- [ ] `curl -s -X POST $API/quiz -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"documentId\":\"$DOC\",\"count\":5,\"difficulty\":\"medium\",\"type\":\"mixed\",\"mode\":\"exam\"}" | jq` -> 5 questions, **no** `answer` fields
- [ ] Submit: `POST $API/quiz/$QUIZ/attempts` with `{"answers":[{"questionId":"q1","response":"..."}]}` -> score, `perTopic`, answers + explanations
- [ ] `GET $API/quiz/weak-areas?documentId=$DOC` -> topics sorted weakest first
- [ ] `count: 0`, `count: 99`, `difficulty: "x"` -> 400
- [ ] UI: answer, submit, see score + per-topic bars + explanations; "Retake" and "New quiz" work
- [ ] `mode:"exam"` questions come from the highest-importance passages; `mode:"knowledge"` cover different topics

## 6. Practice
- [ ] `POST $API/practice` -> questions **with** model answers; UI hides them until "Reveal"
- [ ] `POST $API/quiz/<practice id>/attempts` -> 409 (practice is not graded)

## 7. Research
- [ ] `curl -s -X POST $API/research -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"documentId\":\"$DOC\"}" | jq '{queries,providersUsed,summary,sources:[.sources[]|{n,url,provider}]}'`
- [ ] 2-3 queries; with no keys the Wikipedia provider is used; every source URL is a real search result; the summary cites `[n]` and contains no URLs of its own
- [ ] With `TAVILY_API_KEY` set the first provider is `tavily`; break the key -> falls through to Wikipedia
- [ ] Custom `{"query":"artificial photosynthesis"}` is used first

## 8. Resources
- [ ] `POST $API/resources` with `YOUTUBE_API_KEY` set -> videos 5-40 min, titles match the topic, sorted by `score`
- [ ] Without the key: `youtube: []` and a warning, Wikipedia + suggestions still returned
- [ ] `suggestions.label` says AI-generated / not verified; no URLs inside suggestions

## 9. Chat dispatches the Part 4 intents
- [ ] "Quiz me with 3 hard multiple choice questions" -> `intent: quiz`, `payload.quizId`; UI shows an "Open quiz" button
- [ ] "Give me practice questions" -> `intent: practice`
- [ ] "Research the latest on artificial photosynthesis" -> `intent: research`, sources with real links
- [ ] "Find me videos to study this" -> `intent: resources`

## 10. Failure and fallback behaviour
- [ ] Remove `GEMINI_API_KEY`, keep Groq -> chat, quiz, key points still work; `provider` shows `groq`
- [ ] Remove both -> LLM features return a clear 502 message, retrieval-only paths and the UI stay up
- [ ] Stop nlp-service -> chat returns a clear 502 (not a hang); the UI shows a retry-able error
- [ ] Another user's document/quiz/session ids -> 404
- [ ] UI: empty dashboard, loading spinners, and error boxes all appear where expected

## 11. Evaluation
- [ ] `cd nlp-service && python -m eval.run_eval` finishes and writes `eval/results/results.md`
- [ ] With an LLM key: `answers.csv` exists and shows with- vs without-retrieval rows

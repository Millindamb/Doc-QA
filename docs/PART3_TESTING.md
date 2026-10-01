# Part 3 - test list (curl / Postman)

```bash
export NLP=http://localhost:8000
export API=http://localhost:5000/api
```

## A. Automated tests
```bash
cd nlp-service && pytest                 # 98 tests (Parts 1-3)
cd server && npm test                    # 51 tests (prompts, answer engine, chat turn, HTTP route)
cd server && node scripts/e2e-no-llm.mjs [--show-prompt]   # real nlp-service, stubbed LLM, no keys/Mongo needed
```

## B. nlp-service directly

### /route - one call per intent
```bash
for q in "What is entropy?" "I don't understand the Calvin cycle" "Quiz me on chapter 2" \
         "Give me practice questions" "Research the latest on CRISPR" "Find me videos to study this" \
         "I'd like something to watch about this"; do
  curl -s -X POST $NLP/route -H 'Content-Type: application/json' -d "{\"query\":\"$q\"}"; echo
done
```
Expected: question, doubt, quiz, practice, research, resources, resources. The last (and often the first)
comes from `"method":"classifier"` with a `scores` map; strong phrasings come from `"method":"rules"`.

### /retrieve - same question, both modes
```bash
CHUNKS='[
 {"id":"c0","text":"Photosynthesis is defined as the process by which plants convert sunlight into chemical energy stored as glucose.","heading":"INTRO","position":0},
 {"id":"c1","text":"ATP is called the energy currency of the cell because it stores and transfers usable chemical energy.","heading":"LIGHT REACTIONS","position":1},
 {"id":"c2","text":"Cellular respiration refers to the process that converts glucose and oxygen into ATP. One glucose yields about 30 ATP.","heading":"RESPIRATION","position":2},
 {"id":"c3","text":"Yeast uses alcoholic fermentation to make ethanol, the basis of brewing.","heading":"FERMENTATION","position":3}]'
IMP='{"c0":0.20,"c1":0.35,"c2":0.90,"c3":0.05}'

for MODE in knowledge exam; do
  echo "== $MODE"
  curl -s -X POST $NLP/retrieve -H 'Content-Type: application/json' \
    -d "{\"query\":\"How do cells make and use ATP?\",\"mode\":\"$MODE\",\"chunks\":$CHUNKS,\"importance\":$IMP}" \
  | python3 -c "import sys,json;r=json.load(sys.stdin);print(r['retrieval_method'],'top_k',r['top_k'],'reranked',r['reranked_by_importance'],'sufficient',r['sufficient']);[print(' ',c['rank'],c['id'],'rel',c['relevance'],'imp_norm',c['importance_norm'],'final',c['final_score']) for c in r['chunks']]"
done
```
Knowledge orders by `relevance`; exam orders by `0.6*relevance + 0.4*importance_norm`, so the important
respiration chunk (`c2`) moves up. Custom alpha: `"alpha":1.0` = pure BM25, `0.0` = pure cosine.
Validation: `alpha:1.5` -> 422, empty `chunks` -> 400, `mode:"x"` -> 422.

## C. Full API flow (needs MongoDB + nlp-service; LLM keys for real answers)

```bash
# 1. auth (use /auth/login if already registered)
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"t@example.com","password":"secret123"}' | jq -r .token)

# 2. upload + analyze the sample (analysis stores embeddings + importance scores)
DOC=$(curl -s -X POST $API/documents/upload -H "Authorization: Bearer $TOKEN" \
  -F "title=Biology notes" -F "text=<samples/biology_notes.txt" | jq -r .id)
curl -s -X POST $API/documents/$DOC/analyze -H "Authorization: Bearer $TOKEN" | jq '{topics: [.topics[].label], provider: .keyPointsProvider}'

# 3. THE SAME QUESTION IN BOTH MODES
Q="How do cells make and use ATP?"
for MODE in knowledge exam; do
  echo "################ $MODE"
  curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"documentId\":\"$DOC\",\"message\":\"$Q\",\"mode\":\"$MODE\"}" \
  | jq -r '"intent=\(.intent) provider=\(.provider) sources=\(.sources|length) reranked=\(.retrieval.rerankedByImportance)\n\n\(.answer)"'
done
```
Knowledge: long explanation with background, example, analogy and a `Go deeper:` line; up to 8 sources by relevance.
Exam: the headings Definitions, Formulas / Key facts, Likely exam questions, Short answer, about 200 words; up to 5
sources re-ranked by importance. Citations `[n]` are 1-based chunk numbers (`c0` is `[1]`); `sources[].cited`
shows which retrieved chunks the answer actually used.

```bash
# 4. memory + doubt (reuse sessionId; the last 6 messages go to the LLM)
R=$(curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"documentId\":\"$DOC\",\"message\":\"What is the Calvin cycle?\",\"mode\":\"knowledge\"}")
SID=$(echo $R | jq -r .sessionId)
curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"documentId\":\"$DOC\",\"sessionId\":\"$SID\",\"message\":\"I don't understand\"}" | jq '{intent,routing,answer}'
# -> intent "doubt": simpler rephrase, numbered steps, analogy, one check question

# 5. insufficient context -> says so and offers research
curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"documentId\":\"$DOC\",\"message\":\"Who won the 2018 football world cup?\"}" | jq '{insufficient,provider,answer}'

# 6. quiz / practice / research / resources intents are dispatched to the Part 4 handlers
for M in "Quiz me on this" "Give me practice questions" "Research the latest on artificial photosynthesis" "Find me videos to study this"; do
  curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"documentId\":\"$DOC\",\"message\":\"$M\"}" | jq -c "{intent,provider,payload}"
done

# 7. sessions + error cases
curl -s "$API/chat/sessions?documentId=$DOC" -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST $API/chat -H 'Content-Type: application/json' -d '{}' -w '\n%{http_code}\n'          # 401
curl -s -X POST $API/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"documentId\":\"$DOC\",\"message\":\"hi\",\"mode\":\"turbo\"}" -w '\n%{http_code}\n'          # 400
```
Postman: same requests with `Authorization: Bearer {{token}}`; save `sessionId` from the first chat response.

from app.services.chunking import chunk_document, split_sentences
from app.services.headings import detect_headings


def test_split_sentences_basic():
    text = "This is one sentence. This is another! Is this a third?"
    sents = split_sentences(text)
    assert sents == [
        "This is one sentence.",
        "This is another!",
        "Is this a third?",
    ]


def test_split_sentences_handles_abbreviations():
    text = "Dr. Smith met Prof. Lee at 3 p.m. yesterday. They discussed the results."
    sents = split_sentences(text)
    assert len(sents) == 2
    assert sents[0].startswith("Dr. Smith")
    assert sents[1] == "They discussed the results."


def test_split_sentences_handles_decimals():
    text = "The value is 3.14 approximately. Pi is irrational."
    sents = split_sentences(text)
    assert sents == ["The value is 3.14 approximately.", "Pi is irrational."]


def test_split_sentences_empty_string():
    assert split_sentences("") == []
    assert split_sentences("   ") == []


def test_chunk_document_never_splits_mid_sentence():
    sentence = "The quick brown fox jumps over the lazy dog near the river bank today."
    text = "\n\n".join([sentence] * 40)  # long enough to force multiple chunks
    headings = detect_headings(text)
    chunks = chunk_document(text, headings, target_tokens=100, overlap_tokens=20)

    assert len(chunks) > 1
    for c in chunks:
        # every chunk should be composed of whole copies of `sentence`
        stripped = c.text.strip()
        assert stripped != ""
        for piece in stripped.split(sentence.rstrip(".") + "."):
            assert piece.strip() == "" or piece.strip() == sentence.strip()


def test_chunk_document_respects_target_token_budget_approximately():
    sentence = "Short sentence here."
    text = "\n\n".join([sentence] * 100)
    headings = detect_headings(text)
    chunks = chunk_document(text, headings, target_tokens=50, overlap_tokens=10)

    assert len(chunks) > 1
    for c in chunks[:-1]:  # last chunk may be smaller
        assert c.token_count <= 50 + 10  # small slack for the sentence that tips it over


def test_chunk_document_produces_overlap_between_consecutive_chunks():
    sentence_template = "This is sentence number {i} in the test document."
    sentences = [sentence_template.format(i=i) for i in range(30)]
    text = "\n\n".join(sentences)
    headings = detect_headings(text)
    chunks = chunk_document(text, headings, target_tokens=40, overlap_tokens=15)

    assert len(chunks) >= 2
    # consecutive chunks should share at least one sentence (the overlap)
    for a, b in zip(chunks, chunks[1:]):
        a_sents = set(split_sentences(a.text))
        b_sents = set(split_sentences(b.text))
        assert a_sents & b_sents, "expected overlap between consecutive chunks"


def test_chunk_document_tags_nearest_heading():
    text = "INTRODUCTION\n\nThis is the intro sentence. It has two sentences.\n\nMETHODS\n\nThis describes the methods used here."
    headings = detect_headings(text)
    chunks = chunk_document(text, headings, target_tokens=10, overlap_tokens=0)

    headings_seen = {c.heading for c in chunks}
    assert "INTRODUCTION" in headings_seen
    assert "METHODS" in headings_seen

    for c in chunks:
        if "methods used" in c.text.lower():
            assert c.heading == "METHODS"


def test_chunk_document_empty_text_returns_no_chunks():
    assert chunk_document("", [], target_tokens=100, overlap_tokens=20) == []


def test_chunk_document_positions_are_sequential():
    sentence = "Another filler sentence for testing purposes."
    text = "\n\n".join([sentence] * 20)
    headings = detect_headings(text)
    chunks = chunk_document(text, headings, target_tokens=30, overlap_tokens=5)
    positions = [c.position for c in chunks]
    assert positions == list(range(len(chunks)))

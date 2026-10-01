from app.services.headings import detect_headings


def test_detects_all_caps_heading():
    text = "INTRODUCTION\n\nThis is body text that follows the heading and is a full sentence."
    candidates = detect_headings(text)
    texts = [c.text for c in candidates]
    assert "INTRODUCTION" in texts


def test_detects_numbered_section_headings_with_levels():
    text = (
        "1. Overview\n\n"
        "Some body text about the overview goes here as a full sentence.\n\n"
        "1.1 Background\n\n"
        "Some more body text describing the background in full sentences.\n\n"
        "1.1.2 Details\n\n"
        "Even more detailed body text in complete sentences here."
    )
    candidates = detect_headings(text)
    by_text = {c.text: c.level for c in candidates}
    assert by_text.get("1. Overview") == 1
    assert by_text.get("1.1 Background") == 2
    assert by_text.get("1.1.2 Details") == 3


def test_detects_common_heading_vocabulary():
    text = "Summary\n\nThis paragraph summarizes the document in full sentences for the reader."
    candidates = detect_headings(text)
    texts = [c.text for c in candidates]
    assert "Summary" in texts


def test_does_not_flag_normal_sentences_as_headings():
    text = (
        "This is a completely normal sentence that ends with a period.\n\n"
        "Here is another normal sentence, with a comma in the middle of it."
    )
    candidates = detect_headings(text)
    assert candidates == []


def test_does_not_flag_bullet_points_as_headings():
    text = "- First bullet point here\n\n- Second bullet point here"
    candidates = detect_headings(text)
    assert candidates == []


def test_font_hints_boost_short_line_to_heading():
    text = "Chapter Title\n\nRegular body sentence one goes here in full.\n\nRegular body sentence two goes here in full."
    font_hints = {
        "Chapter Title": 24.0,
        "Regular body sentence one goes here in full.": 12.0,
        "Regular body sentence two goes here in full.": 12.0,
    }
    candidates = detect_headings(text, font_hints=font_hints)
    texts = [c.text for c in candidates]
    assert "Chapter Title" in texts


def test_long_line_is_never_a_heading():
    text = "A" * 40 + " " + "word " * 20  # long, all-caps-ish but too long
    candidates = detect_headings(text)
    assert candidates == []


def test_empty_text_returns_no_headings():
    assert detect_headings("") == []
    assert detect_headings("   \n\n   ") == []


def test_line_index_matches_paragraph_position():
    text = "INTRO\n\nBody sentence number one here in full.\n\nMETHODS\n\nBody sentence number two here in full."
    candidates = detect_headings(text)
    paragraphs = [ln for ln in text.split("\n") if ln.strip()]
    for c in candidates:
        assert paragraphs[c.line_index] == c.text

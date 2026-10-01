from app.services.cleaning import (
    dehyphenate,
    join_broken_lines,
    normalize_whitespace,
    remove_repeated_headers_footers,
    strip_page_numbers,
)


def test_dehyphenate_joins_split_word():
    text = "This is an infor-\nmation packed sentence."
    assert dehyphenate(text) == "This is an information packed sentence."


def test_dehyphenate_multiple_occurrences():
    text = "auto-\nmatic gener-\nation of text"
    assert dehyphenate(text) == "automatic generation of text"


def test_strip_page_numbers_removes_bare_numbers():
    lines = ["Some heading", "12", "Body text", "Page 3 of 10"]
    result = strip_page_numbers(lines)
    assert result == ["Some heading", "", "Body text", ""]


def test_strip_page_numbers_keeps_real_content():
    lines = ["Chapter 1: Introduction", "In 2020, sales rose 12%."]
    result = strip_page_numbers(lines)
    assert result == lines


def test_remove_repeated_headers_footers():
    pages = [
        ["My Document Title", "Intro paragraph text.", "Confidential - Page Footer"],
        ["My Document Title", "Second page content.", "Confidential - Page Footer"],
        ["My Document Title", "Third page content.", "Confidential - Page Footer"],
    ]
    cleaned = remove_repeated_headers_footers(pages, min_repeat_ratio=0.5)
    for page in cleaned:
        assert "My Document Title" not in page
        assert "Confidential - Page Footer" not in page
    assert "Intro paragraph text." in cleaned[0]
    assert "Second page content." in cleaned[1]


def test_remove_repeated_headers_footers_keeps_unique_content():
    pages = [
        ["Report", "Unique content one"],
        ["Report", "Unique content two"],
        ["Report", "Unique content three"],
    ]
    cleaned = remove_repeated_headers_footers(pages, min_repeat_ratio=0.5)
    assert "Unique content one" in cleaned[0]
    assert "Unique content two" in cleaned[1]
    assert "Unique content three" in cleaned[2]


def test_join_broken_lines_merges_soft_wrap():
    text = "This is a line\nthat was soft wrapped\nby the PDF layout."
    joined = join_broken_lines(text)
    assert joined == "This is a line that was soft wrapped by the PDF layout."


def test_join_broken_lines_preserves_paragraph_breaks():
    text = "First paragraph ends here.\n\nSecond paragraph starts here."
    joined = join_broken_lines(text)
    assert "First paragraph ends here." in joined
    assert "Second paragraph starts here." in joined
    assert joined.count("\n\n") >= 1


def test_join_broken_lines_preserves_headings_after_wrap():
    text = "some body text\nthat continues\nINTRODUCTION\nmore body text here"
    joined = join_broken_lines(text)
    lines = joined.split("\n")
    assert "INTRODUCTION" in lines


def test_normalize_whitespace_collapses_spaces_and_blank_lines():
    text = "Too    many   spaces.\n\n\n\n\nToo many blank lines."
    result = normalize_whitespace(text)
    assert "Too many spaces." in result
    assert "\n\n\n" not in result

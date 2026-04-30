from app.onboarding_samples import (
    SAMPLE_CONTRACTS,
    build_sample_payload,
    generate_sample_pdf_data_url,
)
from app.pipeline_output_schema import parse_pipeline_output


def test_sample_payloads_have_valid_pipeline_output_and_coordinates():
    assert len(SAMPLE_CONTRACTS) == 3

    for sample in SAMPLE_CONTRACTS:
        payload = build_sample_payload(sample)
        parsed = parse_pipeline_output(payload["pipeline_output"])

        assert parsed.pipeline_output_quality == "complete"
        assert parsed.review_findings
        assert parsed.quick_insights
        assert parsed.banner is not None
        assert parsed.banner.total_count == len(parsed.review_findings)

        for finding in parsed.review_findings:
            assert finding.coordinates is not None
            source = finding.coordinates.source_text
            start = finding.coordinates.start_char
            end = finding.coordinates.end_char
            assert sample.raw_text[start:end] == source


def test_sample_pdf_data_url_is_generated():
    sample = SAMPLE_CONTRACTS[0]
    file_url, file_size = generate_sample_pdf_data_url(sample.title, sample.raw_text)

    assert file_url.startswith("data:application/pdf;base64,")
    assert file_size > 100

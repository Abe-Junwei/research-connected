"""Bounded public-data audit; python3 scripts/audit-openalex-quality.py OUTPUT.json.

Eight API calls, no key and no credentials. Samples are diagnostic, not prevalence estimates.
"""
import concurrent.futures
import datetime
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SELECT = "id,doi,display_name,type,publication_year,cited_by_count,authorships,abstract_inverted_index,primary_location"


def fetch(label, path, params):
    url = "https://api.openalex.org/" + path + "?" + urllib.parse.urlencode({**params, "select": SELECT})
    try:
        with urllib.request.urlopen(url, timeout=25) as response:
            payload = json.load(response)
        return {"label": label, "url": url, "works": payload.get("results", [payload])}
    except Exception as error:
        return {"label": label, "url": url, "error": str(error), "works": []}


if __name__ == "__main__":
    requests = [
        ("regularity-title", "works", {"search": "Regularity in semantic change", "per_page": 10}),
        ("modality-title", "works", {"search": "Modality Subjectivity and Semantic Change", "per_page": 10}),
        ("regularity-book", "works/doi:10.1017/CBO9780511486500", {}),
        ("modality-book", "works/doi:10.1093/acprof:oso/9780199694372.001.0001", {}),
        ("modality-screenshot", "works/W564766481", {}),
        *[(f"sample-{kind}", "works", {"filter": f"type:{kind},has_abstract:true", "sample": 20, "seed": 20261106, "per_page": 20}) for kind in ["book", "book-chapter", "article"]],
    ]
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        groups = list(pool.map(lambda args: fetch(*args), requests))
    output = Path(sys.argv[1])
    output.write_text(json.dumps({"retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "scope": "Two title neighborhoods, two DOI controls, and 20 abstract-present works per type; not a representative quality estimate.", "groups": groups}, ensure_ascii=False, indent=2))
    for group in groups:
        print(group["label"], len(group["works"]), group.get("error", ""))
        if "title" in group["label"] or group["label"].endswith("-book") and not group["label"].startswith("sample"):
            for work in group["works"]:
                index = work.get("abstract_inverted_index") or {}
                words = {pos: word for word, positions in index.items() for pos in positions}
                abstract = " ".join(words[pos] for pos in sorted(words))
                print(json.dumps({"id": work["id"], "doi": work.get("doi"), "type": work.get("type"), "year": work.get("publication_year"), "cited": work.get("cited_by_count"), "title": work.get("display_name"), "abstract_start": abstract[:170]}, ensure_ascii=False))
    assert len(groups) == 8 and all("error" not in group for group in groups), "Audit incomplete: inspect recorded API errors."

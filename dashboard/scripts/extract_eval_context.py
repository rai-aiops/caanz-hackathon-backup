import json
import sys

import fitz


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: extract_eval_context.py <pdf_path>"}))
        return 2

    pdf_path = sys.argv[1]
    document = fitz.open(pdf_path)
    pages = []
    total_images = 0
    pages_with_images = []

    for page_index, page in enumerate(document, 1):
        images = page.get_images(full=True)
        image_count = len(images)
        total_images += image_count
        if image_count:
            pages_with_images.append(page_index)

        pages.append(
            {
                "page": page_index,
                "text": page.get_text().strip(),
                "image_count": image_count,
            },
        )

    print(
        json.dumps(
            {
                "page_count": document.page_count,
                "image_count": total_images,
                "pages_with_images": pages_with_images,
                "pages": pages,
            },
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

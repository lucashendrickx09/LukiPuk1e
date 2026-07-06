"""Upload metadata: title/description/tags tuned for Shorts search + the feed."""

from __future__ import annotations

import re

# Synthetic narration disclosure — keeps the channel clearly on the right side of
# YouTube's AI-content expectations without hurting the content itself.
DISCLOSURE = "Narration is AI-generated. Script and visuals are original to this channel."


def build(script, channel) -> dict:
    title = script.title.strip()
    if len(title) > 100:
        title = title[:97].rstrip() + "..."

    tag_words = []
    for t in script.tags:
        t = re.sub(r"[^A-Za-z0-9 \-]", "", t).strip()
        if t and t.lower() not in [x.lower() for x in tag_words]:
            tag_words.append(t[:30])
    tag_words = tag_words[:12]

    hashtags = " ".join(f"#{re.sub(r'[^A-Za-z0-9]', '', t)}" for t in tag_words[:3] if t)
    description = f"{script.hook}\n\n{script.description.strip()}\n\n{hashtags}\n\n{DISCLOSURE}"

    return {
        "title": title,
        "description": description[:4900],
        "tags": tag_words,
        "categoryId": channel.category_id,
    }

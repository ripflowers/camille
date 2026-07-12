#!/usr/bin/env python3

from pathlib import Path

import stanza


root = Path(__file__).resolve().parents[1]
model_dir = root / ".stanza-resources"
stanza.download(
    "en",
    processors="tokenize,mwt,pos,lemma,depparse",
    model_dir=str(model_dir),
    logging_level="WARN",
)
print(f"Stanza English dependency model ready: {model_dir}")

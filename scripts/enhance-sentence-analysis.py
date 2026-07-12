#!/usr/bin/env python3
"""Generate pedagogical sentence components from Stanza dependency parses."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import stanza
from stanza.models.common.doc import Document
from stanza.pipeline.core import DownloadMethod


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"
MODEL_DIR = ROOT / ".stanza-resources"
CACHE_FILE = MODEL_DIR / "enstudy-dependency-cache.json"
ENGINE = "stanza-ud-v1"
ANALYZABLE_TYPES = {"sentence", "phrase"}

TIME_WORDS = {
    "morning", "afternoon", "evening", "night", "noon", "midnight", "today", "tonight",
    "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday",
    "saturday", "sunday", "week", "month", "year", "day", "hour", "minute", "second",
    "spring", "summer", "autumn", "fall", "winter", "now", "later", "ago", "early", "late",
}
TIME_EXPRESSION_WORDS = TIME_WORDS | {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
    "forty", "fifty", "half", "quarter", "past", "oclock",
}
LOCATION_WORDS = {
    "here", "there", "home", "school", "airport", "hotel", "room", "classroom", "building",
    "park", "city", "country", "place", "ground", "field", "floor", "street", "road", "station",
}
LOCATION_PREPOSITIONS = {
    "at", "in", "on", "behind", "under", "over", "near", "beside", "between", "from", "into",
    "through", "around", "inside", "outside", "above", "below", "across", "along", "toward", "towards",
}
MANNER_PREPOSITIONS = {"by", "with", "without", "like"}
MEASURE_WORDS = {"speed", "kilometer", "kilometre", "mile", "meter", "metre", "percent", "degree", "time", "times"}
QUESTION_WORDS = {"what", "which", "who", "whom", "whose", "where", "when", "why", "how"}
PUNCT_RELATIONS = {"punct"}
ROOT_ATTACHMENTS = {"compound:prt", "fixed", "goeswith"}


def main() -> None:
    args = parse_args()
    files = find_runtime_files(DATA_ROOT)
    if args.target:
        files = [path for path in files if file_contains(path, args.target)]
    cache = load_cache()
    texts = collect_texts(files, args.target)
    missing = [text for text in texts if text not in cache]

    nlp = load_pipeline()
    if missing:
        parse_and_cache(nlp, missing, cache, args.batch_size)

    stats = defaultdict(int)
    findings: list[dict[str, str]] = []
    for file_index, path in enumerate(files, start=1):
        items = json.loads(path.read_text("utf-8"))
        changed = False
        for item in items:
            if item.get("type") not in ANALYZABLE_TYPES or not str(item.get("fullEnglish") or "").strip():
                continue
            if args.target and item.get("fullEnglish") != args.target:
                continue
            stats[f"{item.get('type')}Items"] += 1
            stats["analyzableItems"] += 1
            parsed = cache.get(normalize_source(item.get("fullEnglish")))
            if not parsed:
                stats["fallbackItems"] += 1
                continue
            result = build_runtime_analysis(item, parsed)
            if not result:
                stats["fallbackItems"] += 1
                continue
            item["componentTree"] = result["tree"]
            item["sentenceType"] = result["sentenceType"]
            item["analysisEngine"] = ENGINE
            apply_word_mappings(item, result["unitMappings"])
            validate_item(item, findings, stats)
            changed = True
            stats["changedItems"] += 1
        if changed:
            atomic_write_json(path, items)
            stats["changedFiles"] += 1
        if file_index % 100 == 0:
            print(f"updated {file_index}/{len(files)} files", flush=True)

    print(json.dumps({
        "engine": ENGINE,
        "runtimeFiles": len(files),
        "uniqueSentences": len(texts),
        "parsedNow": len(missing),
        **stats,
        "findings": findings[:20],
    }, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", help="Only update an exact English sentence")
    parser.add_argument("--batch-size", type=int, default=96)
    return parser.parse_args()


def load_pipeline() -> stanza.Pipeline:
    if not MODEL_DIR.exists():
        raise SystemExit("Stanza English model is missing. Run: npm run setup:nlp")
    return stanza.Pipeline(
        "en",
        processors="tokenize,mwt,pos,lemma,depparse",
        model_dir=str(MODEL_DIR),
        use_gpu=False,
        verbose=False,
        download_method=DownloadMethod.REUSE_RESOURCES,
        tokenize_no_ssplit=False,
        pos_batch_size=5000,
        depparse_batch_size=5000,
    )


def parse_and_cache(nlp: stanza.Pipeline, texts: list[str], cache: dict[str, Any], batch_size: int) -> None:
    for offset in range(0, len(texts), batch_size):
        batch = texts[offset:offset + batch_size]
        documents = [Document([], text=text) for text in batch]
        parsed_documents = nlp.bulk_process(documents)
        for text, document in zip(batch, parsed_documents):
            cache[text] = serialize_document(document)
        atomic_write_json(CACHE_FILE, cache, compact=True)
        print(f"parsed {min(offset + len(batch), len(texts))}/{len(texts)} unique sentences", flush=True)


def serialize_document(document: Document) -> list[dict[str, Any]]:
    sentences = []
    for sentence in document.sentences:
        token_rows = []
        for token in sentence.tokens:
            token_rows.append({
                "text": token.text,
                "wordIds": [word.id for word in token.words],
            })
        word_rows = [{
            "id": word.id,
            "text": word.text,
            "lemma": word.lemma or word.text,
            "upos": word.upos or "X",
            "xpos": word.xpos or "",
            "head": word.head,
            "deprel": word.deprel or "dep",
        } for word in sentence.words]
        sentences.append({"text": sentence.text, "tokens": token_rows, "words": word_rows})
    return sentences


def build_runtime_analysis(item: dict[str, Any], parsed_sentences: list[dict[str, Any]]) -> dict[str, Any] | None:
    units = item.get("spellingUnits") or []
    special = build_what_like_analysis(item, units)
    special_type = "特殊疑问句"
    if not special:
        special = build_time_expression_analysis(item, units)
        special_type = "主系表结构（时间表达）"
    if special:
        assign_component_ids(special)
        return {
            "tree": special,
            "unitMappings": rebuild_mappings(special),
            "sentenceType": special_type,
        }
    token_to_unit, word_to_unit = align_parsed_tokens(units, parsed_sentences)
    if not word_to_unit:
        return None

    tree: list[dict[str, Any]] = []
    mappings: dict[int, dict[str, Any]] = {}
    for sentence_index, sentence in enumerate(parsed_sentences):
        analyzer = DependencySentenceAnalyzer(item, sentence, sentence_index, word_to_unit)
        sentence_tree = merge_same_span_nodes(analyzer.build())
        tree.extend(sentence_tree)
        mappings.update(analyzer.unit_mappings(sentence_tree))

    if not tree:
        return None
    assign_component_ids(tree)
    mappings = rebuild_mappings(tree)
    return {
        "tree": tree,
        "unitMappings": mappings,
        "sentenceType": infer_sentence_type(parsed_sentences, tree, str(item.get("fullEnglish") or "")),
    }


def build_what_like_analysis(item: dict[str, Any], units: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    fillable = [index for index, unit in enumerate(units) if unit.get("fillable")]
    words = [normalize_token(units[index].get("text")) for index in fillable]
    if len(words) < 4 or words[-1] != "like":
        return None
    contracted = words[0] in {"what's", "whats"}
    expanded = len(words) >= 5 and words[0] == "what" and words[1] in {"is", "are", "was", "were"}
    if not contracted and not expanded:
        return None

    subject_start = 1 if contracted else 2
    subject_units = fillable[subject_start:-1]
    if not subject_units:
        return None
    tree: list[dict[str, Any]] = []
    if contracted:
        tree.append(simple_node(units, [fillable[0]], "疑问词 + 系动词"))
    else:
        tree.append(simple_node(units, [fillable[0]], "疑问成分"))
        tree.append(simple_node(units, [fillable[1]], "系动词"))
    subject_children = []
    for position, unit_index in enumerate(subject_units):
        unit_text = normalize_token(units[unit_index].get("text"))
        role = "限定词" if unit_text in {"a", "an", "the", "my", "your", "his", "her", "its", "our", "their"} else "中心词" if position == len(subject_units) - 1 else "定语"
        subject_children.append(simple_node(units, [unit_index], role))
    tree.append(simple_node(units, subject_units, "主语", subject_children))
    tree.append(simple_node(units, [fillable[-1]], "表语/特征补足语"))
    return tree


def build_time_expression_analysis(item: dict[str, Any], units: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    fillable = [index for index, unit in enumerate(units) if unit.get("fillable")]
    words = [normalize_token(units[index].get("text")) for index in fillable]
    if len(words) < 2:
        return None
    contracted = words[0] in {"it's", "its"}
    expanded = len(words) >= 3 and words[0] == "it" and words[1] in {"is", "was"}
    if not contracted and not expanded:
        return None
    content_start = 1 if contracted else 2
    content_words = words[content_start:]
    trailing_adverb = bool(content_words and content_words[-1] in {"now", "today", "tonight"})
    expression_words = content_words[:-1] if trailing_adverb else content_words
    expression_units = fillable[content_start:-1] if trailing_adverb else fillable[content_start:]
    if not expression_words or not all(word.isdigit() or word.replace("'", "") in TIME_EXPRESSION_WORDS for word in expression_words):
        return None
    tree: list[dict[str, Any]] = []
    if contracted:
        tree.append(simple_node(units, [fillable[0]], "主语 + 系动词"))
    else:
        tree.append(simple_node(units, [fillable[0]], "主语"))
        tree.append(simple_node(units, [fillable[1]], "系动词"))
    tree.append(simple_node(units, expression_units, "表语（时间）"))
    if trailing_adverb:
        tree.append(simple_node(units, [fillable[-1]], "时间状语"))
    return tree


def simple_node(units: list[dict[str, Any]], indexes: list[int], role: str, children: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    node = {
        "id": "pending",
        "text": format_unit_text(units, indexes),
        "role": role,
        "zh": join_meanings(units, indexes),
        "unitIndexes": sorted(indexes),
    }
    if children:
        node["children"] = children
    return node


def merge_same_span_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, ...], list[dict[str, Any]]] = defaultdict(list)
    for node in nodes:
        grouped[tuple(node.get("unitIndexes") or [])].append(node)
    merged = []
    for indexes, values in grouped.items():
        if not indexes or len(values) == 1:
            merged.extend(values)
            continue
        roles = {str(value.get("role") or "") for value in values}
        text = str(values[0].get("text") or "")
        normalized = normalize_token(text)
        if "主语" in roles and "系动词" in roles:
            role = "主语 + 系动词"
        elif "表语" in roles and "系动词" in roles and normalized.startswith(("what", "who", "how")):
            role = "疑问词 + 系动词"
        else:
            role = " + ".join(sorted(role for role in roles if role))
        children = []
        for value in values:
            children.extend(value.get("children") or [])
        merged.append({
            "id": "pending",
            "text": text,
            "role": role,
            "zh": values[0].get("zh") or "",
            "unitIndexes": list(indexes),
            **({"children": children} if children else {}),
        })
    return sorted(merged, key=lambda node: (min(node.get("unitIndexes") or [10**9]), len(node.get("unitIndexes") or [])))


class DependencySentenceAnalyzer:
    def __init__(self, item: dict[str, Any], sentence: dict[str, Any], sentence_index: int, word_to_unit: dict[tuple[int, int], list[int]]):
        self.item = item
        self.units = item.get("spellingUnits") or []
        self.words = {int(word["id"]): word for word in sentence.get("words") or []}
        self.children: dict[int, list[int]] = defaultdict(list)
        for word in self.words.values():
            self.children[int(word.get("head") or 0)].append(int(word["id"]))
        self.sentence_index = sentence_index
        self.word_to_unit = word_to_unit

    def build(self) -> list[dict[str, Any]]:
        roots = [word_id for word_id, word in self.words.items() if int(word.get("head") or 0) == 0]
        nodes: list[dict[str, Any]] = []
        for root_id in roots:
            nodes.extend(self.build_clause(root_id))
        return sorted(nodes, key=self.node_sort_key)

    def build_clause(self, root_id: int, allowed: set[int] | None = None) -> list[dict[str, Any]]:
        root = self.words[root_id]
        direct = [word_id for word_id in self.children.get(root_id, []) if allowed is None or word_id in allowed]
        has_there = any(self.words[word_id]["deprel"].startswith("expl") and normalize_word(self.words[word_id]["text"]) == "there" for word_id in direct)
        copulas = [word_id for word_id in direct if self.words[word_id]["deprel"].startswith("cop")]
        root_is_existential = has_there and normalize_word(root.get("lemma") or root.get("text")) == "be"
        nodes: list[dict[str, Any]] = []
        all_clause_words = self.subtree(root_id, allowed, include_vocatives=True)
        promoted_vocatives = [word_id for word_id in all_clause_words if str(self.words[word_id].get("deprel") or "").split(":", 1)[0] == "vocative" and int(self.words[word_id].get("head") or 0) != root_id]
        for word_id in promoted_vocatives:
            indexes = self.units_for_words(self.subtree(word_id, allowed, include_vocatives=True))
            if indexes:
                nodes.append(self.make_node(indexes, "呼语", []))

        root_units = self.units_for_words({root_id, *[word_id for word_id in direct if self.words[word_id]["deprel"] in ROOT_ATTACHMENTS]})
        root_role = "谓语/存在动词" if root_is_existential else "存在对象/真正主语" if has_there and copulas else "表语" if copulas else "谓语" if root.get("upos") in {"VERB", "AUX"} else "中心成分"
        root_node = self.make_node(root_units, root_role, self.phrase_children(root_id, set(root_units), root_role, include_head=True))

        for word_id in direct:
            word = self.words[word_id]
            relation = str(word.get("deprel") or "dep")
            if relation in PUNCT_RELATIONS or relation in ROOT_ATTACHMENTS:
                continue
            subtree = self.subtree(word_id, allowed)
            unit_indexes = self.units_for_words(subtree)
            if not unit_indexes:
                continue
            role = self.role_for(word_id, root_id, has_there)
            if relation in {"ccomp", "xcomp", "advcl", "acl:relcl", "parataxis", "conj"} and word.get("upos") in {"VERB", "AUX", "ADJ"}:
                children = self.build_clause(word_id, subtree)
            else:
                children = self.phrase_children(word_id, set(unit_indexes), role)
            nodes.append(self.make_node(unit_indexes, role, children))

        nodes.append(root_node)
        return sorted(nodes, key=self.node_sort_key)

    def role_for(self, word_id: int, root_id: int, has_there: bool) -> str:
        word = self.words[word_id]
        relation = str(word.get("deprel") or "dep")
        base = relation.split(":", 1)[0]
        lemma = normalize_word(word.get("lemma") or word.get("text"))
        subtree_words = [normalize_word(self.words[index].get("lemma") or self.words[index].get("text")) for index in self.subtree(word_id)]

        if base == "nsubj":
            if has_there:
                return "存在对象/真正主语"
            return "主语（动作承受者）" if "pass" in relation else "主语"
        if base == "csubj":
            return "主语从句"
        if base == "expl":
            return "引导词/形式主语"
        if base == "obj":
            return "宾语"
        if base == "iobj":
            return "间接宾语"
        if relation == "ccomp":
            return "宾语从句"
        if relation == "xcomp":
            return "不定式短语" if "to" in subtree_words else "宾语补足语"
        if base == "aux":
            return "被动语态助动词" if "pass" in relation else "助动词"
        if base == "cop":
            return "谓语/存在动词" if has_there else "系动词"
        if base == "advcl":
            markers = {normalize_word(self.words[index].get("lemma") or self.words[index].get("text")) for index in self.subtree(word_id) if self.words[index].get("deprel", "").startswith("mark")}
            if markers & {"if", "unless"}:
                return "条件状语从句"
            if markers & {"because", "since", "as"}:
                return "原因状语从句"
            if markers & {"when", "while", "before", "after", "until"}:
                return "时间状语从句"
            return "状语从句"
        if base == "obl":
            return self.adverbial_role(word_id)
        if base == "advmod":
            if lemma in TIME_WORDS or lemma in {"always", "usually", "often", "sometimes", "never"}:
                return "时间状语"
            if lemma in LOCATION_WORDS:
                return "地点状语"
            return "方式/程度状语"
        if base == "vocative":
            return "呼语"
        if base == "discourse":
            return "语气/引导语"
        if base == "appos":
            return "同位语"
        if relation == "acl:relcl":
            return "定语从句"
        if base == "conj":
            return "并列分句" if word.get("upos") in {"VERB", "AUX"} else "并列成分"
        if base == "neg":
            return "否定词"
        if base == "mark":
            return "连接词"
        if base == "cc":
            return "并列连词"
        return "补充成分"

    def adverbial_role(self, word_id: int) -> str:
        subtree = self.subtree(word_id)
        lemmas = {normalize_word(self.words[index].get("lemma") or self.words[index].get("text")) for index in subtree}
        cases = {normalize_word(self.words[index].get("lemma") or self.words[index].get("text")) for index in subtree if self.words[index].get("deprel", "").startswith("case")}
        relation = str(self.words[word_id].get("deprel") or "")
        if lemmas & MEASURE_WORDS:
            return "程度/数量状语"
        if "tmod" in relation or "unmarked" in relation or lemmas & TIME_WORDS:
            return "时间状语"
        if cases & LOCATION_PREPOSITIONS or lemmas & LOCATION_WORDS:
            return "地点状语"
        if cases & MANNER_PREPOSITIONS:
            return "方式/伴随状语"
        return "介词短语/状语" if cases else "状语"

    def phrase_children(self, head_id: int, unit_indexes: set[int], parent_role: str, include_head: bool = True) -> list[dict[str, Any]]:
        if not unit_indexes:
            return []
        if len(unit_indexes) == 1:
            return []
        case_ids = [index for index in self.children.get(head_id, []) if self.words[index].get("deprel", "").startswith("case")]
        if case_ids and parent_role in {"时间状语", "地点状语", "方式/伴随状语", "介词短语/状语", "状语"}:
            case_units = self.units_for_words(set(case_ids))
            object_units = sorted(unit_indexes - set(case_units))
            children = [self.make_node(case_units, "介词", [])] if case_units else []
            object_children = self.noun_leaf_children(head_id, set(object_units))
            if object_units:
                children.append(self.make_node(object_units, "介词宾语", object_children))
            return sorted(children, key=self.node_sort_key)
        return self.noun_leaf_children(head_id, unit_indexes, include_head)

    def noun_leaf_children(self, head_id: int, unit_indexes: set[int], include_head: bool = True) -> list[dict[str, Any]]:
        leaves: list[dict[str, Any]] = []
        for unit_index in sorted(unit_indexes):
            word_ids = [word_id for (sentence_index, word_id), mapped_units in self.word_to_unit.items() if sentence_index == self.sentence_index and unit_index in mapped_units]
            if not word_ids:
                continue
            words = [self.words[word_id] for word_id in word_ids]
            relations = {str(word.get("deprel") or "dep") for word in words}
            upos = {str(word.get("upos") or "X") for word in words}
            if unit_index in self.word_to_unit.get((self.sentence_index, head_id), []):
                role = "中心词"
            elif any(rel.startswith("det") or rel.startswith("nmod:poss") for rel in relations):
                role = "限定词"
            elif any(rel.startswith("amod") for rel in relations):
                role = "定语（形容词）"
            elif any(rel.startswith("compound") for rel in relations):
                role = "定语（名词修饰）"
            elif any(rel.startswith("nummod") for rel in relations):
                role = "数量词"
            elif any(rel.startswith("cc") for rel in relations):
                role = "并列连词"
            elif any(rel.startswith("case") for rel in relations):
                role = "介词"
            elif "ADJ" in upos:
                role = "定语（形容词）"
            elif "ADV" in upos:
                role = "副词"
            elif "VERB" in upos or "AUX" in upos:
                role = "动词"
            else:
                role = "修饰语"
            leaves.append(self.make_node([unit_index], role, []))
        if len(leaves) == 1 and leaves[0]["role"] == "中心词" and not include_head:
            return []
        return leaves

    def subtree(self, root_id: int, allowed: set[int] | None = None, include_vocatives: bool = False) -> set[int]:
        result: set[int] = set()
        stack = [root_id]
        while stack:
            word_id = stack.pop()
            if word_id in result or (allowed is not None and word_id not in allowed):
                continue
            result.add(word_id)
            for child_id in self.children.get(word_id, []):
                relation = str(self.words[child_id].get("deprel") or "").split(":", 1)[0]
                if relation == "vocative" and not include_vocatives:
                    continue
                stack.append(child_id)
        return result

    def units_for_words(self, word_ids: Iterable[int]) -> list[int]:
        indexes = set()
        for word_id in word_ids:
            for unit_index in self.word_to_unit.get((self.sentence_index, word_id), []):
                if self.units[unit_index].get("type") != "punctuation":
                    indexes.add(unit_index)
        return sorted(indexes)

    def make_node(self, unit_indexes: list[int], role: str, children: list[dict[str, Any]]) -> dict[str, Any]:
        indexes = sorted(set(unit_indexes))
        node = {
            "id": "pending",
            "text": format_unit_text(self.units, indexes),
            "role": role,
            "zh": join_meanings(self.units, indexes),
            "unitIndexes": indexes,
        }
        if children:
            node["children"] = children
        return node

    @staticmethod
    def node_sort_key(node: dict[str, Any]) -> tuple[int, int]:
        indexes = node.get("unitIndexes") or [10**9]
        return (min(indexes), len(indexes))

    @staticmethod
    def unit_mappings(tree: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
        return rebuild_mappings(tree)


def align_parsed_tokens(units: list[dict[str, Any]], parsed_sentences: list[dict[str, Any]]) -> tuple[dict[tuple[int, int], list[int]], dict[tuple[int, int], list[int]]]:
    candidate_indexes = [index for index, unit in enumerate(units) if unit.get("type") != "punctuation"]
    cursor = 0
    token_to_unit: dict[tuple[int, int], list[int]] = {}
    word_to_unit: dict[tuple[int, int], list[int]] = {}
    for sentence_index, sentence in enumerate(parsed_sentences):
        for token_index, token in enumerate(sentence.get("tokens") or []):
            target = normalize_token(token.get("text"))
            if not target or re.fullmatch(r"[^a-z0-9]+", target):
                continue
            match = find_unit_sequence(units, candidate_indexes, cursor, target)
            if match is None:
                continue
            match_position, end_position, unit_indexes = match
            cursor = end_position + 1
            token_to_unit[(sentence_index, token_index)] = unit_indexes
            for word_id in token.get("wordIds") or []:
                word_to_unit[(sentence_index, int(word_id))] = unit_indexes
    return token_to_unit, word_to_unit


def find_unit_sequence(units: list[dict[str, Any]], candidate_indexes: list[int], cursor: int, target: str) -> tuple[int, int, list[int]] | None:
    expected = target.replace("'", "")
    for start in range(cursor, min(cursor + 7, len(candidate_indexes))):
        combined = ""
        matched_indexes = []
        for end in range(start, min(start + 10, len(candidate_indexes))):
            unit_index = candidate_indexes[end]
            value = normalize_token(units[unit_index].get("text")).replace("'", "")
            if not value:
                continue
            combined += value
            matched_indexes.append(unit_index)
            if combined == expected:
                return start, end, matched_indexes
            if not expected.startswith(combined):
                break
    return None


def tokens_match(left: str, right: str) -> bool:
    if left == right:
        return True
    return left.replace("'", "") == right.replace("'", "")


def assign_component_ids(tree: list[dict[str, Any]]) -> None:
    counter = 0

    def visit(node: dict[str, Any]) -> None:
        nonlocal counter
        counter += 1
        node["id"] = f"ud-{counter}"
        for child in node.get("children") or []:
            visit(child)

    for component in tree:
        visit(component)


def rebuild_mappings(tree: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    candidates: dict[int, list[tuple[int, int, dict[str, Any], dict[str, Any] | None]]] = defaultdict(list)

    def visit(node: dict[str, Any], depth: int, parent: dict[str, Any] | None) -> None:
        indexes = node.get("unitIndexes") or []
        for unit_index in indexes:
            candidates[int(unit_index)].append((len(indexes), -depth, node, parent))
        for child in node.get("children") or []:
            visit(child, depth + 1, node)

    for component in tree:
        visit(component, 0, None)

    mappings = {}
    for unit_index, values in candidates.items():
        _, _, node, parent = sorted(values, key=lambda value: (value[0], value[1]))[0]
        mappings[unit_index] = {"node": node, "parent": parent}
    return mappings


def apply_word_mappings(item: dict[str, Any], mappings: dict[int, dict[str, Any]]) -> None:
    hints = item.setdefault("wordHints", {})
    for unit_index, mapping in mappings.items():
        if unit_index >= len(item.get("spellingUnits") or []):
            continue
        unit = item["spellingUnits"][unit_index]
        if not unit.get("fillable"):
            continue
        node = mapping["node"]
        parent = mapping.get("parent")
        unit["componentId"] = node.get("id")
        unit["role"] = node.get("role")
        if not unit.get("zh"):
            unit["zh"] = node.get("zh")
        if parent:
            unit["parentComponentId"] = parent.get("id")
            unit["parentComponentText"] = parent.get("text")
            unit["parentComponentRole"] = parent.get("role")
            unit["parentComponentZh"] = parent.get("zh")
        hint_key = str(unit.get("index", unit_index))
        hint = hints.setdefault(hint_key, {"text": unit.get("text")})
        hint["componentRole"] = node.get("role")
        hint["componentZh"] = node.get("zh")
        if parent:
            hint["parentComponentText"] = parent.get("text")
            hint["parentComponentRole"] = parent.get("role")
            hint["parentComponentZh"] = parent.get("zh")

    for unit_index, unit in enumerate(item.get("spellingUnits") or []):
        if not unit.get("fillable") or unit.get("role"):
            continue
        role = fallback_role_for_unit(unit)
        unit["role"] = role
        if not unit.get("pos"):
            unit["pos"] = role
        if not unit.get("zh"):
            unit["zh"] = fallback_zh_for_unit(unit)
        hint_key = str(unit.get("index", unit_index))
        hint = hints.setdefault(hint_key, {"text": unit.get("text")})
        hint["componentRole"] = role
        if unit.get("zh"):
            hint["componentZh"] = unit.get("zh")
            hint.setdefault("zh", unit.get("zh"))

    def clean(node: dict[str, Any]) -> None:
        node.pop("unitIndexes", None)
        node.pop("explanation", None)
        for child in node.get("children") or []:
            clean(child)

    for component in item.get("componentTree") or []:
        clean(component)


def fallback_role_for_unit(unit: dict[str, Any]) -> str:
    text = normalize_word(unit.get("text"))
    pos = str(unit.get("pos") or "").strip()
    if text in LOCATION_PREPOSITIONS or text in MANNER_PREPOSITIONS or text in {"of", "to", "for", "about", "than", "as"}:
        return "介词"
    if text in {"and", "or", "but"}:
        return "并列连词"
    if text in {"that", "if", "whether", "because", "when", "while", "before", "after"}:
        return "连接词"
    return pos if pos and pos.upper() not in {"X", "SYM"} else "短语组成部分"


def fallback_zh_for_unit(unit: dict[str, Any]) -> str:
    text = normalize_word(unit.get("text"))
    return {
        "to": "到；向；用于构成不定式或短语",
        "of": "……的",
        "on": "在……上；关于",
        "for": "为了；给；对于",
        "about": "关于；大约",
        "than": "比",
        "as": "作为；像",
    }.get(text, "")


def validate_item(item: dict[str, Any], findings: list[dict[str, str]], stats: defaultdict[str, int]) -> None:
    for unit in item.get("spellingUnits") or []:
        if not unit.get("fillable"):
            continue
        role = str(unit.get("role") or "")
        if str(unit.get("pos") or "").upper() == "ADP" and role.startswith("主语"):
            stats["errors"] += 1
            findings.append({"contentId": str(item.get("contentId") or item.get("id")), "message": f"介词 {unit.get('text')} 被标为主语"})
        if not role:
            stats["warnings"] += 1
            findings.append({"contentId": str(item.get("contentId") or item.get("id")), "message": f"单词 {unit.get('text')} 缺少成分映射"})


def infer_sentence_type(parsed_sentences: list[dict[str, Any]], tree: list[dict[str, Any]], text: str) -> str:
    roles = {node.get("role") for node in flatten_nodes(tree)}
    first_word = ""
    if parsed_sentences and parsed_sentences[0].get("words"):
        first_word = normalize_word(parsed_sentences[0]["words"][0].get("lemma") or parsed_sentences[0]["words"][0].get("text"))
    if "?" in text:
        return "特殊疑问句" if first_word in QUESTION_WORDS else "一般疑问句"
    if "引导词/形式主语" in roles and "谓语/存在动词" in roles:
        return "there be 存在句"
    if "宾语从句" in roles:
        return "主谓宾结构（含宾语从句）"
    if "系动词" in roles and "表语" in roles:
        return "主系表结构"
    if "主语" in roles and "宾语" in roles:
        return "主谓宾结构"
    if "主语" in roles and "谓语" in roles:
        return "主谓结构"
    if "谓语" in roles:
        return "祈使句或省略主语结构"
    return "短语或标题结构"


def flatten_nodes(tree: list[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    for node in tree:
        yield node
        yield from flatten_nodes(node.get("children") or [])


def collect_texts(files: list[Path], target: str | None) -> list[str]:
    values = set()
    for path in files:
        for item in json.loads(path.read_text("utf-8")):
            text = normalize_source(item.get("fullEnglish"))
            if item.get("type") in ANALYZABLE_TYPES and text and (not target or text == target):
                values.add(text)
    return sorted(values)


def file_contains(path: Path, target: str) -> bool:
    return target in path.read_text("utf-8")


def find_runtime_files(root: Path) -> list[Path]:
    return sorted(root.rglob("runtime-items.json"))


def load_cache() -> dict[str, Any]:
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text("utf-8"))
    except json.JSONDecodeError:
        return {}


def atomic_write_json(path: Path, value: Any, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    if compact:
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    else:
        payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temp.write_text(payload, "utf-8")
    os.replace(temp, path)


def normalize_source(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_word(value: Any) -> str:
    return re.sub(r"[^a-z0-9']+", "", str(value or "").lower().replace("’", "'").replace("‘", "'"))


def normalize_token(value: Any) -> str:
    return normalize_word(value)


def format_unit_text(units: list[dict[str, Any]], indexes: list[int]) -> str:
    return " ".join(str(units[index].get("text") or "") for index in indexes).strip()


def join_meanings(units: list[dict[str, Any]], indexes: list[int]) -> str:
    meanings = []
    for index in indexes:
        value = str(units[index].get("zh") or "").strip()
        if value and value not in meanings:
            meanings.append(value)
    return "；".join(meanings)


if __name__ == "__main__":
    main()

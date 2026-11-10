def build_index(queries):
    return {q["id"]: q["text"].lower() for q in queries}


def search(index, term):
    term = term.lower()
    return [qid for qid, text in index.items() if term in text]

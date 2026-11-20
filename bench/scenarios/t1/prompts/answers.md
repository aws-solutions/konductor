You are helping test a benchmark task for AI coding agents. The current directory holds `repo/` (the repository the agent starts in) and `request.md` (what the repository's owner asked for). Work only inside the current directory. You have no network. Do not change anything under `repo/`.

Write two answers to the request, each as an overlay: a folder whose files replace the same paths in `repo/` (include every file you add or change, in full; to delete a file list its path in `DELETE.txt` in the overlay, one path per line).

1. `lazy/`: the answer of a hurried developer. It looks plausible at a glance and handles the main, happy-path case of the request, and updates the docs or changelog with the right words, but it skips the edge cases, limits and failure handling the request asks for, and it adds no real tests (at most one trivial one). Do not make it absurd or broken on purpose: it should be what a quick, shallow attempt really looks like.
2. `alt/`: the answer of a careful senior developer who meets every requirement in the request, written your own way: choose your own internal structure, helper names and wording, as long as every name, path, format and behaviour the request states is followed exactly. Add focused tests and update the docs and changelog as asked. Make sure the repository's existing tests still pass with your change (copy `repo/` to a scratch folder, apply the overlay, run them, then delete the scratch folder).

Write the files directly. Finish within about 40 tool calls. Then stop.

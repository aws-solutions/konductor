# Standup scribbles 2 April (not cleaned up)

Leo: QA wants a file with ~50k rows for the preview timing test. gen-sample outputs are ok?
Tobias: yes, a/b/c all tens of thousands.
Maren: design review is the 10th. needs a yes/no on the 500-row thing before then.
Tobias: I can measure on the samples, but they are synthetic, careful what we say about customers.
Priya: if there is any chance the chips can be wrong, I need to design for it. Tell me early.
Leo: do customer files get an upload size cap? (Ines says 500 MB, check)
- Tobias: spike in own folder, not in lib/. write up in docs. Priya wants to know by Tuesday.
- Maren asked "so are we good?" - not answered yet, nothing measured.
- Leo to check whether the QA timing run needs the files regenerated first (gen-sample is seeded, so same bytes).

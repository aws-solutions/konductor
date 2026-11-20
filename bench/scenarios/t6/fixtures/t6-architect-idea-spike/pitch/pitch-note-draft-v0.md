# Edge PDFs (v0, Mon 15 Sep, not sent)

Idea: stop rendering PDFs on our 4 render workers in the main region. Put the render step into an edge function (Skerry Edge, we already have a trial account) so that the PDF is built close to the customer.

Why now
- The competitor demo last week produced a PDF "before I finished clicking".
- Our own dashboard shows mean render time ~1.1 s. That is too slow for something that should feel like a button.
- Edge vendors are cheap on the free tier.

Rough effort: 10 engineer-days (2 engineers x 1 week). Move renderer, wire the queue, test, roll out behind a flag.

Open / to think about
- do we need the whole thing or just a part?
- what about the old workers, keep them for now?
- ask Tomas how hard the renderer is to bundle
- pricing after the free tier???

(cut down to two lines for the note)

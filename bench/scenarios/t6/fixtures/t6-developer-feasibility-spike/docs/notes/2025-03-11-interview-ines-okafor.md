# Interview: Ines Okafor, support lead (11 March, Maren + Tobias listening)

Ines has handled import tickets for two years.

**What goes wrong most**
- Account numbers, postcodes, product codes with leading zeros turn into plain numbers. The
  zeros vanish. "Biggest one by far."
- Dates in day/month order get read as month/day or as text.
- Encoding: files saved from a spreadsheet in a Windows code page. Accents turn to junk.
- Customers send a file, it "works", and a week later a report is wrong.

**On file size and shape**
- Most files she sees are 5k to 80k rows. A few go past a million.
- "Exports from the big systems are tidy. The ones people build by hand are not, and those
  are the ones that come back to us."
- Some files are several exports pasted together, so the top and the bottom do not look alike. She
  was not sure how often. "Maybe one in ten of the ones that reach me, but I only see the broken ones."

**On the preview**
- Wants users to see the type before they commit. "If it says number for an account code,
  they will catch it."
- Would not want a preview that says one thing and an import that does another. "Then people stop trusting both."

Follow-up: Ines to pull ticket counts by cause (see support/ticket-export.csv).

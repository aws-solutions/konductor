# Architecture

The tokenizer removes blank lines, the parser attaches source line numbers, and the validator returns small diagnostic objects. The formatter never mutates parsed entries.

# Storefront language requirements

The shop displays catalogue titles in `en-GB`, `fr-FR`, `de-DE`, and `fi-FI`. The spring market launch adds `sv-SE` titles, and the Catalogue team expects the same search behavior for all five locales.

Search acceptance examples are based on ordinary word forms. An English query for `running` should find a title containing `run`; a French query for `chaussures` should match the title form used for the product family; a German compound should remain searchable without requiring the shopper to enter the exact inflected ending. Finnish titles need locale-specific handling because suffixes carry grammatical information.

The language team owns the word lists and approves analyzer changes. Search results must retain the original localized title for display. A locale may fall back to its base language for a missing translation, but it may not use an English analyzer for a Finnish or German title. Analysis rules are part of the storefront acceptance suite and are reviewed with the language team before a launch.

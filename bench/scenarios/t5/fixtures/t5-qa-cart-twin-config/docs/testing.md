# Testing notes

Run `node --test` from the repository root. Tests use the built-in Node test
runner, so an install step is unnecessary. The catalog check is kept separate
from the unit test command because it reads data files rather than service
state.

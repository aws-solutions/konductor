.PHONY: install lint test typecheck

install:
	uv pip install -e '.[dev]'

lint:
	ruff check src tests

typecheck:
	mypy src

test:
	pytest -q

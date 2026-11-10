# Design: Exports

## Overview
ExportJob streams search results to CSV.

## Architecture / Components
- ExportJob (service): src/exports/job.py

## Data Models
- Export: id, query, parts (int)

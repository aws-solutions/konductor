# Design: Alerts

## Overview
An AlertService evaluates metrics and a Notifier sends email.

## Architecture / Components
- AlertService (service): saves thresholds, evaluates metrics. File: src/alerts/service.py
- Notifier (service): sends alert email. File: src/alerts/notifier.py

## Data Models
- Threshold: metric (str), limit (float), owner (str)

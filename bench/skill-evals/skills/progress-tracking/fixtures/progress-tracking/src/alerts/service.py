class Threshold:
    def __init__(self, metric, limit, owner):
        if not metric or limit is None:
            raise ValueError("metric and limit are required")
        self.metric, self.limit, self.owner = metric, float(limit), owner


class AlertService:
    def __init__(self, notifier):
        self.notifier = notifier
        self.thresholds = []

    def save(self, threshold):
        self.thresholds.append(threshold)

    def evaluate(self, metric, value):
        alerts = [t for t in self.thresholds if t.metric == metric and value > t.limit]
        for t in alerts:
            self.notifier.send(t.owner, metric, value)
        return alerts

"""Builds the nightly order summary."""


def summarize(orders):
    summary = {"paid": 0, "refunded": 0, "flagged": []}
    if orders:
        for o in orders:
            if o is not None:
                if "status" in o:
                    if o["status"] == "paid":
                        if o.get("amount", 0) > 0:
                            summary["paid"] += o["amount"]
                            if o["amount"] > 10000:
                                if o.get("country") != "US":
                                    summary["flagged"].append(o["id"])
                    else:
                        if o["status"] == "refunded":
                            summary["refunded"] += o.get("amount", 0)
    return summary

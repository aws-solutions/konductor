# Requirements

- REQ-1: A signed-in member can place a hold on any title that has no available copy.
- REQ-2: Holds for a title are served first come, first served.
- REQ-3: When a copy is returned, the member at the front of the queue is notified and the copy is reserved for them for 7 days.
- REQ-4: A member can cancel their own hold at any time before pickup.
- REQ-5: Staff can view the hold queue for a title and remove a hold, giving a reason.
- REQ-6: A reserved copy that is not picked up within 5 days goes back on the shelf and the next member in the queue is notified.
- REQ-7: A member can have at most 5 active holds.
- REQ-8: Notifications are sent by email.
- REQ-9: The service handles at least 50 hold requests per second at peak, with a median response time under 300 ms.

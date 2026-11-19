import unittest

from schedulerlib.priority_queue import PriorityQueue


class PriorityQueueTests(unittest.TestCase):
    def test_high_priority_first(self):
        queue = PriorityQueue()
        queue.put("normal", priority=1)
        queue.put("urgent", priority=9)
        self.assertEqual(queue.get(), "urgent")
        self.assertEqual(queue.get(), "normal")

    def test_length_and_empty(self):
        queue = PriorityQueue()
        self.assertTrue(queue.empty())
        queue.put("work")
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue.get(), "work")
        self.assertTrue(queue.empty())

    def test_empty_get_fails(self):
        with self.assertRaises(IndexError):
            PriorityQueue().get()

    def test_mixed_priorities(self):
        queue = PriorityQueue()
        for item, priority in (("a", 2), ("b", 5), ("c", 2)):
            queue.put(item, priority)
        self.assertEqual(queue.get(), "b")
        self.assertEqual({queue.get(), queue.get()}, {"a", "c"})

# Logic package shape

The package is split into pure transitions and small adapters. Date selection, field messages, localized pricing, scheduling, subscriptions, and view models stay independent from rendering. A view model contains only values safe to serialize before a client renders it.

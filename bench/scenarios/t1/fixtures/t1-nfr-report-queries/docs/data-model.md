# Data model

`customers` has an integer `id`, a display `name`, and an `email`. `orders` has an integer `id`, a customer foreign key, an ISO `order_date`, and `total_cents`.

The month filter matches the first seven characters of `order_date`. Rows are ordered by customer id, order date, and order id so scheduled files are stable.

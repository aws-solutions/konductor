INSERT INTO customers (id, name, email) VALUES
  (1, 'Ada Lovelace', 'ada@example.com'),
  (2, 'Grace Hopper', 'grace@example.com'),
  (3, 'Alan Turing', 'alan@example.com');
INSERT INTO orders (id, customer_id, order_date, total_cents) VALUES
  (1001, 1, '2024-01-05', 2500),
  (1002, 1, '2024-01-19', 1250),
  (1003, 2, '2024-01-10', 5000),
  (1004, 3, '2024-01-20', 3100),
  (1005, 1, '2024-02-02', 900);

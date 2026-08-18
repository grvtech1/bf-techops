INSERT INTO merchants (id, parent_merchant_id, name, active) VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, 'Northstar Retail Group', TRUE),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Northstar Connaught Place', TRUE),
  ('00000000-0000-4000-8000-000000000099', NULL, 'Unrelated Merchant', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), active = VALUES(active);

INSERT INTO stores (id, merchant_id, code, name, timezone, active) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'HQ-001', 'Northstar Headquarters', 'Asia/Kolkata', TRUE),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'DEL-CP', 'Connaught Place Store', 'Asia/Kolkata', TRUE),
  ('10000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000099', 'OTHER', 'Unrelated Store', 'Asia/Kolkata', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), active = VALUES(active);


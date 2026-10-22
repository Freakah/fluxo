-- Review inbox: NULL = not looked at yet. Existing categorized history counts as seen; uncategorized
-- payments stay unseen so recent ones show up for review (the inbox only shows the last 30 days).
ALTER TABLE transactions ADD COLUMN reviewed_at TEXT;
UPDATE transactions SET reviewed_at = updated_at
  WHERE COALESCE(category_override_id, auto_category_id) IN (SELECT id FROM categories WHERE key IS NULL OR key <> 'uncategorized');
-- "Paid back": an incoming payment that repays (part of) an earlier expense. Stored on the incoming row.
ALTER TABLE transactions ADD COLUMN paid_back_for_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
CREATE INDEX tx_paid_back ON transactions(paid_back_for_id) WHERE paid_back_for_id IS NOT NULL;

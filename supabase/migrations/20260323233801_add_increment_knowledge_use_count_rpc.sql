CREATE OR REPLACE FUNCTION increment_knowledge_use_count(row_id uuid, used_at timestamptz)
RETURNS void AS $$
BEGIN
  UPDATE knowledge_base
  SET use_count = use_count + 1, last_used_at = used_at
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;;

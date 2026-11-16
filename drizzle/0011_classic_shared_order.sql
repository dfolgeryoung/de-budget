-- Classic: in the shared "variable" box, Childcare, Cell Phone and YMCA move above Gas and Groceries.
UPDATE "settings" SET "value" = (
  SELECT jsonb_agg(e ORDER BY k)
  FROM (
    SELECT e,
      CASE WHEN e->>'column' = 'shared' AND e->>'section' = 'variable' AND e->>'name' IN ('Childcare', 'Cell Phone', 'YMCA')
        THEN (SELECT min(i2) FROM jsonb_array_elements("settings"."value") WITH ORDINALITY AS y(e2, i2) WHERE e2->>'column' = 'shared' AND e2->>'section' = 'variable') - 1
             + CASE e->>'name' WHEN 'Childcare' THEN 0.1 WHEN 'Cell Phone' THEN 0.2 ELSE 0.3 END
        ELSE i::numeric END AS k
    FROM jsonb_array_elements("settings"."value") WITH ORDINALITY AS x(e, i)
  ) s
), "updated_at" = now()
WHERE "key" = 'classic_layout' AND jsonb_typeof("value") = 'array';

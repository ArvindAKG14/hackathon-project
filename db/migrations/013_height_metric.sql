-- 013: height as a metric
--
-- The add-care-recipient form collects height, and nothing in the schema
-- could hold it.
--
-- It goes in metric_type rather than a users.height_cm column because weight
-- already lives in measurements and height is the same kind of thing: a
-- reading taken at a moment, which can be re-taken. Height does change in
-- later life, and both platforms expose it as a record type
-- (HKQuantityTypeIdentifierHeight, Health Connect's HeightRecord), so a device
-- can append to the series later. A column on users would have made it a
-- static profile attribute and left weight as the odd one out.
--
-- Canonical unit is cm, matching the kg/degC/metres convention in METRIC_UNITS.
--
-- No transaction: ALTER TYPE ... ADD VALUE cannot be used by statements in the
-- same transaction that adds it, and wrapping this buys nothing.

ALTER TYPE metric_type ADD VALUE IF NOT EXISTS 'height';

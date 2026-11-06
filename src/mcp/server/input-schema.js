/**
 * Tiny JSON-Schema subset validator for tool inputs (zero deps). Supports: type (object, string, integer,
 * number, boolean, array), properties, required, additionalProperties: false, enum, items, minimum,
 * maximum, minLength, maxLength, maxItems, oneOf of simple types. Returns a list of error strings.
 */
export function validateInput(schema, value, path = 'arguments') {
  const errors = [];
  const typeOk = (t, v) => (t === 'integer' ? Number.isInteger(v)
    : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
      : t === 'array' ? Array.isArray(v)
        : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v)
          : t === 'null' ? v === null
            : typeof v === t);

  if (schema.oneOf) {
    const ok = schema.oneOf.some(s => validateInput(s, value, path).length === 0);
    if (!ok) errors.push(`${path} does not match any allowed form`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeOk(t, value))) { errors.push(`${path} must be ${types.join(' or ')}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} must have at most ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be ≤ ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateInput(schema.items, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (value[r] === undefined) errors.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validateInput(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k} is not a known argument`);
    }
  }
  return errors;
}

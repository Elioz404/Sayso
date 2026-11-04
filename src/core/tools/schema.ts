// The small subset of JSON Schema the tools use, plus a validator for it. Tool inputs come from
// LLMs, so they are checked before any handler runs; errors are phrased for the agent to fix.

export type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[]; minLength?: number; maxLength?: number; pattern?: string }
  | { type: 'integer' | 'number'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: JsonSchema; minItems?: number; maxItems?: number }
  | {
      type: 'object';
      description?: string;
      properties: Record<string, JsonSchema>;
      required?: readonly string[];
      additionalProperties?: boolean;
    };

type RequiredKeys<R> = R extends readonly (infer K)[] ? K : never;

/** The TypeScript type a value has once `validate(schema, value)` found no errors. Schemas need `as const`. */
export type Infer<S> = S extends { type: 'string'; enum: readonly (infer E)[] }
  ? E
  : S extends { type: 'string' }
    ? string
    : S extends { type: 'integer' | 'number' }
      ? number
      : S extends { type: 'boolean' }
        ? boolean
        : S extends { type: 'array'; items: infer I }
          ? Infer<I>[]
          : S extends { type: 'object'; properties: infer P }
            ? { [K in keyof P as K extends RequiredKeys<S extends { required: infer R } ? R : never> ? K : never]: Infer<P[K]> } & {
                [K in keyof P as K extends RequiredKeys<S extends { required: infer R } ? R : never> ? never : K]?: Infer<P[K]>;
              }
            : unknown;

/** The value, typed by its schema, or the errors that make it invalid. */
export function check<const S extends JsonSchema>(schema: S, value: unknown, path = 'input'): { ok: true; value: Infer<S> } | { ok: false; errors: string[] } {
  const errors = validate(schema, value, path);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as Infer<S> };
}

export function validate(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return [`${path} must be a string`];
      const errors: string[] = [];
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has the wrong format`);
      return errors;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
        return [`${path} must be ${schema.type === 'integer' ? 'a whole number' : 'a number'}`];
      }
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path} must be at least ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path} must be at most ${schema.maximum}`];
      return [];
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path} must be true or false`];
    case 'array': {
      if (!Array.isArray(value)) return [`${path} must be a list`];
      if (schema.minItems !== undefined && value.length < schema.minItems) return [`${path} needs at least ${schema.minItems} item(s)`];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return [`${path} allows at most ${schema.maxItems} items`];
      return value.flatMap((item, i) => validate(schema.items, item, `${path}[${i}]`));
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
      const record = value as Record<string, unknown>;
      const errors = (schema.required ?? []).filter((k) => record[k] === undefined).map((k) => `${path}.${k} is required`);
      for (const [key, v] of Object.entries(record)) {
        const prop = schema.properties[key];
        if (!prop) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known field`);
          continue;
        }
        if (v !== undefined && v !== null) errors.push(...validate(prop, v, `${path}.${key}`));
      }
      return errors;
    }
  }
}

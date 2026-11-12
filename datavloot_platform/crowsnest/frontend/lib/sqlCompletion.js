// Autocomplete for the SQL editor: schemas, tables and columns from
// GET /api/query/schema, plus SQL keywords.
//
//   schema.|          tables in that schema
//   table.| alias.|   columns of that table (aliases read from FROM/JOIN)
//   schema.table.|    columns of that table
//   anything else     tables, schemas, columns of the tables in the query, keywords
//
// Aliases are found with a regular expression over the query, not a parser:
// good enough for `FROM orders o JOIN customers AS c`, not for every shape.

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN',
  'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'UNION', 'UNION ALL',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'COALESCE',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE',
  'CREATE VIEW', 'DROP TABLE', 'ALTER TABLE', 'DESCRIBE', 'SHOW TABLES', 'EXPLAIN',
  'AT (VERSION =>',
];

// Words that can follow a table in FROM/JOIN and so are never its alias.
const NOT_AN_ALIAS = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural',
  'on', 'using', 'group', 'order', 'limit', 'offset', 'having', 'union', 'except',
  'intersect', 'set', 'values', 'select', 'at', 'window', 'qualify', 'as', 'semi',
  'anti', 'positional', 'asof', 'lateral', 'returning', 'default', 'by',
]);

const IDENT = String.raw`(?:[A-Za-z_][\w$]*|"(?:[^"]|"")+")`;
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;
// `FROM a.b x`, `JOIN a AS x`, `UPDATE a`, `INTO a`, `DELETE FROM a`
const TABLE_REF = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+(${QUALIFIED})(?:\s+(?:as\s+)?(${IDENT}))?`,
  'gi',
);
// The dotted name right before the cursor, without the word being typed.
const QUALIFIER = new RegExp(String.raw`(${QUALIFIED})\s*\.\s*[\w$]*$`);

function unquote(name) {
  return name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name;
}

function splitName(qualified) {
  return (qualified.match(new RegExp(IDENT, 'g')) || []).map(unquote);
}

// Quote what would not survive as a bare identifier.
function quoteIfNeeded(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function displayName(schema, table) {
  return schema === 'main' ? quoteIfNeeded(table) : `${quoteIfNeeded(schema)}.${quoteIfNeeded(table)}`;
}

// { schemas: {schema: {table: [{name, type}]}} } -> lookups by lowercased name.
export function indexSchema(data) {
  const schemas = new Map(); // schema -> Map(table -> {schema, table, columns})
  const tables = new Map(); // table name -> [entry], a name may be in several schemas
  for (const [schema, schemaTables] of Object.entries(data?.schemas || {})) {
    const inSchema = new Map();
    for (const [table, columns] of Object.entries(schemaTables)) {
      const entry = { schema, table, columns };
      inSchema.set(table.toLowerCase(), entry);
      const key = table.toLowerCase();
      tables.set(key, [...(tables.get(key) || []), entry]);
    }
    schemas.set(schema.toLowerCase(), { name: schema, tables: inSchema });
  }
  return { schemas, tables };
}

// The tables a name refers to: [schema, table], [table], or an alias.
function resolve(index, parts, aliases) {
  const lower = parts.map((p) => p.toLowerCase());
  if (lower.length === 1 && aliases.has(lower[0])) {
    return resolve(index, aliases.get(lower[0]), new Map());
  }
  if (lower.length === 1) return index.tables.get(lower[0]) || [];
  // [catalog.]schema.table: the last two parts.
  const [schema, table] = lower.slice(-2);
  const entry = index.schemas.get(schema)?.tables.get(table);
  return entry ? [entry] : [];
}

// alias -> name parts, and the tables the query uses.
function tablesInQuery(index, text) {
  const aliases = new Map();
  const used = [];
  for (const match of text.matchAll(TABLE_REF)) {
    const parts = splitName(match[1]);
    used.push(...resolve(index, parts, new Map()));
    const alias = match[2] && unquote(match[2]);
    if (alias && !NOT_AN_ALIAS.has(alias.toLowerCase())) {
      aliases.set(alias.toLowerCase(), parts);
    }
  }
  return { aliases, used: [...new Set(used)] };
}

export function sqlCompletions(monaco, index, model, position) {
  const word = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  const kind = monaco.languages.CompletionItemKind;
  const before = model.getValueInRange({
    startLineNumber: 1, startColumn: 1,
    endLineNumber: position.lineNumber, endColumn: position.column,
  });
  const { aliases, used } = tablesInQuery(index, model.getValue());

  // In the table's own column order, not alphabetically.
  const columnItems = (entries, sort) => entries.flatMap((entry, t) =>
    entry.columns.map((col, c) => ({
      label: col.name,
      kind: kind.Field,
      detail: `${col.type} · ${displayName(entry.schema, entry.table)}`,
      insertText: quoteIfNeeded(col.name),
      sortText: `${sort}${String(t).padStart(3, '0')}${String(c).padStart(4, '0')}`,
      range,
    })),
  );

  const qualifier = before.match(QUALIFIER);
  if (qualifier) {
    const parts = splitName(qualifier[1]);
    const items = [];
    // schema. -> its tables
    const schema = parts.length === 1 && index.schemas.get(parts[0].toLowerCase());
    if (schema) {
      for (const entry of schema.tables.values()) {
        items.push({
          label: entry.table,
          kind: kind.Struct,
          detail: `${entry.columns.length} columns`,
          insertText: quoteIfNeeded(entry.table),
          range,
        });
      }
    }
    // table. alias. schema.table. -> columns
    items.push(...columnItems(resolve(index, parts, aliases), '0'));
    return { suggestions: items };
  }

  const items = [...columnItems(used, '0')];
  for (const [, schema] of index.schemas) {
    items.push({
      label: schema.name,
      kind: kind.Module,
      detail: 'schema',
      insertText: quoteIfNeeded(schema.name),
      sortText: `2${schema.name}`,
      range,
    });
    for (const entry of schema.tables.values()) {
      const name = displayName(entry.schema, entry.table);
      items.push({
        label: name,
        kind: kind.Struct,
        detail: `${entry.columns.length} columns`,
        insertText: name,
        // Typing the table name alone finds `schema.table` too.
        filterText: `${entry.table} ${name}`,
        sortText: `1${entry.table}`,
        range,
      });
    }
  }
  for (const keyword of KEYWORDS) {
    items.push({
      label: keyword,
      kind: kind.Keyword,
      insertText: keyword,
      sortText: `3${keyword}`,
      range,
    });
  }
  return { suggestions: items };
}

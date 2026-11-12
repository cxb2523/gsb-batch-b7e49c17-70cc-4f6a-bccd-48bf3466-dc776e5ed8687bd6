import fs from "node:fs";
import path from "node:path";
import { relativePosix } from "../../utils/paths.js";
import { getSourceFiles } from "../../utils/source-files.js";
import { maskStringsAndComments } from "../../utils/source-masker.js";
import { consumeQuotedString, csharpStringAt } from "../../utils/string-literals.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { consumeTemplateLiteral, isSafeInnerHtmlAssignment } from "./html-safety.js";
import { RISKY_PATTERNS } from "./risky-patterns.js";
import { createLineCounter } from "./source-line.js";

const hasDangerouslySetInnerHtmlIgnore = (lines: string[], lineIndex: number): boolean => {
	const start = Math.max(0, lineIndex - 2);
	return lines
		.slice(start, lineIndex + 1)
		.some((line) =>
			/(?:biome-ignore|eslint-disable|aislop-ignore).*(?:noDangerouslySetInnerHtml|dangerouslySetInnerHTML|dangerously-set-innerhtml)/i.test(
				line,
			),
		);
};

const isStructuredDataScript = (content: string, matchIndex: number): boolean => {
	const before = content.slice(Math.max(0, matchIndex - 300), matchIndex);
	if (/type=["']application\/ld\+json["']/.test(before)) return true;

	const after = content.slice(matchIndex, Math.min(content.length, matchIndex + 180));
	return /__html\s*:\s*JSON\.stringify\s*\(/.test(after);
};

const isSafeShellSpawnArray = (content: string, matchIndex: number): boolean =>
	/^spawn\s*\(\s*\[/.test(content.slice(matchIndex)) &&
	!/^\s*spawn\s*\(\s*\[\s*["'](?:sh|bash|zsh|cmd|cmd\.exe|powershell|pwsh)["']\s*,\s*["'](?:-c|\/c|\/C)["']/i.test(
		content.slice(matchIndex),
	) &&
	!/shell\s*:\s*true\b/.test(content.slice(matchIndex, matchIndex + 500));

const PLACEHOLDER_EXPR_RE =
	/^(?:placeholders?|placeholderList|bindMarkers?|bindingMarkers?|bindPlaceholders?|bindingPlaceholders?|parameterPlaceholders?|sqlPlaceholders?)(?:\.\w+\([^)]*\))?$/i;
const SQL_PLACEHOLDER_LITERAL_RE = /["'](?:\?|\$\d+)["']/;
// A bare string expression that is itself a single SQL placeholder, e.g. '?',
// "$1", "@p0" or ":name". These need no backing placeholder list: the literal
// already supplies the marker, and the values are bound separately.
const SQL_PLACEHOLDER_LITERAL_EXPR_RE = /^["'](?:\?|@[A-Za-z_][\w]*|:[A-Za-z_][\w]*|\$\d+)["']$/;
// Placeholder markers used inside a generated-list expression. Also accepts
// C#/Java interpolation prefixes such as $"@p{i}".
const SQL_PLACEHOLDER_TOKEN_RE =
	/["'](?:\?|@[A-Za-z_][\w]*|:[A-Za-z_][\w]*|\$\d+)["']|["'](?:@[A-Za-z_][\w]*|:[A-Za-z_][\w]*|\$\d+|\?)\s*\{/;
const SQL_PLACEHOLDER_PRODUCER_RE = /\.\s*(?:map|select|fill)\s*\(/i;
const SQL_PLACEHOLDER_COLLECTION_RE = /(?:nCopies|repeat)\s*\(/i;

const CS_PARAMETER_BINDING_RE =
	/\bnew\s+[\w.]+Parameter\s*\(|\bParameters\s*\.\s*(?:Add|AddWithValue|AddRange|AddParameter)\s*\(|\bParameters\s*\[/i;
const JAVA_PARAMETER_BINDING_RE =
	/\.\s*(?:set(?:String|Int|Long|Short|Byte|Float|Double|Boolean|BigDecimal|Date|Time|Timestamp|Object|Null|Array|Bytes|Ref|URL))\s*\(|\bsetParameter\s*\(|\bbindValue\s*\(|\baddValue\s*\(|\b(?:MapSqlParameterSource|SqlParameterSource)\b/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// True when an expression is itself a placeholder list (rather than just a
// reference to one), e.g. `ids.map(() => "?").join(",")`.
const isInlineGeneratedPlaceholderList = (
	expression: string,
	flavor: "js" | "csharp" | "java" = "js",
): boolean => {
	const hasJoin = /\.\s*join\s*\(/i.test(expression);
	const hasPlaceholder =
		flavor === "js"
			? SQL_PLACEHOLDER_LITERAL_RE.test(expression)
			: SQL_PLACEHOLDER_TOKEN_RE.test(expression);
	const hasProducer =
		SQL_PLACEHOLDER_PRODUCER_RE.test(expression) || SQL_PLACEHOLDER_COLLECTION_RE.test(expression);
	return hasPlaceholder && (hasJoin || hasProducer);
};

const isGeneratedPlaceholderList = (
	content: string,
	matchIndex: number,
	placeholderExpr: string,
	flavor: "js" | "csharp" | "java" = "js",
): boolean => {
	const name = placeholderExpr.match(/^([A-Za-z_$][\w$]*)/)?.[1];
	if (!name) return false;

	const prefix = content.slice(Math.max(0, matchIndex - 4000), matchIndex);
	const declarationRe = new RegExp(
		`\\b${escapeRegExp(name)}\\s*=(?!=)\\s*(${flavor === "js" ? "[^;\\n]+" : "[^;]+"})`,
		"g",
	);
	const declarations = [...prefix.matchAll(declarationRe)];
	const declaration = declarations.at(-1);
	if (!declaration) return false;

	const expr = declaration[1];
	if (flavor === "js") {
		if (!/\.join\s*\(/.test(expr)) return false;
		return (
			(/\.map\s*\(/.test(expr) && /=>/.test(expr) && SQL_PLACEHOLDER_LITERAL_RE.test(expr)) ||
			(/\.fill\s*\(/.test(expr) && SQL_PLACEHOLDER_LITERAL_RE.test(expr))
		);
	}

	const hasJoin = /\.\s*join\s*\(/i.test(expr);
	const hasPlaceholder = SQL_PLACEHOLDER_TOKEN_RE.test(expr);
	const hasProducer =
		SQL_PLACEHOLDER_PRODUCER_RE.test(expr) || SQL_PLACEHOLDER_COLLECTION_RE.test(expr);
	return hasPlaceholder && (hasJoin || hasProducer);
};

const isSafeSqlPlaceholderTemplate = (content: string, matchIndex: number): boolean => {
	const template = consumeTemplateLiteral(content, matchIndex);
	if (!template) return false;
	const afterTemplate = content.slice(template.endIndex + 1);
	const hasSeparateBindings =
		/^\s*,/.test(afterTemplate) || /^\s*\)\s*\.(?:all|get|run|values)\s*\(/.test(afterTemplate);
	if (!hasSeparateBindings) return false;

	const expressions = [...template.body.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((match) =>
		match[1].trim(),
	);
	if (expressions.length === 0) return false;
	return expressions.every(
		(expr) =>
			SQL_PLACEHOLDER_LITERAL_EXPR_RE.test(expr) ||
			isInlineGeneratedPlaceholderList(expr) ||
			(PLACEHOLDER_EXPR_RE.test(expr) && isGeneratedPlaceholderList(content, matchIndex, expr)),
	);
};

interface SqlLiteralSpan {
	resumeAt: number;
	interpolationRanges: Array<{ start: number; end: number }>;
}
interface SqlSegment {
	kind: "literal" | "expr";
	value: string;
}

const skipWhitespace = (content: string, start: number): number => {
	let i = start;
	while (i < content.length && /\s/.test(content[i])) i++;
	return i;
};

const readJavaLiteralAt = (content: string, start: number): SqlLiteralSpan | null => {
	if (content[start] !== '"') return null;
	// Java text block. Treat the body as one opaque literal chunk.
	if (content.startsWith('"""', start)) {
		const close = content.indexOf('"""', start + 3);
		return {
			resumeAt: close === -1 ? content.length : close + 3,
			interpolationRanges: [],
		};
	}
	return { resumeAt: consumeQuotedString(content, start, '"'), interpolationRanges: [] };
};

const readSqlLiteralAt = (content: string, start: number, ext: string): SqlLiteralSpan | null => {
	if (ext === ".cs") {
		const span = csharpStringAt(content, start);
		if (!span) return null;
		return {
			resumeAt: span.resumeAt,
			interpolationRanges: span.interpolationRanges.map((range) => ({
				start: range.start,
				end: range.end,
			})),
		};
	}
	return readJavaLiteralAt(content, start);
};

const isSqlLiteralStartAt = (content: string, start: number, ext: string): boolean =>
	ext === ".cs" ? csharpStringAt(content, start) !== null : content[start] === '"';

const findSqlLiteralStart = (content: string, from: number, ext: string): number => {
	let i = from;
	while (i < content.length) {
		const candidate = content.slice(i).search(/["$@]/);
		if (candidate === -1) return -1;
		i += candidate;
		if (isSqlLiteralStartAt(content, i, ext)) return i;
		i++;
	}
	return -1;
};

// Read one concatenated operand expression, stopping at a top-level +, comma,
// closing delimiter, semicolon or newline.
const readSqlOperand = (content: string, start: number): { value: string; endIndex: number } => {
	let i = start;
	let paren = 0;
	let bracket = 0;
	let brace = 0;
	while (i < content.length) {
		const char = content[i];
		if (char === '"' || char === "'") {
			i = consumeQuotedString(content, i, char);
			continue;
		}
		if (char === "$" || char === "@") {
			const span = csharpStringAt(content, i);
			if (span) {
				i = span.resumeAt;
				continue;
			}
		}
		if (char === "(") paren++;
		else if (char === ")") {
			if (paren === 0) break;
			paren--;
		} else if (char === "[") bracket++;
		else if (char === "]") {
			if (bracket === 0) break;
			bracket--;
		} else if (char === "{") brace++;
		else if (char === "}") {
			if (brace === 0) break;
			brace--;
		} else if (paren === 0 && bracket === 0 && brace === 0) {
			if (char === "+" || char === "," || char === ";" || char === "\n" || char === "\r") break;
		}
		i++;
	}
	return { value: content.slice(start, i).trim(), endIndex: i };
};

const parseConcatChain = (
	content: string,
	startIndex: number,
	ext: string,
): { segments: SqlSegment[]; endIndex: number } | null => {
	let i = startIndex;
	let expectLiteral = true;
	let endIndex = i;
	const segments: SqlSegment[] = [];
	while (i < content.length) {
		if (expectLiteral) {
			const literal = readSqlLiteralAt(content, i, ext);
			if (!literal) break;
			segments.push({ kind: "literal", value: "" });
			for (const range of literal.interpolationRanges) {
				segments.push({ kind: "expr", value: content.slice(range.start, range.end).trim() });
			}
			i = literal.resumeAt;
		} else {
			const operand = readSqlOperand(content, i);
			if (!operand.value) return null;
			segments.push({ kind: "expr", value: operand.value });
			i = operand.endIndex;
		}
		i = skipWhitespace(content, i);
		if (content[i] === "+") {
			i = skipWhitespace(content, i + 1);
			expectLiteral = isSqlLiteralStartAt(content, i, ext);
			continue;
		}
		endIndex = i;
		break;
	}
	return segments.length === 0 ? null : { segments, endIndex };
};

// Java's String.format(...) style: the format literal plus its arguments.
const parseFormatArguments = (
	content: string,
	startIndex: number,
	ext: string,
): { segments: SqlSegment[]; endIndex: number } | null => {
	let i = startIndex;
	let endIndex = i;
	const segments: SqlSegment[] = [];
	while (i < content.length) {
		i = skipWhitespace(content, i);
		if (isSqlLiteralStartAt(content, i, ext)) {
			const literal = readSqlLiteralAt(content, i, ext);
			if (!literal) return null;
			segments.push({ kind: "literal", value: "" });
			i = literal.resumeAt;
		} else {
			const operand = readSqlOperand(content, i);
			if (!operand.value) return null;
			segments.push({ kind: "expr", value: operand.value });
			i = operand.endIndex;
		}
		i = skipWhitespace(content, i);
		if (content[i] === ",") {
			i++;
			continue;
		}
		if (content[i] === ")") {
			endIndex = i + 1;
			break;
		}
		return null;
	}
	return segments.length === 0 ? null : { segments, endIndex };
};

// Parse the SQL argument expression handed to a C#/Java sink: either a
// concatenation chain such as `"... IN (" + placeholders + ")"`, an
// interpolated string such as `$"... IN ({placeholders})"`, or a
// String.format(...) call.
const parseSqlExpression = (
	content: string,
	matchIndex: number,
	ext: string,
): { segments: SqlSegment[]; endIndex: number } | null => {
	const literalStart = findSqlLiteralStart(content, matchIndex, ext);
	if (literalStart === -1) return null;
	const prefix = content.slice(matchIndex, literalStart);
	if (ext === ".java" && /\bString\s*\.\s*format\s*\(\s*$/.test(prefix)) {
		return parseFormatArguments(content, literalStart, ext);
	}
	return parseConcatChain(content, literalStart, ext);
};

const isPlaceholderGeneratorExpression = (
	expression: string,
	content: string,
	matchIndex: number,
	ext: string,
): boolean => {
	const trimmed = expression.trim();
	if (!trimmed) return false;
	if (SQL_PLACEHOLDER_LITERAL_EXPR_RE.test(trimmed)) return true;
	const flavor = ext === ".cs" ? "csharp" : "java";
	if (isInlineGeneratedPlaceholderList(trimmed, flavor)) return true;
	return (
		PLACEHOLDER_EXPR_RE.test(trimmed) &&
		isGeneratedPlaceholderList(content, matchIndex, trimmed, flavor)
	);
};

const isSafeParameterizedSql = (content: string, matchIndex: number, ext: string): boolean => {
	const parsed = parseSqlExpression(content, matchIndex, ext);
	if (!parsed) return false;

	const expressions = parsed.segments.filter((segment) => segment.kind === "expr");
	if (expressions.length === 0) return false;
	if (
		!expressions.every((segment) =>
			isPlaceholderGeneratorExpression(segment.value, content, matchIndex, ext),
		)
	) {
		return false;
	}

	const after = content.slice(parsed.endIndex, Math.min(content.length, parsed.endIndex + 4000));
	return ext === ".cs"
		? CS_PARAMETER_BINDING_RE.test(after)
		: JAVA_PARAMETER_BINDING_RE.test(after);
};

export const detectRiskyConstructs = async (context: EngineContext): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		const ext = path.extname(filePath);

		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const relativePath = relativePosix(context.rootDirectory, filePath);
		const masked = maskStringsAndComments(content, ext);
		const lines = content.split("\n");

		for (const { pattern, extensions, name, message, help } of RISKY_PATTERNS) {
			if (!extensions.includes(ext)) continue;

			const regex = new RegExp(pattern.source, pattern.flags);
			const lineAt = createLineCounter(content);

			for (const match of masked.matchAll(regex)) {
				const line = lineAt(match.index);

				// For innerHTML: skip if target is a <template> element (safe by design)
				if (name === "innerhtml") {
					const beforeMatch = content.slice(Math.max(0, match.index - 200), match.index);
					if (isSafeInnerHtmlAssignment(content, match.index)) continue;
					if (
						/(?:template|tmpl|tpl)$/i.test(beforeMatch.trimEnd()) ||
						/createElement\s*\(\s*['"]template['"]\s*\)$/.test(beforeMatch.trimEnd())
					) {
						continue;
					}
				}

				if (name === "sql-injection") {
					const isSafe =
						ext === ".cs" || ext === ".java"
							? isSafeParameterizedSql(content, match.index, ext)
							: isSafeSqlPlaceholderTemplate(content, match.index);
					if (isSafe) continue;
				}

				if (name === "shell-injection" && isSafeShellSpawnArray(content, match.index)) {
					continue;
				}

				if (name === "dangerously-set-innerhtml") {
					if (hasDangerouslySetInnerHtmlIgnore(lines, line - 1)) continue;
					if (isStructuredDataScript(content, match.index)) continue;
				}

				diagnostics.push({
					filePath: relativePath,
					engine: "security",
					rule: `security/${name}`,
					severity: "error",
					message,
					help,
					line,
					column: 0,
					category: "Security",
					fixable: false,
				});
			}
		}
	}

	return diagnostics;
};

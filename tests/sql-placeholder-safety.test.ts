import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRiskyConstructs } from "../src/engines/security/risky.js";
import type { EngineContext } from "../src/engines/types.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-sql-placeholder-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const scan = async (fileName: string, language: string, source: string): Promise<string[]> => {
	const file = path.join(root, "src", fileName);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, source);
	const context: EngineContext = {
		rootDirectory: root,
		languages: [language],
		frameworks: [],
		files: [file],
		installedTools: {},
		config: {
			quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
			security: { audit: false, auditTimeout: 0 },
		},
	};
	return (await detectRiskyConstructs(context)).map(
		(diagnostic) => `${diagnostic.rule}:${diagnostic.line}`,
	);
};

describe("TypeScript SQL placeholder templates", () => {
	const statements = [
		'const placeholders = ids.map(() => "?").join(", ");',
		"db.query(`SELECT * FROM t WHERE id IN (${placeholders})`, ids);",
	];

	it("accepts a generated placeholder list bound separately", async () => {
		expect(await scan("a.ts", "typescript", statements.join("\n"))).toEqual([]);
	});

	it("accepts placeholder literals interpolated directly", async () => {
		const source = ["db.query(`SELECT * FROM t WHERE a = ${'?'} AND b = ${\"$1\"}`, a, b);"].join(
			"\n",
		);
		expect(await scan("b.ts", "typescript", source)).toEqual([]);
	});

	it("accepts a member call on a generated placeholder list", async () => {
		const source = [
			'const placeholders = ids.map(() => "?").join(",");',
			'db.query(`SELECT * FROM t WHERE id IN (${placeholders.join(",")})`, ids);',
		].join("\n");
		expect(await scan("c.ts", "typescript", source)).toEqual([]);
	});

	it("flags user input interpolated in place of a placeholder", async () => {
		const source = [
			"const values = ids.map((id) => `'${id}'`).join(\", \");",
			"db.query(`SELECT * FROM t WHERE id IN (${values})`, ids);",
		].join("\n");
		expect(await scan("d.ts", "typescript", source)).toEqual(["security/sql-injection:2"]);
	});

	it("flags user input interpolated inline in place of a placeholder", async () => {
		const source = [
			"db.query(`SELECT * FROM t WHERE id IN (${ids.map((id) => `'${id}'`).join(\",\")})`, ids);",
		].join("\n");
		expect(await scan("d2.ts", "typescript", source)).toEqual(["security/sql-injection:1"]);
	});

	it("flags a placeholder template with no separately bound parameters", async () => {
		const source = [
			'const placeholders = ids.map(() => "?").join(", ");',
			"db.query(`SELECT * FROM t WHERE id IN (${placeholders})`);",
		].join("\n");
		expect(await scan("e.ts", "typescript", source)).toEqual(["security/sql-injection:2"]);
	});

	it("does not trust a placeholder declaration beyond the 4000-character lookup window", async () => {
		const source = [
			'const placeholders = ids.map(() => "?").join(",");',
			`// ${"x".repeat(4100)}`,
			"db.query(`SELECT * FROM t WHERE id IN (${placeholders})`, ids);",
		].join("\n");
		expect(await scan("f.ts", "typescript", source)).toEqual(["security/sql-injection:3"]);
	});
});

describe("C# SQL placeholder parameters", () => {
	it("accepts a concatenated placeholder list with SqlParameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void Run(SqlConnection conn, int[] ids) {",
			'    var placeholders = string.Join(",", ids.Select((_, i) => "@p" + i));',
			'    using var cmd = new SqlCommand("SELECT * FROM t WHERE id IN (" + placeholders + ")", conn);',
			'    cmd.Parameters.AddWithValue("@p0", ids[0]);',
			"  }",
			"}",
		].join("\n");
		expect(await scan("A.cs", "csharp", source)).toEqual([]);
	});

	it("accepts an interpolated placeholder list with SqlParameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void Run(SqlConnection conn, int[] ids) {",
			'    var placeholders = string.Join(",", ids.Select((_, i) => $"@p{i}"));',
			'    using var cmd = new SqlCommand($"SELECT * FROM t WHERE id IN ({placeholders})", conn);',
			'    cmd.Parameters.AddRange(new[] { new SqlParameter("@p0", ids[0]) });',
			"  }",
			"}",
		].join("\n");
		expect(await scan("B.cs", "csharp", source)).toEqual([]);
	});

	it("flags user input concatenated into the query", async () => {
		const source = [
			"class Repo {",
			"  void Run(SqlConnection conn, string name) {",
			'    using var cmd = new SqlCommand("SELECT * FROM t WHERE name = \'" + name + "\'", conn);',
			'    cmd.Parameters.AddWithValue("@p0", name);',
			"  }",
			"}",
		].join("\n");
		expect(await scan("C.cs", "csharp", source)).toEqual(["security/sql-injection:3"]);
	});

	it("flags a placeholder list without parameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void Run(SqlConnection conn, int[] ids) {",
			'    var placeholders = string.Join(",", ids.Select((_, i) => "@p" + i));',
			'    using var cmd = new SqlCommand("SELECT * FROM t WHERE id IN (" + placeholders + ")", conn);',
			"  }",
			"}",
		].join("\n");
		expect(await scan("D.cs", "csharp", source)).toEqual(["security/sql-injection:4"]);
	});

	it("accepts a verbatim interpolated query with later SqlParameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void Run(SqlCommand cmd, int[] ids) {",
			'    var placeholders = string.Join(",", ids.Select((_, i) => $"@p{i}"));',
			'    cmd.CommandText = $@"SELECT * FROM t WHERE id IN ({placeholders})";',
			'    cmd.Parameters.Add(new SqlParameter("@p0", ids[0]));',
			"  }",
			"}",
		].join("\n");
		expect(await scan("E.cs", "csharp", source)).toEqual([]);
	});
});

describe("Java SQL placeholder parameters", () => {
	it("accepts a concatenated placeholder list with setX bindings", async () => {
		const source = [
			"class Repo {",
			"  void run(Connection c, int[] ids) throws Exception {",
			'    String placeholders = String.join(",", Collections.nCopies(ids.length, "?"));',
			'    var ps = c.prepareStatement("SELECT * FROM t WHERE id IN (" + placeholders + ")");',
			"    ps.setString(1, ids[0]);",
			"  }",
			"}",
		].join("\n");
		expect(await scan("Repo.java", "java", source)).toEqual([]);
	});

	it("accepts String.format placeholder lists with setParameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void run(EntityManager em, int[] ids) {",
			'    String placeholders = String.join(",", Collections.nCopies(ids.length, "?"));',
			'    em.createQuery(String.format("FROM User WHERE id IN (%s)", placeholders))',
			"      .setParameter(1, ids[0]);",
			"  }",
			"}",
		].join("\n");
		expect(await scan("Repo2.java", "java", source)).toEqual([]);
	});

	it("flags a user value formatted into the query", async () => {
		const source = [
			"class Repo {",
			'  void b(Connection c, String n) { c.prepareStatement(String.format("DELETE FROM %s", n)); }',
			"}",
		].join("\n");
		expect(await scan("Repo3.java", "java", source)).toEqual(["security/sql-injection:2"]);
	});

	it("flags a placeholder list without parameter bindings", async () => {
		const source = [
			"class Repo {",
			"  void run(Connection c, int[] ids) throws Exception {",
			'    String placeholders = String.join(",", Collections.nCopies(ids.length, "?"));',
			'    c.prepareStatement("SELECT * FROM t WHERE id IN (" + placeholders + ")");',
			"  }",
			"}",
		].join("\n");
		expect(await scan("Repo4.java", "java", source)).toEqual(["security/sql-injection:4"]);
	});

	it("accepts bindings on a later line of the same statement", async () => {
		const source = [
			"class Repo {",
			"  void run(Connection c, int[] ids) throws Exception {",
			'    String placeholders = String.join(",", Collections.nCopies(ids.length, "?"));',
			'    var ps = c.prepareStatement("SELECT * FROM t WHERE id IN (" + placeholders + ")");',
			"    ps",
			"      .setObject(1, ids[0]);",
			"  }",
			"}",
		].join("\n");
		expect(await scan("Repo5.java", "java", source)).toEqual([]);
	});
});

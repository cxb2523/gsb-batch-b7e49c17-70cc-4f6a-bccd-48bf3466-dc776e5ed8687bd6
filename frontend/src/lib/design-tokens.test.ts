import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function getSourceFiles(dir: string, baseDir: string = dir): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getSourceFiles(fullPath, baseDir));
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.spec.')
    ) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }

  return results;
}

describe('Design Tokens Enforcement', () => {
  const srcDir = path.resolve(__dirname, '..');
  const tailwindConfigFile = path.resolve(srcDir, '../tailwind.config.js');
  const indexCssFile = path.resolve(srcDir, 'index.css');

  it('contains zero arbitrary hex classes or inline hex styles anywhere in the app', () => {
    const sourceFiles = getSourceFiles(srcDir);
    const hexRegex = /\[#[0-9a-fA-F]{3,8}\]|style=\{\{[^}]*#[0-9a-fA-F]{3,8}[^}]*\}\}/g;
    const violations: { file: string; count: number; matches: string[] }[] = [];

    for (const relPath of sourceFiles) {
      const content = fs.readFileSync(path.join(srcDir, relPath), 'utf-8');
      const matches = content.match(hexRegex);

      if (matches && matches.length > 0) {
        violations.push({ file: relPath, count: matches.length, matches: matches.slice(0, 5) });
      }
    }

    expect(
      violations,
      `Found arbitrary hexes:\n${violations
        .map((v) => `  ${v.file}: ${v.count} arbitrary hexes (e.g. ${v.matches.join(', ')})`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('puts nothing on window or globalThis: no handle that exists only for tests, under any name', () => {
    const assignsGlobal = /\b(?:window|globalThis)\.[A-Za-z_$][\w$]*\s*=(?!=)/;
    const offenders = getSourceFiles(srcDir).filter((relPath) =>
      assignsGlobal.test(fs.readFileSync(path.join(srcDir, relPath), 'utf-8')),
    );

    expect(offenders).toEqual([]);
  });

  it('only uses colour opacity steps Tailwind generates, and never glues two classes together', () => {
    const generatedSteps = new Set([0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100]);
    const opacityClass =
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-[a-z][a-z0-9-]*\/(\d+)\b/g;
    const gluedClasses = /\b[a-z][a-z0-9-]*\/\d+[a-z]/;
    const problems: string[] = [];

    for (const relPath of getSourceFiles(srcDir)) {
      const content = fs.readFileSync(path.join(srcDir, relPath), 'utf-8');
      for (const [match, step] of content.matchAll(opacityClass)) {
        if (!generatedSteps.has(Number(step)))
          problems.push(`${relPath}: ${match} is not generated`);
      }
      if (gluedClasses.test(content)) problems.push(`${relPath}: two classes run together`);
    }

    expect(problems).toEqual([]);
  });

  it('contains zero dark: utility classes, .dark selectors, or darkMode configuration', () => {
    // 1. Check tailwind.config.js
    if (fs.existsSync(tailwindConfigFile)) {
      const configContent = fs.readFileSync(tailwindConfigFile, 'utf-8');
      expect(configContent).not.toContain('darkMode');
    }

    // 2. Check index.css
    if (fs.existsSync(indexCssFile)) {
      const cssContent = fs.readFileSync(indexCssFile, 'utf-8');
      expect(cssContent).not.toContain('.dark');
      expect(cssContent).not.toContain('dark:');
    }

    // 3. Check all source files for dark: classes
    const sourceFiles = getSourceFiles(srcDir);
    const darkClasses: { file: string; count: number }[] = [];

    for (const relPath of sourceFiles) {
      const fullPath = path.join(srcDir, relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const matches = content.match(/\bdark:[a-zA-Z0-9_\-[\]/]+/g);
      if (matches && matches.length > 0) {
        darkClasses.push({ file: relPath, count: matches.length });
      }
    }

    expect(
      darkClasses,
      `Found dark: classes in source files:\n${darkClasses
        .map((d) => `  ${d.file}: ${d.count}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('enforces light-only theme="light" and toggleTheme: false on both canvas pages', () => {
    const canvasPages = ['features/boards/components/BoardEditor.tsx', 'pages/PublicBoardView.tsx'];

    for (const relPath of canvasPages) {
      const fullPath = path.join(srcDir, relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Check theme="light"
      expect(
        content.includes('theme="light"'),
        `Expected ${relPath} to specify theme="light" on Excalidraw component`,
      ).toBe(true);

      // Check toggleTheme: false
      expect(
        content.includes('toggleTheme: false'),
        `Expected ${relPath} to specify toggleTheme: false in UIOptions.canvasActions`,
      ).toBe(true);

      // Must not allow toggleTheme: true
      expect(
        content.includes('toggleTheme: true'),
        `Expected ${relPath} not to contain toggleTheme: true`,
      ).toBe(false);
    }
  });
});

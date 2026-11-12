// Defensive-context classification.
//
// SkillHawk's rule engine is intentionally line-oriented and regex based, so a
// dangerous command quoted inside security documentation (a counter-example, a
// negated instruction, a rule description) produces the same finding as a
// command the agent is actually told to run.
//
// This module decides, for a single scanned line, whether the match lives in a
// *defensive* context. The decision is deliberately explainable: every positive
// answer carries the category and the marker phrase that motivated it, which is
// surfaced in every output format so a human reviewer can audit the call.
//
// The scanner never executes scanned content; this is pure text classification.

// Markers that describe a dangerous pattern rather than instruct the agent to
// perform it. Each entry is [category, human-readable reason, RegExp].
const DEFENSIVE_MARKERS = [
  [
    'negation',
    'the line prohibits or negates the action rather than requesting it',
    /\b(?:do\s+not|don'?t|never|must\s+not|mustn'?t|should\s+not|shouldn'?t|ought\s+not|cannot|can'?t|won'?t|avoid|refuse\s+to|stop\s+using|no\s+longer)\b/i,
  ],
  [
    'counter-example',
    'the pattern is quoted as a counter-example or an explicitly bad practice',
    /\b(?:counter[- ]?example|bad\s+example|anti[- ]?pattern|bad\s+practice|unsafe\s+example|insecure\s+example|malicious\s+example|example\s+of\s+(?:a\s+)?(?:unsafe|insecure|dangerous|malicious)|do\s+the\s+opposite|what\s+not\s+to\s+do)\b/i,
  ],
  [
    'security-rule',
    'the line states a security rule, policy or warning that mentions the pattern',
    /\b(?:security\s+rule|safety\s+rule|security\s+policy|forbidden|prohibited|not\s+allowed|disallowed|rule:\s*never|warning:|caution:|reject\s+any\s+instruction|reviewer\s+should\s+reject|never\s+(?:run|execute|pipe|use|install|read|disclose|print|expose))\b/i,
  ],
  [
    'illustration',
    'the pattern is introduced only as an illustration, not as work to perform',
    /\b(?:for\s+example|for\s+instance|e\.?g\.?|such\s+as|illustrates?\s+(?:a\s+)?(?:dangerous|unsafe|risky|insecure)|demonstrates?\s+(?:a\s+)?(?:dangerous|unsafe|risky|insecure))\b/i,
  ],
  [
    'chinese-defensive',
    '中文行内出现禁止、否定或安全规则表述，危险命令仅作为说明样例',
    /(?:不要|请勿|禁止|严禁|绝不能|不应|不可|不得|避免|切勿|永远不要|反例|负面示例|错误示例|坏例子|安全规则|安全策略|不允许|违规)/,
  ],
];

// Markers showing the line genuinely instructs the agent to perform work.
// When one of these coexists with a defensive phrase, the line is treated as a
// real execution instruction (execution intent wins over defensive framing).
const EXECUTION_MARKERS = [
  /\b(?:run|execute|exec|invoke|install|apply|launch|start|call|perform|carry\s+out)\b[^.!?\n]{0,120}(?:command|script|instruction|installer|payload|following|below|this)/i,
  /\b(?:run|execute|exec|invoke|install|apply|launch|start|call)\s+(?:the\s+)?(?:following|below|this)\b/i,
  /\b(?:then|next|after\s+that|now)[^.!?\n]{0,60}\b(?:run|execute|exec|invoke|install|apply|launch)\b/i,
  /\bplease\s+(?:run|execute|install|invoke|apply|launch|call)\b/i,
  // Chinese imperative forms. Negated variants are filtered out beforehand by
  // CHINESE_NEGATED_EXECUTION in hasChineseExecutionInstruction.
  /(?:请|立即|马上|现在|接下来|然后)[^。；\n]{0,20}(?:运行|执行|运行一下|安装|调用)/,
  /(?:运行|执行|安装|调用)[^。；\n]{0,20}(?:以下|下面|这条|该)?\s*(?:命令|脚本|指令)/,
];

// Negated Chinese imperatives such as "请勿执行" / "不要运行" — these are
// defensive even though they contain an execution verb.
const CHINESE_NEGATED_EXECUTION =
  /(?:请勿|不要|切勿|禁止|严禁|不应|不得|不可|避免)[^。；\n]{0,8}(?:运行|执行|运行一下|安装|调用)/;

const ENGLISH_NEGATION_WORDS =
  /\b(?:do\s+not|don'?t|never|must\s+not|mustn'?t|should\s+not|shouldn'?t|avoid|refuse\s+to)\b/i;

// Split a line into clauses at contrast/separator punctuation so a negation in
// one clause cannot cancel an explicit imperative in another clause
// (e.g. "Do not run X, but run the following command: ...").
const CLAUSE_SPLIT = /\s+(?:but|however|instead)\b|[;—–]|,/i;

function hasChineseExecutionInstruction(line) {
  if (CHINESE_NEGATED_EXECUTION.test(line)) return false;
  return EXECUTION_MARKERS.slice(4).some((pattern) => pattern.test(line));
}

function findDefensiveMarker(line) {
  for (const [category, reason, pattern] of DEFENSIVE_MARKERS) {
    if (pattern.test(line)) return { category, reason, marker: line.match(pattern)[0] };
  }
  return null;
}

function hasExecutionInstruction(line) {
  // Chinese imperatives have their own negation handling.
  if (hasChineseExecutionInstruction(line)) return true;

  const englishMarkers = EXECUTION_MARKERS.slice(0, 4);
  const clauses = line.split(CLAUSE_SPLIT);
  // An execution marker only counts as an instruction when its own clause is
  // not negated. A fully negated line therefore stays defensive, while a later
  // non-negated imperative ("but run the following command") still wins.
  return clauses.some((clause) => {
    if (!englishMarkers.some((pattern) => pattern.test(clause))) return false;
    return !ENGLISH_NEGATION_WORDS.test(clause);
  });
}

/**
 * Classify the context of a rule match within one scanned line.
 *
 * @param {string} rawLine The full line of scanned text (not trimmed).
 * @param {string} [previousLine] The preceding line of the same document, used
 *   only when the matched line itself is a bare command (no prose at all) whose
 *   defensive framing lives on the line above.
 * @returns {{defensive: boolean, defensiveReason: (string|null)}}
 *   defensive is true only when a defensive marker is present AND the line
 *   does not also direct the agent to actually execute the command.
 */
export function classifyLineContext(rawLine, previousLine = '') {
  const line = String(rawLine ?? '');
  const marker = findDefensiveMarker(line);
  if (marker) {
    if (hasExecutionInstruction(line)) {
      return { defensive: false, defensiveReason: null };
    }
    return {
      defensive: true,
      defensiveReason: `${marker.category}: ${marker.reason} (matched "${marker.marker.trim()}")`,
    };
  }

  // A bare command line (no prose, typically inside quotes or a code fence)
  // inherits defensive framing from the immediately preceding line when that
  // line explicitly introduces it as forbidden or illustrative prose. It must
  // not inherit when the current line itself carries execution intent.
  const previous = String(previousLine ?? '');
  if (previous && isBareCommandLine(line)
      && !hasExecutionInstruction(line) && !hasExecutionInstruction(previous)) {
    const previousMarker = findDefensiveMarker(previous);
    if (previousMarker) {
      return {
        defensive: true,
        defensiveReason: `${previousMarker.category}: introduced by the previous line as documentation rather than an instruction (matched "${previousMarker.marker.trim()}")`,
      };
    }
  }

  return { defensive: false, defensiveReason: null };
}

// A "bare command" line contains essentially only the command itself, possibly
// wrapped in quote/fence characters or list punctuation — no explanatory prose.
function isBareCommandLine(line) {
  const stripped = line.trim().replace(/^[>*\-\d.)\s]+|[\s`*_]+$/g, '');
  const wordCount = stripped.split(/\s+/).filter(Boolean).length;
  return wordCount > 0 && wordCount <= 12 && !/[.!?。；;]$/.test(stripped);
}

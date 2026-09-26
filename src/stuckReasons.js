// Why a problem got you stuck. The single source of truth: the server validates
// saved reflections against it and the page loads it from GET /api/stuck-reasons.
// Keys are stored in the database, so never rename a key; change only labels.
export const STUCK_REASON_GROUPS = [
  {
    group: "Reading the problem",
    reasons: [
      { key: "misread", label: "Misread or misunderstood the statement" },
      { key: "constraints", label: "Didn't read the constraints closely" },
      { key: "missed-condition", label: "Missed a condition or detail in the statement" },
      { key: "io-format", label: "Misread the input/output format" },
      { key: "samples", label: "Misunderstood the sample tests" },
      { key: "long-statement", label: "Long statement, lost track of what was asked" }
    ]
  },
  {
    group: "Finding the idea",
    reasons: [
      { key: "key-observation", label: "Couldn't find the key observation" },
      { key: "invariant", label: "Missed an invariant or monotonic property" },
      { key: "reformulate", label: "Didn't reformulate or simplify the problem" },
      { key: "known-pattern", label: "Didn't recognise a known pattern" },
      { key: "math-insight", label: "Missing a math / number theory insight" },
      { key: "counting", label: "Couldn't count it (combinatorics)" },
      { key: "greedy-proof", label: "Couldn't prove or trust the greedy" },
      { key: "small-cases", label: "Didn't try small cases or brute force first" },
      { key: "overthinking", label: "Overthought or overcomplicated it" },
      { key: "underestimated", label: "Underestimated it, assumed too simple" }
    ]
  },
  {
    group: "Choosing the approach",
    reasons: [
      { key: "wrong-technique", label: "Picked the wrong technique" },
      { key: "unknown-technique", label: "Didn't know the technique or data structure" },
      { key: "dp-state", label: "Couldn't define the DP state or transition" },
      { key: "graph-model", label: "Didn't see it as a graph problem" },
      { key: "binary-search", label: "Didn't see binary search (on the answer)" },
      { key: "two-pointers", label: "Didn't see two pointers / sliding window" },
      { key: "prefix-sums", label: "Didn't see prefix sums / difference arrays" },
      { key: "bitmask", label: "Missed a bitwise / XOR insight" },
      { key: "construction", label: "Couldn't find the construction" },
      { key: "interactive", label: "Interactive protocol or query limit" }
    ]
  },
  {
    group: "Complexity",
    reasons: [
      { key: "tle", label: "Too slow: wrong time complexity (TLE)" },
      { key: "constant-factor", label: "Too slow: constant factor or I/O" },
      { key: "mle", label: "Memory limit exceeded" },
      { key: "recursion", label: "Recursion depth / stack overflow" }
    ]
  },
  {
    group: "Implementation",
    reasons: [
      { key: "edge-cases", label: "Missed edge cases" },
      { key: "off-by-one", label: "Off-by-one or indexing errors" },
      { key: "overflow", label: "Integer overflow or precision" },
      { key: "bugs", label: "Implementation bugs" },
      { key: "multitest-reset", label: "Forgot to reset between test cases" },
      { key: "messy-code", label: "Implementation too long or messy" },
      { key: "output-format", label: "Output format mistakes" }
    ]
  },
  {
    group: "Testing & debugging",
    reasons: [
      { key: "no-counterexample", label: "Wrong answer, couldn't find a counterexample" },
      { key: "insufficient-testing", label: "Didn't test enough before submitting" }
    ]
  },
  {
    group: "Mindset",
    reasons: [
      { key: "intimidated", label: "Intimidated by the problem" },
      { key: "time-pressure", label: "Time pressure or panic" },
      { key: "gave-up-early", label: "Gave up or opened the editorial too early" },
      { key: "focus", label: "Tired or lost focus" }
    ]
  },
  {
    group: "Other",
    reasons: [
      { key: "not-stuck", label: "Wasn't really stuck" },
      { key: "other", label: "Something else" }
    ]
  }
];

export const STUCK_REASON_KEYS = new Set(
  STUCK_REASON_GROUPS.flatMap(g => g.reasons.map(r => r.key))
);

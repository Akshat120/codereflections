// The sample journal written by `npm run seed` (scripts/seed.js), so a fresh
// local checkout has something to look at: reflections spread over the last
// few weeks, some reviewed, a small practice queue and a few blog entries.
//
// Problem names, ratings and tags are the real Codeforces ones; the
// reflections are short illustrative notes. Dates are relative (`daysAgo`), so
// the journal looks recent whenever it is seeded.
//
// Each reflection: the problem, when it was solved (`daysAgo`), how long it
// took (`minutes`), a `stuckReason` key from src/stuckReasons.js, the grades
// of the reviews done since (each given on the day it fell due), the four text
// answers, and `code`, which becomes the "simplest implementation" answer.
const raw = String.raw;

export const REFLECTIONS = [
  {
    problem: "1904A", name: "Forked!", rating: 900,
    tags: ["brute force", "implementation"],
    daysAgo: 38, minutes: 14, stuckReason: "misread",
    reviews: ["remembered", "remembered", "remembered", "remembered"],
    keyObservation: "A square forks both pieces only if it is one knight move from the king **and** one from the queen. So generate the (at most 8) squares around each and count the common ones.",
    whatMadeMeStuck: raw`Missed that when $a = b$ the 8 moves collapse to 4, so I counted the same square twice.`,
    pattern: "Tiny search space: enumerate candidates from both sides and intersect.",
    futureTrigger: "\"Count positions that satisfy two local conditions\" with constant-size neighbourhoods: just enumerate, and deduplicate with a set.",
    code: raw`set<pair<int,int>> around(int x, int y, int a, int b) {
    set<pair<int,int>> s;
    for (int dx : {-1, 1}) for (int dy : {-1, 1}) {
        s.insert({x + dx * a, y + dy * b});
        s.insert({x + dx * b, y + dy * a});
    }
    return s;
}
// answer = number of squares in both around(king) and around(queen)`
  },
  {
    problem: "1904B", name: "Collecting Game", rating: 1100,
    tags: ["binary search", "dp", "greedy", "sortings", "two pointers"],
    daysAgo: 36, minutes: 31, stuckReason: "prefix-sums",
    reviews: ["remembered", "forgot", "remembered", "remembered", "remembered"],
    keyObservation: raw`Sort the array. Starting from position $i$ you own the whole prefix, so your score is $pre_i$. You can take $i+1$ exactly when $pre_i \ge a_{i+1}$, and then you are in the same situation as starting from $i+1$.`,
    whatMadeMeStuck: "Tried to simulate each start separately with a pointer, which is quadratic on a strictly growing array.",
    pattern: "Sort + prefix sums, then fill the answers from right to left.",
    futureTrigger: "\"From each start, how far can a growing sum reach?\" Answers of neighbours are linked: reuse the one to the right.",
    code: raw`sort(idx.begin(), idx.end(), [&](int x, int y) { return a[x] < a[y]; });
// pre[i] = sum of the i + 1 smallest values
reach[n - 1] = n - 1;
for (int i = n - 2; i >= 0; i--)
    reach[i] = pre[i] >= a[idx[i + 1]] ? reach[i + 1] : i;
// answer for idx[i] is reach[i]`
  },
  {
    problem: "1635C", name: "Differential Sorting", rating: 1200,
    tags: ["constructive algorithms", "greedy"],
    daysAgo: 33, minutes: 47, stuckReason: "constraints",
    reviews: ["hard", "remembered", "remembered", "remembered", "remembered"],
    keyObservation: raw`The last two elements can never change. If $a_{n-1} > a_n$ it is impossible. If $a_n \ge 0$, set every earlier element to $a_{n-1} - a_n \le a_{n-1}$. If $a_n < 0$ no operation can help, so the array must already be sorted.`,
    whatMadeMeStuck: "Did not read that the number of operations only has to be at most n, not minimal. Spent 20 minutes minimising.",
    pattern: "Constructive: find the elements that cannot move and build everything from them.",
    futureTrigger: "\"You do not have to minimise the number of operations\": look for one uniform operation applied everywhere.",
    code: raw`if (a[n - 2] > a[n - 1]) { cout << -1 << "\n"; continue; }
if (a[n - 1] < 0) {
    cout << (is_sorted(a.begin(), a.end()) ? 0 : -1) << "\n";
    continue;
}
cout << n - 2 << "\n";
for (int i = 1; i <= n - 2; i++)
    cout << i << " " << n - 1 << " " << n << "\n";`
  },
  {
    problem: "1541B", name: "Pleasant Pairs", rating: 1200,
    tags: ["brute force", "implementation", "math", "number theory"],
    daysAgo: 30, minutes: 52, stuckReason: "tle",
    reviews: ["remembered", "remembered", "remembered", "remembered"],
    keyObservation: raw`$a_i \cdot a_j = i + j$ means $i + j$ is a multiple of $a_i$. For a fixed $i$ only every $a_i$-th index $j$ can work, and since the values are distinct the total work is $\sum n / a_i = O(n \log n)$.`,
    whatMadeMeStuck: raw`Wrote the $O(n^2)$ loop first and got TLE; then worried the stepping loop was also quadratic until I used that the $a_i$ are distinct.`,
    pattern: "Harmonic-sum enumeration over multiples.",
    futureTrigger: "A product equal to something small (here at most 2n), with distinct values: iterate over multiples.",
    code: raw`long long count = 0;
for (int i = 1; i <= n; i++) {
    for (int j = a[i] - i % a[i]; j <= n; j += a[i])
        if (j > i && 1LL * a[i] * a[j] == i + j) count++;
}`
  },
  {
    problem: "1352C", name: "K-th Not Divisible by n", rating: 1200,
    tags: ["binary search", "math"],
    daysAgo: 27, minutes: 22, stuckReason: "math-insight",
    reviews: ["remembered", "remembered", "remembered", "remembered"],
    keyObservation: raw`The numbers come in blocks of $n - 1$ good ones followed by one multiple of $n$. Before the $k$-th good number, $\lfloor (k-1)/(n-1) \rfloor$ multiples were skipped.`,
    whatMadeMeStuck: "Started writing a binary search on the answer before noticing there is a closed form.",
    pattern: "Count what is skipped, add it to the index.",
    futureTrigger: "\"k-th number not having a periodic property\": work out one period by hand first.",
    code: raw`cout << k + (k - 1) / (n - 1) << "\n";`
  },
  {
    problem: "1520D", name: "Same Differences", rating: 1200,
    tags: ["data structures", "hashing", "math"],
    daysAgo: 24, minutes: 35, stuckReason: "reformulate",
    reviews: ["forgot", "remembered", "remembered", "remembered"],
    keyObservation: raw`$a_j - a_i = j - i \iff a_j - j = a_i - i$. Each index gets the key $a_i - i$ and the answer is the number of pairs with equal keys.`,
    whatMadeMeStuck: "Kept thinking about pairs. The condition mixes i and j until you move each index to its own side.",
    pattern: "Separate the variables, then count equal keys with a map.",
    futureTrigger: "A pair condition where i-terms and j-terms can be moved to opposite sides of the equation.",
    code: raw`map<int, long long> seen;
long long pairs = 0;
for (int i = 0; i < n; i++) pairs += seen[a[i] - i]++;`
  },
  {
    problem: "1399C", name: "Boats Competition", rating: 1200,
    tags: ["brute force", "greedy", "two pointers"],
    daysAgo: 21, minutes: 41, stuckReason: "constraints",
    reviews: ["remembered", "remembered", "remembered"],
    keyObservation: raw`$n \le 50$ and $w_i \le n$, so the team weight $s$ is at most $2n$. Try every $s$ and count the pairs greedily from the weight frequencies.`,
    whatMadeMeStuck: "Looked for a clever way to pick s. The constraints say: try all of them.",
    pattern: "Brute force over the answer parameter, with a frequency array.",
    futureTrigger: "Constraints of 50 or 100: the intended solution is probably cubic. Read the limits before thinking.",
    code: raw`int best = 0;
for (int s = 2; s <= 2 * n; s++) {
    int teams = 0;
    for (int x = 1; x < s - x; x++)
        if (s - x <= n) teams += min(cnt[x], cnt[s - x]);
    if (s % 2 == 0) teams += cnt[s / 2] / 2;
    best = max(best, teams);
}`
  },
  {
    problem: "1372C", name: "Omkar and Baseball", rating: 1500,
    tags: ["constructive algorithms", "math"],
    daysAgo: 18, minutes: 58, stuckReason: "small-cases",
    reviews: ["hard", "remembered", "remembered"],
    keyObservation: "The answer is only ever 0, 1 or 2. Zero if sorted. One if, after cutting off the already-correct prefix and suffix, no element in the middle is in its place. Otherwise two (first derange everything, then sort).",
    whatMadeMeStuck: "Did not try small permutations by hand, so I never saw that two special exchanges always suffice.",
    pattern: "Bounded answer: prove a small upper bound, then classify the cases.",
    futureTrigger: "A powerful operation and \"minimum number of operations\": suspect the answer is at most 2 or 3.",
    code: raw`int l = 0, r = n - 1;
while (l < n && a[l] == l + 1) l++;
while (r >= 0 && a[r] == r + 1) r--;
if (l > r) { cout << 0 << "\n"; continue; }
bool fixedInside = false;
for (int i = l; i <= r; i++) fixedInside |= a[i] == i + 1;
cout << (fixedInside ? 2 : 1) << "\n";`
  },
  {
    problem: "1436C", name: "Binary Search", rating: 1500,
    tags: ["binary search", "combinatorics"],
    daysAgo: 15, minutes: 73, stuckReason: "binary-search",
    reviews: ["forgot", "remembered", "remembered", "hard"],
    keyObservation: raw`The positions the search looks at depend only on $n$ and $pos$, not on the values. Simulate it: every probe left of $pos$ needs a smaller value, every probe right of it a larger one. Then count: choose and arrange the smaller ones, the larger ones, and permute the rest.`,
    whatMadeMeStuck: "Tried to reason about which permutations are \"sorted enough\" instead of running the given code on indices.",
    pattern: "Simulate the algorithm on positions, turn each comparison into a constraint, count arrangements.",
    futureTrigger: "\"For how many inputs does this code give the right answer?\" Follow the code path, not the inputs.",
    code: raw`int less = 0, greater = 0, l = 0, r = n;
while (l < r) {
    int mid = (l + r) / 2;
    if (mid <= pos) { if (mid != pos) less++; l = mid + 1; }
    else { greater++; r = mid; }
}
// answer = A(x - 1, less) * A(n - x, greater) * (n - 1 - less - greater)!  (mod 1e9 + 7)`
  },
  {
    problem: "1420C1", name: "Pokémon Army (easy version)", rating: 1300,
    tags: ["constructive algorithms", "dp", "greedy"],
    daysAgo: 12, minutes: 39, stuckReason: "greedy-proof",
    reviews: ["remembered", "remembered", "remembered"],
    keyObservation: raw`The best alternating sum takes every local maximum with $+$ and every local minimum between them with $-$. Equivalently, with $a_{n+1} = 0$, it is $\sum \max(0, a_i - a_{i+1})$.`,
    whatMadeMeStuck: "Had the peaks-and-valleys idea early but did not trust it without a proof, and wrote the two-state DP to check.",
    pattern: "Alternating sum: peaks minus valleys (or DP on the parity of the picked count).",
    futureTrigger: "\"Maximum alternating sum of a subsequence\".",
    code: raw`long long best = 0;
a.push_back(0);
for (int i = 0; i < n; i++) best += max(0LL, a[i] - a[i + 1]);`
  },
  {
    problem: "1486B", name: "Eastern Exhibition", rating: 1500,
    tags: ["binary search", "geometry", "shortest paths", "sortings"],
    daysAgo: 9, minutes: 44, stuckReason: "key-observation",
    reviews: ["remembered", "remembered"],
    keyObservation: raw`Manhattan distance splits into an $x$ part and a $y$ part, so the two axes are independent. On one axis the best points are the medians: one point when $n$ is odd, the whole segment between the two middle values when $n$ is even.`,
    whatMadeMeStuck: "Was thinking about the plane as a whole (the tags even say geometry) instead of one axis at a time.",
    pattern: "Sum of absolute differences is minimised at the median; Manhattan distance separates by axis.",
    futureTrigger: raw`Minimise $\sum |x - x_i| + |y - y_i|$: solve each coordinate alone and multiply the counts.`,
    code: raw`sort(x.begin(), x.end());
sort(y.begin(), y.end());
long long ways = 1;
if (n % 2 == 0)
    ways = (x[n / 2] - x[n / 2 - 1] + 1LL) * (y[n / 2] - y[n / 2 - 1] + 1LL);`
  },
  {
    problem: "1513C", name: "Add One", rating: 1600,
    tags: ["dp", "matrices"],
    daysAgo: 7, minutes: 86, stuckReason: "dp-state",
    reviews: ["remembered"],
    keyObservation: raw`Digits evolve independently. Let $dp_i$ be the length of the string that starts as "10" after $i$ operations: $dp_i = dp_{i-9} + dp_{i-10}$. A digit $d$ turns into "10" after $10 - d$ operations, so its length after $m$ operations is $1$ if $m < 10 - d$ and $dp_{m - (10 - d)}$ otherwise.`,
    whatMadeMeStuck: raw`My first state was (digit, operations left), which is right but I recomputed it per test. With $t = 2 \cdot 10^5$ it has to be precomputed once.`,
    pattern: "Independent pieces with a shared precomputed DP over the number of operations.",
    futureTrigger: "Each element splits into more elements of the same kind over time: one DP indexed by time, shared by all tests.",
    code: raw`const int M = 200005, MOD = 1e9 + 7;
int dp[M];
// once, before reading the tests
for (int i = 0; i < 9; i++) dp[i] = 2;
dp[9] = 3;
for (int i = 10; i < M; i++) dp[i] = (dp[i - 9] + dp[i - 10]) % MOD;

// per test: for each digit d of n
total += m < 10 - d ? 1 : dp[m - (10 - d)];`
  },
  {
    problem: "1672D", name: "Cyclic Rotation", rating: 1700,
    tags: ["constructive algorithms", "greedy", "implementation", "two pointers"],
    daysAgo: 5, minutes: 64, stuckReason: "invariant",
    reviews: ["remembered", "remembered"],
    keyObservation: "An operation takes an element and puts it right next to a later equal element. Read b backwards: an element equal to its right neighbour may have been moved there, so it can be \"banked\" and used later to match an element of a that is missing in between.",
    whatMadeMeStuck: "Simulated the operation forwards and could not find what stays the same. Going from the end makes each decision forced.",
    pattern: "Reverse the process; two pointers from the back with a counter of spare elements.",
    futureTrigger: "An operation that only moves elements next to an equal one: match the arrays from the end, keeping a multiset of spares.",
    code: raw`map<int, int> spare;
bool ok = true;
int j = n - 1;
for (int i = n - 1; i >= 0 && ok; i--) {
    while (j >= 0 && j + 1 < n && b[j] == b[j + 1]) spare[b[j--]]++;
    if (j >= 0 && a[i] == b[j]) j--;
    else if (spare[a[i]] > 0) spare[a[i]]--;
    else ok = false;
}`
  },
  {
    problem: "1343C", name: "Alternating Subsequence", rating: 1200,
    tags: ["dp", "greedy", "two pointers"],
    daysAgo: 3, minutes: 19, stuckReason: "edge-cases",
    reviews: ["remembered"],
    keyObservation: "The longest alternating subsequence takes exactly one element from every maximal block of equal sign. To maximise the sum, take the largest element of each block.",
    whatMadeMeStuck: "Initialised the block maximum with 0, which is wrong for blocks of negative numbers.",
    pattern: "Split into maximal blocks, pick one representative per block.",
    futureTrigger: "\"Maximum length first, then maximum sum\": the length fixes the structure, the sum is a choice inside each group.",
    code: raw`long long sum = 0;
for (int i = 0; i < n; ) {
    int j = i;
    long long best = a[i];
    while (j < n && (a[j] > 0) == (a[i] > 0)) best = max(best, a[j++]);
    sum += best;
    i = j;
}`
  },
  {
    problem: "1367C", name: "Social Distance", rating: 1300,
    tags: ["constructive algorithms", "greedy", "math"],
    daysAgo: 2, minutes: 33, stuckReason: "off-by-one",
    reviews: [],
    keyObservation: raw`Scan left to right and sit someone at a free table whenever the previous occupied table is more than $k$ behind and the next original one is more than $k$ ahead. Taking the leftmost legal table never hurts.`,
    whatMadeMeStuck: raw`"Distance strictly greater than $k$" against "at least $k$": had $\ge$ where it needed $>$ and failed sample 3.`,
    pattern: "Greedy leftmost placement with the last occupied position.",
    futureTrigger: "Placing as many items as possible with a minimum gap on a line.",
    code: raw`// nxt[i] = position of the next '1' at or after i (a large value if none)
int added = 0, last = -k - 1;
for (int i = 0; i < n; i++) {
    if (s[i] == '1') last = i;
    else if (i - last > k && nxt[i] - i > k) { added++; last = i; }
}`
  },
  {
    problem: "1409C", name: "Yet Another Array Restoration", rating: 1200,
    tags: ["brute force", "math", "number theory"],
    daysAgo: 1, minutes: 49, stuckReason: "overthinking",
    reviews: [],
    keyObservation: raw`The common difference $d$ must divide $y - x$, with at most $n$ elements from $x$ to $y$. Take the smallest such $d$, then add elements below $x$ while they stay positive, and only then above $y$.`,
    whatMadeMeStuck: raw`Tried to derive the best $d$ with a formula. With $n \le 50$ you can just try every $d$.`,
    pattern: "Brute force the parameter; extend downwards before upwards to keep the maximum small.",
    futureTrigger: "An arithmetic progression through two given values: the difference divides their gap.",
    code: raw`for (int d = 1; d <= y - x; d++) {
    if ((y - x) % d || (y - x) / d + 1 > n) continue;
    vector<int> res;
    for (int v = x; v <= y; v += d) res.push_back(v);
    for (int v = x - d; v > 0 && (int)res.size() < n; v -= d) res.push_back(v);
    for (int v = y + d; (int)res.size() < n; v += d) res.push_back(v);
    break; // the smallest d gives the smallest maximum
}`
  },
  {
    problem: "1454D", name: "Number into Sequence", rating: 1300,
    tags: ["constructive algorithms", "math", "number theory"],
    daysAgo: 0, minutes: 37, stuckReason: "math-insight",
    reviews: [],
    keyObservation: raw`Every element must be divisible by the first, so all of them share a prime $p$. The length is therefore at most the largest exponent $e$ in the factorisation of $n$, and $p, p, \dots, p, n / p^{e-1}$ reaches it.`,
    whatMadeMeStuck: "Was building the sequence from the largest divisor down. The bound comes from the first element, not the last.",
    pattern: "Factorise, take the prime with the largest exponent.",
    futureTrigger: "A chain where each element divides the next and the product is fixed.",
    code: raw`// p = prime with the largest exponent e in n (trial division up to sqrt(n))
cout << e << "\n";
for (int i = 1; i < e; i++) { cout << p << " "; n /= p; }
cout << n << "\n";`
  },
  {
    problem: "1475C", name: "Ball in Berland", rating: 1400,
    tags: ["combinatorics", "graphs", "math"],
    daysAgo: 0, minutes: 55, stuckReason: "counting",
    reviews: [],
    keyObservation: raw`Count the complement. A pair $(a, b)$ clashes with every other pair using boy $a$ or girl $b$, so it is compatible with $k - 1 - (deg_a - 1) - (deg_b - 1)$ pairs. Sum over all pairs and halve.`,
    whatMadeMeStuck: "Tried to count good pairs directly and double counted pairs sharing both a boy and a girl (which cannot exist, since pairs are distinct).",
    pattern: "Count per edge with degrees, divide by two.",
    futureTrigger: "\"Choose two edges with no common endpoint\" in a bipartite graph.",
    code: raw`long long total = 0;
for (int i = 0; i < k; i++)
    total += k - 1 - (degBoy[a[i]] - 1) - (degGirl[b[i]] - 1);
cout << total / 2 << "\n";`
  }
];

// Problems still waiting to be solved. The first one is the active problem,
// with some time already on its stopwatch.
export const QUEUE = [
  {
    problem: "1915D", name: "Unnatural Language Processing", rating: 900,
    tags: ["greedy", "implementation", "strings"],
    daysAgo: 1, status: "active", minutes: 9
  },
  {
    problem: "1921D", name: "Very Different Array", rating: 1100,
    tags: ["data structures", "greedy", "sortings", "two pointers"],
    daysAgo: 1
  },
  {
    problem: "1899D", name: "Yarik and Musical Notes", rating: 1300,
    tags: ["hashing", "math", "number theory"],
    daysAgo: 0
  },
  {
    problem: "1873G", name: "ABBC or BACB", rating: 1500,
    tags: ["constructive algorithms", "greedy"],
    daysAgo: 0
  }
];

// Private blog entries: free-form notes in Markdown (`daysAgo` as above).
export const BLOG = [
  {
    title: "Pair conditions: move each index to its own side",
    daysAgo: 20,
    tags: ["counting", "hashing", "1520D", "1541B"],
    body: raw`Two problems this month looked different and were the same trick.

## The pattern

A condition on a pair $(i, j)$ that mixes both indices can often be rewritten so that everything about $i$ is on one side and everything about $j$ on the other:

$$a_j - a_i = j - i \iff a_j - j = a_i - i$$

After that each index has a **key**, and the answer is the number of pairs with equal keys.

${"```"}cpp
map<int, long long> seen;
long long pairs = 0;
for (int i = 0; i < n; i++) pairs += seen[a[i] - i]++;
${"```"}

## When it does not separate

In *Pleasant Pairs* ($a_i \cdot a_j = i + j$) the variables do not separate, but the product is small (at most $2n$), so for a fixed $i$ only every $a_i$-th index can work.

| Problem | Condition | Idea |
|---|---|---|
| 1520D | $a_j - a_i = j - i$ | key $a_i - i$, count equal keys |
| 1541B | $a_i \cdot a_j = i + j$ | iterate over multiples of $a_i$ |

<spoiler summary="Why the multiples loop is fast enough">
The values $a_i$ are distinct, so the total work is $\sum_i n / a_i \le n \cdot H_n = O(n \log n)$.

${"```"}cpp
for (int j = a[i] - i % a[i]; j <= n; j += a[i])
    if (j > i && 1LL * a[i] * a[j] == i + j) count++;
${"```"}
</spoiler>

> Before writing two nested loops, try to rewrite the condition.`
  },
  {
    title: "Read the constraints before thinking",
    daysAgo: 6,
    tags: ["habits", "constraints"],
    body: raw`Three of my slowest solves had the same cause: I started designing something clever while the limits were asking for brute force.

- $n \le 50$ usually means a cubic solution is intended (1399C, 1409C).
- "You do not have to minimise the number of operations" means one uniform operation is enough (1635C).
- $t \le 2 \cdot 10^5$ with a small per-test input means **precompute once** (1513C).

**Rule:** write the limits at the top of the scratch paper before the first idea.`
  },
  {
    title: "Checklist for counting problems",
    daysAgo: 0,
    tags: ["counting", "checklist"],
    body: raw`1. Is the complement easier to count? (1475C: all pairs of edges minus the clashing ones.)
2. Can I count per element instead of per pair, and divide by the symmetry?
3. Does the algorithm in the statement only depend on **positions**? Then simulate it and turn every comparison into a constraint (1436C).
4. Check the formula on the first sample by hand before coding.`
  }
];

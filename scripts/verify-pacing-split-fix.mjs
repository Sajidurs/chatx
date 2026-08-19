// Regression check for a real bug found while investigating "AI seems to
// ignore context after a human hands a conversation back": splitIntoMessages
// silently dropped content whenever a reply contained a decimal number not
// followed by whitespace (a price like "$45.00", a version like "2.0"), since
// the old regex excluded periods entirely from its "ordinary content"
// character class -- there was no way to consume a mid-token period as plain
// text, only as a (failing) sentence terminator, and the regex engine just
// skipped past whatever it couldn't match. This directly imports the real
// function (no server/DB/Claude needed -- pure unit-level check).
//
// Usage: node --experimental-strip-types scripts/verify-pacing-split-fix.mjs
// (the flag is needed to import the real .ts source directly, rather than
// re-implementing/copy-pasting the function into this script)

import { splitIntoMessages } from "../src/lib/chat/pacing.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

const priceReply = "Your refund of $45.00 was processed yesterday -- it should land within 3-5 business days.";
const priceChunks = splitIntoMessages(priceReply);
check(
  "a reply with a price ($45.00) keeps the full amount intact, not dropped",
  priceChunks.join(" ").includes("$45.00"),
  JSON.stringify(priceChunks)
);

// Short sentences intentionally group into one chat bubble (up to 160
// chars) -- this only checks nothing was silently dropped, not a 1:1
// sentence-to-chunk split.
const multiSentence = "Hi there! How can I help you today? Let me know.";
const multiChunks = splitIntoMessages(multiSentence);
check(
  "a normal multi-sentence reply keeps all three sentences, none dropped",
  ["Hi there!", "How can I help you today?", "Let me know."].every((s) => multiChunks.join(" ").includes(s)),
  JSON.stringify(multiChunks)
);

const longMultiSentence =
  "Thanks so much for reaching out about this today, we really appreciate your patience while we looked into it. Unfortunately we don't have that specific item in stock right now. We do expect a new shipment in about two weeks though, so hang tight.";
const longChunks = splitIntoMessages(longMultiSentence);
check(
  "a long multi-sentence reply DOES split into multiple bubbles once over the length limit",
  longChunks.length > 1,
  JSON.stringify(longChunks)
);

const versionReply = "Version 2.0 just shipped. Check it out.";
const versionChunks = splitIntoMessages(versionReply);
check(
  "a decimal that isn't money (a version number) is also preserved",
  versionChunks.join(" ").includes("2.0"),
  JSON.stringify(versionChunks)
);

const noTrailingPunctuation = "No trailing punctuation here";
const ntpChunks = splitIntoMessages(noTrailingPunctuation);
check(
  "a reply with no trailing sentence punctuation isn't dropped entirely",
  ntpChunks.join(" ").includes("No trailing punctuation here"),
  JSON.stringify(ntpChunks)
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("PACING SPLIT FIX VERIFICATION FAILED");
  process.exit(1);
}
console.log("Verified: splitIntoMessages no longer drops content around embedded periods (prices, version numbers, etc).");

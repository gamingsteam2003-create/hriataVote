const SECTIONS = [
  ["Data we collect", ["Full name, college registration number, department and semester — to match you with the official student registry.", "Optional institutional email address — used only as a sign-in identifier.", "A password, stored only as an Argon2id hash. VoteSecure never stores your password in readable form.", "Security metadata such as sign-in times and a salted hash of your IP address, used to detect abuse."]],
  ["How verification works", ["Your details are compared with a registry uploaded by an authorised college representative.", "An election administrator reviews every request and records the decision and reason in the audit log.", "Being verified does not automatically make you eligible for every election; each election has its own eligibility list based on department and semester rules."]],
  ["Election rules", ["Each eligible student may cast exactly one ballot per election. The server rejects any second ballot, including simultaneous or repeated submissions.", "Ballots are accepted only while an election is Open, measured by server time. Client-supplied times are ignored.", "Each position allows a configured maximum number of selections. Abstaining is only possible when the election rules allow it.", "Accepted ballots cannot be changed or withdrawn.", "Candidate vote totals are never shown while voting is in progress. Results are counted after closing, reconciled, finalised, and then published according to the election's disclosure policy."]],
  ["How ballots are handled", ["Your participation (that you voted) and your ballot content (your selections) are stored in separate database collections.", "The ballot record contains no user identifier, and its timestamp is limited to the calendar date.", "Ballot choices never appear in logs, audit events, analytics or administrator screens.", "After voting you receive a random receipt code. Only its hash is stored, so you can later check that a ballot with your receipt was counted, without revealing your choices."]],
  ["Known privacy limitations", ["This is a controlled college-election application with database-backed privacy safeguards — not a cryptographic voting protocol. It does not provide end-to-end verifiability or coercion resistance.", "A person with direct database or server access (for example a database administrator) could attempt to correlate participation and ballot records using insertion order or timing. Collection separation reduces, but does not eliminate, this risk.", "The receipt code proves inclusion of a ballot, not its contents, and anyone holding your receipt can perform the same check.", "The hash-linked audit log is tamper-evident, not tamper-proof: an attacker with full database and signing-key access could rewrite it. External signed checkpoints make such rewrites detectable when compared."]],
  ["Retention", ["Rejected verification requests are retained for audit purposes and may be deleted by the college according to its retention policy.", "Audit events are append-only within the application."]],
];

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 vs-rise" data-testid="privacy-page">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Privacy &amp; election rules</h1>
      <p className="mt-4 text-sm text-slate-500">This page describes what VoteSecure does and, just as importantly, what it does not guarantee.</p>
      <div className="mt-12 space-y-12">
        {SECTIONS.map(([title, items]) => (
          <section key={title}>
            <h2 className="font-display text-lg font-semibold text-sky-700">{title}</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
              {items.map((i) => <li key={i} className="border-l-2 border-sky-200 pl-4">{i}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

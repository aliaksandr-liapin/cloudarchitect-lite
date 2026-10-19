import { YOU_DECIDE, type GapTopic, type Question, type Requirement } from '@cloudarchitect/domain';
import { useState } from 'react';

type Answers = Partial<Record<GapTopic, string>>;

/** Next free id of the form U1, U2, … (C- and T- ids are reserved by the gateway). */
function nextUserId(reqs: Requirement[]): string {
  const used = new Set(reqs.map((r) => r.id));
  let n = 1;
  while (used.has(`U${n}`)) n++;
  return `U${n}`;
}

/** The one clarification round: quick answers per gap and the editable requirements (spec §5). */
export function ClarifyCard({
  questions,
  requirements,
  assumptions,
  onContinue,
  onCancel,
  disabled = false,
}: {
  questions: Question[];
  requirements: Requirement[];
  assumptions: string[];
  onContinue(answers: Answers, requirements: Requirement[]): void;
  onCancel(): void;
  /** A request is running: hold Continue so it is not sent twice (Cancel stays available). */
  disabled?: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [freeText, setFreeText] = useState<Answers>({});
  const [reqs, setReqs] = useState(requirements);

  const choice = (topic: GapTopic) => answers[topic] ?? YOU_DECIDE;
  const pick = (topic: GapTopic, value: string) => {
    setAnswers((a) => ({ ...a, [topic]: value }));
    setFreeText((f) => ({ ...f, [topic]: '' }));
  };
  const type = (topic: GapTopic, text: string) => {
    setFreeText((f) => ({ ...f, [topic]: text }));
    setAnswers((a) => ({ ...a, [topic]: text.trim() || YOU_DECIDE }));
  };

  const edit = (id: string, text: string) =>
    setReqs((rs) => rs.map((r) => (r.id === id ? { ...r, text } : r)));
  const remove = (id: string) => setReqs((rs) => rs.filter((r) => r.id !== id));
  const add = () =>
    setReqs((rs) => [
      ...rs,
      { id: nextUserId(rs), text: '', type: 'functional', status: 'confirmed', provenance: 'user' },
    ]);

  const kept = reqs.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text.length > 0);
  const allAnswers = (value?: string): Answers =>
    Object.fromEntries(
      questions.map((q) => [q.topic, value ?? (answers[q.topic]?.trim() || YOU_DECIDE)]),
    );

  return (
    <section className="clarify" aria-label="Clarify before drawing">
      <h2>{questions.length ? 'A few questions before drawing' : 'Review requirements'}</h2>
      {questions.map((q) => (
        <fieldset key={q.topic} className="question">
          <legend>{q.text}</legend>
          <div className="chips">
            {q.suggestions.map((s) => (
              <button
                key={s}
                className="chip"
                aria-pressed={choice(q.topic) === s && !freeText[q.topic]}
                onClick={() => pick(q.topic, s)}
              >
                {s}
              </button>
            ))}
            <button
              className="chip"
              aria-pressed={choice(q.topic) === YOU_DECIDE}
              onClick={() => pick(q.topic, YOU_DECIDE)}
            >
              You decide
            </button>
          </div>
          <input
            className="input"
            aria-label={`Your own answer: ${q.text}`}
            placeholder="Or type your own answer"
            maxLength={500}
            value={freeText[q.topic] ?? ''}
            onChange={(e) => type(q.topic, e.target.value)}
          />
        </fieldset>
      ))}

      <h3>Requirements</h3>
      <ul className="reqs">
        {reqs.map((r) => (
          <li key={r.id}>
            <span className="badge muted">{r.id}</span>
            <textarea
              aria-label={`Requirement ${r.id}`}
              rows={2}
              maxLength={2000}
              value={r.text}
              onChange={(e) => edit(r.id, e.target.value)}
            />
            <button aria-label={`Delete requirement ${r.id}`} onClick={() => remove(r.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <button onClick={add}>Add requirement</button>
      {assumptions.length > 0 && (
        <>
          <h3>Assumptions</h3>
          <ul className="small muted">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {kept.length === 0 && <p className="small warn">Add at least one requirement.</p>}
      <div className="row">
        <button onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        {questions.length > 0 && (
          <button
            disabled={disabled || kept.length === 0}
            onClick={() => onContinue(allAnswers(YOU_DECIDE), kept)}
          >
            Skip questions
          </button>
        )}
        <button
          className="primary"
          disabled={disabled || kept.length === 0}
          onClick={() => onContinue(allAnswers(), kept)}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

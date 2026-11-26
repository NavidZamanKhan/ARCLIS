import { useState } from 'react';

const cases = [
  { name: 'Positive numbers', stdin: '7 5\n', expected: '12\n' },
  { name: 'Mixed signs', stdin: '-3 5\n', expected: '2\n' },
  { name: 'Zero', stdin: '0 0\n', expected: '0\n' },
];

export function TestCases({ target, execution, runCase }) {
  const [selected, setSelected] = useState(0);
  const fixture = cases[selected];
  const { testCase, state } = execution.run;
  const completed = testCase && state === 'COMPLETED';
  const matches = completed && testCase.stdout === testCase.expected;
  const result = completed ? (matches ? 'Output matches' : 'Output differs') : execution.label;

  return (
    <div className="test-cases">
      <div className="test-case-controls">
        <label>
          Two-number sum case
          <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
            {cases.map(({ name }, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => runCase(fixture)} disabled={!target || execution.active}>Run case</button>
      </div>
      {testCase && (
        <div className="test-case-result" role="status" aria-label="Test case result">
          <strong>{testCase.name}</strong> · {result}
          {completed && !matches && (
            <dl className="test-case-values">
              <dt>Expected</dt><dd><code>{JSON.stringify(testCase.expected)}</code></dd>
              <dt>Received</dt><dd><code>{JSON.stringify(testCase.stdout)}</code></dd>
            </dl>
          )}
        </div>
      )}
      <dl className="test-case-values">
        <dt>Input</dt><dd><code>{fixture.stdin.trimEnd()}</code></dd>
        <dt>Expected output</dt><dd><code>{fixture.expected.trimEnd()}</code></dd>
      </dl>
      {!target && <p className="debug-empty">Select an execution target to run a case.</p>}
    </div>
  );
}

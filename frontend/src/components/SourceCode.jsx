export function SourceCode({ sample }) {
  return (
    <pre className="source-code font-mono" tabIndex={0} aria-label={sample.label + ' source sample'}>
      <code>
        {sample.lines.map((line, index) => (
          <span className="source-line" key={index}>
            <span className="line-number" aria-hidden="true">{index + 1}</span>
            <span className="line-text">
              {line.map((part, offset) => typeof part === 'string' ? part : (
                <span key={offset} data-syntax={part.kind}>{part.text}</span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

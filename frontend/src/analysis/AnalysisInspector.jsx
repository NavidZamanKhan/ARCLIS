import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const pageSize = 32;
const views = ['Tokens', 'AST', 'Symbols', 'Diagnostics', 'IR'];

function PagedList({ items, renderItem }) {
  const [page, setPage] = useState(0);
  const count = Math.ceil(items.length / pageSize);
  const start = page * pageSize;
  return (
    <>
      <ul className="analysis-list">
        {items.slice(start, start + pageSize).map((item, index) => renderItem(item, start + index))}
      </ul>
      {count > 1 && (
        <div className="analysis-pages" role="group" aria-label="Result pages">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page + 1} / {count}</span>
          <button type="button" disabled={page + 1 === count} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

function Location({ range, navigate, className = '', children }) {
  return (
    <button type="button" className={'analysis-location ' + className} disabled={!navigate || !range}
      onClick={() => navigate(range)}>
      {children}
      {range?.start && <span className="analysis-line">L{range.start.line}</span>}
    </button>
  );
}

function AstNode({ node, field, navigate, root }) {
  const [expanded, setExpanded] = useState(Boolean(root));
  const children = Object.entries(node).flatMap(([key, value]) => (
    (Array.isArray(value) ? value : [value]).filter((item) => item?.kind && item?.range)
      .map((item) => ({ node: item, field: key }))
  ));
  const detail = node.name ?? node.operator ?? node.text ?? node.type;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li className="analysis-branch">
      <div className="analysis-node">
        {children.length > 0 && (
          <button type="button" className="analysis-expand" aria-expanded={expanded}
            aria-label={(expanded ? 'Collapse ' : 'Expand ') + node.kind} onClick={() => setExpanded(!expanded)}>
            <Chevron size={15} aria-hidden="true" />
          </button>
        )}
        <Location range={node.range} navigate={navigate}>
          <span>{node.kind}{detail && <code> {detail}</code>}{field && <small>{field}</small>}</span>
        </Location>
      </div>
      {expanded && children.length > 0 && (
        <PagedList items={children} renderItem={(child, index) => (
          <AstNode key={index} {...child} navigate={navigate} />
        )} />
      )}
    </li>
  );
}

function formatOperand(operand, symbols) {
  if (operand == null) return '';
  if (operand.kind === 'temp') return 't' + operand.id;
  if (operand.kind === 'symbol') return (symbols[operand.id - 1]?.name ?? 'symbol') + '#' + operand.id;
  return operand.segments?.join(' ') ?? operand.text;
}

function instructionText(row, symbols) {
  const operand = (key) => formatOperand(row[key], symbols);
  switch (row.op) {
    case 'global': case 'local': case 'function': case 'end-function': case 'parameter':
      return row.op + ' ' + operand('symbol');
    case 'load': return operand('result') + ' = load ' + operand('source');
    case 'store': return operand('target') + ' = ' + operand('value');
    case 'binary': return operand('result') + ' = ' + operand('left') + ' ' + row.operator + ' ' + operand('right');
    case 'unary': return operand('result') + ' = ' + row.operator + operand('operand');
    case 'move': return operand('result') + ' = ' + operand('value');
    case 'truth': return operand('result') + ' = truth ' + operand('value');
    case 'label': return 'L' + row.label + ':';
    case 'jump': return 'goto L' + row.target;
    case 'branch-zero': case 'branch-nonzero':
      return 'if ' + operand('value') + (row.op === 'branch-zero' ? ' == 0 goto L' : ' != 0 goto L') + row.target;
    case 'argument': return 'arg ' + row.callSite + '.' + row.index + ' = ' + operand('value');
    case 'call': return (row.result ? operand('result') + ' = ' : '')
      + 'call ' + operand('callee') + ' (' + row.argumentCount + ' args, site ' + row.callSite + ')';
    case 'return': return ('return ' + operand('value')).trimEnd();
    default: return row.op;
  }
}

function ResultView({ view, report, navigate }) {
  if (view === 'AST') {
    return report.ast
      ? <ul className="analysis-list"><AstNode node={report.ast} navigate={navigate} root /></ul>
      : <p className="analysis-note">Fix the syntax diagnostics to view the AST.</p>;
  }
  if (view === 'IR') {
    if (!report.ir) return <p className="analysis-note">Fix the diagnostics to generate intermediate code.</p>;
    if (!(report.ir.initializers.length || report.ir.instructions.length)) {
      return <p className="analysis-note">This source produces no instructions.</p>;
    }
    return [
      ['Initializers', report.ir.initializers], ['Instructions', report.ir.instructions],
    ].filter(([, items]) => items.length > 0).map(([title, items]) => (
      <section key={title} className="analysis-ir-section" aria-label={title}>
        <h3>{title}</h3>
        <PagedList items={items} renderItem={(row, index) => (
          <li key={index}><Location range={row.range} navigate={navigate}><code>{instructionText(row, report.symbols)}</code></Location></li>
        )} />
      </section>
    ));
  }

  if (view === 'Diagnostics') {
    return report.diagnostics.length ? (
      <PagedList items={report.diagnostics} renderItem={(item, index) => (
        <li key={index}>
          <Location range={item.range} navigate={navigate} className="analysis-diagnostic">
            <span><small>{item.phase} · {item.code}</small>{item.message}</span>
          </Location>
        </li>
      )} />
    ) : <p className="analysis-note">No diagnostics.</p>;
  }

  if (view === 'Symbols') {
    if (!report.syntax_valid) return <p className="analysis-note">Fix the syntax diagnostics to view symbols.</p>;
    const scopes = new Map(report.scopes.map((scope) => [scope.id, scope]));
    return report.symbols.length ? (
      <PagedList items={report.symbols} renderItem={(item, index) => (
        <li key={index}>
          <Location range={item.range} navigate={navigate}>
            <span>
              <code>{item.name}{Array.isArray(item.parameterTypes) && '(' + item.parameterTypes.join(', ') + ')'}</code>
              <small>{item.static ? 'static ' : ''}{item.type} · {item.kind} · {scopes.get(item.scope)?.kind} #{item.scope}</small>
            </span>
          </Location>
        </li>
      )} />
    ) : <p className="analysis-note">No symbols.</p>;
  }

  return (
    <PagedList items={report.tokens} renderItem={(item, index) => (
      <li key={index}>
        <Location range={item.range} navigate={navigate}>
          <span><code>{item.lexeme || 'EOF'}</code><small>{item.kind}</small></span>
        </Location>
      </li>
    )} />
  );
}

function AnalysisResults({ report, navigate }) {
  const [view, setView] = useState(report.diagnostics.length ? 'Diagnostics' : 'Tokens');
  return (
    <>
      <div className="analysis-views" role="group" aria-label="Analysis result view">
        {views.map((entry) => (
          <button type="button" key={entry} aria-pressed={view === entry} onClick={() => setView(entry)}>{entry}</button>
        ))}
      </div>
      <ResultView key={view} view={view} report={report} navigate={navigate} />
    </>
  );
}

export function AnalysisInspector({ state, stale, navigate }) {
  if (!state) return <p className="analysis-note">Open a C file and select Analyze.</p>;
  const { snapshot, status, report, message } = state;
  return (
    <section className="analysis-inspector" aria-label="C analysis">
      <h3 className="analysis-file" title={snapshot.path}>{snapshot.path}</h3>
      {status === 'running' && <p className="analysis-note" role="status">Analyzing C source…</p>}
      {status === 'error' && <p className="analysis-note analysis-error" role="alert">{message}</p>}
      {status === 'complete' && (
        <>
          <p className={'analysis-note' + (stale ? ' analysis-stale' : '')} role="status">
            {stale ? 'Results are stale. Analyze again to update them.'
              : report.diagnostics.length ? report.diagnostics.length + ' diagnostics' : 'Analysis complete'}
          </p>
          <AnalysisResults report={report} navigate={stale ? null : navigate} />
        </>
      )}
    </section>
  );
}

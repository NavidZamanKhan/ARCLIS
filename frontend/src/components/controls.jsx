import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export function Button({ variant = 'secondary', icon: Icon, children, ...props }) {
  return (
    <button type="button" className={'ui-button ui-button--' + variant} {...props}>
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Select({ label, options, value, onChange }) {
  const id = useId();

  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <div className="ui-select">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
    </div>
  );
}

export function Status({ tone, icon: Icon, children }) {
  return (
    <span className={'ui-status ui-status--' + tone}>
      <Icon size={16} aria-hidden="true" />
      {children}
    </span>
  );
}

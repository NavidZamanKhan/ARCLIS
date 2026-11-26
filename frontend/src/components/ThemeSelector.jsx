import { Moon, Sun } from 'lucide-react';

const themes = [
  { id: 'graphite', label: 'Graphite', Icon: Moon },
  { id: 'silver', label: 'Silver', Icon: Sun },
];

export function ThemeSelector({ value, onChange }) {
  return (
    <fieldset className="theme-selector">
      <legend className="sr-only">Color theme</legend>
      {themes.map(({ id, label, Icon }) => (
        <label key={id}>
          <input
            className="sr-only"
            type="radio"
            name="arclis-color-theme"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
          />
          <span className="theme-option"><Icon size={15} aria-hidden="true" />{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

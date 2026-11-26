export const panelOptions = {
  navigator: { label: 'Navigator', size: 224, min: 168, max: 360, direction: 1 },
  inspector: { label: 'Inspector', size: 256, min: 184, max: 384, direction: -1 },
  debug: { label: 'Debug', size: 192, min: 96, max: 448, direction: -1 },
};

export function defaultLayout() {
  return Object.fromEntries(
    Object.entries(panelOptions).map(([panel, { size }]) => [panel, { size, visible: true }]),
  );
}

export function clampSize(value, { min, max }) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

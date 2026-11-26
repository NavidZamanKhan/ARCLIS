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

const storageKey = 'arclis.layout';

export function readLayout() {
  const layout = defaultLayout();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const [panel, options] of Object.entries(panelOptions)) {
      const candidate = saved?.[panel];
      if (typeof candidate?.visible === 'boolean') layout[panel].visible = candidate.visible;
      if (Number.isFinite(candidate?.size)) layout[panel].size = clampSize(candidate.size, options);
    }
  } catch {
    // Start with the default layout when storage is unavailable.
  }
  return layout;
}

export function saveLayout(layout) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The layout remains usable for this visit.
  }
}

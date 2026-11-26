export const restrictedDeployment = import.meta.env.MODE === 'deployment';

export function backendUrl(path) {
  const origin = restrictedDeployment ? window.location.origin : 'http://127.0.0.1:8000';
  return new URL(path, origin);
}

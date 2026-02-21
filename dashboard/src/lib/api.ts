// All API calls go through Next.js API proxy
const API_URL = '/api';

export async function fetchHealth() {
  const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_URL}/stats`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function fetchAssets(state?: string, assetType?: string) {
  const params = new URLSearchParams();
  if (state) params.append('state', state);
  if (assetType) params.append('asset_type', assetType);
  
  const url = `${API_URL}/assets${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch assets');
  return res.json();
}

export async function fetchAsset(assetId: string) {
  const res = await fetch(`${API_URL}/assets/${assetId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch asset');
  return res.json();
}

export async function fetchAssetHistory(assetId: string, hours: number = 24) {
  const res = await fetch(`${API_URL}/assets/${assetId}/history?hours=${hours}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch asset history');
  return res.json();
}

export async function fetchActiveAlerts() {
  const res = await fetch(`${API_URL}/alerts/active`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
}

export async function fetchAlerts(assetId?: string, hours: number = 24) {
  const params = new URLSearchParams();
  if (assetId) params.append('asset_id', assetId);
  params.append('hours', hours.toString());
  
  const res = await fetch(`${API_URL}/alerts?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch alerts');
  return res.json();
}
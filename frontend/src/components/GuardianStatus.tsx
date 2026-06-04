import React from 'react';
import { SystemHealth } from '../types';
import { useApiData } from '../hooks/useApi';

interface GpuStatus {
  cuda_available: boolean;
  gpu_name?: string;
  vram_total_gb?: number;
  vram_used_gb?: number;
  torch_version?: string;
  finbert?: { engine: string; device: string; gpu_active: boolean; ready: boolean };
}

function ProgressBar({ value, warn }: { value: number; warn: number }) {
  const color = value > warn ? 'var(--red)' : value > warn * 0.75 ? 'var(--amber)' : 'var(--green)';
  return (
    <div style={{ background: 'var(--bg-primary)', height: 3, marginTop: 4, borderRadius: 2 }}>
      <div style={{ width: `${Math.min(value, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
    </div>
  );
}

export const GuardianStatus: React.FC = () => {
  const { data: health, loading } = useApiData<SystemHealth>('/api/health', 15000);
  const { data: gpu } = useApiData<GpuStatus>('/api/gpu/status', 30000);

  return (
    <div className="panel" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="panel-header">
        <span className="panel-title">Guardian — System Health</span>
        {loading && <span className="spinner" />}
      </div>
      <div style={{ padding: 8 }}>
        {!health ? (
          <div className="text-muted">Loading…</div>
        ) : (
          <>
            {/* System Resources */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>System Resources</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {[
                  { label: 'CPU', value: health.system?.cpu_pct || 0, unit: '%', warn: 80 },
                  { label: 'Memory', value: health.system?.mem_pct || 0, unit: '%', warn: 80 },
                  { label: 'Disk', value: health.system?.disk_pct || 0, unit: '%', warn: 85 },
                ].map(m => (
                  <div key={m.label} className="metric-box">
                    <div className="metric-label">{m.label}</div>
                    <div className="metric-value" style={{
                      color: m.value > m.warn ? 'var(--red)' : m.value > m.warn * 0.75 ? 'var(--amber)' : 'var(--green)',
                      fontSize: 16,
                    }}>
                      {m.value.toFixed(1)}{m.unit}
                    </div>
                    <ProgressBar value={m.value} warn={m.warn} />
                  </div>
                ))}
              </div>
              {health.system && (
                <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>Mem Free: {health.system.mem_available_gb?.toFixed(1)} GB</span>
                  <span>Disk Free: {health.system.disk_free_gb?.toFixed(1)} GB</span>
                </div>
              )}
            </div>

            {/* GPU & ML Status */}
            {gpu && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>GPU & ML Engine</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div className="metric-box">
                    <div className="metric-label">GPU</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: gpu.cuda_available ? 'var(--green)' : 'var(--text-muted)', marginTop: 2 }}>
                      {gpu.cuda_available ? '● CUDA ACTIVE' : '○ CPU ONLY'}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{gpu.gpu_name || 'N/A'}</div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">VRAM</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginTop: 2 }}>
                      {gpu.vram_used_gb != null ? `${gpu.vram_used_gb}GB` : '—'} / {gpu.vram_total_gb != null ? `${gpu.vram_total_gb}GB` : '—'}
                    </div>
                    {gpu.vram_total_gb && gpu.vram_used_gb != null && (
                      <ProgressBar value={(gpu.vram_used_gb / gpu.vram_total_gb) * 100} warn={80} />
                    )}
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">NLP Sentiment</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: gpu.finbert?.ready ? 'var(--green)' : 'var(--amber)' }}>
                      {gpu.finbert?.engine || 'rule-based'}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{gpu.finbert?.device || 'cpu'}</div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">PyTorch</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: gpu.torch_version ? 'var(--green)' : 'var(--red)' }}>
                      {gpu.torch_version || 'not installed'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Agents */}
            <div>
              <div style={{ color: 'var(--amber)', fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Agent Status</div>
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Last Beat</th>
                    <th>Restarts</th>
                    <th>Last Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(health.agents || []).map((a, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--amber)' }}>{a.name}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span className={`status-dot ${a.status === 'OK' ? 'ok' : a.status === 'WARN' ? 'warn' : 'dead'}`} />
                          <span style={{
                            color: a.status === 'OK' ? 'var(--green)' : a.status === 'WARN' ? 'var(--amber)' : 'var(--red)',
                            fontWeight: 700,
                          }}>
                            {a.status}
                          </span>
                        </div>
                      </td>
                      <td style={{ color: a.last_beat_seconds_ago > 120 ? 'var(--red)' : a.last_beat_seconds_ago > 60 ? 'var(--amber)' : 'var(--text-secondary)' }}>
                        {a.last_beat_seconds_ago > 0 ? `${a.last_beat_seconds_ago}s ago` : 'Never'}
                      </td>
                      <td style={{ color: a.restart_count > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>
                        {a.restart_count}
                      </td>
                      <td style={{ color: 'var(--red)', fontSize: 10, maxWidth: 200 }} className="truncate">
                        {a.last_error || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
              Last updated: {health.updated_at ? new Date(health.updated_at).toLocaleTimeString() : '—'}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

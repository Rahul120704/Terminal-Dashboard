/**
 * SupplyChainPanel — Bloomberg SPLC equivalent
 * Supply chain relationship visualization for NSE stocks
 */
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

interface SupplyChainRelation {
  symbol: string;
  name: string;
  relationship: 'customer' | 'supplier' | 'competitor' | 'peer';
  revenue_pct?: number;
  sector?: string;
  exchange?: string;
}

interface SupplyChainData {
  symbol: string;
  name: string;
  sector: string;
  customers: SupplyChainRelation[];
  suppliers: SupplyChainRelation[];
  competitors: SupplyChainRelation[];
  peers: SupplyChainRelation[];
}

// Static supply chain mapping for major Indian conglomerates/sectors
const SUPPLY_CHAIN_MAP: Record<string, SupplyChainData> = {
  RELIANCE: {
    symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy / Conglomerate',
    customers: [
      { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', relationship: 'customer', sector: 'Finance', exchange: 'NSE' },
      { symbol: 'DMART', name: 'Avenue Supermarts', relationship: 'customer', sector: 'Retail', exchange: 'NSE' },
    ],
    suppliers: [
      { symbol: 'GAIL', name: 'GAIL India', relationship: 'supplier', sector: 'Gas', exchange: 'NSE', revenue_pct: 12 },
      { symbol: 'ONGC', name: 'ONGC', relationship: 'supplier', sector: 'Oil', exchange: 'NSE', revenue_pct: 18 },
      { symbol: 'IOC', name: 'Indian Oil', relationship: 'supplier', sector: 'Oil', exchange: 'NSE', revenue_pct: 8 },
    ],
    competitors: [
      { symbol: 'ADANIGREEN', name: 'Adani Green', relationship: 'competitor', sector: 'Energy', exchange: 'NSE' },
      { symbol: 'NTPC', name: 'NTPC', relationship: 'competitor', sector: 'Power', exchange: 'NSE' },
    ],
    peers: [
      { symbol: 'TCS', name: 'TCS (Jio)', relationship: 'peer', sector: 'IT', exchange: 'NSE' },
      { symbol: 'BHARTIARTL', name: 'Bharti Airtel', relationship: 'peer', sector: 'Telecom', exchange: 'NSE' },
    ],
  },
  TCS: {
    symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'Information Technology',
    customers: [
      { symbol: 'TATAMOTORS', name: 'Tata Motors', relationship: 'customer', sector: 'Auto', exchange: 'NSE', revenue_pct: 5 },
      { symbol: 'TITAN', name: 'Titan Company', relationship: 'customer', sector: 'Consumer', exchange: 'NSE' },
    ],
    suppliers: [
      { symbol: 'MPHASIS', name: 'Mphasis', relationship: 'supplier', sector: 'IT', exchange: 'NSE' },
      { symbol: 'LTIM', name: 'LTIMindtree', relationship: 'supplier', sector: 'IT', exchange: 'NSE' },
    ],
    competitors: [
      { symbol: 'INFY', name: 'Infosys', relationship: 'competitor', sector: 'IT', exchange: 'NSE' },
      { symbol: 'WIPRO', name: 'Wipro', relationship: 'competitor', sector: 'IT', exchange: 'NSE' },
      { symbol: 'HCLTECH', name: 'HCL Technologies', relationship: 'competitor', sector: 'IT', exchange: 'NSE' },
    ],
    peers: [
      { symbol: 'TECHM', name: 'Tech Mahindra', relationship: 'peer', sector: 'IT', exchange: 'NSE' },
      { symbol: 'COFORGE', name: 'Coforge', relationship: 'peer', sector: 'IT', exchange: 'NSE' },
    ],
  },
  HDFCBANK: {
    symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking',
    customers: [
      { symbol: 'BAJFINANCE', name: 'Bajaj Finance', relationship: 'customer', sector: 'NBFC', exchange: 'NSE' },
    ],
    suppliers: [
      { symbol: 'RBI', name: 'Reserve Bank of India', relationship: 'supplier', sector: 'Regulator', exchange: 'NSE', revenue_pct: 100 },
    ],
    competitors: [
      { symbol: 'ICICIBANK', name: 'ICICI Bank', relationship: 'competitor', sector: 'Banking', exchange: 'NSE' },
      { symbol: 'SBIN', name: 'State Bank of India', relationship: 'competitor', sector: 'Banking', exchange: 'NSE' },
      { symbol: 'AXISBANK', name: 'Axis Bank', relationship: 'competitor', sector: 'Banking', exchange: 'NSE' },
      { symbol: 'KOTAKBANK', name: 'Kotak Mahindra', relationship: 'competitor', sector: 'Banking', exchange: 'NSE' },
    ],
    peers: [
      { symbol: 'INDUSINDBK', name: 'IndusInd Bank', relationship: 'peer', sector: 'Banking', exchange: 'NSE' },
      { symbol: 'BANDHANBNK', name: 'Bandhan Bank', relationship: 'peer', sector: 'Banking', exchange: 'NSE' },
    ],
  },
};

const REL_COLORS: Record<string, string> = {
  customer:   '#00c853',
  supplier:   '#ff9500',
  competitor: '#ff3d00',
  peer:       '#4fc3f7',
};

const REL_LABELS: Record<string, string> = {
  customer:   '▶ CUSTOMERS',
  supplier:   '◀ SUPPLIERS',
  competitor: '⚡ COMPETITORS',
  peer:       '≈ PEERS',
};

function RelationCard({ item, onClick }: { item: SupplyChainRelation; onClick: (s: string) => void }) {
  const color = REL_COLORS[item.relationship] || '#888';
  return (
    <div
      onClick={() => onClick(item.symbol)}
      style={{
        background: '#111', border: `1px solid ${color}22`, borderLeft: `3px solid ${color}`,
        padding: '8px 10px', borderRadius: 3, cursor: 'pointer', marginBottom: 6,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
      onMouseLeave={e => (e.currentTarget.style.background = '#111')}
    >
      <div>
        <div style={{ color: '#ff9500', fontWeight: 700, fontSize: 12 }}>{item.symbol}</div>
        <div style={{ color: '#888', fontSize: 10 }}>{item.name}</div>
        {item.sector && <div style={{ color: '#555', fontSize: 9 }}>{item.sector}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        {item.revenue_pct && (
          <div style={{ color, fontSize: 11, fontWeight: 700 }}>{item.revenue_pct}%</div>
        )}
        <div style={{ color, fontSize: 9, border: `1px solid ${color}44`, padding: '1px 5px', borderRadius: 2, marginTop: 4 }}>
          {item.relationship.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

// Simple SVG supply chain diagram
function SCDiagram({ data }: { data: SupplyChainData }) {
  const w = 700, h = 280;
  const centerX = w / 2, centerY = h / 2;
  const boxW = 110, boxH = 36;

  const nodePositions: { sym: string; name: string; x: number; y: number; color: string; rel: string }[] = [
    { sym: data.symbol, name: data.name, x: centerX, y: centerY, color: '#ff9500', rel: 'center' },
    ...data.suppliers.slice(0, 3).map((s, i) => ({
      sym: s.symbol, name: s.name,
      x: 80 + i * 10, y: centerY - 80 + i * 80,
      color: '#ff9500', rel: 'supplier',
    })),
    ...data.customers.slice(0, 3).map((c, i) => ({
      sym: c.symbol, name: c.name,
      x: w - 80, y: centerY - 60 + i * 80,
      color: '#00c853', rel: 'customer',
    })),
    ...data.competitors.slice(0, 2).map((c, i) => ({
      sym: c.symbol, name: c.name,
      x: centerX - 120 + i * 240, y: 30,
      color: '#ff3d00', rel: 'competitor',
    })),
  ];

  return (
    <svg width={w} height={h} style={{ background: '#0a0a0a', borderRadius: 4 }}>
      <defs>
        <marker id="arrow-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#00c853" />
        </marker>
        <marker id="arrow-orange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#ff9500" />
        </marker>
      </defs>

      {/* Edges */}
      {nodePositions.filter(n => n.rel !== 'center').map((node, i) => {
        const color = REL_COLORS[node.rel] || '#333';
        const marker = node.rel === 'customer' ? 'url(#arrow-green)' : 'url(#arrow-orange)';
        const [x1, y1] = node.rel === 'supplier'
          ? [node.x + boxW / 2, node.y]
          : [centerX - boxW / 2, centerY];
        const [x2, y2] = node.rel === 'supplier'
          ? [centerX - boxW / 2, centerY]
          : [node.x - boxW / 2, node.y];
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={color} strokeWidth={1.5} strokeDasharray="4 2" opacity={0.5}
            markerEnd={node.rel === 'customer' ? marker : undefined}
            markerStart={node.rel === 'supplier' ? 'url(#arrow-orange)' : undefined}
          />
        );
      })}

      {/* Nodes */}
      {nodePositions.map((node, i) => {
        const isCenter = node.rel === 'center';
        const bw = isCenter ? 140 : boxW;
        const bh = isCenter ? 44 : boxH;
        return (
          <g key={i} transform={`translate(${node.x - bw / 2}, ${node.y - bh / 2})`}>
            <rect width={bw} height={bh} rx={3}
              fill={isCenter ? '#1a1a00' : '#111'}
              stroke={node.color} strokeWidth={isCenter ? 2 : 1}
            />
            <text x={bw / 2} y={bh / 2 - 5} textAnchor="middle" fill={node.color}
              fontSize={isCenter ? 13 : 10} fontWeight="bold" fontFamily="Consolas, monospace">
              {node.sym}
            </text>
            <text x={bw / 2} y={bh / 2 + 9} textAnchor="middle" fill="#555"
              fontSize={8} fontFamily="Consolas, monospace">
              {node.name.slice(0, 18)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const SupplyChainPanel: React.FC<{ symbol?: string; onSelectTicker?: (s: string) => void }> = ({
  symbol = 'RELIANCE', onSelectTicker,
}) => {
  const [sym, setSym]           = useState(symbol.toUpperCase());
  const [inputVal, setInputVal] = useState(symbol.toUpperCase());
  const [data, setData]         = useState<SupplyChainData | null>(null);
  const [peers, setPeers]       = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'map' | 'table'>('map');

  const load = useCallback(async (s: string) => {
    // Use static map first
    if (SUPPLY_CHAIN_MAP[s]) {
      setData(SUPPLY_CHAIN_MAP[s]);
    } else {
      // Fall back to peer comparison data for the symbol
      setData({
        symbol: s, name: s, sector: 'Unknown',
        customers: [], suppliers: [], competitors: [], peers: [],
      });
    }
    // Load peer comparison for the table
    const peerData = await apiFetch<any[]>(`/api/peers/${s}`);
    if (peerData) setPeers(peerData);
  }, []);

  useEffect(() => { load(sym); }, [sym, load]);

  const handleSelect = (s: string) => {
    onSelectTicker?.(s);
    setSym(s); setInputVal(s);
  };

  const allRelations = data ? [
    ...data.suppliers.map(r => ({ ...r, relationship: 'supplier' as const })),
    ...data.customers.map(r => ({ ...r, relationship: 'customer' as const })),
    ...data.competitors.map(r => ({ ...r, relationship: 'competitor' as const })),
    ...data.peers.map(r => ({ ...r, relationship: 'peer' as const })),
  ] : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', color: '#e8e8e0', fontFamily: 'Consolas, monospace', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1a1a1a', background: '#111', flexShrink: 0 }}>
        <span style={{ color: '#ff9500', fontWeight: 700, fontSize: 12 }}>SPLC</span>
        <span style={{ color: '#555', fontSize: 10 }}>Supply Chain · Customers · Suppliers · Peers</span>
        <div style={{ flex: 1 }} />
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') setSym(inputVal); }}
          placeholder="SYMBOL ↵"
          style={{ background: '#1a1a1a', border: '1px solid #333', color: '#ff9500', padding: '3px 8px', fontSize: 11, fontFamily: 'Consolas, monospace', width: 130, outline: 'none' }}
        />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {(['map', 'table'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            background: activeTab === tab ? '#111' : 'transparent',
            border: 'none', borderBottom: activeTab === tab ? '2px solid #ff9500' : '2px solid transparent',
            color: activeTab === tab ? '#ff9500' : '#555',
            padding: '5px 16px', cursor: 'pointer', fontSize: 11,
            fontFamily: 'Consolas, monospace', fontWeight: 700,
          }}>
            {tab === 'map' ? '⬡ RELATIONSHIP MAP' : '⊟ DETAILS TABLE'}
          </button>
        ))}
        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', alignItems: 'center', paddingRight: 12 }}>
          {Object.entries(REL_COLORS).map(([rel, color]) => (
            <span key={rel} style={{ color, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, background: color, borderRadius: '50%', display: 'inline-block' }} />
              {rel}
            </span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* MAP TAB */}
        {activeTab === 'map' && data && (
          <div style={{ padding: 12 }}>
            <SCDiagram data={data} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              {Object.entries(REL_LABELS).map(([rel, label]) => {
                const items = (data as any)[rel + 's'] as SupplyChainRelation[] || [];
                if (items.length === 0) return null;
                return (
                  <div key={rel}>
                    <div style={{ color: REL_COLORS[rel], fontSize: 10, fontWeight: 700, marginBottom: 8 }}>{label}</div>
                    {items.map(item => (
                      <RelationCard key={item.symbol} item={{ ...item, relationship: rel as any }} onClick={handleSelect} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TABLE TAB */}
        {activeTab === 'table' && (
          <div style={{ padding: '8px 12px' }}>
            {allRelations.length > 0 && (
              <>
                <div style={{ color: '#ff9500', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>ALL CHAIN RELATIONSHIPS</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#111' }}>
                      {['Symbol', 'Company', 'Relationship', 'Sector', 'Revenue %'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#888', borderBottom: '1px solid #222' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allRelations.map(row => (
                      <tr key={row.symbol + row.relationship} style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                        onClick={() => handleSelect(row.symbol)}>
                        <td style={{ padding: '5px 10px', color: '#ff9500', fontWeight: 700 }}>{row.symbol}</td>
                        <td style={{ padding: '5px 10px', color: '#e8e8e0' }}>{row.name}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <span style={{ color: REL_COLORS[row.relationship], border: `1px solid ${REL_COLORS[row.relationship]}44`, padding: '1px 6px', borderRadius: 2, fontSize: 9 }}>
                            {row.relationship.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '5px 10px', color: '#666' }}>{row.sector || '—'}</td>
                        <td style={{ padding: '5px 10px', color: '#888' }}>{row.revenue_pct ? `${row.revenue_pct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {peers.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ color: '#4fc3f7', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>PEER COMPARISON</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#111' }}>
                      {['Symbol', 'Name', 'Sector', 'P/E', 'ROE', 'ROCE', 'Mkt Cap'].map(h => (
                        <th key={h} style={{ padding: '5px 10px', textAlign: h === 'Symbol' || h === 'Name' || h === 'Sector' ? 'left' : 'right', color: '#888', borderBottom: '1px solid #222' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {peers.map((peer: any) => (
                      <tr key={peer.symbol} style={{ borderBottom: '1px solid #111', cursor: 'pointer' }}
                        onClick={() => handleSelect(peer.symbol)}>
                        <td style={{ padding: '5px 10px', color: '#ff9500', fontWeight: 700 }}>{peer.symbol}</td>
                        <td style={{ padding: '5px 10px', color: '#e8e8e0' }}>{peer.name || '—'}</td>
                        <td style={{ padding: '5px 10px', color: '#666' }}>{peer.sector || '—'}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#888' }}>{peer.pe_ratio?.toFixed(1) ?? '—'}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#00c853' }}>{peer.roe ? `${peer.roe.toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#00c853' }}>{peer.roce ? `${peer.roce.toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#888' }}>
                          {peer.market_cap ? (peer.market_cap >= 1e5 ? `₹${(peer.market_cap / 1e5).toFixed(0)}B` : `₹${peer.market_cap.toFixed(0)}Cr`) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplyChainPanel;

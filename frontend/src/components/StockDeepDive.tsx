/**
 * StockDeepDive — OVERVIEW · MODL · DOC SEARCH · KPIC · FINANCIALS
 *                 HOLDING · EARNINGS · PEERS · FILINGS · NEWS · INSIDER · AI
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApiData } from '../hooks/useApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSymbol?: string;
  onNavigate?: (view: string, ticker: string) => void;
}

type Tab =
  | 'overview' | 'modl' | 'docsearch' | 'kpic'
  | 'financials' | 'holding' | 'earnings' | 'peers'
  | 'filings' | 'news' | 'insider' | 'research';

const TABS: { id: Tab; label: string; accent?: string }[] = [
  { id: 'overview',   label: 'OVERVIEW'   },
  { id: 'modl',       label: 'MODL',       accent: '#3b82f6' },
  { id: 'docsearch',  label: 'DOC SEARCH', accent: '#8b5cf6' },
  { id: 'kpic',       label: 'KPIC',       accent: '#22d3ee' },
  { id: 'financials', label: 'FINANCIALS' },
  { id: 'holding',    label: 'HOLDING'    },
  { id: 'earnings',   label: 'EARNINGS'   },
  { id: 'peers',      label: 'PEERS'      },
  { id: 'filings',    label: 'FILINGS'    },
  { id: 'news',       label: 'NEWS'       },
  { id: 'insider',    label: 'INSIDER'    },
  { id: 'research',   label: 'AI'         },
];

// ── Supply chain static data ──────────────────────────────────────────────────
interface SCRelation { symbol: string; name: string; type: 'customer'|'supplier'|'competitor'|'peer'; rev_pct?: number; sector?: string; }
interface SCData { customers: SCRelation[]; suppliers: SCRelation[]; competitors: SCRelation[]; peers: SCRelation[]; }

const SUPPLY_CHAIN: Record<string, SCData> = {
  RELIANCE: {
    customers:   [{ symbol:'DMART',      name:'Avenue Supermarts', type:'customer', sector:'Retail' },
                  { symbol:'BHARTIARTL', name:'Bharti Airtel',     type:'customer', sector:'Telecom' }],
    suppliers:   [{ symbol:'ONGC',  name:'ONGC',       type:'supplier', rev_pct:18, sector:'Oil' },
                  { symbol:'GAIL',  name:'GAIL India', type:'supplier', rev_pct:12, sector:'Gas' },
                  { symbol:'IOC',   name:'Indian Oil',  type:'supplier', rev_pct:8,  sector:'Oil' }],
    competitors: [{ symbol:'ADANIENT',   name:'Adani Enterprises', type:'competitor', sector:'Conglomerate' },
                  { symbol:'NTPC',       name:'NTPC',               type:'competitor', sector:'Power' }],
    peers:       [{ symbol:'BHARTIARTL', name:'Bharti Airtel', type:'peer', sector:'Telecom' },
                  { symbol:'ITC',        name:'ITC',           type:'peer', sector:'FMCG' }],
  },
  TCS: {
    customers:   [{ symbol:'TATAMOTORS', name:'Tata Motors', type:'customer', rev_pct:5, sector:'Auto' },
                  { symbol:'TITAN',      name:'Titan',        type:'customer', sector:'Consumer' }],
    suppliers:   [{ symbol:'MPHASIS', name:'Mphasis',     type:'supplier', sector:'IT' },
                  { symbol:'LTIM',    name:'LTIMindtree', type:'supplier', sector:'IT' }],
    competitors: [{ symbol:'INFY',    name:'Infosys',       type:'competitor', sector:'IT' },
                  { symbol:'WIPRO',   name:'Wipro',         type:'competitor', sector:'IT' },
                  { symbol:'HCLTECH', name:'HCL Tech',      type:'competitor', sector:'IT' }],
    peers:       [{ symbol:'TECHM',   name:'Tech Mahindra', type:'peer', sector:'IT' },
                  { symbol:'LTIM',    name:'LTIMindtree',   type:'peer', sector:'IT' }],
  },
  HDFCBANK: {
    customers:   [{ symbol:'BAJFINANCE', name:'Bajaj Finance', type:'customer', sector:'NBFC' }],
    suppliers:   [{ symbol:'SBIN', name:'SBI', type:'supplier', sector:'Bank' }],
    competitors: [{ symbol:'ICICIBANK', name:'ICICI Bank',  type:'competitor', sector:'Bank' },
                  { symbol:'AXISBANK',  name:'Axis Bank',   type:'competitor', sector:'Bank' },
                  { symbol:'KOTAKBANK', name:'Kotak Bank',  type:'competitor', sector:'Bank' },
                  { symbol:'SBIN',      name:'SBI',         type:'competitor', sector:'Bank' }],
    peers:       [{ symbol:'INDUSINDBK', name:'IndusInd Bank', type:'peer', sector:'Bank' },
                  { symbol:'FEDERALBNK', name:'Federal Bank', type:'peer', sector:'Bank' }],
  },
  INFY: {
    customers:   [],
    suppliers:   [{ symbol:'COFORGE', name:'Coforge',  type:'supplier', sector:'IT' },
                  { symbol:'MPHASIS', name:'Mphasis',  type:'supplier', sector:'IT' }],
    competitors: [{ symbol:'TCS',     name:'TCS',      type:'competitor', sector:'IT' },
                  { symbol:'WIPRO',   name:'Wipro',    type:'competitor', sector:'IT' },
                  { symbol:'HCLTECH', name:'HCL Tech', type:'competitor', sector:'IT' }],
    peers:       [{ symbol:'TECHM',      name:'Tech Mahindra', type:'peer', sector:'IT' },
                  { symbol:'PERSISTENT',name:'Persistent',     type:'peer', sector:'IT' }],
  },
  TATAMOTORS: {
    customers:   [{ symbol:'MOTHERSON', name:'Samvardhana Motherson', type:'customer', sector:'Auto Ancillary' }],
    suppliers:   [{ symbol:'TATASTEEL',  name:'Tata Steel',    type:'supplier', rev_pct:22, sector:'Steel' },
                  { symbol:'BALKRISIND', name:'Balkrishna Ind', type:'supplier', sector:'Tyre' },
                  { symbol:'MOTHERSON',  name:'Samvardhana',    type:'supplier', rev_pct:8,  sector:'Auto Ancillary' }],
    competitors: [{ symbol:'M&M',       name:'Mahindra',      type:'competitor', sector:'Auto' },
                  { symbol:'MARUTI',    name:'Maruti Suzuki', type:'competitor', sector:'Auto' },
                  { symbol:'EICHERMOT', name:'Eicher Motors', type:'competitor', sector:'Auto' }],
    peers:       [{ symbol:'ASHOKLEY',   name:'Ashok Leyland', type:'peer', sector:'Commercial Vehicles' },
                  { symbol:'HEROMOTOCO', name:'Hero MotoCorp',  type:'peer', sector:'Two-Wheelers' }],
  },
  SUNPHARMA: {
    customers:   [],
    suppliers:   [{ symbol:'JUBILANT', name:'Jubilant Ingrevia', type:'supplier', sector:'Chemicals' },
                  { symbol:'AARTI',    name:'Aarti Industries',  type:'supplier', sector:'Chemicals' }],
    competitors: [{ symbol:'DRREDDY',    name:"Dr. Reddy's",  type:'competitor', sector:'Pharma' },
                  { symbol:'CIPLA',      name:'Cipla',        type:'competitor', sector:'Pharma' },
                  { symbol:'DIVISLAB',   name:"Divi's Labs",  type:'competitor', sector:'Pharma' },
                  { symbol:'AUROPHARMA', name:'Aurobindo',    type:'competitor', sector:'Pharma' }],
    peers:       [{ symbol:'TORNTPHARM', name:'Torrent Pharma', type:'peer', sector:'Pharma' },
                  { symbol:'IPCALAB',    name:'IPCA Labs',      type:'peer', sector:'Pharma' }],
  },
  MARUTI: {
    customers:   [],
    suppliers:   [{ symbol:'MOTHERSON',  name:'Samvardhana Motherson', type:'supplier', rev_pct:12, sector:'Auto Ancillary' },
                  { symbol:'BALKRISIND', name:'Balkrishna Ind',         type:'supplier', sector:'Tyre' },
                  { symbol:'TATASTEEL',  name:'Tata Steel',             type:'supplier', sector:'Steel' }],
    competitors: [{ symbol:'TATAMOTORS', name:'Tata Motors',  type:'competitor', sector:'Auto' },
                  { symbol:'M&M',        name:'Mahindra',     type:'competitor', sector:'Auto' }],
    peers:       [{ symbol:'HEROMOTOCO', name:'Hero MotoCorp', type:'peer', sector:'Two-Wheelers' },
                  { symbol:'BAJAJ-AUTO', name:'Bajaj Auto',   type:'peer', sector:'Two-Wheelers' }],
  },
  SBIN: {
    customers:   [],
    suppliers:   [],
    competitors: [{ symbol:'HDFCBANK',  name:'HDFC Bank',  type:'competitor', sector:'Bank' },
                  { symbol:'ICICIBANK', name:'ICICI Bank', type:'competitor', sector:'Bank' },
                  { symbol:'AXISBANK',  name:'Axis Bank',  type:'competitor', sector:'Bank' },
                  { symbol:'PNB',       name:'Punjab National Bank', type:'competitor', sector:'Bank' }],
    peers:       [{ symbol:'BANKBARODA', name:'Bank of Baroda', type:'peer', sector:'PSU Bank' },
                  { symbol:'CANARABANK', name:'Canara Bank',    type:'peer', sector:'PSU Bank' }],
  },
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const D = {
  bg:    '#06080f',
  sf:    '#0b0e18',
  sf2:   '#0f1220',
  bd:    '#1a2035',
  bd2:   '#242d45',
  blue:  '#3b82f6',
  cyan:  '#22d3ee',
  amber: '#f59e0b',
  green: '#10b981',
  red:   '#ef4444',
  purp:  '#8b5cf6',
  orange:'#f97316',
  text:  '#dde3f0',
  t2:    '#8896b3',
  t3:    '#454e6a',
} as const;

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(v?: number|null, d=2): string {
  if (v==null||isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
}
function fmtCr(v?: number|null): string {
  if (v==null) return '—';
  const n=Number(v), a=Math.abs(n);
  if (a>=1e12) return `₹${(n/1e12).toFixed(2)}T`;
  if (a>=1e9)  return `₹${(n/1e9).toFixed(2)}B`;
  if (a>=1e7)  return `₹${(n/1e7).toFixed(1)}Cr`;
  if (a>=1e5)  return `₹${(n/1e5).toFixed(0)}L`;
  return `₹${n.toFixed(0)}`;
}
function fmtPct(v?: number|null): string {
  if (v==null) return '—';
  const n=Number(v);
  return `${n>=0?'+':''}${n.toFixed(2)}%`;
}
function timeAgo(s?: string|null): string {
  if (!s) return '';
  try {
    const d=(Date.now()-new Date(s).getTime())/1000;
    if (d<3600)  return `${Math.floor(d/60)}m ago`;
    if (d<86400) return `${Math.floor(d/3600)}h ago`;
    return `${Math.floor(d/86400)}d ago`;
  } catch { return ''; }
}
function numColor(v?: number|null, good=true): string {
  if (v==null) return D.text;
  const n=Number(v);
  if (good) return n>0?D.green:n<0?D.red:D.text;
  return n>0?D.red:n<0?D.green:D.text;
}

// ── Scoring helpers ───────────────────────────────────────────────────────────
type ScoreResult = {label:string; color:string};
function scoreVal(metric:'pe'|'pb'|'roe'|'de'|'margin', v:number): ScoreResult {
  switch(metric) {
    case 'pe':
      if (v<=0)  return {label:'N/A',        color:D.t3};
      if (v<12)  return {label:'DEEP VALUE',  color:D.green};
      if (v<22)  return {label:'CHEAP',       color:D.green};
      if (v<35)  return {label:'FAIR',        color:D.amber};
      if (v<55)  return {label:'PREMIUM',     color:D.orange};
      return             {label:'EXPENSIVE',  color:D.red};
    case 'pb':
      if (v<1)   return {label:'DEEP VALUE',  color:D.green};
      if (v<2.5) return {label:'CHEAP',       color:D.green};
      if (v<5)   return {label:'FAIR',        color:D.amber};
      return             {label:'EXPENSIVE',  color:D.red};
    case 'roe':
      if (v>25)  return {label:'EXCELLENT',   color:D.green};
      if (v>15)  return {label:'GOOD',        color:D.cyan};
      if (v>8)   return {label:'FAIR',        color:D.amber};
      return             {label:'WEAK',       color:D.red};
    case 'de':
      if (v<0.2) return {label:'ZERO DEBT',   color:D.green};
      if (v<0.5) return {label:'LOW',         color:D.green};
      if (v<1)   return {label:'MODERATE',    color:D.amber};
      return             {label:'HIGH',       color:D.red};
    case 'margin':
      if (v>25)  return {label:'EXCELLENT',   color:D.green};
      if (v>15)  return {label:'GOOD',        color:D.cyan};
      if (v>8)   return {label:'FAIR',        color:D.amber};
      return             {label:'THIN',       color:D.red};
  }
}

function hl(text:string, q:string): React.ReactNode {
  if (!q||!text||q.length<2) return text;
  const i=text.toLowerCase().indexOf(q.toLowerCase());
  if (i===-1) return text;
  return (<>{text.slice(0,i)}<mark style={{background:`${D.amber}28`,color:D.amber,fontWeight:700,padding:'0 2px',borderRadius:1}}>{text.slice(i,i+q.length)}</mark>{text.slice(i+q.length)}</>);
}

// ── Sub-components ────────────────────────────────────────────────────────────
const Card: React.FC<{title:string; accent?:string; action?:React.ReactNode; children:React.ReactNode; noPad?:boolean}> =
  ({title, accent=D.blue, action, children, noPad}) => (
  <div style={{background:D.sf,border:`1px solid ${D.bd}`,borderLeft:`2px solid ${accent}`,marginBottom:12,borderRadius:2}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px 5px',borderBottom:`1px solid ${D.bd}`}}>
      <span style={{fontSize:9,fontWeight:800,letterSpacing:1.1,color:accent,textTransform:'uppercase'}}>{title}</span>
      {action}
    </div>
    <div style={noPad?{}:{padding:'8px 10px'}}>{children}</div>
  </div>
);

const MRow: React.FC<{label:string; value:React.ReactNode; color?:string}> = ({label,value,color}) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',borderBottom:`1px solid ${D.bd}`}}>
    <span style={{fontSize:10,color:D.t3}}>{label}</span>
    <span style={{fontSize:11,fontWeight:600,color:color||D.text,fontFamily:'Consolas,monospace',textAlign:'right',maxWidth:'62%'}}>{value}</span>
  </div>
);

const Tag: React.FC<{label:string; color?:string}> = ({label,color=D.cyan}) => (
  <span style={{display:'inline-block',padding:'1px 6px',fontSize:9,fontWeight:700,border:`1px solid ${color}44`,color,background:`${color}12`,borderRadius:2,marginRight:3,marginBottom:3}}>{label}</span>
);

const ScoreBadge: React.FC<{score:ScoreResult}> = ({score}) => (
  <span style={{fontSize:9,fontWeight:800,color:score.color,border:`1px solid ${score.color}44`,background:`${score.color}12`,padding:'1px 5px',borderRadius:2}}>{score.label}</span>
);

const MiniSparkBars: React.FC<{values:number[]; labels?:string[]; color?:string; height?:number}> =
  ({values, labels, color=D.blue, height=36}) => {
  const max = Math.max(...values.map(Math.abs), 0.01);
  return (
    <div style={{display:'flex',gap:2,alignItems:'flex-end',height}}>
      {values.map((v,i) => (
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
          <div style={{width:'100%',flex:1,background:D.bd,borderRadius:1,display:'flex',alignItems:'flex-end'}}>
            <div style={{width:'100%',height:`${Math.max(4,(Math.abs(v)/max)*100)}%`,background:v>=0?color:D.red,borderRadius:1,transition:'height 0.3s'}}/>
          </div>
          {labels && <span style={{fontSize:7,color:D.t3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%'}}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
};

const RatioBar: React.FC<{label:string; value:number; max:number; color?:string; suffix?:string}> =
  ({label, value, max, color=D.blue, suffix=''}) => {
  const pct = Math.min(100, Math.max(0, (value/max)*100));
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',borderBottom:`1px solid ${D.bd}`}}>
      <span style={{fontSize:9,color:D.t3,width:90,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
      <div style={{flex:1,height:4,background:D.bd,borderRadius:2}}>
        <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:2,transition:'width 0.4s'}}/>
      </div>
      <span style={{fontSize:10,fontWeight:600,color:D.text,fontFamily:'Consolas',width:44,textAlign:'right',flexShrink:0}}>{value.toFixed(1)}{suffix}</span>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const StockDeepDive: React.FC<Props> = ({isOpen, onClose, initialSymbol, onNavigate}) => {
  const [query,    setQuery]   = useState('');
  const [symbol,   setSymbol]  = useState(initialSymbol||'');
  const [tab,      setTab]     = useState<Tab>('overview');
  const [dcf,      setDcf]     = useState({growth:15, discount:12, targetPE:25, years:5});
  const [docQuery, setDocQuery]= useState('');
  const [docFilter,setDocFilter]=useState<'all'|'filings'|'news'>('all');
  const [researchRefresh, setResearchRefresh] = useState(0);
  const inputRef    = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const {data:searchResults} = useApiData<any[]>(
    query.length>=1 ? `/api/search?q=${encodeURIComponent(query)}&limit=8` : null, 0, 0
  );
  const {data, loading, error} = useApiData<any>(
    symbol ? `/api/company/deep-dive/${symbol}` : null, 0, 900000
  );
  const researchUrl = symbol && tab==='research'
    ? `/api/company/deep-research/${symbol}${researchRefresh>0?'?refresh=true':''}`
    : null;
  const {data:rd, loading:rdLoading} = useApiData<any>(researchUrl, 0, 1800000);

  useEffect(()=>{
    if (isOpen) {
      setTimeout(()=>inputRef.current?.focus(), 60);
      if (initialSymbol && initialSymbol!==symbol) {
        setSymbol(initialSymbol);
        setTab('overview');
      }
    }
  }, [isOpen, initialSymbol]);

  // Focus doc search input when switching to that tab
  useEffect(()=>{
    if (tab==='docsearch') setTimeout(()=>docInputRef.current?.focus(), 80);
  }, [tab]);

  const handleKey = useCallback((e:React.KeyboardEvent)=>{
    if (e.key==='Escape') { onClose(); return; }
    if (e.key==='Enter' && query.trim()) {
      setSymbol(query.trim().toUpperCase()); setQuery(''); setTab('overview');
    }
  }, [query, onClose]);

  const pick = useCallback((sym:string)=>{
    setSymbol(sym.toUpperCase()); setQuery(''); setTab('overview');
  }, []);

  // ── Data destructure (before early return so useMemos below can depend on these) ──
  const lq    = data?.live_quote        || {};
  const ov    = data?.overview          || {};
  const fu    = data?.fundamentals      || {};
  const sh    = data?.shareholding      || {};
  const qr    = fu.quarterly_results    || [];
  const peers = data?.peers || data?.sector_peers || [];

  // ── ALL useMemo hooks MUST be before early return ──────────────────────────
  const qrRevVals  = qr.slice(0,8).map((q:any)=>Number(q.revenue||0));
  const qrPatVals  = qr.slice(0,8).map((q:any)=>Number(q.pat||0));
  const qrLabels   = qr.slice(0,8).map((q:any)=>(q.period||'').toString().slice(-6));

  const dcfFair = useMemo(()=>{
    if (!fu.eps || Number(fu.eps)<=0) return null;
    const futureEps = Number(fu.eps) * Math.pow(1 + dcf.growth/100, dcf.years);
    return (futureEps * dcf.targetPE) / Math.pow(1 + dcf.discount/100, dcf.years);
  }, [fu.eps, dcf]);

  const docResults = useMemo(()=>{
    if (docQuery.length<2) return {filings:[] as any[], news:[] as any[]};
    const q=docQuery.toLowerCase();
    return {
      filings: docFilter!=='news'
        ? (data?.filings||[]).filter((f:any)=>
            (f.subject||'').toLowerCase().includes(q)||(f.summary||'').toLowerCase().includes(q)||(f.filing_type||'').toLowerCase().includes(q))
        : [],
      news: docFilter!=='filings'
        ? (data?.news||[]).filter((n:any)=>
            (n.headline||'').toLowerCase().includes(q)||(n.summary||'').toLowerCase().includes(q)||(n.category||'').toLowerCase().includes(q))
        : [],
    };
  }, [docQuery, docFilter, data]);

  const peerPE = useMemo(()=>{
    const rows = peers
      .map((p:any)=>({symbol:p.symbol||p.ticker||'',name:p.name||'',pe:Number(p.pe??p.pe_ratio??0)}))
      .filter((p:any)=>p.pe>0)
      .sort((a:any,b:any)=>a.pe-b.pe);
    const maxPE = Math.max(...rows.map((r:any)=>r.pe), fu.pe_ratio||0, 1);
    return {rows, maxPE};
  }, [peers, fu.pe_ratio]);

  const kpiPeers = useMemo(()=>{
    const valid = peers.filter((p:any)=>(p.pe??p.pe_ratio)!=null||(p.market_cap)!=null);
    const maxMCap = Math.max(...valid.map((p:any)=>Number(p.market_cap||0)), 1);
    const maxPE   = Math.max(...valid.map((p:any)=>Number(p.pe??p.pe_ratio??0)), 1);
    return {valid, maxMCap, maxPE};
  }, [peers]);

  // ── Early return AFTER all hooks ──────────────────────────────────────────
  if (!isOpen) return null;

  const dcfUpside = dcfFair && lq.price ? ((dcfFair - lq.price)/lq.price)*100 : null;
  const isSelf = (sym:string) => sym.toUpperCase()===symbol.toUpperCase();

  // ── KPIC ─────────────────────────────────────────────────────────────────
  const sector_peers_live: any[] = data?.sector_peers || [];
  const staticSC: SCData = SUPPLY_CHAIN[symbol] || {customers:[],suppliers:[],competitors:[],peers:[]};
  const sc: SCData = (() => {
    if (staticSC.competitors.length + staticSC.suppliers.length + staticSC.customers.length > 0) {
      return staticSC;
    }
    // Dynamic fallback: use screener peers as industry competitors + sector peers map as peers
    const fromPeers = peers.slice(0,8).map((p:any):SCRelation => ({
      symbol: (p.symbol||p.ticker||'').toUpperCase(),
      name:   p.name||p.symbol||'',
      type:   'competitor' as const,
      sector: ov.sector||'',
    })).filter((r:SCRelation)=>r.symbol && r.symbol!==symbol);
    const fromSector = sector_peers_live.slice(0,6).map((p:any):SCRelation => ({
      symbol: (p.symbol||'').toUpperCase(),
      name:   p.name||p.symbol||'',
      type:   'peer' as const,
      sector: ov.sector||'',
    })).filter((r:SCRelation)=>r.symbol && r.symbol!==symbol && !fromPeers.find(x=>x.symbol===r.symbol));
    return {customers:[], suppliers:[], competitors:fromPeers, peers:fromSector};
  })();
  const scHasData = sc.competitors.length + sc.peers.length + sc.customers.length + sc.suppliers.length > 0;

  // ── Sub renders for SC rows ───────────────────────────────────────────────
  const REL_COLOR: Record<string,string> = {customer:D.cyan, supplier:D.purp, competitor:D.orange, peer:D.green};
  const SCRow = ({r}:{r:SCRelation}) => (
    <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${D.bd}`,fontSize:10}}>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span style={{color:D.amber,fontWeight:700,cursor:'pointer',minWidth:80,fontSize:11}} onClick={()=>pick(r.symbol)}>{r.symbol}</span>
        <span style={{color:D.t2}}>{r.name}</span>
      </div>
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        {r.rev_pct!=null&&<span style={{fontSize:9,color:D.t3}}>{r.rev_pct}% rev</span>}
        {r.sector&&<span style={{fontSize:9,color:D.t3,background:D.sf2,padding:'0 4px',borderRadius:2}}>{r.sector}</span>}
        <span style={{fontSize:8,fontWeight:700,padding:'1px 5px',color:REL_COLOR[r.type],border:`1px solid ${REL_COLOR[r.type]}44`,borderRadius:2}}>{r.type.toUpperCase()}</span>
      </div>
    </div>
  );

  // ═════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div
      style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:44}}
      onClick={e=>{if(e.target===e.currentTarget) onClose();}}
    >
      <div style={{width:'93vw',maxWidth:1200,maxHeight:'90vh',background:D.bg,border:`1px solid ${D.bd2}`,display:'flex',flexDirection:'column',boxShadow:`0 24px 80px rgba(0,0,0,0.95),0 0 0 1px ${D.bd}`}}>

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',borderBottom:`1px solid ${D.bd}`,background:D.sf,flexShrink:0}}>
          <span style={{color:D.blue,fontWeight:900,fontSize:10,letterSpacing:2,whiteSpace:'nowrap',fontFamily:'Consolas,monospace'}}>BTI / DEEP DIVE</span>
          <div style={{width:1,height:14,background:D.bd,flexShrink:0}}/>
          <div style={{position:'relative',flex:1}}>
            <input
              ref={inputRef}
              value={query}
              onChange={e=>setQuery(e.target.value.toUpperCase())}
              onKeyDown={handleKey}
              placeholder="Search symbol — RELIANCE, TCS, HDFCBANK, INFY…"
              style={{width:'100%',background:'transparent',border:`1px solid ${D.bd}`,color:D.text,padding:'5px 10px',fontSize:12,fontFamily:'Consolas,monospace',outline:'none',boxSizing:'border-box',borderRadius:2}}
            />
            {query.length>0 && searchResults && searchResults.length>0 && (
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:D.sf,border:`1px solid ${D.bd2}`,zIndex:1000,maxHeight:260,overflowY:'auto',borderRadius:2,boxShadow:`0 8px 32px rgba(0,0,0,0.8)`}}>
                {searchResults.map((s:any,i:number)=>(
                  <div key={i} onClick={()=>pick(s.symbol||s)}
                    style={{padding:'7px 10px',cursor:'pointer',fontSize:11,display:'flex',gap:10,alignItems:'center',borderBottom:`1px solid ${D.bd}`}}
                    onMouseEnter={e=>(e.currentTarget.style.background=D.sf2)}
                    onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                    <span style={{color:D.amber,fontWeight:700,minWidth:90,fontSize:12,fontFamily:'Consolas'}}>{s.symbol}</span>
                    <span style={{color:D.t2,flex:1}}>{s.name||''}</span>
                    {s.sector&&<span style={{color:D.t3,fontSize:9}}>{s.sector}</span>}
                    {s.price&&(
                      <span style={{color:s.change_pct>=0?D.green:D.red,fontWeight:700,fontSize:10,fontFamily:'Consolas'}}>
                        ₹{s.price.toFixed(2)} {s.change_pct!=null?`(${s.change_pct>0?'+':''}${s.change_pct.toFixed(2)}%)`:''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {symbol && (
            <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
              <div style={{width:1,height:14,background:D.bd}}/>
              <span style={{color:D.amber,fontWeight:900,fontSize:15,fontFamily:'Consolas'}}>{symbol}</span>
              {lq.price>0&&(
                <>
                  <span style={{color:D.text,fontWeight:700,fontFamily:'Consolas'}}>₹{fmt(lq.price)}</span>
                  <span style={{color:numColor(lq.change_pct),fontWeight:700,fontSize:11,fontFamily:'Consolas'}}>{fmtPct(lq.change_pct)}</span>
                </>
              )}
              <a href={`https://www.screener.in/company/${symbol}/`} target="_blank" rel="noreferrer"
                style={{color:D.cyan,fontSize:9,textDecoration:'none',border:`1px solid ${D.cyan}33`,padding:'1px 5px',borderRadius:2}}>
                screener ↗
              </a>
            </div>
          )}
          <button onClick={onClose}
            style={{background:'transparent',border:`1px solid ${D.bd}`,color:D.t3,padding:'3px 8px',cursor:'pointer',fontFamily:'Consolas',flexShrink:0,fontSize:10,borderRadius:2}}>
            ESC
          </button>
        </div>

        {/* ── EMPTY STATE ──────────────────────────────────────────────── */}
        {!symbol && (
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:24}}>
            <div style={{fontSize:11,color:D.t2,letterSpacing:1}}>ENTER ANY NSE / BSE SYMBOL</div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'center',maxWidth:520}}>
              {['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','WIPRO','ADANIENT','BAJFINANCE','TATAMOTORS','ITC','LTIM','SUNPHARMA','ONGC','MARUTI'].map(s=>(
                <button key={s} onClick={()=>pick(s)}
                  style={{background:'transparent',border:`1px solid ${D.bd2}`,color:D.amber,padding:'3px 10px',cursor:'pointer',fontSize:10,fontFamily:'Consolas',borderRadius:2}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor=D.amber;}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor=D.bd2;}}>
                  {s}
                </button>
              ))}
            </div>
            <div style={{fontSize:10,color:D.t3}}>OVERVIEW · MODL · DOC SEARCH · KPIC · FINANCIALS · HOLDING · EARNINGS · PEERS · FILINGS · NEWS · INSIDER · AI</div>
          </div>
        )}

        {/* ── LOADING ──────────────────────────────────────────────────── */}
        {symbol && loading && (
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:D.t2}}>
            <div className="spinner" style={{width:22,height:22}}/>
            <div style={{fontSize:11}}>Loading {symbol}</div>
          </div>
        )}

        {/* ── ERROR ────────────────────────────────────────────────────── */}
        {symbol && !loading && error && (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,color:D.red,fontSize:12}}>
            <div>Failed to load {symbol}</div>
            <div style={{fontSize:10,color:D.t3}}>{error}</div>
          </div>
        )}

        {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
        {symbol && !loading && data && (
          <>
            {/* ── TAB BAR ──────────────────────────────────────────────── */}
            <div style={{display:'flex',background:D.bg,padding:'5px 10px',gap:3,borderBottom:`1px solid ${D.bd}`,overflowX:'auto',flexShrink:0}}>
              {TABS.map(t=>{
                const active = tab===t.id;
                const accent = t.accent||(active?D.blue:undefined);
                return (
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{
                    padding:'4px 11px',border:'none',borderRadius:20,cursor:'pointer',
                    fontSize:9,fontWeight:800,fontFamily:'Consolas,monospace',whiteSpace:'nowrap',
                    background:active?(accent||D.blue):'transparent',
                    color:active?'#fff':(t.accent||D.t3),
                    letterSpacing:0.5,
                    outline:'none',
                    transition:'all 0.12s',
                  }}>
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* ── CONTENT AREA ─────────────────────────────────────────── */}
            <div style={{flex:1,overflowY:'auto',padding:'12px 14px'}}>

              {/* ════════════════════════════════════════════════════════ */}
              {/* OVERVIEW                                                  */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='overview' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  <div>
                    <Card title="Company Profile" accent={D.amber}>
                      {ov.description&&<div style={{fontSize:10,color:D.t2,lineHeight:1.75,marginBottom:10}}>{ov.description}</div>}
                      <MRow label="Sector"     value={ov.sector||'—'}/>
                      <MRow label="Industry"   value={ov.industry||'—'}/>
                      <MRow label="NSE Symbol" value={symbol} color={D.amber}/>
                      {ov.bse_code&&<MRow label="BSE Code" value={ov.bse_code}/>}
                      {ov.isin&&<MRow label="ISIN" value={ov.isin}/>}
                      {ov.website&&<MRow label="Website" value={<a href={ov.website} target="_blank" rel="noreferrer" style={{color:D.cyan}}>{ov.website}</a>}/>}
                    </Card>
                    <Card title="Key Management" accent={D.t3}>
                      {(ov.management||[]).length>0
                        ? (ov.management as any[]).slice(0,8).map((m:any,i:number)=>(
                            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:`1px solid ${D.bd}`,fontSize:10}}>
                              <span style={{color:D.t2}}>{m.name}</span>
                              <span style={{color:D.t3,fontSize:9}}>{m.title||m.designation}</span>
                            </div>
                          ))
                        : <div style={{fontSize:10,color:D.t3}}>Management on <a href={`https://www.screener.in/company/${symbol}/`} target="_blank" rel="noreferrer" style={{color:D.cyan}}>screener.in ↗</a></div>
                      }
                    </Card>
                  </div>
                  <div>
                    <Card title="Live Market" accent={D.green}>
                      <MRow label="LTP"         value={lq.price?`₹${fmt(lq.price)}`:'—'} color={D.amber}/>
                      <MRow label="Change"       value={fmtPct(lq.change_pct)} color={numColor(lq.change_pct)}/>
                      <MRow label="Market Cap"   value={fmtCr(lq.market_cap||fu.market_cap)}/>
                      <MRow label="52W High"     value={lq.high_52w?`₹${fmt(lq.high_52w)}`:'—'} color={D.green}/>
                      <MRow label="52W Low"      value={lq.low_52w?`₹${fmt(lq.low_52w)}`:'—'} color={D.red}/>
                      <MRow label="Volume"       value={lq.volume?Number(lq.volume).toLocaleString('en-IN'):'—'}/>
                    </Card>
                    <Card title="Key Ratios" accent={D.blue}>
                      <MRow label="P/E"          value={fmt(fu.pe_ratio)}/>
                      <MRow label="P/B"          value={fmt(fu.pb_ratio)}/>
                      <MRow label="EV/EBITDA"    value={fmt(fu.ev_ebitda)}/>
                      <MRow label="ROE"          value={fu.roe?`${fmt(fu.roe)}%`:'—'} color={fu.roe>15?D.green:undefined}/>
                      <MRow label="ROCE"         value={fu.roce?`${fmt(fu.roce)}%`:'—'} color={fu.roce>12?D.green:undefined}/>
                      <MRow label="D/E"          value={fmt(fu.debt_equity)} color={fu.debt_equity>1?D.orange:D.green}/>
                      <MRow label="Net Margin"   value={fu.net_margin?`${fmt(fu.net_margin)}%`:'—'}/>
                      <MRow label="Div Yield"    value={fu.dividend_yield?`${fmt(fu.dividend_yield)}%`:'—'}/>
                    </Card>
                    <Card title="Shareholding" accent={D.purp}>
                      {[{label:'PROMOTER',pct:sh.promoter_pct,color:'#f59e0b'},{label:'FII/FPI',pct:sh.fii_pct,color:D.cyan},{label:'DII/MF',pct:sh.dii_pct,color:D.purp},{label:'PUBLIC',pct:sh.public_pct,color:D.green}].map(b=>(
                        <div key={b.label} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:`1px solid ${D.bd}`,fontSize:10}}>
                          <span style={{color:D.t3}}>{b.label}</span>
                          <span style={{color:b.color,fontWeight:700,fontFamily:'Consolas'}}>{b.pct!=null?`${fmt(b.pct)}%`:'—'}</span>
                        </div>
                      ))}
                      {sh.pledge_pct!=null&&sh.pledge_pct>0&&(
                        <div style={{marginTop:6,padding:'4px 8px',background:sh.pledge_pct>10?`${D.red}08`:`${D.green}06`,border:`1px solid ${sh.pledge_pct>10?D.red+'33':D.green+'22'}`,borderRadius:2,fontSize:10}}>
                          <span style={{color:D.t3}}>Pledge: </span>
                          <span style={{color:sh.pledge_pct>10?D.red:D.green,fontWeight:700}}>{fmt(sh.pledge_pct)}%</span>
                          {sh.pledge_pct>10&&<span style={{color:D.red,fontSize:9,marginLeft:6}}>⚠ High</span>}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* MODL — Financial Modeling & Metrics                      */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='modl' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

                  {/* LEFT */}
                  <div>
                    {/* Valuation Scorecard */}
                    <Card title="Valuation Scorecard" accent={D.blue}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        {[
                          {label:'P/E Ratio',  val:fu.pe_ratio,   metric:'pe'   as const, fmt2:(v:number)=>v.toFixed(1)+'x'},
                          {label:'P/B Ratio',  val:fu.pb_ratio,   metric:'pb'   as const, fmt2:(v:number)=>v.toFixed(2)+'x'},
                          {label:'EV/EBITDA',  val:fu.ev_ebitda,  metric:'pe'   as const, fmt2:(v:number)=>v.toFixed(1)+'x'},
                          {label:'ROE',        val:fu.roe,        metric:'roe'  as const, fmt2:(v:number)=>v.toFixed(1)+'%'},
                          {label:'ROCE',       val:fu.roce,       metric:'roe'  as const, fmt2:(v:number)=>v.toFixed(1)+'%'},
                          {label:'Net Margin', val:fu.net_margin, metric:'margin' as const, fmt2:(v:number)=>v.toFixed(1)+'%'},
                          {label:'D/E Ratio',  val:fu.debt_equity,metric:'de'   as const, fmt2:(v:number)=>v.toFixed(2)+'x'},
                          {label:'Int Coverage',val:fu.interest_coverage,metric:'roe' as const,fmt2:(v:number)=>v.toFixed(1)+'x'},
                        ].map(row=>{
                          const v = row.val!=null?Number(row.val):null;
                          const score = v!=null?scoreVal(row.metric,v):null;
                          return (
                            <div key={row.label} style={{background:D.sf2,border:`1px solid ${D.bd}`,borderRadius:2,padding:'8px 10px'}}>
                              <div style={{fontSize:9,color:D.t3,marginBottom:4}}>{row.label}</div>
                              <div style={{fontSize:16,fontWeight:800,color:D.text,fontFamily:'Consolas',marginBottom:4}}>
                                {v!=null?row.fmt2(v):'—'}
                              </div>
                              {score&&<ScoreBadge score={score}/>}
                            </div>
                          );
                        })}
                      </div>
                    </Card>

                    {/* Quarterly Revenue Trend */}
                    {qrRevVals.some(v=>v>0) && (
                      <Card title="Revenue Trend — 8 Qtrs" accent={D.cyan}>
                        <MiniSparkBars values={[...qrRevVals].reverse()} labels={[...qrLabels].reverse()} color={D.cyan} height={48}/>
                        <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
                          <span style={{fontSize:9,color:D.t3}}>Latest: {fmtCr(qrRevVals[0])}</span>
                          <span style={{fontSize:9,color:D.t3}}>8Q ago: {fmtCr(qrRevVals[qrRevVals.length-1]||0)}</span>
                        </div>
                      </Card>
                    )}

                    {/* PAT Trend */}
                    {qrPatVals.some(v=>v!==0) && (
                      <Card title="PAT Trend — 8 Qtrs" accent={D.green}>
                        <MiniSparkBars values={[...qrPatVals].reverse()} labels={[...qrLabels].reverse()} color={D.green} height={40}/>
                        <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
                          <span style={{fontSize:9,color:D.t3}}>Latest PAT: {fmtCr(qrPatVals[0])}</span>
                          <span style={{fontSize:9,color:fu.pat_growth_yoy>0?D.green:D.red,fontWeight:700,fontFamily:'Consolas'}}>
                            YoY: {fu.pat_growth_yoy!=null?fmtPct(fu.pat_growth_yoy):'—'}
                          </span>
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* RIGHT */}
                  <div>
                    {/* DCF Quick Model */}
                    <Card title="DCF Quick Model" accent={D.purp}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                        {[
                          {label:'EPS Growth % / yr', key:'growth',  min:0,  max:50, step:1},
                          {label:'Discount Rate %',   key:'discount',min:8,  max:25, step:0.5},
                          {label:'Target P/E',        key:'targetPE',min:10, max:80, step:1},
                          {label:'Years',             key:'years',   min:1,  max:10, step:1},
                        ].map(({label,key,min,max,step})=>(
                          <div key={key} style={{background:D.sf2,border:`1px solid ${D.bd}`,borderRadius:2,padding:'7px 9px'}}>
                            <div style={{fontSize:9,color:D.t3,marginBottom:4}}>{label}</div>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <input
                                type="number" min={min} max={max} step={step}
                                value={dcf[key as keyof typeof dcf]}
                                onChange={e=>setDcf(d=>({...d,[key]:Number(e.target.value)}))}
                                style={{width:'100%',background:'transparent',border:`1px solid ${D.bd2}`,color:D.text,padding:'3px 6px',fontFamily:'Consolas',fontSize:13,fontWeight:700,borderRadius:2,outline:'none'}}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Base EPS display */}
                      <div style={{padding:'6px 8px',background:D.sf2,border:`1px solid ${D.bd}`,borderRadius:2,marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span style={{fontSize:9,color:D.t3}}>Base EPS (TTM)</span>
                          <span style={{fontSize:12,fontWeight:700,color:D.text,fontFamily:'Consolas'}}>
                            {fu.eps?`₹${fmt(fu.eps)}`:'—'}
                          </span>
                        </div>
                      </div>

                      {/* Result */}
                      <div style={{padding:'10px 12px',background:dcfUpside!=null?(dcfUpside>0?`${D.green}0c`:`${D.red}0c`):D.sf2,border:`1px solid ${dcfUpside!=null?(dcfUpside>0?D.green+'44':D.red+'44'):D.bd}`,borderRadius:2}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                          <span style={{fontSize:9,color:D.t2,fontWeight:700,letterSpacing:0.5}}>FAIR VALUE</span>
                          <span style={{fontSize:18,fontWeight:900,color:D.text,fontFamily:'Consolas'}}>
                            {dcfFair!=null?`₹${fmt(dcfFair,0)}`:'—'}
                          </span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
                          <span style={{color:D.t3}}>Current ₹{lq.price?fmt(lq.price,0):'—'}</span>
                          <span style={{color:dcfUpside!=null?(dcfUpside>0?D.green:D.red):D.t3,fontWeight:700,fontFamily:'Consolas'}}>
                            {dcfUpside!=null?`${dcfUpside>0?'+':''}${dcfUpside.toFixed(1)}% Upside`:'—'}
                          </span>
                        </div>
                        {!fu.eps&&<div style={{fontSize:9,color:D.t3,marginTop:4}}>EPS data required for calculation</div>}
                      </div>
                      <div style={{fontSize:9,color:D.t3,marginTop:6,lineHeight:1.5}}>
                        Model: EPS × (1+g)^n × P/E_target ÷ (1+r)^n · Not financial advice.
                      </div>
                    </Card>

                    {/* Peer P/E Comparison */}
                    {peerPE.rows.length>0 && (
                      <Card title="Peer P/E Comparison" accent={D.amber}>
                        {/* Insert current company if not already in peers */}
                        {(()=>{
                          const rows = [...peerPE.rows];
                          if (fu.pe_ratio>0 && !rows.find(r=>isSelf(r.symbol))) {
                            rows.push({symbol, name:ov.name||symbol, pe:fu.pe_ratio});
            rows.sort((a,b)=>a.pe-b.pe);
                          }
                          const maxPE = Math.max(peerPE.maxPE, fu.pe_ratio||0, 1);
                          return rows.slice(0,10).map((r,i)=>(
                            <RatioBar
                              key={i}
                              label={isSelf(r.symbol)?`★ ${r.symbol}`:r.symbol}
                              value={r.pe}
                              max={maxPE}
                              color={isSelf(r.symbol)?D.amber:D.blue}
                              suffix="x"
                            />
                          ));
                        })()}
                      </Card>
                    )}

                    {/* Historical Performance Summary */}
                    <Card title="Historical Performance" accent={D.green}>
                      <MRow label="Revenue (TTM)"      value={fmtCr(fu.revenue)}/>
                      <MRow label="Rev Growth YoY"     value={fu.revenue_growth_yoy?fmtPct(fu.revenue_growth_yoy):'—'} color={numColor(fu.revenue_growth_yoy)}/>
                      <MRow label="EBITDA Margin"      value={fu.ebitda_margin?`${fmt(fu.ebitda_margin)}%`:'—'}/>
                      <MRow label="PAT (TTM)"          value={fmtCr(fu.net_income)}/>
                      <MRow label="PAT Growth YoY"     value={fu.pat_growth_yoy?fmtPct(fu.pat_growth_yoy):'—'} color={numColor(fu.pat_growth_yoy)}/>
                      <MRow label="Free Cash Flow"     value={fmtCr(fu.free_cash_flow)} color={fu.free_cash_flow>0?D.green:D.red}/>
                      <MRow label="Op Cash Flow"       value={fmtCr(fu.operating_cash_flow)} color={fu.operating_cash_flow>0?D.green:D.red}/>
                      <MRow label="Book Value / Share" value={fu.book_value?`₹${fmt(fu.book_value)}`:'—'}/>
                    </Card>
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* DOC SEARCH — Document Intelligence & AI Search           */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='docsearch' && (
                <div>
                  {/* Search bar */}
                  <div style={{marginBottom:12}}>
                    <div style={{position:'relative'}}>
                      <input
                        ref={docInputRef}
                        value={docQuery}
                        onChange={e=>setDocQuery(e.target.value)}
                        placeholder={`Search filings, news & research for ${symbol}… (e.g. "dividend", "capex", "results", "acquisition")`}
                        style={{
                          width:'100%',background:D.sf,border:`1px solid ${D.purp}`,
                          color:D.text,padding:'10px 14px',fontSize:13,
                          fontFamily:'Consolas,monospace',outline:'none',
                          boxSizing:'border-box',borderRadius:3,
                          boxShadow:`0 0 0 1px ${D.purp}22`,
                        }}
                      />
                      {docQuery&&(
                        <button onClick={()=>setDocQuery('')}
                          style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'transparent',border:'none',color:D.t3,cursor:'pointer',fontSize:14}}>
                          ×
                        </button>
                      )}
                    </div>

                    {/* Filter chips */}
                    <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center'}}>
                      <span style={{fontSize:9,color:D.t3}}>FILTER:</span>
                      {(['all','filings','news'] as const).map(f=>(
                        <button key={f} onClick={()=>setDocFilter(f)}
                          style={{padding:'3px 10px',borderRadius:20,border:`1px solid ${docFilter===f?D.purp:D.bd}`,background:docFilter===f?`${D.purp}20`:'transparent',color:docFilter===f?D.purp:D.t3,fontSize:9,fontWeight:700,cursor:'pointer',fontFamily:'Consolas'}}>
                          {f.toUpperCase()}
                        </button>
                      ))}
                      <div style={{marginLeft:'auto',fontSize:9,color:D.t3}}>
                        {(data?.filings||[]).length} filings · {(data?.news||[]).length} news indexed
                      </div>
                    </div>
                  </div>

                  {/* No query: show index summary + quick searches */}
                  {docQuery.length<2 && (
                    <div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
                        {[
                          {label:'Filings Indexed',    val:(data?.filings||[]).length,  color:D.cyan,  desc:'BSE/NSE announcements'},
                          {label:'News Articles',      val:(data?.news||[]).length,      color:D.green, desc:'Last 30 days'},
                          {label:'Insider Trades',     val:(data?.insider_trades||[]).length, color:D.amber, desc:'Bulk + SAST deals'},
                        ].map(s=>(
                          <div key={s.label} style={{background:D.sf,border:`1px solid ${D.bd}`,borderLeft:`2px solid ${s.color}`,padding:'10px 12px',borderRadius:2}}>
                            <div style={{fontSize:20,fontWeight:900,color:s.color,fontFamily:'Consolas'}}>{s.val}</div>
                            <div style={{fontSize:10,fontWeight:700,color:D.t2,marginTop:2}}>{s.label}</div>
                            <div style={{fontSize:9,color:D.t3}}>{s.desc}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:9,color:D.t3,marginBottom:6,letterSpacing:1}}>QUICK SEARCHES</div>
                        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                          {['dividend','results','acquisition','capex','buyback','fundraise','order','plant','expansion','default','penalty','AGM','board','rights issue'].map(q=>(
                            <button key={q} onClick={()=>setDocQuery(q)}
                              style={{padding:'3px 9px',borderRadius:20,border:`1px solid ${D.bd2}`,background:'transparent',color:D.t2,fontSize:9,cursor:'pointer',fontFamily:'Consolas'}}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{padding:'16px',background:D.sf,border:`1px solid ${D.bd}`,borderRadius:2,borderLeft:`2px solid ${D.purp}`}}>
                        <div style={{fontSize:10,color:D.t2,lineHeight:1.7}}>
                          Search across all <strong style={{color:D.purp}}>filings</strong>, <strong style={{color:D.green}}>news</strong>, and <strong style={{color:D.cyan}}>announcements</strong> for {symbol} using plain language.
                          Results are ranked by relevance and include the full text snippet with matched terms highlighted.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {docQuery.length>=2 && (()=>{
                    const totalHits = docResults.filings.length + docResults.news.length;
                    return (
                      <div>
                        <div style={{fontSize:10,color:D.t2,marginBottom:10}}>
                          <span style={{color:D.purp,fontWeight:700}}>{totalHits}</span> results for &ldquo;<span style={{color:D.amber}}>{docQuery}</span>&rdquo; in {symbol}
                        </div>

                        {totalHits===0&&(
                          <div style={{padding:'24px',textAlign:'center',color:D.t3,fontSize:11,background:D.sf,border:`1px solid ${D.bd}`,borderRadius:2}}>
                            No matches found. Try a different keyword.
                          </div>
                        )}

                        {/* Filing results */}
                        {docResults.filings.length>0&&(
                          <Card title={`Filings (${docResults.filings.length})`} accent={D.cyan} noPad>
                            {docResults.filings.map((f:any,i:number)=>(
                              <div key={i}
                                style={{padding:'9px 12px',borderBottom:`1px solid ${D.bd}`,cursor:f.url?'pointer':'default'}}
                                onClick={()=>f.url&&window.open(f.url,'_blank')}
                                onMouseEnter={e=>{if(f.url)(e.currentTarget as HTMLDivElement).style.background=D.sf2;}}
                                onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background='transparent';}}>
                                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}>
                                  <Tag label={f.filing_type||f.exchange||'FILING'} color={D.cyan}/>
                                  <span style={{fontSize:9,color:D.t3,marginLeft:'auto'}}>{timeAgo(f.created_at||f.filed_at)}</span>
                                  {f.url&&<span style={{fontSize:9,color:D.cyan}}>↗</span>}
                                </div>
                                <div style={{fontSize:11,color:D.text,lineHeight:1.5}}>
                                  {hl(f.subject||f.description||'',docQuery)}
                                </div>
                                {f.summary&&(
                                  <div style={{fontSize:10,color:D.t2,marginTop:3,lineHeight:1.5}}>
                                    {hl((f.summary||'').slice(0,200)+(f.summary?.length>200?'…':''),docQuery)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </Card>
                        )}

                        {/* News results */}
                        {docResults.news.length>0&&(
                          <Card title={`News (${docResults.news.length})`} accent={D.green} noPad>
                            {docResults.news.map((n:any,i:number)=>(
                              <div key={i}
                                style={{padding:'9px 12px',borderBottom:`1px solid ${D.bd}`,cursor:n.url?'pointer':'default'}}
                                onClick={()=>n.url&&window.open(n.url,'_blank')}
                                onMouseEnter={e=>{if(n.url)(e.currentTarget as HTMLDivElement).style.background=D.sf2;}}
                                onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background='transparent';}}>
                                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}>
                                  {n.category&&<Tag label={n.category.toUpperCase()} color={D.green}/>}
                                  <span style={{fontSize:9,color:n.sentiment>0.2?D.green:n.sentiment<-0.2?D.red:D.t3,fontWeight:700}}>
                                    {n.sentiment>0.3?'▲▲':n.sentiment>0.1?'▲':n.sentiment<-0.3?'▼▼':n.sentiment<-0.1?'▼':''}
                                  </span>
                                  <span style={{fontSize:9,color:D.t3,marginLeft:'auto'}}>{timeAgo(n.created_at)}</span>
                                  {n.url&&<span style={{fontSize:9,color:D.green}}>↗</span>}
                                </div>
                                <div style={{fontSize:11,color:D.text,lineHeight:1.5}}>
                                  {hl(n.headline||'',docQuery)}
                                </div>
                                {n.summary&&(
                                  <div style={{fontSize:10,color:D.t2,marginTop:3,lineHeight:1.5}}>
                                    {hl((n.summary||'').slice(0,200)+(n.summary?.length>200?'…':''),docQuery)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </Card>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* KPIC — Supply Chain & Industry Trends                    */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='kpic' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

                  {/* LEFT */}
                  <div>
                    {scHasData ? (
                      <>
                        {sc.suppliers.length>0&&(
                          <Card title={`Suppliers (${sc.suppliers.length})`} accent={D.purp}>
                            {sc.suppliers.map((r,i)=><SCRow key={i} r={r}/>)}
                          </Card>
                        )}
                        {sc.customers.length>0&&(
                          <Card title={`Key Customers (${sc.customers.length})`} accent={D.cyan}>
                            {sc.customers.map((r,i)=><SCRow key={i} r={r}/>)}
                          </Card>
                        )}
                        {sc.customers.length===0&&sc.suppliers.length===0&&(
                          <Card title="Supply Chain" accent={D.t3}>
                            <div style={{fontSize:10,color:D.t3,textAlign:'center',padding:'12px 0'}}>No customer/supplier data mapped</div>
                          </Card>
                        )}
                      </>
                    ) : (
                      <Card title="Supply Chain Map" accent={D.t3}>
                        <div style={{padding:'16px 0',textAlign:'center',color:D.t3,fontSize:11}}>
                          Supply chain map not yet available for {symbol}.<br/>
                          <span style={{fontSize:9,color:D.t3,marginTop:4,display:'block'}}>Mapped: RELIANCE · TCS · HDFCBANK · INFY · TATAMOTORS · SUNPHARMA · MARUTI · SBIN</span>
                        </div>
                      </Card>
                    )}

                    {/* Industry KPI Benchmark — P/E vs Peers */}
                    {kpiPeers.valid.length>0 && (
                      <Card title="Industry P/E Benchmark" accent={D.blue}>
                        {(()=>{
                          const rows = kpiPeers.valid
                            .map((p:any)=>({sym:p.symbol||p.ticker||'',pe:Number(p.pe??p.pe_ratio??0)}))
                            .filter((r:any)=>r.pe>0)
                            .sort((a:any,b:any)=>a.pe-b.pe)
                            .slice(0,8);
                          if (fu.pe_ratio>0&&!rows.find((r:any)=>isSelf(r.sym))) {
                            rows.push({sym:symbol, pe:fu.pe_ratio});
                            rows.sort((a:any,b:any)=>a.pe-b.pe);
                          }
                          const maxPE = Math.max(...rows.map((r:any)=>r.pe), 1);
                          return rows.map((r:any,i:number)=>(
                            <RatioBar key={i} label={isSelf(r.sym)?`★ ${r.sym}`:r.sym} value={r.pe} max={maxPE} color={isSelf(r.sym)?D.amber:D.blue} suffix="x"/>
                          ));
                        })()}
                      </Card>
                    )}
                  </div>

                  {/* RIGHT */}
                  <div>
                    {sc.competitors.length>0&&(
                      <Card title={`Competitors (${sc.competitors.length})`} accent={D.orange}>
                        {sc.competitors.map((r,i)=><SCRow key={i} r={r}/>)}
                      </Card>
                    )}
                    {sc.peers.length>0&&(
                      <Card title={`Sector Peers (${sc.peers.length})`} accent={D.green}>
                        {sc.peers.map((r,i)=><SCRow key={i} r={r}/>)}
                      </Card>
                    )}

                    {/* Market Cap vs Peers */}
                    {kpiPeers.valid.length>0 && (
                      <Card title="Market Cap vs Peers" accent={D.cyan}>
                        {(()=>{
                          const rows = kpiPeers.valid
                            .map((p:any)=>({sym:p.symbol||p.ticker||'',mc:Number(p.market_cap||0)}))
                            .filter((r:any)=>r.mc>0)
                            .sort((a:any,b:any)=>b.mc-a.mc)
                            .slice(0,8);
                          if ((lq.market_cap||fu.market_cap)&&!rows.find((r:any)=>isSelf(r.sym))) {
                            rows.push({sym:symbol, mc:Number(lq.market_cap||fu.market_cap||0)});
                            rows.sort((a:any,b:any)=>b.mc-a.mc);
                          }
                          const maxMC = Math.max(...rows.map((r:any)=>r.mc), 1);
                          return rows.slice(0,8).map((r:any,i:number)=>(
                            <RatioBar key={i} label={isSelf(r.sym)?`★ ${r.sym}`:r.sym} value={r.mc/1e7} max={maxMC/1e7} color={isSelf(r.sym)?D.amber:D.cyan} suffix="Cr"/>
                          ));
                        })()}
                      </Card>
                    )}

                    {/* Economic sensitivity matrix */}
                    <Card title="Economic Sensitivity" accent={D.t3}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
                        {[
                          {factor:'Interest Rates',  impact: ov.sector?.includes('Bank')||ov.sector?.includes('Finance')?'HIGH':'MODERATE', color:D.amber},
                          {factor:'INR / USD',        impact: ov.sector?.includes('IT')||ov.sector?.includes('Pharma')?'HIGH':'LOW', color:D.cyan},
                          {factor:'Crude Oil',        impact: ov.sector?.includes('Oil')||ov.sector?.includes('Petro')?'HIGH':ov.sector?.includes('Auto')?'MODERATE':'LOW', color:D.orange},
                          {factor:'Global Demand',   impact: ov.sector?.includes('IT')||ov.sector?.includes('Metal')?'HIGH':'MODERATE', color:D.blue},
                          {factor:'Domestic GDP',    impact:'MODERATE', color:D.green},
                          {factor:'Monsoon / Agri',  impact: ov.sector?.includes('FMCG')||ov.sector?.includes('Agri')?'HIGH':'LOW', color:D.green},
                        ].map(({factor,impact,color})=>(
                          <div key={factor} style={{background:D.sf2,border:`1px solid ${D.bd}`,borderRadius:2,padding:'6px 8px'}}>
                            <div style={{fontSize:9,color:D.t3,marginBottom:2}}>{factor}</div>
                            <span style={{fontSize:9,fontWeight:800,color,border:`1px solid ${color}44`,background:`${color}12`,padding:'1px 5px',borderRadius:2}}>
                              {impact}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div style={{marginTop:8,fontSize:9,color:D.t3,lineHeight:1.5}}>
                        Sensitivity derived from sector classification · {ov.sector||'Sector unknown'}
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* FINANCIALS                                               */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='financials' && (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  <div>
                    <Card title="Quarterly P&L" accent={D.amber}>
                      {qr.length>0 ? (
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                          <thead>
                            <tr>{['Period','Revenue','Op.Profit','OPM%','PAT','EPS'].map(h=>(
                              <th key={h} style={{textAlign:'right',color:D.t3,padding:'3px 6px',borderBottom:`1px solid ${D.bd}`,fontSize:9,whiteSpace:'nowrap'}}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {qr.slice(0,8).map((q:any,i:number)=>(
                              <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                                <td style={{padding:'3px 6px',color:D.amber,whiteSpace:'nowrap',fontWeight:700,fontFamily:'Consolas'}}>{q.period||'—'}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{fmtCr(q.revenue)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{fmtCr(q.operating_profit)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',color:q.opm_pct>20?D.green:D.text,fontFamily:'Consolas'}}>{q.opm_pct?`${fmt(q.opm_pct)}%`:'—'}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',color:q.pat>0?D.green:D.red,fontFamily:'Consolas'}}>{fmtCr(q.pat)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{q.eps?`₹${fmt(q.eps)}`:'—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{color:D.t3,fontSize:10}}>Quarterly data at <a href={`https://www.screener.in/company/${symbol}/`} target="_blank" rel="noreferrer" style={{color:D.cyan}}>screener.in ↗</a></div>
                      )}
                    </Card>
                    <Card title="Income Statement" accent={D.green}>
                      <MRow label="Revenue (TTM)"      value={fmtCr(fu.revenue)}/>
                      <MRow label="Revenue Growth YoY" value={fu.revenue_growth_yoy?fmtPct(fu.revenue_growth_yoy):'—'} color={numColor(fu.revenue_growth_yoy)}/>
                      <MRow label="EBITDA"             value={fmtCr(fu.ebitda)}/>
                      <MRow label="EBITDA Margin"      value={fu.ebitda_margin?`${fmt(fu.ebitda_margin)}%`:'—'}/>
                      <MRow label="PAT / Net Income"   value={fmtCr(fu.net_income)}/>
                      <MRow label="PAT Growth YoY"     value={fu.pat_growth_yoy?fmtPct(fu.pat_growth_yoy):'—'} color={numColor(fu.pat_growth_yoy)}/>
                      <MRow label="Net Margin"         value={fu.net_margin?`${fmt(fu.net_margin)}%`:'—'}/>
                      <MRow label="EPS (TTM)"          value={fu.eps?`₹${fmt(fu.eps)}`:'—'}/>
                    </Card>
                  </div>
                  <div>
                    <Card title="Balance Sheet" accent={D.blue}>
                      <MRow label="Total Assets"        value={fmtCr(fu.total_assets)}/>
                      <MRow label="Total Debt"          value={fmtCr(fu.total_debt)} color={fu.total_debt>0?D.orange:undefined}/>
                      <MRow label="Cash & Equivalents"  value={fmtCr(fu.cash)}/>
                      <MRow label="Net Debt"            value={fmtCr(fu.net_debt)}/>
                      <MRow label="Book Value / Share"  value={fu.book_value?`₹${fmt(fu.book_value)}`:'—'}/>
                      <MRow label="Shareholders Equity" value={fmtCr(fu.shareholders_equity)}/>
                    </Card>
                    <Card title="Cash Flow" accent={D.cyan}>
                      <MRow label="Operating CF"   value={fmtCr(fu.operating_cash_flow)} color={fu.operating_cash_flow>0?D.green:D.red}/>
                      <MRow label="Investing CF"   value={fmtCr(fu.investing_cf)}/>
                      <MRow label="Financing CF"   value={fmtCr(fu.financing_cf)}/>
                      <MRow label="Free Cash Flow" value={fmtCr(fu.free_cash_flow)} color={fu.free_cash_flow>0?D.green:D.red}/>
                    </Card>
                    <Card title="Valuation Multiples" accent={D.purp}>
                      <MRow label="P/E (TTM)"         value={fmt(fu.pe_ratio)}/>
                      <MRow label="P/B Ratio"         value={fmt(fu.pb_ratio)}/>
                      <MRow label="EV/EBITDA"         value={fmt(fu.ev_ebitda)}/>
                      <MRow label="Price / Sales"     value={fmt(fu.ps_ratio)}/>
                      <MRow label="ROE"               value={fu.roe?`${fmt(fu.roe)}%`:'—'} color={fu.roe>15?D.green:undefined}/>
                      <MRow label="ROCE"              value={fu.roce?`${fmt(fu.roce)}%`:'—'} color={fu.roce>12?D.green:undefined}/>
                      <MRow label="D/E Ratio"         value={fmt(fu.debt_equity)} color={fu.debt_equity>1?D.orange:undefined}/>
                      <MRow label="Interest Coverage" value={fmt(fu.interest_coverage)}/>
                      <MRow label="Current Ratio"     value={fmt(fu.current_ratio)}/>
                    </Card>
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* HOLDING                                                  */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='holding' && (
                <div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}}>
                    {[{label:'PROMOTER',val:sh.promoter_pct,color:D.amber},{label:'FII/FPI',val:sh.fii_pct,color:D.cyan},{label:'DII/MF',val:sh.dii_pct,color:D.purp},{label:'PUBLIC',val:sh.public_pct,color:D.green}].map(b=>(
                      <div key={b.label} style={{padding:12,background:D.sf,border:`1px solid ${b.color}33`,textAlign:'center',borderRadius:2}}>
                        <div style={{fontSize:9,color:D.t3,letterSpacing:1}}>{b.label}</div>
                        <div style={{fontSize:22,fontWeight:900,color:b.color,fontFamily:'Consolas',marginTop:4}}>
                          {b.val!=null?`${fmt(b.val,1)}%`:'—'}
                        </div>
                      </div>
                    ))}
                  </div>
                  {sh.pledge_pct!=null&&(
                    <div style={{padding:'8px 12px',marginBottom:12,background:sh.pledge_pct>10?`${D.red}08`:`${D.green}06`,border:`1px solid ${sh.pledge_pct>10?D.red+'33':D.green+'22'}`,borderRadius:2}}>
                      <span style={{fontSize:11,color:D.t2}}>Promoter Pledge: </span>
                      <span style={{fontSize:14,fontWeight:700,color:sh.pledge_pct>10?D.red:D.green,fontFamily:'Consolas'}}>{fmt(sh.pledge_pct)}%</span>
                      <span style={{fontSize:9,color:D.t3,marginLeft:10}}>
                        {sh.pledge_pct>20?'⚠ VERY HIGH — forced selling risk':sh.pledge_pct>10?'⚠ HIGH — monitor closely':sh.pledge_pct>0?'✓ Moderate':'✓ Zero pledge'}
                      </span>
                    </div>
                  )}
                  <Card title="Quarterly History" accent={D.blue}>
                    {(sh.history||[]).length>0 ? (
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                        <thead>
                          <tr>{['Quarter','Promoter','FII','DII','Public'].map(h=>(
                            <th key={h} style={{textAlign:'right',color:D.t3,padding:'3px 8px',borderBottom:`1px solid ${D.bd}`,fontSize:9}}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {(sh.history as any[]).slice(0,10).map((h:any,i:number)=>(
                            <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                              <td style={{padding:'3px 8px',color:D.t2}}>{h.quarter||h.date}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.amber,fontWeight:700,fontFamily:'Consolas'}}>{h.promoter!=null?`${fmt(h.promoter)}%`:'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.cyan,fontFamily:'Consolas'}}>{h.fii!=null?`${fmt(h.fii)}%`:'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.purp,fontFamily:'Consolas'}}>{h.dii!=null?`${fmt(h.dii)}%`:'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.t2,fontFamily:'Consolas'}}>{h.public!=null?`${fmt(h.public)}%`:'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{color:D.t3,fontSize:10}}>Historical shareholding at <a href={`https://www.screener.in/company/${symbol}/#shareholding`} target="_blank" rel="noreferrer" style={{color:D.cyan}}>screener.in ↗</a></div>
                    )}
                  </Card>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* EARNINGS                                                 */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='earnings' && (
                <div>
                  <Card title={`Quarterly Results — ${symbol}`} accent={D.amber}>
                    {(data?.earnings||[]).length>0 ? (
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                        <thead>
                          <tr>{['Quarter','Date','Revenue','EPS','Rev Surp%','EPS Surp%','Rev Growth','PAT Growth','Status'].map(h=>(
                            <th key={h} style={{textAlign:'right',color:D.t3,padding:'4px 6px',borderBottom:`1px solid ${D.bd}`,fontSize:9,whiteSpace:'nowrap'}}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {(data.earnings as any[]).map((e:any,i:number)=>(
                            <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                              <td style={{padding:'4px 6px',color:D.amber,fontWeight:700,fontFamily:'Consolas'}}>{e.quarter?`Q${e.quarter}`:'—'}</td>
                              <td style={{padding:'4px 6px',color:D.t3,whiteSpace:'nowrap'}}>{e.date||'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',fontFamily:'Consolas'}}>{fmtCr(e.revenue)}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',fontFamily:'Consolas'}}>{e.eps?`₹${fmt(e.eps)}`:'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',fontWeight:700,color:numColor(e.rev_surprise),fontFamily:'Consolas'}}>{e.rev_surprise!=null?fmtPct(e.rev_surprise):'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',fontWeight:700,color:numColor(e.eps_surprise),fontFamily:'Consolas'}}>{e.eps_surprise!=null?fmtPct(e.eps_surprise):'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',color:numColor(e.rev_growth),fontFamily:'Consolas'}}>{e.rev_growth!=null?fmtPct(e.rev_growth):'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right',color:numColor(e.pat_growth),fontFamily:'Consolas'}}>{e.pat_growth!=null?fmtPct(e.pat_growth):'—'}</td>
                              <td style={{padding:'4px 6px',textAlign:'right'}}>
                                <Tag label={(e.status||'upcoming').toUpperCase()} color={e.status==='declared'?D.green:D.amber}/>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : qr.length>0 ? (
                      <>
                        <div style={{fontSize:9,color:D.t3,marginBottom:6}}>FROM SCREENER.IN</div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                          <thead>
                            <tr>{['Period','Revenue','Op.Profit','OPM%','PAT','EPS'].map(h=>(
                              <th key={h} style={{textAlign:'right',color:D.t3,padding:'3px 6px',borderBottom:`1px solid ${D.bd}`,fontSize:9}}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {qr.slice(0,8).map((q:any,i:number)=>(
                              <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                                <td style={{padding:'3px 6px',color:D.amber,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Consolas'}}>{q.period}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{fmtCr(q.revenue)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{fmtCr(q.operating_profit)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',color:q.opm_pct>20?D.green:D.text,fontFamily:'Consolas'}}>{q.opm_pct?`${fmt(q.opm_pct)}%`:'—'}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',color:q.pat>0?D.green:D.red,fontFamily:'Consolas'}}>{fmtCr(q.pat)}</td>
                                <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{q.eps?`₹${fmt(q.eps)}`:'—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : (
                      <div style={{color:D.t3,fontSize:10}}>No earnings data for {symbol}</div>
                    )}
                  </Card>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* PEERS                                                    */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='peers' && (
                <div>
                  <Card title={`Peer Comparison — ${ov.sector||symbol}`} accent={D.cyan}
                    action={<a href={`https://www.screener.in/company/${symbol}/#peers`} target="_blank" rel="noreferrer" style={{fontSize:9,color:D.cyan,textDecoration:'none'}}>screener.in ↗</a>}>
                    {peers.length>0 ? (
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                        <thead>
                          <tr>{['Symbol / Company','Price','Chg%','Market Cap','P/E','Div Yield'].map(h=>(
                            <th key={h} style={{textAlign:h==='Symbol / Company'?'left':'right',color:D.t3,padding:'4px 8px',borderBottom:`1px solid ${D.bd}`,fontSize:9}}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {(peers as any[]).map((p:any,i:number)=>{
                            const self=(p.symbol||p.ticker||'').toUpperCase()===symbol;
                            return (
                              <tr key={i} style={{borderBottom:`1px solid ${D.bd}`,background:self?`${D.amber}08`:'transparent'}}>
                                <td style={{padding:'5px 8px'}}>
                                  <span style={{color:D.amber,fontWeight:700,cursor:'pointer',fontFamily:'Consolas'}} onClick={()=>pick(p.symbol||p.ticker||'')}>
                                    {p.symbol||p.ticker||p.name||'—'}
                                  </span>
                                  {p.name&&p.symbol&&p.name!==p.symbol&&<span style={{color:D.t3,fontSize:9,marginLeft:6}}>{p.name}</span>}
                                  {self&&<Tag label="THIS" color={D.amber}/>}
                                </td>
                                <td style={{padding:'5px 8px',textAlign:'right',color:D.text,fontWeight:500,fontFamily:'Consolas'}}>{p.live_price||p.price||p.cmp?`₹${fmt(p.live_price||p.price||p.cmp)}`:'—'}</td>
                                <td style={{padding:'5px 8px',textAlign:'right',fontWeight:700,color:numColor(p.live_change||p.change_pct),fontFamily:'Consolas'}}>{p.live_change!=null||p.change_pct!=null?fmtPct(p.live_change??p.change_pct):'—'}</td>
                                <td style={{padding:'5px 8px',textAlign:'right',color:D.t2,fontFamily:'Consolas'}}>{fmtCr(p.market_cap)}</td>
                                <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'Consolas'}}>{p.pe!=null||p.pe_ratio!=null?fmt(p.pe??p.pe_ratio):'—'}</td>
                                <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'Consolas'}}>{p.dividend_yield!=null?`${fmt(p.dividend_yield)}%`:'—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{color:D.t3,fontSize:10}}>Peer data at <a href={`https://www.screener.in/company/${symbol}/#peers`} target="_blank" rel="noreferrer" style={{color:D.cyan}}>screener.in ↗</a></div>
                    )}
                  </Card>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* FILINGS                                                  */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='filings' && (
                <Card title={`BSE / NSE Announcements — ${symbol}`} accent={D.cyan} noPad>
                  {(data?.filings||[]).length===0 ? (
                    <div style={{padding:'16px',color:D.t3,fontSize:10}}>No filings in DB for {symbol}</div>
                  ) : (
                    (data.filings as any[]).map((f:any,i:number)=>(
                      <div key={i} style={{padding:'8px 12px',borderBottom:`1px solid ${D.bd}`,cursor:f.url?'pointer':'default'}}
                        onClick={()=>f.url&&window.open(f.url,'_blank')}
                        onMouseEnter={e=>{if(f.url)(e.currentTarget as HTMLDivElement).style.background=D.sf2;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background='transparent';}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                          <div style={{display:'flex',gap:6,alignItems:'center'}}>
                            <Tag label={f.exchange||'NSE'} color={D.cyan}/>
                            <span style={{fontSize:9,color:D.amber,fontWeight:700}}>{f.symbol}</span>
                          </div>
                          <span style={{fontSize:9,color:D.t3}}>{timeAgo(f.created_at)}</span>
                        </div>
                        <div style={{fontSize:11,color:D.text,lineHeight:1.4}}>{f.subject}</div>
                        {f.summary&&<div style={{fontSize:10,color:D.t2,marginTop:2}}>{f.summary}</div>}
                      </div>
                    ))
                  )}
                </Card>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* NEWS                                                     */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='news' && (
                <Card title={`News — ${symbol} (Last 30 Days)`} accent={D.green} noPad>
                  {(data?.news||[]).length===0 ? (
                    <div style={{padding:'16px',color:D.t3,fontSize:10}}>No news for {symbol} in last 30 days</div>
                  ) : (
                    (data.news as any[]).map((n:any,i:number)=>(
                      <div key={i} style={{padding:'7px 12px',borderBottom:`1px solid ${D.bd}`,cursor:n.url?'pointer':'default'}}
                        onClick={()=>n.url&&window.open(n.url,'_blank')}
                        onMouseEnter={e=>{if(n.url)(e.currentTarget as HTMLDivElement).style.background=D.sf2;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background='transparent';}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                          <div style={{display:'flex',gap:5,alignItems:'center'}}>
                            {n.category&&<Tag label={n.category.toUpperCase()} color={D.green}/>}
                            <span style={{fontSize:9,color:n.sentiment>0.2?D.green:n.sentiment<-0.2?D.red:D.t3,fontWeight:700}}>
                              {n.sentiment>0.3?'▲▲':n.sentiment>0.1?'▲':n.sentiment<-0.3?'▼▼':n.sentiment<-0.1?'▼':''}
                            </span>
                          </div>
                          <span style={{fontSize:9,color:D.t3}}>{timeAgo(n.created_at)}</span>
                        </div>
                        <div style={{fontSize:11,color:D.text,lineHeight:1.4}}>{n.headline}</div>
                        {n.summary&&<div style={{fontSize:10,color:D.t2,marginTop:2}}>{(n.summary||'').slice(0,160)}{(n.summary||'').length>160?'…':''}</div>}
                      </div>
                    ))
                  )}
                </Card>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* INSIDER                                                  */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='insider' && (
                <Card title={`Insider & Bulk Trades — ${symbol}`} accent={D.orange} noPad>
                  {(data?.insider_trades||[]).length===0 ? (
                    <div style={{padding:'16px',color:D.t3,fontSize:10}}>No insider trades found for {symbol}</div>
                  ) : (
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                      <thead>
                        <tr>{['Date','Person','Category','Transaction','Qty','Before%','After%'].map(h=>(
                          <th key={h} style={{textAlign:h==='Date'||h==='Person'?'left':'right',color:D.t3,padding:'4px 8px',borderBottom:`1px solid ${D.bd}`,fontSize:9}}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {(data.insider_trades as any[]).map((t:any,i:number)=>{
                          const isBuy=(t.transaction||t.buy_sell||'').toLowerCase().includes('buy')||(t.transaction||t.buy_sell||'').toLowerCase()==='acquisition';
                          return (
                            <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                              <td style={{padding:'3px 8px',color:D.t3,whiteSpace:'nowrap'}}>{t.date||t.acq_from_dt}</td>
                              <td style={{padding:'3px 8px',color:D.text,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis'}}>{t.name||t.acq_name}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.t3,fontSize:9}}>{t.category||t.acq_type||'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',fontWeight:700,color:isBuy?D.green:D.red,fontFamily:'Consolas'}}>{(t.transaction||t.buy_sell||'—').toUpperCase()}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',fontFamily:'Consolas'}}>{t.qty?Number(t.qty).toLocaleString('en-IN'):'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.t3,fontFamily:'Consolas'}}>{t.before_pct?`${fmt(t.before_pct)}%`:'—'}</td>
                              <td style={{padding:'3px 8px',textAlign:'right',color:D.amber,fontFamily:'Consolas'}}>{t.after_pct?`${fmt(t.after_pct)}%`:'—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </Card>
              )}

              {/* ════════════════════════════════════════════════════════ */}
              {/* AI RESEARCH                                              */}
              {/* ════════════════════════════════════════════════════════ */}
              {tab==='research' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                    <span style={{fontSize:11,fontWeight:800,color:D.purp,letterSpacing:0.5}}>AI DEEP RESEARCH — {symbol}</span>
                    {rdLoading&&<span className="spinner"/>}
                    {rd?.ai_analysis?.provider&&!rdLoading&&(
                      <span style={{fontSize:9,color:D.t3}}>via {rd.ai_analysis.provider} · {rd.ai_analysis.word_count} words</span>
                    )}
                    {rd?.data_sources&&(
                      <div style={{display:'flex',gap:3,marginLeft:'auto',flexWrap:'wrap'}}>
                        {[['NSE API',rd.data_sources.nse_api],['BSE API',rd.data_sources.bse_api],['Google News',rd.data_sources.google_news],['Screener',rd.data_sources.screener],['Tickertape',rd.data_sources.tickertape]].map(([label,ok])=>(
                          <span key={label as string} style={{padding:'1px 5px',fontSize:8,borderRadius:2,background:ok?`${D.green}10`:`${D.red}08`,border:`1px solid ${ok?D.green+'33':D.red+'22'}`,color:ok?D.green:D.t3}}>{label as string}</span>
                        ))}
                      </div>
                    )}
                    <button onClick={()=>setResearchRefresh(r=>r+1)} className="btn"
                      style={{padding:'2px 8px',fontSize:9,marginLeft:rd?.data_sources?0:'auto',background:'transparent',border:`1px solid ${D.bd2}`,color:D.t2,cursor:'pointer',fontFamily:'Consolas',borderRadius:2}}>
                      ↻ REFRESH
                    </button>
                  </div>

                  {rdLoading&&!rd&&(
                    <div style={{textAlign:'center',padding:'40px 0',color:D.t2}}>
                      <div className="spinner" style={{margin:'0 auto 12px'}}/>
                      <div style={{fontSize:11}}>Fetching web data + generating AI analysis…</div>
                      <div style={{fontSize:9,color:D.t3,marginTop:6}}>Google News · NSE API · BSE API · Screener.in</div>
                    </div>
                  )}

                  {rd&&(
                    <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:12}}>
                      <div>
                        {rd.ai_analysis?.available ? (
                          <Card title="AI Research Note" accent={D.purp}
                            action={<span style={{fontSize:8,color:D.t3}}>{rd.ai_analysis.generated_at?.slice(0,16)?.replace('T',' ')}</span>}>
                            {(rd.ai_analysis.analysis as string).split(/\n(?=## )/).filter(Boolean).map((section:string,i:number)=>{
                              const lines=section.split('\n');
                              const heading=lines[0].replace(/^##\s*/,'').trim();
                              const body=lines.slice(1).join('\n').trim();
                              return (
                                <div key={i} style={{marginBottom:14}}>
                                  <div style={{fontSize:9,fontWeight:800,color:D.purp,letterSpacing:0.5,marginBottom:5,borderBottom:`1px solid ${D.purp}22`,paddingBottom:3}}>{heading}</div>
                                  <div style={{fontSize:10,color:D.t2,lineHeight:1.65,whiteSpace:'pre-wrap'}}>
                                    {body.split(/(BUY|ACCUMULATE|HOLD|REDUCE|SELL)/g).map((part,j)=>
                                      ['BUY','ACCUMULATE','HOLD','REDUCE','SELL'].includes(part)
                                        ? <span key={j} style={{fontWeight:700,color:part==='BUY'||part==='ACCUMULATE'?D.green:part==='SELL'||part==='REDUCE'?D.red:D.amber}}>{part}</span>
                                        : <span key={j}>{part}</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </Card>
                        ) : (
                          <Card title="AI Research Note" accent={D.purp}>
                            <div style={{padding:'20px 0',textAlign:'center',color:D.t3,fontSize:10}}>
                              {rdLoading?'Generating analysis…':'AI analysis unavailable — ensure Ollama (localhost:11434) or ANTHROPIC_API_KEY is set in backend/.env'}
                            </div>
                          </Card>
                        )}

                        {(rd.bse_data?.quarterly_results||[]).length>0&&(
                          <Card title="BSE Quarterly Results" accent={D.amber}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                              <thead>
                                <tr>{['Period','Revenue (Cr)','PAT (Cr)','EPS','Date'].map(h=>(
                                  <th key={h} style={{textAlign:h==='Period'?'left':'right',fontSize:9,color:D.t3,padding:'3px 6px',borderBottom:`1px solid ${D.bd}`}}>{h}</th>
                                ))}</tr>
                              </thead>
                              <tbody>
                                {rd.bse_data.quarterly_results.map((q:any,i:number)=>(
                                  <tr key={i} style={{borderBottom:`1px solid ${D.bd}`}}>
                                    <td style={{padding:'3px 6px',color:D.amber,fontWeight:700,fontFamily:'Consolas'}}>{q.period}</td>
                                    <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{q.net_sales!=null?Number(q.net_sales).toLocaleString('en-IN'):'—'}</td>
                                    <td style={{padding:'3px 6px',textAlign:'right',color:q.net_profit>0?D.green:D.red,fontWeight:700,fontFamily:'Consolas'}}>{q.net_profit!=null?Number(q.net_profit).toLocaleString('en-IN'):'—'}</td>
                                    <td style={{padding:'3px 6px',textAlign:'right',fontFamily:'Consolas'}}>{q.eps??'—'}</td>
                                    <td style={{padding:'3px 6px',textAlign:'right',color:D.t3,fontSize:9}}>{q.result_date}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </Card>
                        )}

                        {(rd.bse_data?.announcements||[]).length>0&&(
                          <Card title="Latest BSE Announcements" accent={D.cyan} noPad>
                            {rd.bse_data.announcements.slice(0,10).map((a:any,i:number)=>(
                              <div key={i} style={{display:'flex',gap:8,padding:'5px 10px',borderBottom:`1px solid ${D.bd}`,alignItems:'flex-start'}}>
                                <span style={{fontSize:9,color:D.t3,flexShrink:0,minWidth:70}}>{a.date}</span>
                                <span style={{fontSize:10,color:D.t2,lineHeight:1.4}}>{a.subject}</span>
                                <span style={{fontSize:8,color:D.t3,flexShrink:0}}>{a.category}</span>
                              </div>
                            ))}
                          </Card>
                        )}
                      </div>

                      <div>
                        <Card title={`Web News (${(rd.web_news||[]).length})`} accent={D.green} noPad
                          action={<span style={{fontSize:8,color:D.t3}}>Google News RSS</span>}>
                          {(rd.web_news||[]).length===0 ? (
                            <div style={{padding:'12px',color:D.t3,fontSize:10}}>No news found</div>
                          ) : (
                            (rd.web_news as any[]).map((n:any,i:number)=>(
                              <div key={i} style={{padding:'7px 10px',borderBottom:`1px solid ${D.bd}`}}>
                                <a href={n.url} target="_blank" rel="noopener noreferrer"
                                  style={{fontSize:10,color:D.text,textDecoration:'none',lineHeight:1.4,display:'block'}}
                                  onMouseEnter={e=>(e.currentTarget.style.color=D.amber)}
                                  onMouseLeave={e=>(e.currentTarget.style.color=D.text)}>
                                  {n.title}
                                </a>
                                <div style={{display:'flex',gap:6,marginTop:3,alignItems:'center'}}>
                                  <span style={{fontSize:9,color:D.blue,fontWeight:600}}>{n.source}</span>
                                  <span style={{fontSize:9,color:D.t3}}>{n.published}</span>
                                </div>
                                {n.snippet&&<div style={{fontSize:9,color:D.t3,marginTop:2,lineHeight:1.4}}>{n.snippet.slice(0,180)}{n.snippet.length>180?'…':''}</div>}
                              </div>
                            ))
                          )}
                        </Card>

                        {(rd.nse_data?.isin||rd.bse_data?.details)&&(
                          <Card title="NSE + BSE Live Data" accent={D.blue}>
                            {rd.nse_data?.isin&&(<>
                              <MRow label="ISIN"           value={rd.nse_data.isin}/>
                              <MRow label="Listing Date"   value={rd.nse_data.listing_date}/>
                              <MRow label="NSE Industry"   value={rd.nse_data.industry}/>
                              <MRow label="Macro Sector"   value={rd.nse_data.macro_sector}/>
                              <MRow label="52W High (NSE)" value={rd.nse_data['52w_high']?`₹${rd.nse_data['52w_high']}`:'—'}/>
                              <MRow label="52W Low (NSE)"  value={rd.nse_data['52w_low']?`₹${rd.nse_data['52w_low']}`:'—'}/>
                            </>)}
                            {rd.bse_data?.details&&(<>
                              <MRow label="BSE P/E"        value={rd.bse_data.details.pe??'—'}/>
                              <MRow label="BSE EPS"        value={rd.bse_data.details.eps?`₹${rd.bse_data.details.eps}`:'—'}/>
                              <MRow label="BSE Mkt Cap"    value={rd.bse_data.details.market_cap_cr?`₹${Number(rd.bse_data.details.market_cap_cr).toLocaleString('en-IN')} Cr`:'—'}/>
                              <MRow label="Promoter Hold"  value={rd.bse_data.details.promoter_pct?`${rd.bse_data.details.promoter_pct}%`:'—'}/>
                              <MRow label="FII Hold"       value={rd.bse_data.details.fii_pct?`${rd.bse_data.details.fii_pct}%`:'—'}/>
                              <MRow label="BSE ROE%"       value={rd.bse_data.details.roe?`${rd.bse_data.details.roe}%`:'—'}/>
                            </>)}
                          </Card>
                        )}

                        {(rd.nse_data?.upcoming_events||[]).length>0&&(
                          <Card title="NSE Upcoming Events" accent={D.amber}>
                            {rd.nse_data.upcoming_events.map((ev:any,i:number)=>(
                              <div key={i} style={{display:'flex',gap:8,padding:'3px 0',borderBottom:`1px solid ${D.bd}`}}>
                                <span style={{fontSize:9,color:D.amber,minWidth:80,fontFamily:'Consolas'}}>{ev.date}</span>
                                <span style={{fontSize:10,color:D.t2}}>{ev.purpose}</span>
                              </div>
                            ))}
                          </Card>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StockDeepDive;

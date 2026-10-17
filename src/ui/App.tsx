import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownUp, ChevronDown, CircleHelp, FileText, FolderOpen, Grid2X2, Search, Settings2, ShieldCheck, Spade, Upload, X } from 'lucide-react'
import { HandSchema, parseFile, SiteSchema, type Hand, type Site } from '../domain'
import { deleteAllHands, getHands, isDesktopRuntime, saveHands } from '../storage'

type Nav = 'Overview' | 'Hands' | 'Import' | 'Settings'
const nav = [{ label: 'Overview', icon: Grid2X2 }, { label: 'Hands', icon: Spade }, { label: 'Import', icon: Upload }, { label: 'Settings', icon: Settings2 }] as const

export default function App() {
  const [page, setPage] = useState<Nav>('Overview')
  const [hands, setHands] = useState<Hand[]>([])
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [site, setSite] = useState<Site>('888poker')
  const [files, setFiles] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const [importDetails, setImportDetails] = useState<string[]>([])
  const [preview, setPreview] = useState<{ hands: Hand[]; warnings: number; failures: number } | null>(null)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [selected, setSelected] = useState<Hand | null>(null)
  const [actionIndex, setActionIndex] = useState(-1)
  const [busy, setBusy] = useState(false)
  const storageLabel = isDesktopRuntime() ? 'SQLite · PokerLab app data' : 'Browser IndexedDB · PokerLab local database'
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const refresh = async () => setHands(await getHands())
  useEffect(() => { void refresh().catch(() => setMessage('PokerLab local storage is unavailable.')) }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const filtered = useMemo(() => hands.filter((h) => `${h.sourceHandId ?? ''} ${h.tournamentId ?? ''} ${h.site} ${(h.heroCards ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()) && (!fromDate || (h.playedAt ?? '').slice(0, 10) >= fromDate) && (!toDate || (h.playedAt ?? '').slice(0, 10) <= toDate)), [hands, query, fromDate, toDate])
  const studyStats = useMemo(() => {
    const bySite = (['888poker', 'sky_poker'] as const).map(siteKey => ({ site: siteKey, count: hands.filter(hand => hand.site === siteKey).length }))
    const collected = hands.filter(hand => hand.resultChips !== null)
    return { bySite, heroCards: hands.filter(hand => hand.heroCards?.length).length, recordedCollections: collected.length, collectedChips: collected.reduce((total, hand) => total + (hand.resultChips ?? 0), 0) }
  }, [hands])

  async function selectFiles(list: FileList | null) {
    if (!list?.length) return
    setFiles(Array.from(list)); setMessage(''); setPreview(null); setImportDetails([])
  }
  async function importFiles() {
    if (!files.length) { inputRef.current?.click(); return }
    const validatedSite = SiteSchema.safeParse(site)
    if (!validatedSite.success) { setMessage('Choose a supported site before importing.'); return }
    setBusy(true)
    try {
      const parsedHands: Hand[] = []
      let warningCount = 0, failedCount = 0, unsupported = false
      const detailLines: string[] = []
      for (const file of files) {
        const parsed = await parseFile(await file.text(), validatedSite.data, file.name)
        for (const hand of parsed.hands) {
          const validation = HandSchema.safeParse(hand)
          if (validation.success) parsedHands.push(validation.data)
          else {
            failedCount++
            detailLines.push(`${file.name}: parsed hand ${hand.sourceHandId ?? hand.id} failed data validation and was excluded.`)
          }
        }
        warningCount += parsed.diagnostics.filter(d => d.severity === 'warning').length
        failedCount += parsed.failedCount
        if (parsed.failedCount === 0 && parsed.hands.length === 0 && parsed.diagnostics.some(d => d.severity === 'error')) failedCount++
        unsupported ||= parsed.unsupported
        for (const diagnostic of parsed.diagnostics) detailLines.push(`${file.name}${diagnostic.line ? ` · line ${diagnostic.line}` : ''}: ${diagnostic.message}`)
      }
      setPreview({ hands: parsedHands, warnings: warningCount, failures: failedCount })
      setImportDetails(detailLines)
      const note = unsupported ? ' Some input did not match a supported 888poker hand block.' : ''
      setMessage(`Preview: ${files.length} file${files.length === 1 ? '' : 's'}, ${parsedHands.length} supported hand${parsedHands.length === 1 ? '' : 's'}, ${warningCount} warnings, ${failedCount} failures.${note}`)
    } catch { setMessage('Could not read a selected file. Check that it is accessible and try again.') }
    finally { setBusy(false) }
  }
  async function commitImport() {
    if (!preview) return
    setBusy(true)
    try {
      const saved = await saveHands(preview.hands)
      await refresh()
      setMessage(`Import complete: ${saved.imported} imported, ${saved.duplicates} duplicates skipped, ${preview.warnings} warnings, ${preview.failures} failures.`)
      setPreview(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setMessage(`Could not save parsed hands locally. Your source files were not changed. Details: ${detail}`)
    }
    finally { setBusy(false) }
  }
  async function clearData() {
    if (!window.confirm('Delete all locally stored PokerLab hands? This cannot be undone.')) return
    await deleteAllHands(); await refresh(); setMessage('Local hand data deleted.')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Spade size={19} fill="currentColor" /></div><span>Poker<span className="brand-light">Lab</span></span><span className="brand-version">BETA</span></div>
      <div className="workspace"><div className="avatar">P</div><div><b>Personal workspace</b><small>Local database</small></div><ChevronDown size={14} /></div>
      <div className="nav-title">WORKSPACE</div>
      <nav>{nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => setPage(label)}><Icon size={17} strokeWidth={1.8} />{label}{label === 'Hands' && <span className="nav-count">{hands.length}</span>}{page === label && <span className="active-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-chip"><ShieldCheck size={15} /><span>Private by design</span><span className="green-dot" /></div><div className="user-row"><div className="user-avatar">P</div><div><b>Player</b><small>Local profile</small></div><CircleHelp size={16} className="help-icon" /></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">PokerLab <span>/</span> <b>{page}</b></div><div className="top-right"><span className="local-status"><i /> Local only</span><button className="icon-btn" title="Help"><CircleHelp size={17} /></button><div className="top-avatar">P</div></div></header>
      <div className="content">
        {page === 'Overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR STUDY SPACE</div><h1>Good to see you.</h1><p className="subtitle">Your hands, your data. Start by importing a session.</p></div><button className="primary-btn" onClick={() => { setPage('Import'); inputRef.current?.click() }}><Upload size={15} /> Import hands</button></div>
          <section className="stats-grid"><Stat icon={<Spade size={16} />} label="HANDS IMPORTED" value={hands.length.toString()} caption="Across all sessions"/><Stat icon={<Activity size={16} />} label="TOURNAMENTS" value={new Set(hands.map(h => h.tournamentId).filter(Boolean)).size.toString()} caption="With a recorded tournament ID"/><Stat icon={<ArrowDownUp size={16} />} label="DATE COVERAGE" value={new Set(hands.map(h=>h.playedAt?.slice(0,10)).filter(Boolean)).size.toString()} caption="Days with imported hands"/></section>
          <section className="panel study-panel"><div className="panel-head"><div><h2>Study statistics</h2><p>Descriptive totals from the hand histories currently stored on this device.</p></div></div><div className="study-content"><div className="site-breakdown"><div className="study-subhead">HANDS BY SITE</div>{studyStats.bySite.map(row=><div className="site-stat" key={row.site}><div><span>{row.site==='888poker'?'888poker':'Sky Poker'}</span><b>{row.count}</b></div><div className="site-track"><i style={{width:`${hands.length ? row.count / hands.length * 100 : 0}%`}}/></div></div>)}</div><div className="coverage-stats"><div className="coverage-stat"><span>HERO CARDS RECORDED</span><b>{studyStats.heroCards}</b><small>of {hands.length} hands</small></div><div className="coverage-stat"><span>HERO COLLECTIONS RECORDED</span><b>{studyStats.recordedCollections}</b><small>collected chips: {studyStats.collectedChips.toLocaleString()}</small></div></div></div><div className="study-footnote">Collection amounts are source-reported chips, not net results. VPIP, PFR, 3-bet, and showdown rates need validated opportunity and outcome rules before display.</div></section>
          <section className="panel recent-panel"><div className="panel-head"><div><h2>Recent hands</h2><p>Your latest imported hands, ready to review.</p></div><button className="text-btn" onClick={() => setPage('Hands')}>View all <span>→</span></button></div>
            {hands.length ? <HandTable hands={hands.slice(0, 6)} onSelect={setSelected} /> : <EmptyState onImport={() => { setPage('Import'); inputRef.current?.click() }} />}
          </section>
          <section className="supported-strip"><div className="supported-icon"><FileText size={17} /></div><div><b>888poker import is ready</b><p>Tournament and BLAST hand blocks are confirmed.</p></div><button className="text-btn" onClick={() => setPage('Import')}>Import hands <span>→</span></button></section>
        </>}
        {page === 'Hands' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> LIBRARY</div><h1>Your hands<span className="title-count">{hands.length}</span></h1><p className="subtitle">Search your locally stored tournament hand histories.</p></div><button className="primary-btn" onClick={() => { setPage('Import'); inputRef.current?.click() }}><Upload size={15} /> Import hands</button></div><section className="panel library-panel"><div className="filterbar"><div className="search-wrap"><Search size={15}/><input ref={searchRef} aria-label="Search hands" placeholder="Search hand ID, tournament ID or hero cards..." value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><select className="filter-btn" aria-label="Sort hands" value={sortOrder} onChange={e=>setSortOrder(e.target.value as 'newest'|'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><input className="filter-btn date-filter" type="date" aria-label="From date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/><input className="filter-btn date-filter" type="date" aria-label="To date" value={toDate} onChange={e=>setToDate(e.target.value)}/></div>{filtered.length?<HandTable hands={[...filtered].sort((a,b)=>{const dateCompare=(a.playedAt??'').localeCompare(b.playedAt??'');return sortOrder==='oldest'?dateCompare:-dateCompare})} onSelect={h=>{setActionIndex(-1);setSelected(h)}}/>:<EmptyState onImport={()=>{setPage('Import');inputRef.current?.click()}} title={hands.length?'No matching hands':'No hands yet'} body={hands.length?'Try another search or date.':'Import a hand history to start building your library.'}/>}</section></>}
        {page === 'Import' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> ADD TO YOUR LIBRARY</div><h1>Import hands</h1><p className="subtitle">Choose hand-history files stored on your device.</p></div></div><section className="import-layout"><div className="panel import-panel"><h2>Select files</h2><p className="panel-desc">Files are read locally in this app. Nothing is uploaded.</p><div className="site-select"><label htmlFor="site">Poker site</label><select id="site" value={site} onChange={e=>{const result=SiteSchema.safeParse(e.target.value);if(result.success){setSite(result.data);setPreview(null);setMessage('')}}}><option value="888poker">888poker</option><option value="sky_poker">Sky Poker</option></select><span className={`unsupported-label ${site==='888poker'?'confirmed-label':''}`}>{site==='888poker'?'FORMAT CONFIRMED':'PARSER NOT CONFIRMED'}</span></div><input ref={inputRef} type="file" multiple accept=".txt,.log,.hh,.history,text/plain" className="hidden-input" onChange={e=>void selectFiles(e.target.files)}/><button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void selectFiles(e.dataTransfer.files)}}><div className="upload-circle"><FolderOpen size={21}/></div><b>Drop files here, or <span>browse</span></b><small>Text hand-history files · Multiple files supported</small></button>{files.length>0&&<div className="file-list">{files.map(f=><div key={`${f.name}-${f.size}`} className="file-row"><FileText size={15}/><span>{f.name}</span><small>{(f.size/1024).toFixed(1)} KB</small><button aria-label={`Remove ${f.name}`} onClick={()=>{setFiles(files.filter(x=>x!==f));setPreview(null);setMessage('')}}><X size={15}/></button></div>)}</div>}<div className="import-note"><CircleHelp size={15}/><span>{site==='888poker'?'Confirmed 888poker tournament and BLAST text formats are parsed locally. Unexpected lines are reported with hand and line diagnostics.':'Sky Poker parsing is disabled until an authentic sample format is reviewed.'}</span></div>{preview?<button className="primary-btn import-submit" disabled={busy||preview.hands.length===0} onClick={()=>void commitImport()}>{busy?'Saving locally…':`Import ${preview.hands.length} parsed hand${preview.hands.length===1?'':'s'}`} <span>→</span></button>:<button className="primary-btn import-submit" disabled={busy||files.length===0} onClick={()=>void importFiles()}>{busy?'Checking files…':'Preview import'} <span>→</span></button>}{message&&<div className="notice" role="status">{message}{importDetails.length>0&&<ul>{importDetails.slice(0,12).map((line,i)=><li key={i}>{line}</li>)}</ul>}{importDetails.length>12&&<small>+{importDetails.length-12} more diagnostics</small>}</div>}</div><div className="import-side"><div className="panel support-panel"><div className="small-icon"><ShieldCheck size={17}/></div><h3>Local first, always.</h3><p>Your files are read on this device. No cloud account, uploads, or tracking.</p></div><div className="panel support-panel formats"><div className="formats-head">SUPPORTED FORMATS <span className="amber-dot"/></div><div className="format-row"><span>888poker · tournament + BLAST</span><span className="supported-label">Supported</span></div><div className="format-row"><span>Sky Poker</span><span className="not-supported">Awaiting sample</span></div><small>888poker support uses redacted structural fixtures derived from your supplied local histories. Sky Poker needs a representative sample.</small></div></div></section></>}
        {page === 'Settings' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> PREFERENCES</div><h1>Settings</h1><p className="subtitle">Manage your local data and app details.</p></div></div><section className="panel settings-panel"><h2>Local data</h2><p>Your hand history database is stored on this device.</p><div className="setting-row"><div><b>Storage</b><small>{storageLabel}</small></div><span className="local-status"><i/> On this device</span></div><div className="setting-row"><div><b>Imported hands</b><small>{hands.length} hand records stored locally</small></div><button className="danger-btn" onClick={()=>void clearData()} disabled={!hands.length}>Delete all data</button></div></section><section className="panel settings-panel"><h2>Supported formats</h2><p>Only observed formats with fixture coverage are enabled.</p><div className="format-row"><span>888poker tournament + BLAST</span><span className="supported-label">Supported · parser 1.0.0</span></div><div className="format-row"><span>Sky Poker</span><span className="not-supported">Awaiting sample</span></div></section><div className="about-line">PokerLab <span>·</span> Version 0.1.0 <span>·</span> Local-first hand study</div></>}
      </div>
      <footer className="footer"><span>POKERLAB <i>·</i> BUILT FOR STUDY, NOT THE TABLE</span><span><ShieldCheck size={13}/> YOUR DATA STAYS YOURS</span></footer>
    </main>
    {selected&&<div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="modal panel review-modal" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSelected(null)} aria-label="Close"><X size={17}/></button><div className="eyebrow"><span className="eyebrow-line"/> HAND REVIEW · {selected.site==='888poker'?'888POKER':'SKY POKER'}</div><h2>Hand #{selected.sourceHandId}</h2><p>{selected.playedAt ? new Date(selected.playedAt).toLocaleString() : 'Date unavailable'} · Tournament {selected.tournamentId??'unknown'} · Blinds {selected.smallBlind??'—'}/{selected.bigBlind??'—'}</p>{(selected.tournamentName||selected.buyInMinor!==null)&&<p>{selected.tournamentName??'Tournament'}{selected.buyInMinor!==null&&` · Prize pool ${(selected.currency??'')}${(selected.buyInMinor/100).toFixed(2)}`}{selected.feeMinor!==null&&` · Rake ${(selected.currency??'')}${(selected.feeMinor/100).toFixed(2)}`}{selected.buyInMinor!==null&&selected.feeMinor!==null&&` · Total ${selected.currency??''}${((selected.buyInMinor+selected.feeMinor)/100).toFixed(2)}`}</p>}<div className="review-cards"><div><small>HERO</small><div className="playing-cards">{selected.heroCards?.map((card,index)=><PlayingCard key={`${card}-${index}`} code={card}/>)??<span className="unknown-cards">Cards unavailable</span>}</div></div><div><small>BOARD</small><div className="playing-cards">{visibleBoard(selected,actionIndex).map((card,index)=><PlayingCard key={`${card}-${index}`} code={card}/>)}{!visibleBoard(selected,actionIndex).length&&<span className="unknown-cards">No board revealed yet</span>}</div></div></div><div className="table-players">{selected.players.map(player=><div key={player.seat} className={player.isHero?'hero-player':''}><span>Seat {player.seat}{player.position?` · ${player.position}`:''}{player.isHero?' · HERO':''}</span><b>{player.name}</b><small>{player.startingStack===null?'Stack unknown':`${player.startingStack.toLocaleString()} chips`}</small>{player.shownCards&&<div className="mini-cards">{player.shownCards.map((card,index)=><PlayingCard key={`${card}-${index}`} code={card} small/>)}</div>}</div>)}</div><div className="action-replay"><div className="action-heading"><b>Action replay</b><span>{selected.actions.length ? `${Math.max(0,actionIndex+1)} / ${selected.actions.length}` : 'No actions parsed'}</span></div>{actionIndex>=0&&selected.actions[actionIndex]&&<div className="current-action"><small>{selected.actions[actionIndex].street.toUpperCase()}</small><b>{selected.actions[actionIndex].player??'Unknown player'} {selected.actions[actionIndex].actionType.replace('_',' ')}{selected.actions[actionIndex].amount===null?'':` ${selected.actions[actionIndex].amount}`}</b><span>Reported action amount · source line: {selected.actions[actionIndex].sourceText}</span></div>}<div className="replay-controls"><button disabled={actionIndex<0} onClick={()=>setActionIndex(i=>Math.max(-1,i-1))}>← Previous</button><button disabled={actionIndex>=selected.actions.length-1} onClick={()=>setActionIndex(i=>Math.min(selected.actions.length-1,i+1))}>Next action →</button></div></div>{selected.warnings.length>0&&<div className="review-warning">Parser notes: {selected.warnings.join(' ')}</div>}</div></div>}
  </div>
}

function Stat({icon,label,value,caption}:{icon:React.ReactNode;label:string;value:string;caption:string}) { return <div className="panel stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><span className="stat-menu">···</span></div><div className="stat-value">{value}</div><div className="stat-caption">{caption}</div></div> }
function visibleBoard(hand: Hand, actionIndex: number): string[] {
  if (actionIndex < 0) return []
  const street = hand.actions[actionIndex]?.street
  const count = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' || street === 'showdown' ? 5 : 0
  return hand.boardCards.slice(0, count)
}
function PlayingCard({ code, small = false }: { code: string; small?: boolean }) {
  const suitCode = code.at(-1)?.toLowerCase() ?? ''
  const rankCode = code.slice(0, -1).toUpperCase()
  const rank = ({ T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' } as Record<string, string>)[rankCode] ?? rankCode
  const suits: Record<string, { glyph: string; name: string; red: boolean }> = {
    c: { glyph: '♣', name: 'clubs', red: false }, d: { glyph: '♦', name: 'diamonds', red: true },
    h: { glyph: '♥', name: 'hearts', red: true }, s: { glyph: '♠', name: 'spades', red: false },
  }
  const suit = suits[suitCode]
  return <span className={`playing-card ${small ? 'small-card' : ''} ${suit?.red ? 'red-card' : ''}`} role="img" aria-label={suit ? `${rank} of ${suit.name}` : `Unknown card ${code}`}><span className="card-corner"><b>{rank}</b><i>{suit?.glyph ?? '?'}</i></span><span className="card-center">{suit?.glyph ?? '?'}</span><span className="card-corner card-corner-bottom"><b>{rank}</b><i>{suit?.glyph ?? '?'}</i></span></span>
}
function EmptyState({onImport,title='No hands to show',body='Import a hand history to start building your library.'}:{onImport:()=>void;title?:string;body?:string}) {return <div className="empty-state"><div className="empty-icon"><Spade size={22}/></div><b>{title}</b><p>{body}</p><button className="secondary-btn" onClick={onImport}><Upload size={14}/> Import a hand history</button></div>}
function HandTable({hands,onSelect}:{hands:Hand[];onSelect:(h:Hand)=>void}) { return <div className="table-scroll"><table><thead><tr><th>DATE <ArrowDownUp size={11}/></th><th>SITE</th><th>TOURNAMENT</th><th>HERO HAND</th><th>POSITION</th><th>RESULT</th><th></th></tr></thead><tbody>{hands.map((h)=><tr key={h.id} onClick={()=>onSelect(h)}><td>{h.playedAt?new Date(h.playedAt).toLocaleDateString():'—'}</td><td><span className="site-cell"><i className="site-dot"/>{h.site==='888poker'?'888poker':'Sky Poker'}</span></td><td>{h.tournamentId??'—'}</td><td><div className="mini-cards">{h.heroCards?.map((card,index)=><PlayingCard key={`${card}-${index}`} code={card} small/>)??'—'}</div></td><td>{h.position??'—'}</td><td><span className="result-muted">{h.resultChips===null?'Unknown':`${h.resultChips.toLocaleString()} collected`}</span></td><td className="row-arrow">›</td></tr>)}</tbody></table></div> }

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownUp, ChevronDown, CircleHelp, FileText, FolderOpen, Grid2X2, Search, Settings2, ShieldCheck, Spade, Upload, X } from 'lucide-react'
import { HandSchema, parseFile, recoverShownCards, SiteSchema, type Hand, type HandTag, type Site } from '../domain'
import { deriveHandAccounting } from '../accounting'
import { calculateShowdownEquity, parseCardList, type EquityResult } from '../pokerMath'
import { deleteAllHands, getHands, getHandTags, isDesktopRuntime, removeHandTag, saveHandTag, saveHands } from '../storage'

const cardAssetUrls = import.meta.glob('./assets/cards/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

type Nav = 'Overview' | 'Hands' | 'Tournaments' | 'Import' | 'Settings'
const nav = [{ label: 'Overview', icon: Grid2X2 }, { label: 'Hands', icon: Spade }, { label: 'Tournaments', icon: Activity }, { label: 'Import', icon: Upload }, { label: 'Settings', icon: Settings2 }] as const

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
  const [handTags, setHandTags] = useState<HandTag[]>([])
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#a7e267')
  const [positionFilter, setPositionFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [actionIndex, setActionIndex] = useState(-1)
  const [busy, setBusy] = useState(false)
  const storageLabel = isDesktopRuntime() ? 'SQLite · PokerLab app data' : 'Browser IndexedDB · PokerLab local database'
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const refresh = async () => {
    const [storedHands, storedTags] = await Promise.all([getHands(), getHandTags()])
    setHands(storedHands.map(recoverShownCards))
    setHandTags(storedTags)
  }
  useEffect(() => { void refresh().catch(() => setMessage('PokerLab local storage is unavailable.')) }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const accountingByHand = useMemo(() => new Map(hands.map(hand => [hand.id, deriveHandAccounting(hand)])), [hands])
  const filtered = useMemo(() => hands.filter((h) => {
    const accounting = accountingByHand.get(h.id)
    const stageMatches = stageFilter === 'all' || stageFilter === 'preflop' || (stageFilter === 'flop' && h.boardCards.length >= 3) || (stageFilter === 'turn' && h.boardCards.length >= 4) || (stageFilter === 'river' && h.boardCards.length >= 5) || (stageFilter === 'showdown' && h.players.some(player => player.shownCards?.length))
    const net = accounting?.heroNetChips
    const resultMatches = resultFilter === 'all' || (resultFilter === 'unknown' && net == null) || (resultFilter === 'won' && net != null && net > 0) || (resultFilter === 'lost' && net != null && net < 0) || (resultFilter === 'even' && net === 0)
    const matchesTag = tagFilter === 'all' || (tagFilter === 'tagged' && handTags.some(tag => tag.handId === h.id)) || (tagFilter === 'untagged' && !handTags.some(tag => tag.handId === h.id)) || handTags.some(tag => tag.handId === h.id && tag.name === tagFilter)
    return `${h.sourceHandId ?? ''} ${h.tournamentId ?? ''} ${h.site} ${(h.heroCards ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()) && (!fromDate || (h.playedAt ?? '').slice(0, 10) >= fromDate) && (!toDate || (h.playedAt ?? '').slice(0, 10) <= toDate) && (positionFilter === 'all' || h.position === positionFilter) && stageMatches && resultMatches && matchesTag
  }), [hands, accountingByHand, query, fromDate, toDate, positionFilter, stageFilter, resultFilter, tagFilter, handTags])
  const tournamentSummaries = useMemo(() => {
    const groups = new Map<string, { site: Site; tournamentId: string | null; name: string | null; currency: string | null; buyInMinor: number | null; feeMinor: number | null; firstPlayedAt: string | null; handCount: number; net: number; netComplete: boolean }>()
    for (const hand of hands) {
      const key = hand.tournamentId ? `${hand.site}:${hand.tournamentId}` : `hand:${hand.id}`
      const group = groups.get(key) ?? { site: hand.site, tournamentId: hand.tournamentId, name: hand.tournamentName, currency: hand.currency, buyInMinor: hand.buyInMinor, feeMinor: hand.feeMinor, firstPlayedAt: hand.playedAt, handCount: 0, net: 0, netComplete: true }
      group.handCount++
      if (!group.name && hand.tournamentName) group.name = hand.tournamentName
      if (group.buyInMinor == null && hand.buyInMinor != null) group.buyInMinor = hand.buyInMinor
      if (group.feeMinor == null && hand.feeMinor != null) group.feeMinor = hand.feeMinor
      if (!group.currency && hand.currency) group.currency = hand.currency
      if (!group.firstPlayedAt || (hand.playedAt && hand.playedAt < group.firstPlayedAt)) group.firstPlayedAt = hand.playedAt
      const accounting = accountingByHand.get(hand.id)
      if (accounting?.heroNetChips === null || accounting?.heroNetChips === undefined) group.netComplete = false
      else group.net += accounting.heroNetChips
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => (b.firstPlayedAt ?? '').localeCompare(a.firstPlayedAt ?? ''))
  }, [hands, accountingByHand])
  const financialTotals = useMemo(() => {
    const grouped = new Map<string, { currency: string | null; entryFee: number }>()
    for (const tournament of tournamentSummaries) {
      if (tournament.buyInMinor == null && tournament.feeMinor == null) continue
      const key = tournament.currency ?? ''
      const total = grouped.get(key) ?? { currency: tournament.currency, entryFee: 0 }
      if (tournament.buyInMinor != null) total.entryFee += tournament.buyInMinor
      if (tournament.feeMinor != null) total.entryFee += tournament.feeMinor
      grouped.set(key, total)
    }
    return [...grouped.values()]
  }, [tournamentSummaries])
  const totalNetChips = tournamentSummaries.every(summary => summary.netComplete) ? tournamentSummaries.reduce((total, summary) => total + summary.net, 0) : null
  const selectedAccounting = selected ? deriveHandAccounting(selected) : null
  const selectedActionAccounting = actionIndex >= 0 ? selectedAccounting?.actions[actionIndex] : undefined
  const selectedTags = selected ? handTags.filter(tag => tag.handId === selected.id) : []
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
    if (!window.confirm('Wipe the local PokerLab database? All imported hands and colored tags stored in PokerLab will be permanently deleted. Original hand-history files will not be changed.')) return
    try { await deleteAllHands(); await refresh(); setMessage('Local database wiped.') }
    catch (error) { setMessage(error instanceof Error ? `Could not wipe the local database: ${error.message}` : 'Could not wipe the local database.') }
  }
  async function addSelectedTag() {
    if (!selected || !tagName.trim()) return
    try {
      await saveHandTag({ handId: selected.id, name: tagName, color: tagColor, createdAt: new Date().toISOString() })
      setTagName('')
      await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the hand tag.') }
  }
  async function deleteTag(tag: HandTag) {
    await removeHandTag(tag.handId, tag.name)
    await refresh()
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
            {hands.length ? <HandTable hands={hands.slice(0, 6)} tags={handTags} accountingByHand={accountingByHand} onSelect={setSelected} /> : <EmptyState onImport={() => { setPage('Import'); inputRef.current?.click() }} />}
          </section>
          <section className="supported-strip"><div className="supported-icon"><FileText size={17} /></div><div><b>888poker import is ready</b><p>Tournament and BLAST hand blocks are confirmed.</p></div><button className="text-btn" onClick={() => setPage('Import')}>Import hands <span>→</span></button></section>
        </>}
        {page === 'Hands' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> LIBRARY</div><h1>Your hands<span className="title-count">{hands.length}</span></h1><p className="subtitle">Search your locally stored tournament hand histories.</p></div><button className="primary-btn" onClick={() => { setPage('Import'); inputRef.current?.click() }}><Upload size={15} /> Import hands</button></div><section className="panel library-panel"><div className="filterbar"><div className="search-wrap"><Search size={15}/><input ref={searchRef} aria-label="Search hands" placeholder="Search hand ID, tournament ID or hero cards..." value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><select className="filter-btn" aria-label="Filter by position" value={positionFilter} onChange={e=>setPositionFilter(e.target.value)}><option value="all">All positions</option>{[...new Set(hands.map(hand=>hand.position).filter((value):value is string=>!!value))].sort().map(value=><option key={value}>{value}</option>)}</select><select className="filter-btn" aria-label="Filter by street reached" value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option value="all">All streets</option><option value="preflop">Preflop</option><option value="flop">Flop reached</option><option value="turn">Turn reached</option><option value="river">River reached</option><option value="showdown">Cards shown</option></select><select className="filter-btn" aria-label="Filter by result" value={resultFilter} onChange={e=>setResultFilter(e.target.value)}><option value="all">All results</option><option value="won">Positive chips</option><option value="lost">Negative chips</option><option value="even">Even</option><option value="unknown">Unknown</option></select><select className="filter-btn" aria-label="Filter by tags" value={tagFilter} onChange={e=>setTagFilter(e.target.value)}><option value="all">All tags</option><option value="tagged">Tagged</option><option value="untagged">Untagged</option>{[...new Set(handTags.map(tag=>tag.name))].sort().map(name=><option key={name} value={name}>{name}</option>)}</select><select className="filter-btn" aria-label="Sort hands" value={sortOrder} onChange={e=>setSortOrder(e.target.value as 'newest'|'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><input className="filter-btn date-filter" type="date" aria-label="From date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/><input className="filter-btn date-filter" type="date" aria-label="To date" value={toDate} onChange={e=>setToDate(e.target.value)}/></div>{filtered.length?<HandTable hands={[...filtered].sort((a,b)=>{const dateCompare=(a.playedAt??'').localeCompare(b.playedAt??'');return sortOrder==='oldest'?dateCompare:-dateCompare})} tags={handTags} accountingByHand={accountingByHand} onSelect={h=>{setActionIndex(-1);setSelected(h)}}/>:<EmptyState onImport={()=>{setPage('Import');inputRef.current?.click()}} title={hands.length?'No matching hands':'No hands yet'} body={hands.length?'Try another search or date.':'Import a hand history to start building your library.'}/>}</section></>}
        {page === 'Tournaments' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line"/> RESULTS</div><h1>Tournaments</h1><p className="subtitle">Session overview and chip results for the tournament hands you imported.</p></div></div><section className="stats-grid"><Stat icon={<Activity size={16}/>} label="TOURNAMENTS" value={tournamentSummaries.length.toString()} caption="Unique tournament IDs"/><Stat icon={<ArrowDownUp size={16}/>} label="ENTRY FEES" value={financialTotals.map(total=>total.entryFee===0?'Free':formatMinor(total.entryFee,total.currency??'')).join(' · ')||'—'} caption="Prize contribution, bounty and rake combined"/><Stat icon={<Spade size={16}/>} label="NET CHIPS" value={hands.length&&totalNetChips!==null?`${totalNetChips>0?'+':''}${totalNetChips.toLocaleString()}`:'—'} caption="Across imported hands only"/></section><section className="panel library-panel tournament-panel"><div className="panel-head"><div><h2>Tournament results</h2><p>Net chips cover imported hands only; final payout and ROI are not present in these hand histories.</p></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>TOURNAMENT</th><th>HANDS</th><th>ENTRY FEE</th><th>NET CHIPS</th><th></th></tr></thead><tbody>{tournamentSummaries.map((summary,index)=><tr key={`${summary.site}:${summary.tournamentId??index}`}><td>{summary.firstPlayedAt?new Date(summary.firstPlayedAt).toLocaleDateString():'—'}</td><td>{summary.name??summary.tournamentId??'Tournament ID unavailable'}</td><td>{summary.handCount}</td><td>{summary.buyInMinor==null&&summary.feeMinor==null?'—':(summary.buyInMinor??0)+(summary.feeMinor??0)===0?'Free':formatMinor((summary.buyInMinor??0)+(summary.feeMinor??0),summary.currency??'')}</td><td>{summary.netComplete?`${summary.net>0?'+':''}${summary.net.toLocaleString()} chips`:'Unknown'}</td><td><button className="text-btn" onClick={()=>{setPage('Hands');setQuery(summary.tournamentId??'')}}>Review hands →</button></td></tr>)}</tbody></table></div>{!tournamentSummaries.length&&<div className="empty-state"><b>No tournament results yet</b><p>Import tournament hand histories to build this overview.</p></div>}</section><p className="study-footnote">Entry fees combine prize contribution, any bounty contribution, and rake, counted once per unique tournament. Freerolls are listed as Free. Chip net is derived from action contributions and recorded collections; unmatched bets are returned to the aggressor. If a hand cannot be reconciled, its net is shown as unknown.</p></>}
        {page === 'Import' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> ADD TO YOUR LIBRARY</div><h1>Import hands</h1><p className="subtitle">Choose hand-history files stored on your device.</p></div></div><section className="import-layout"><div className="panel import-panel"><h2>Select files</h2><p className="panel-desc">Files are read locally in this app. Nothing is uploaded.</p><div className="site-select"><label htmlFor="site">Poker site</label><select id="site" value={site} onChange={e=>{const result=SiteSchema.safeParse(e.target.value);if(result.success){setSite(result.data);setPreview(null);setMessage('')}}}><option value="888poker">888poker</option><option value="sky_poker">Sky Poker</option></select><span className={`unsupported-label ${site==='888poker'?'confirmed-label':''}`}>{site==='888poker'?'FORMAT CONFIRMED':'PARSER NOT CONFIRMED'}</span></div><input ref={inputRef} type="file" multiple accept=".txt,.log,.hh,.history,text/plain" className="hidden-input" onChange={e=>void selectFiles(e.target.files)}/><button className="dropzone" onClick={()=>inputRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void selectFiles(e.dataTransfer.files)}}><div className="upload-circle"><FolderOpen size={21}/></div><b>Drop files here, or <span>browse</span></b><small>Text hand-history files · Multiple files supported</small></button>{files.length>0&&<div className="file-list">{files.map(f=><div key={`${f.name}-${f.size}`} className="file-row"><FileText size={15}/><span>{f.name}</span><small>{(f.size/1024).toFixed(1)} KB</small><button aria-label={`Remove ${f.name}`} onClick={()=>{setFiles(files.filter(x=>x!==f));setPreview(null);setMessage('')}}><X size={15}/></button></div>)}</div>}<div className="import-note"><CircleHelp size={15}/><span>{site==='888poker'?'Confirmed 888poker tournament and BLAST text formats are parsed locally. Unexpected lines are reported with hand and line diagnostics.':'Sky Poker parsing is disabled until an authentic sample format is reviewed.'}</span></div>{preview?<button className="primary-btn import-submit" disabled={busy||preview.hands.length===0} onClick={()=>void commitImport()}>{busy?'Saving locally…':`Import ${preview.hands.length} parsed hand${preview.hands.length===1?'':'s'}`} <span>→</span></button>:<button className="primary-btn import-submit" disabled={busy||files.length===0} onClick={()=>void importFiles()}>{busy?'Checking files…':'Preview import'} <span>→</span></button>}{message&&<div className="notice" role="status">{message}{importDetails.length>0&&<ul>{importDetails.slice(0,12).map((line,i)=><li key={i}>{line}</li>)}</ul>}{importDetails.length>12&&<small>+{importDetails.length-12} more diagnostics</small>}</div>}</div><div className="import-side"><div className="panel support-panel"><div className="small-icon"><ShieldCheck size={17}/></div><h3>Local first, always.</h3><p>Your files are read on this device. No cloud account, uploads, or tracking.</p></div><div className="panel support-panel formats"><div className="formats-head">SUPPORTED FORMATS <span className="amber-dot"/></div><div className="format-row"><span>888poker · tournament + BLAST</span><span className="supported-label">Supported</span></div><div className="format-row"><span>Sky Poker</span><span className="not-supported">Awaiting sample</span></div><small>888poker support uses redacted structural fixtures derived from your supplied local histories. Sky Poker needs a representative sample.</small></div></div></section></>}
        {page === 'Settings' && <><div className="page-heading compact"><div><div className="eyebrow"><span className="eyebrow-line" /> PREFERENCES</div><h1>Settings</h1><p className="subtitle">Manage your local data and app details.</p></div></div><section className="panel settings-panel"><h2>Local data</h2><p>Your hand history database is stored on this device.</p><div className="setting-row"><div><b>Storage</b><small>{storageLabel}</small></div><span className="local-status"><i/> On this device</span></div><div className="setting-row"><div><b>Imported hands and tags</b><small>{hands.length} hand records · {handTags.length} colored tags stored locally</small></div><button className="danger-btn" onClick={()=>void clearData()} disabled={!hands.length&&!handTags.length}>Wipe local database</button></div>{message&&<div className="notice" role="status">{message}</div>}</section><section className="panel settings-panel"><h2>Supported formats</h2><p>Only observed formats with fixture coverage are enabled.</p><div className="format-row"><span>888poker tournament + BLAST</span><span className="supported-label">Supported · parser 1.2.0</span></div><div className="format-row"><span>Sky Poker</span><span className="not-supported">Awaiting sample</span></div></section><div className="about-line">PokerLab <span>·</span> Version 0.1.0 <span>·</span> Local-first hand study</div></>}
      </div>
      <footer className="footer"><span>POKERLAB <i>·</i> BUILT FOR STUDY, NOT THE TABLE</span><span><ShieldCheck size={13}/> YOUR DATA STAYS YOURS</span></footer>
    </main>
    {selected && <PokerReplay hand={selected} actionIndex={actionIndex} setActionIndex={setActionIndex} accounting={selectedAccounting} selectedActionAccounting={selectedActionAccounting} tags={selectedTags} tagName={tagName} tagColor={tagColor} setTagName={setTagName} setTagColor={setTagColor} addTag={addSelectedTag} deleteTag={deleteTag} onClose={() => setSelected(null)} />}
  </div>
}

type PokerReplayProps = {
  hand: Hand
  actionIndex: number
  setActionIndex: React.Dispatch<React.SetStateAction<number>>
  accounting: ReturnType<typeof deriveHandAccounting> | null
  selectedActionAccounting: ReturnType<typeof deriveHandAccounting>['actions'][number] | undefined
  tags: HandTag[]
  tagName: string
  tagColor: string
  setTagName: (value: string) => void
  setTagColor: (value: string) => void
  addTag: () => Promise<void>
  deleteTag: (tag: HandTag) => Promise<void>
  onClose: () => void
}

function PokerReplay({ hand, actionIndex, setActionIndex, accounting, selectedActionAccounting, tags, tagName, tagColor, setTagName, setTagColor, addTag, deleteTag, onClose }: PokerReplayProps) {
  const [playing, setPlaying] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const players = [...hand.players].sort((a, b) => a.seat - b.seat)
  const buttonIndex = players.findIndex(player => player.seat === hand.buttonSeat)
  const seatOrder = buttonIndex < 0 ? players : [...players.slice(buttonIndex), ...players.slice(0, buttonIndex)]
  const positionLabels: Record<number, string[]> = { 2: ['BTN/SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'UTG'], 5: ['BTN', 'SB', 'BB', 'UTG', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'], 7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'], 8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'] }
  const inferredPositions = new Map(seatOrder.map((player, index) => [player.seat, positionLabels[seatOrder.length]?.[index] ?? `Seat ${player.seat}`]))
  const heroPosition = hand.position ?? players.find(player => player.isHero)?.position ?? inferredPositions.get(players.find(player => player.isHero)?.seat ?? -1) ?? 'Position unknown'
  const rawBuyIn = hand.rawText.match(/Tournament #\d+\s+([$€£])\s*([\d,]+(?:\.\d{1,2})?)\s*\+\s*([$€£])?\s*([\d,]+(?:\.\d{1,2})?)/)
  const rawToMinor = (value: string | undefined) => value ? Math.round(Number(value.replaceAll(',', '')) * 100) : null
  const buyInMinor = typeof hand.buyInMinor === 'number' && Number.isFinite(hand.buyInMinor) ? hand.buyInMinor : rawToMinor(rawBuyIn?.[2])
  const feeMinor = typeof hand.feeMinor === 'number' && Number.isFinite(hand.feeMinor) ? hand.feeMinor : rawToMinor(rawBuyIn?.[4])
  const currency = hand.currency ?? rawBuyIn?.[1] ?? ''
  const action = hand.actions[actionIndex]
  const board = visibleBoard(hand, actionIndex)
  const currentPot = actionIndex < 0 ? 0 : selectedActionAccounting?.potAfter ?? 0
  const heroName = players.find(player => player.isHero)?.name
  const potBeforeHeroAction = action?.player === heroName && actionIndex >= 0 ? Math.max(0, currentPot - (selectedActionAccounting?.contribution ?? 0)) : currentPot
  const currentStacks = actionIndex < 0 ? Object.fromEntries(players.map(player => [player.name, player.startingStack])) : selectedActionAccounting?.playerStacks ?? {}
  const moveTo = (index: number) => setActionIndex(Math.max(-1, Math.min(hand.actions.length - 1, index)))

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setActionIndex(index => Math.min(hand.actions.length - 1, index + 1)), 1150)
    return () => window.clearInterval(timer)
  }, [playing, hand.actions.length, setActionIndex])

  useEffect(() => {
    if (playing && actionIndex >= hand.actions.length - 1) setPlaying(false)
  }, [playing, actionIndex, hand.actions.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') moveTo(actionIndex + 1)
      if (event.key === 'ArrowLeft') moveTo(actionIndex - 1)
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); setPlaying(value => !value) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actionIndex, onClose, hand.actions.length])

  const visiblePlayerName = action?.player ?? null
  const foldedPlayers = new Set(hand.actions.slice(0, actionIndex + 1).filter(item => item.actionType === 'fold').map(item => item.player))
  const formatChips = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString()

  return <div className="modal-backdrop poker-replay-backdrop" onClick={onClose}>
    <section className="poker-replay panel" role="dialog" aria-modal="true" aria-label={`Replay hand ${hand.sourceHandId ?? ''}`} onClick={event => event.stopPropagation()}>
      <header className="replay-topbar">
        <div><div className="eyebrow"><span className="eyebrow-line"/> HAND REPLAY · {hand.site === '888poker' ? '888POKER' : 'SKY POKER'}</div><h2>Hand #{hand.sourceHandId ?? hand.id}</h2><p>{hand.tournamentName ?? 'Tournament history'} · {hand.tournamentId ? `Tournament ${hand.tournamentId}` : 'Tournament ID unavailable'} · {hand.tableName ?? 'Table unavailable'}</p></div>
        <button className="replay-close" onClick={onClose} aria-label="Close replay"><X size={18}/></button>
      </header>
      <div className="replay-facts">
        <div><small>PLAYED</small><b>{hand.playedAt ? new Date(hand.playedAt).toLocaleString() : 'Unavailable'}</b></div>
        <div><small>BLINDS / ANTE</small><b>{formatChips(hand.smallBlind)} / {formatChips(hand.bigBlind)}{hand.ante !== null ? ` / ${formatChips(hand.ante)} ante` : ''}</b></div>
        <div><small>ENTRY FEE</small><b>{buyInMinor === null && feeMinor === null ? 'Unavailable' : formatMinor((buyInMinor ?? 0) + (feeMinor ?? 0), currency)}</b></div>
        <div><small>BUTTON / HERO</small><b>{hand.buttonSeat == null ? '—' : `Seat ${hand.buttonSeat}`} / {heroPosition}</b></div>
      </div>

      <div className="replay-workspace">
        <main className="replay-stage-column">
          <div className="poker-stage">
            <div className="felt-rail"><div className="felt-surface">
              <div className="table-logo">POKERLAB <small>HAND REPLAY</small></div>
              <div className="board-area"><div className="board-cards">{board.map((card, index) => <PlayingCard key={`${card}-${index}`} code={card}/>) }{Array.from({ length: Math.max(0, 5 - board.length) }, (_, index) => <PlayingCardBack className="board-card-back" key={`back-${index}`}/>)}</div><div className="pot-readout"><small>{action?.street?.toUpperCase() ?? 'BEFORE DEAL' } · POT</small><b>{formatChips(currentPot)} <span>chips</span></b></div>{selectedActionAccounting?.returnedBeforeAction ? <small className="refund-note">{formatChips(selectedActionAccounting.returnedBeforeAction)} returned uncalled</small> : null}</div>
              {seatOrder.map((player, index) => {
                const angle = Math.PI / 2 + index * (Math.PI * 2 / Math.max(1, seatOrder.length))
                const actionForPlayer = hand.actions.slice(0, actionIndex + 1).filter(item => item.player === player.name).at(-1)
                const net = accounting?.playerNetChips?.[player.name]
                const position = player.position ?? inferredPositions.get(player.seat)
                const revealedCards = player.isHero ? hand.heroCards : player.shownCards
                const revealAction = player.isHero ? -1 : hand.actions.findIndex(item => item.player === player.name && item.actionType === 'show')
                const revealAt = revealAction >= 0 ? revealAction : Math.max(0, hand.actions.length - 1)
                const cardsAreVisible = player.isHero || (actionIndex >= revealAt && revealedCards?.length === 2)
                return <article key={`${player.seat}-${player.name}`} className={`table-seat ${player.isHero ? 'seat-hero' : ''} ${visiblePlayerName === player.name ? 'seat-active' : ''} ${foldedPlayers.has(player.name) ? 'seat-folded' : ''}`} style={{ left: `${50 + Math.cos(angle) * 37}%`, top: `${50 + Math.sin(angle) * 39}%` }}>
                  <div className="seat-cards">{cardsAreVisible ? revealedCards!.map((card, cardIndex) => <PlayingCard key={`${card}-${cardIndex}`} code={card} table/> ) : <><PlayingCardBack className="seat-card-back"/><PlayingCardBack className="seat-card-back"/></>}</div>
                  <div className="seat-info"><div className="seat-label">{position ?? `Seat ${player.seat}`}{player.seat === hand.buttonSeat && <span className="dealer-chip">D</span>}</div><b title={player.name}>{player.name}{player.isHero && <em>HERO</em>}</b><small>{formatChips(currentStacks[player.name])} chips</small>{net !== undefined && <small className={net >= 0 ? 'net-positive' : 'net-negative'}>{net > 0 ? '+' : ''}{net.toLocaleString()} net</small>}{actionForPlayer && <span className="seat-last-action">{actionForPlayer.actionType.replace('_', ' ')}{actionForPlayer.amount !== null ? ` ${formatChips(actionForPlayer.amount)}` : ''}</span>}</div>
                </article>
              })}
              {action && <div className="table-action-callout"><small>{action.street.toUpperCase()} · ACTION {actionIndex + 1} / {hand.actions.length}</small><b>{action.player ?? 'Unknown player'} {action.actionType.replace('_', ' ')}{action.amount !== null ? ` ${formatChips(action.amount)}` : ''}</b>{action.amountTo !== null && action.amountTo !== action.amount && <span>Raise to {formatChips(action.amountTo)}</span>}</div>}
            </div></div>
          </div>

          <div className="replay-timeline panel"><div className="timeline-head"><b>Action timeline</b><span>{actionIndex < 0 ? 'Hand start' : `${actionIndex + 1} of ${hand.actions.length}`}</span></div><input aria-label="Replay action position" type="range" min={-1} max={Math.max(-1, hand.actions.length - 1)} value={actionIndex} onChange={event => { setPlaying(false); moveTo(Number(event.target.value)) }}/><div className="timeline-controls"><button onClick={() => { setPlaying(false); moveTo(-1) }}>⏮ Start</button><button disabled={actionIndex < 0} onClick={() => { setPlaying(false); moveTo(actionIndex - 1) }}>← Previous</button><button className="play-button" onClick={() => { if (actionIndex >= hand.actions.length - 1) moveTo(-1); setPlaying(value => !value) }}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button><button disabled={actionIndex >= hand.actions.length - 1} onClick={() => { setPlaying(false); moveTo(actionIndex + 1) }}>Next →</button><button onClick={() => { setPlaying(false); moveTo(hand.actions.length - 1) }}>End ⏭</button></div></div>
        </main>

        <aside className="replay-side-panel">
          <PreflopGuide hand={hand} position={heroPosition}/>
          <QuickHandCalculator key={hand.id} hand={hand} board={board} initialPot={potBeforeHeroAction}/>
          <details className="replay-side-card replay-accordion"><summary className="replay-section-heading"><b>Hand details</b><span>{hand.parseStatus.toUpperCase()}</span></summary><dl className="hand-detail-list"><dt>Source hand ID</dt><dd>{hand.sourceHandId ?? '—'}</dd><dt>Tournament</dt><dd>{hand.tournamentId ?? '—'}</dd><dt>Site / table</dt><dd>{hand.site} · {hand.tableName ?? '—'}</dd><dt>Entry fee</dt><dd>{buyInMinor === null && feeMinor === null ? '—' : formatMinor((buyInMinor ?? 0) + (feeMinor ?? 0), currency)}</dd><dt>Net chips</dt><dd>{accounting?.heroNetChips == null ? 'Unknown' : `${accounting.heroNetChips > 0 ? '+' : ''}${accounting.heroNetChips.toLocaleString()}`}</dd><dt>Collected (source)</dt><dd>{hand.resultChips == null ? '—' : `${hand.resultChips.toLocaleString()} chips`}</dd></dl></details>
          <details className="replay-side-card replay-accordion"><summary className="replay-section-heading"><b>Players & stacks</b><span>{players.length} SEATS</span></summary><div className="replay-player-list">{players.map(player => { const net = accounting?.playerNetChips?.[player.name]; return <div key={`list-${player.seat}`} className={player.isHero ? 'replay-list-hero' : ''}><span>{player.position ?? inferredPositions.get(player.seat) ?? `Seat ${player.seat}`} · {player.name}</span><b>{formatChips(currentStacks[player.name])}</b><small>{net === undefined ? 'Net unavailable' : `${net > 0 ? '+' : ''}${net.toLocaleString()} net`}</small></div> })}</div></details>
          <details className="replay-side-card replay-accordion"><summary className="replay-section-heading"><b>Hand tags</b><span>{tags.length} TAGS</span></summary><div className="tag-list">{tags.map(tag => <button type="button" key={tag.name} className="tag-chip removable-tag" style={{ '--tag-color': tag.color } as React.CSSProperties} title={`Remove ${tag.name}`} onClick={() => void deleteTag(tag)}>{tag.name}<X size={11}/></button>)}</div><div className="tag-create"><input aria-label="Custom hand tag" maxLength={32} placeholder="Add a tag…" value={tagName} onChange={event => setTagName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addTag() }}/><input aria-label="Tag color" type="color" value={tagColor} onChange={event => setTagColor(event.target.value)}/><button className="secondary-btn" onClick={() => void addTag()} disabled={!tagName.trim()}>Add</button></div></details>
        </aside>
      </div>

      <details className="replay-action-log replay-accordion"><summary className="replay-section-heading"><b>Imported action log</b><span>{hand.actions.length} ACTIONS · EXACT SOURCE</span></summary><div className="action-log-scroll">{hand.actions.map((item, index) => <button key={`${item.sequence}-${index}`} className={index === actionIndex ? 'log-action current-log-action' : 'log-action'} onClick={() => { setPlaying(false); moveTo(index) }}><small>{item.street.toUpperCase()} · {String(index + 1).padStart(2, '0')}</small><b>{item.player ?? 'Unknown player'} {item.actionType.replace('_', ' ')}{item.amount !== null ? ` ${item.amount.toLocaleString()}` : ''}{item.amountTo !== null && item.amountTo !== item.amount ? ` (to ${item.amountTo.toLocaleString()})` : ''}</b><span>{item.sourceText}</span></button>)}{!hand.actions.length && <p className="replay-empty">No actions were parsed for this hand.</p>}</div></details>
      {hand.warnings.length > 0 && <div className="review-warning">Parser notes: {hand.warnings.join(' ')}</div>}
      <details className="raw-hand-details" open={showSource} onToggle={event => setShowSource(event.currentTarget.open)}><summary>Imported source text · {hand.rawText.split(/\r?\n/).length} lines · parser {hand.parserName} {hand.parserVersion}</summary><pre>{hand.rawText}</pre></details>
      <div className="replay-key-hints">Keyboard: ←/→ step actions · Space play/pause · Esc close</div>
    </section>
  </div>
}

function PreflopGuide({ hand, position }: { hand: Hand; position: string }) {
  const cards = hand.heroCards
  const rankOrder = '23456789TJQKA'
  const ranks = cards?.length === 2 ? cards.map(card => card.slice(0, -1).toUpperCase() === '10' ? 'T' : card.slice(0, -1).toUpperCase()) : []
  const valid = ranks.length === 2 && ranks.every(rank => rankOrder.includes(rank))
  const suited = valid && cards![0].at(-1)?.toLowerCase() === cards![1].at(-1)?.toLowerCase()
  const high = valid ? Math.max(rankOrder.indexOf(ranks[0]), rankOrder.indexOf(ranks[1])) : -1
  const low = valid ? Math.min(rankOrder.indexOf(ranks[0]), rankOrder.indexOf(ranks[1])) : -1
  const pair = valid && high === low
  const label = valid ? pair ? `${ranks[0]}${ranks[1]}` : `${rankOrder[high]}${rankOrder[low]}${suited ? 's' : 'o'}` : 'Cards unavailable'
  const pos = position.toUpperCase()
  const late = ['CO', 'BTN', 'BTN/SB'].includes(pos)
  const middle = ['HJ', 'LJ', 'MP', 'UTG+1'].includes(pos)
  let tier = 'Marginal'
  let advice = 'Usually fold first-in from this seat in a conservative baseline.'
  if (valid && ((pair && high >= 10) || (ranks.includes('A') && ranks.includes('K')))) {
    tier = 'Premium'; advice = 'Raise for value when first-in; continue aggressively versus a raise, adjusting to stack depth.'
  } else if (valid && ((pair && high >= 7) || (ranks.includes('A') && (ranks.includes('Q') || (ranks.includes('J') && suited))) || (suited && ranks.includes('K') && low >= 9))) {
    tier = 'Strong'; advice = 'A standard open candidate in most positions; versus a raise, use position and sizing to choose call or 3-bet.'
  } else if (valid && ((pair) || (suited && high >= 9) || (high >= 10 && low >= 9))) {
    tier = 'Playable'; advice = late ? 'Reasonable late-position open candidate; from the blinds or early seats, tighten up.' : middle ? 'Position-sensitive: often mix in later positions, usually fold from early position.' : 'Playable mainly from late position; avoid treating it as an automatic continue versus a raise.'
  }
  const preflopActions = hand.actions.filter(item => item.street === 'preflop' && item.player)
  return <details className="replay-side-card replay-accordion preflop-guide"><summary className="replay-section-heading"><b>Preflop GTO guide</b><span>OPENING BASELINE</span></summary>
    <div className="preflop-content"><div className="preflop-hand"><b>{label}</b><span>{position} · {hand.bigBlind && hand.players.find(player => player.isHero)?.startingStack != null ? `${(hand.players.find(player => player.isHero)!.startingStack! / hand.bigBlind).toFixed(1)} BB` : 'stack depth unknown'}</span></div>
      <div className={`preflop-tier preflop-${tier.toLowerCase()}`}><small>HAND CLASS · {tier.toUpperCase()}</small><p>{advice}</p></div>
      <div className="preflop-actions"><small>RECORDED PREFLOP ACTION</small>{preflopActions.length ? preflopActions.map(item => <span key={item.sequence}>{item.player} {item.actionType.replace('_', ' ')}{item.amount != null ? ` ${item.amount.toLocaleString()}` : ''}</span>) : <span>No preflop actions parsed.</span>}</div>
      <small className="preflop-caveat">Educational baseline only, not solver output. Equilibrium ranges vary with effective stacks, antes, opening size, prior action, and tournament payouts.</small>
    </div>
  </details>
}

function QuickHandCalculator({ hand, board, initialPot }: { hand: Hand; board: string[]; initialPot: number }) {
  const opponents = hand.players.filter(player => !player.isHero && player.shownCards?.length === 2)
  const [opponentName, setOpponentName] = useState(opponents[0]?.name ?? 'manual')
  const [manualCards, setManualCards] = useState('')
  const [potInput, setPotInput] = useState(String(initialPot))
  const [callInput, setCallInput] = useState('')
  const [equityResult, setEquityResult] = useState<EquityResult | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setPotInput(String(initialPot)); setEquityResult(null) }, [initialPot, board.join(' ')])

  const pot = Number(potInput)
  const call = Number(callInput)
  const amountsValid = Number.isFinite(pot) && pot >= 0 && Number.isFinite(call) && call >= 0
  const potOdds = amountsValid && call > 0 && pot + call > 0 ? call / (pot + call) : null
  const selectedOpponent = opponents.find(player => player.name === opponentName)

  function calculate() {
    setError('')
    const heroCards = hand.heroCards ? parseCardList(hand.heroCards.join(' ')) : null
    const opponentCards = selectedOpponent?.shownCards ? parseCardList(selectedOpponent.shownCards.join(' ')) : parseCardList(manualCards)
    if (!heroCards || heroCards.length !== 2) { setEquityResult(null); setError('Hero hole cards are not available in this hand.'); return }
    if (!opponentCards || opponentCards.length !== 2) { setEquityResult(null); setError('Enter two opponent cards, such as As Kd, to calculate equity.'); return }
    try { setEquityResult(calculateShowdownEquity(heroCards, opponentCards, board)); }
    catch (calculationError) { setEquityResult(null); setError(calculationError instanceof Error ? calculationError.message : 'Could not calculate equity.') }
  }

  const ev = equityResult && amountsValid ? equityResult.equity * (pot + call) - call : null
  return <details className="replay-side-card replay-accordion calculator-card"><summary className="replay-section-heading"><b>Quick hand calculator</b><span>POT ODDS · EQUITY · EV</span></summary>
    <div className="calculator-content">
      <p className="calculator-note">Uses the current replay board. Equity is versus one known opponent hand.</p>
      <label className="calculator-field">Pot before your call<input aria-label="Pot before call" type="number" min="0" step="1" value={potInput} onChange={event => setPotInput(event.target.value)}/></label>
      <label className="calculator-field">Amount to call<input aria-label="Amount to call" type="number" min="0" step="1" value={callInput} onChange={event => setCallInput(event.target.value)}/></label>
      {opponents.length > 0 && <label className="calculator-field">Opponent<select value={opponentName} onChange={event => { setOpponentName(event.target.value); setEquityResult(null) }}><option value="manual">Enter cards manually</option>{opponents.map(player => <option key={player.name} value={player.name}>{player.name} (shown)</option>)}</select></label>}
      {(!selectedOpponent || opponentName === 'manual') && <label className="calculator-field">Opponent cards<input aria-label="Opponent cards" placeholder="As Kd" value={manualCards} onChange={event => { setManualCards(event.target.value); setEquityResult(null) }}/></label>}
      <div className="calculator-results"><div><small>POT ODDS</small><b>{potOdds === null ? 'Enter call' : `${(potOdds * 100).toFixed(1)}%`}</b></div><div><small>BREAK-EVEN EQUITY</small><b>{potOdds === null ? '—' : `${(potOdds * 100).toFixed(1)}%`}</b></div><div><small>SHOWDOWN EQUITY</small><b>{equityResult ? `${(equityResult.equity * 100).toFixed(1)}%` : '—'}</b></div><div><small>CALL EV</small><b className={ev === null ? '' : ev >= 0 ? 'net-positive' : 'net-negative'}>{ev === null ? '—' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)} chips`}</b></div></div>
      {error && <div className="calculator-error">{error}</div>}
      {equityResult && <small className="calculator-sample">{board.length === 5 ? 'Exact river result' : `${equityResult.trials.toLocaleString()} simulated board runouts`} · {equityResult.wins} wins · {equityResult.ties} ties · {equityResult.losses} losses</small>}
      <button className="secondary-btn calculator-button" onClick={calculate} disabled={!hand.heroCards?.length}>Calculate showdown equity</button>
      <small className="calculator-caveat">Call EV = equity × (pot + call) − call. Assumes a heads-up call with no fold equity, side pots, or future betting.</small>
    </div>
  </details>
}

function formatMinor(value:number,currency:string){return `${currency}${(value/100).toFixed(2)}`}
function Stat({icon,label,value,caption}:{icon:React.ReactNode;label:string;value:string;caption:string}) { return <div className="panel stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><span className="stat-menu">···</span></div><div className="stat-value">{value}</div><div className="stat-caption">{caption}</div></div> }
function visibleBoard(hand: Hand, actionIndex: number): string[] {
  if (actionIndex < 0) return []
  const street = hand.actions[actionIndex]?.street
  const count = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' || street === 'showdown' ? 5 : 0
  return hand.boardCards.slice(0, count)
}
function PlayingCard({ code, small = false, table = false }: { code: string; small?: boolean; table?: boolean }) {
  const suitCode = code.at(-1)?.toLowerCase() ?? ''
  const rankCode = code.slice(0, -1).toUpperCase()
  const rank = ({ T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' } as Record<string, string>)[rankCode] ?? rankCode
  const suits: Record<string, { glyph: string; name: string; red: boolean }> = {
    c: { glyph: '♣', name: 'clubs', red: false }, d: { glyph: '♦', name: 'diamonds', red: true },
    h: { glyph: '♥', name: 'hearts', red: true }, s: { glyph: '♠', name: 'spades', red: false },
  }
  const suit = suits[suitCode]
  const imageUrl = cardAssetUrls[`./assets/cards/${suitCode.toUpperCase()}-${rank}.png`]
  return <span className={`playing-card ${small ? 'small-card' : ''} ${table ? 'table-card' : ''}`} role="img" aria-label={suit ? `${rank} of ${suit.name}` : `Unknown card ${code}`}>{imageUrl ? <img src={imageUrl} alt="" draggable={false}/> : <span className="playing-card-fallback">{rank}{suit?.glyph ?? '?'}</span>}</span>
}
function PlayingCardBack({ className }: { className: string }) { return <span className={className} aria-label="Face-down card"><span className="back-center-mark">♠</span></span> }
function EmptyState({onImport,title='No hands to show',body='Import a hand history to start building your library.'}:{onImport:()=>void;title?:string;body?:string}) {return <div className="empty-state"><div className="empty-icon"><Spade size={22}/></div><b>{title}</b><p>{body}</p><button className="secondary-btn" onClick={onImport}><Upload size={14}/> Import a hand history</button></div>}
function HandTable({hands,onSelect,tags=[],accountingByHand}:{hands:Hand[];onSelect:(h:Hand)=>void;tags?:HandTag[];accountingByHand?:Map<string,ReturnType<typeof deriveHandAccounting>>}) { return <div className="table-scroll"><table><thead><tr><th>DATE <ArrowDownUp size={11}/></th><th>SITE</th><th>TOURNAMENT</th><th>HERO HAND</th><th>POSITION</th><th>TAGS</th><th>NET CHIPS</th><th></th></tr></thead><tbody>{hands.map((h)=>{const accounting=accountingByHand?.get(h.id)??deriveHandAccounting(h);return <tr key={h.id} onClick={()=>onSelect(h)}><td>{h.playedAt?new Date(h.playedAt).toLocaleDateString():'—'}</td><td><span className="site-cell"><i className="site-dot"/>{h.site==='888poker'?'888poker':'Sky Poker'}</span></td><td>{h.tournamentName??h.tournamentId??'—'}</td><td><div className="mini-cards">{h.heroCards?.map((card,index)=><PlayingCard key={`${card}-${index}`} code={card} small/>)??'—'}</div></td><td>{h.position??'—'}</td><td><div className="tag-list">{tags.filter(tag=>tag.handId===h.id).map(tag=><span key={tag.name} className="tag-chip" style={{'--tag-color':tag.color} as React.CSSProperties}>{tag.name}</span>)}</div></td><td><span className="result-muted">{accounting.heroNetChips===null?'Unknown':`${accounting.heroNetChips>0?'+':''}${accounting.heroNetChips.toLocaleString()}`}</span></td><td className="row-arrow">›</td></tr>})}</tbody></table></div> }

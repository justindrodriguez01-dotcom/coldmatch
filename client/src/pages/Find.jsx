import { useState, useEffect, useRef } from 'react'
import Spinner from '../components/Spinner'
import MatchBadge from '../components/MatchBadge'
import { apiFetch } from '../api'
import { getToken } from '../api'

// ── Helpers ────────────────────────────────────────────────────────────────────

function autoMatch(col, field) {
  const c = col.toLowerCase().trim()
  const map = {
    // "name" only matches full-name columns — NOT first/last alone
    name:      ['full name', 'fullname', 'contact name', 'display name'],
    firstName: ['first name', 'firstname', 'first', 'given name', 'givenname'],
    lastName:  ['last name', 'lastname', 'last', 'surname', 'family name'],
    email:     ['email', 'e-mail', 'email address', 'mail'],
    company:   ['company', 'firm', 'organization', 'employer', 'company name'],
    school:    ['school', 'university', 'college', 'institution', 'alma mater'],
    role:      ['role', 'title', 'job title', 'position', 'level', 'function'],
  }
  return (map[field] || []).some(m => c === m || c.includes(m))
}

// Detect whether a columns array has separate first/last name columns
function detectSplitName(cols) {
  const first = cols.find(c => autoMatch(c, 'firstName'))
  const last  = cols.find(c => autoMatch(c, 'lastName'))
  return { first: first || null, last: last || null }
}

// ── Sub-component: SectionCard ─────────────────────────────────────────────────

function SectionCard({ option, title, children, disabled, badge }) {
  return (
    <div className={`card p-0 overflow-hidden transition-opacity duration-200 ${disabled ? 'opacity-55 pointer-events-none' : ''}`}>
      <div className="px-7 pt-6 pb-5">
        <div className="section-label">{option}</div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">{title}</h3>
          {badge}
        </div>
      </div>
      <div className="px-7 pb-7 pt-0">{children}</div>
    </div>
  )
}

// ── Helpers: parse profileData text into structured fields ─────────────────────

function parseProfileData(text) {
  const lines = (text || '').split('\n')
  const get = (prefix) => {
    const line = lines.find(l => l.toLowerCase().startsWith(prefix.toLowerCase()))
    return line ? line.slice(prefix.length).trim() : ''
  }
  const name     = get('Name:')
  const headline = get('Headline:')
  const location = get('Location:')

  // Try to split "VP at Goldman Sachs" → role + firm
  let role = '', firm = ''
  if (headline) {
    const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i)
    if (atMatch) { role = atMatch[1].trim(); firm = atMatch[2].trim() }
    else { role = headline }
  }

  return { name, headline, role, firm, location }
}

const FINANCE_FIRMS_CLIENT = new Set([
  'goldman sachs','morgan stanley','jpmorgan','jp morgan','bank of america',
  'citigroup','citi','barclays','ubs','jefferies','lazard','evercore','moelis',
  'pjt partners','houlihan lokey','blackstone','kkr','carlyle','apollo','tpg',
  'warburg pincus','bain capital','citadel','two sigma','bridgewater','point72',
  'blackrock','fidelity','pimco',
])
const FINANCE_KW_CLIENT = ['capital','partners','investment','management','securities',
  'equity','fund','financial','banking','trading','hedge','advisory']

function clientMatchLevel(role, firm) {
  const r = (role || '').toLowerCase()
  const f = (firm || '').toLowerCase()
  let score = 0
  if (FINANCE_FIRMS_CLIENT.has(f)) score += 4
  else if (FINANCE_KW_CLIENT.some(k => f.includes(k))) score += 2
  if (['managing director','md','partner','head of'].some(s => r.includes(s))) score += 3
  else if (['vice president','vp','director','principal'].some(s => r.includes(s))) score += 2
  else if (['analyst','associate'].some(s => r.includes(s))) score += 1
  if (score >= 5) return 'High'
  if (score >= 2) return 'Medium'
  return 'Low'
}

function matchReasons(role, firm, name) {
  const reasons = []
  const f = (firm || '').toLowerCase()
  const r = (role || '').toLowerCase()
  if (FINANCE_FIRMS_CLIENT.has(f)) reasons.push(`Works at ${firm} — top finance firm`)
  else if (FINANCE_KW_CLIENT.some(k => f.includes(k))) reasons.push(`${firm} is a finance-adjacent firm`)
  if (['managing director','md','partner','head of'].some(s => r.includes(s))) reasons.push(`Senior role (${role}) — high value contact`)
  else if (['vice president','vp','director','principal'].some(s => r.includes(s))) reasons.push(`Mid-senior role (${role}) — good for informational`)
  else if (['analyst','associate'].some(s => r.includes(s))) reasons.push(`Junior role (${role}) — relatable contact, likely to reply`)
  if (!reasons.length) reasons.push('Limited info — profile loaded partially')
  return reasons
}

// ── Section A: LinkedIn ────────────────────────────────────────────────────────

function LinkedInSection({ profile }) {
  const [url, setUrl] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileData, setProfileData] = useState(null)   // raw text from server
  const [parsed, setParsed] = useState(null)             // { name, headline, role, firm, location }
  const [matchLevel, setMatchLevel] = useState('')
  const [reasons, setReasons] = useState([])
  const [error, setError] = useState('')
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [draftStatus, setDraftStatus] = useState('')
  const [copyDone, setCopyDone] = useState(false)

  const hasResult = !!profileData
  const hasEmail  = !!emailBody

  async function loadProfile() {
    if (!url.trim()) return
    setLoadingProfile(true)
    setError('')
    setProfileData(null)
    setParsed(null)
    setMatchLevel('')
    setReasons([])
    setEmailSubject('')
    setEmailBody('')
    setDraftStatus('')
    try {
      // Server returns { profileData, cached, partial } or { error, blocked }
      const data = await apiFetch('/find/scrape', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      if (data.error) {
        setError(data.error)
      } else {
        const text = data.profileData || ''
        const p = parseProfileData(text)
        const ml = clientMatchLevel(p.role, p.firm)
        const r  = matchReasons(p.role, p.firm, p.name)
        setProfileData(text)
        setParsed(p)
        setMatchLevel(ml)
        setReasons(r)
      }
    } catch (err) {
      setError(err.message || 'Could not load this profile. Try opening it in LinkedIn and using the extension instead.')
    }
    setLoadingProfile(false)
  }

  async function generateEmail() {
    if (!profileData) return
    setGeneratingEmail(true)
    setEmailSubject('')
    setEmailBody('')
    try {
      const data = await apiFetch('/find/generate-batch', {
        method: 'POST',
        body: JSON.stringify({
          contacts: [{
            name:        parsed?.name    || 'LinkedIn Contact',
            company:     parsed?.firm    || '',
            school:      '',
            role:        parsed?.role    || '',
            email:       '',
            profileText: profileData,   // raw text — server uses this directly
          }],
          assumedSchool: profile?.school || '',
        }),
      })
      const r = data.results?.[0]
      if (r?.subject) { setEmailSubject(r.subject); setEmailBody(r.body) }
      else setError('Generation failed — try again.')
    } catch (err) {
      setError('Could not generate email. Try again.')
    }
    setGeneratingEmail(false)
  }

  async function saveDraft() {
    setDraftStatus('saving')
    try {
      await apiFetch('/auth/gmail/draft', {
        method: 'POST',
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      })
      setDraftStatus('saved')
      setTimeout(() => setDraftStatus(''), 3000)
    } catch (_) {
      setDraftStatus('error')
      setTimeout(() => setDraftStatus(''), 3000)
    }
  }

  function copyEmail() {
    navigator.clipboard.writeText(emailBody).then(() => {
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    })
  }

  return (
    <SectionCard option="Option A" title="LinkedIn Profile">
      <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
        Paste a LinkedIn profile URL to load the person's background and generate a personalized cold email.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadProfile()}
            className="input-base pl-8"
            placeholder="https://linkedin.com/in/…"
          />
        </div>
        <button onClick={loadProfile} disabled={loadingProfile || !url.trim()} className="btn-primary gap-2 whitespace-nowrap">
          {loadingProfile
            ? <><Spinner size="xs" className="border-white/30 border-t-white" /> Loading…</>
            : 'Load Profile'}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-gray-500 leading-relaxed bg-gray-50 border border-[#E8E6E3] rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Profile card — expands after successful scrape */}
      {hasResult && parsed && (
        <div className="mt-5 border border-[#E8E6E3] rounded-xl overflow-hidden bg-[#fafaf9] transition-all">

          {/* Header row: name + match badge */}
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E8E6E3] bg-white">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-gray-900 truncate">
                {parsed.name || 'LinkedIn Profile'}
              </div>
              {(parsed.role || parsed.firm) && (
                <div className="text-[13px] text-gray-500 mt-0.5 truncate">
                  {[parsed.role, parsed.firm].filter(Boolean).join(' at ')}
                </div>
              )}
              {parsed.location && (
                <div className="text-[12px] text-gray-400 mt-0.5">{parsed.location}</div>
              )}
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <MatchBadge level={matchLevel} />
            </div>
          </div>

          {/* Reasoning bullets */}
          <div className="px-5 py-3 border-b border-[#E8E6E3]">
            <div className="field-label mb-2">Match signals</div>
            <ul className="space-y-1">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-gray-600">
                  <span className="text-[#0D7377] mt-0.5 flex-shrink-0">✓</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Email area */}
          <div className="px-5 py-4">
            {!hasEmail && !generatingEmail && (
              <button onClick={generateEmail} className="btn-primary">
                Generate cold email
              </button>
            )}

            {generatingEmail && (
              <div className="flex items-center gap-2 text-[13px] text-gray-500 py-2">
                <Spinner size="sm" /> Generating email…
              </div>
            )}

            {hasEmail && (
              <div className="space-y-3">
                <div className="text-[12px] text-gray-500">
                  <span className="font-medium text-gray-700">Subject:</span> {emailSubject}
                </div>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  className="w-full min-h-[140px] px-4 py-3 bg-white border border-[#E8E6E3] rounded-lg text-[13px] text-gray-900 leading-relaxed resize-y outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-[#0D7377]/10"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={saveDraft}
                    disabled={draftStatus === 'saving'}
                    className="btn-primary"
                  >
                    {draftStatus === 'saving'
                      ? <><Spinner size="xs" className="border-white/30 border-t-white" /> Saving…</>
                      : draftStatus === 'saved'  ? '✓ Saved to Gmail'
                      : draftStatus === 'error'  ? 'Failed — retry?'
                      : 'Save to Gmail draft'}
                  </button>
                  <button onClick={copyEmail} className="btn-ghost">
                    {copyDone ? '✓ Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => { setEmailSubject(''); setEmailBody(''); generateEmail() }}
                    className="btn-ghost"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ── Section B: CSV Alumni ──────────────────────────────────────────────────────

const CSV_STEPS = { IDLE: 'idle', MAPPING: 'mapping', CONTACTS: 'contacts', GENERATING: 'generating', EMAILS: 'emails' }
const MAP_FIELDS = [
  { key: 'name',    label: 'Name *' },
  { key: 'email',   label: 'Email' },
  { key: 'company', label: 'Company / Firm' },
  { key: 'school',  label: 'School' },
  { key: 'role',    label: 'Role / Title' },
]

function CSVSection({ profile }) {
  const [step, setStep] = useState(CSV_STEPS.IDLE)
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState([])
  const [allRows, setAllRows] = useState([])
  const [mapping, setMapping] = useState({})
  // Split-name support: when CSV has First Name + Last Name columns separately
  const [splitName, setSplitName] = useState({ first: null, last: null })
  const [scored, setScored] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [emails, setEmails] = useState({})
  const [genProgress, setGenProgress] = useState({ n: 0, total: 0, name: '' })
  const [savingAll, setSavingAll] = useState(false)
  const [saveStatuses, setSaveStatuses] = useState({})
  const [skipPreview, setSkipPreview] = useState(localStorage.getItem('cm_skip_preview') === 'true')
  const [savedDBs, setSavedDBs] = useState([])
  const [dbName, setDbName] = useState('')
  const [dbSaved, setDbSaved] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef()

  useEffect(() => { loadSavedDBs() }, [])

  async function loadSavedDBs() {
    try {
      const data = await apiFetch('/find/databases')
      setSavedDBs(data || [])
    } catch (_) {}
  }

  async function handleFile(file) {
    setUploadError('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const data = await apiFetch('/find/parse-upload', { method: 'POST', body: fd })
      const cols = data.columns || []
      setColumns(cols)
      setAllRows(data.allRows || [])
      setFileName(file.name)

      // Detect split first/last name columns
      const split = detectSplitName(cols)
      setSplitName(split)

      const autoMap = {}
      MAP_FIELDS.forEach(f => {
        // Skip 'name' auto-match if we detected split columns — we'll handle it at score time
        if (f.key === 'name' && (split.first || split.last)) return
        const match = cols.find(c => autoMatch(c, f.key))
        if (match) autoMap[f.key] = match
      })
      // If no full-name column but we have split, signal it with a sentinel
      if (!autoMap.name && (split.first || split.last)) {
        autoMap._splitName = true
      }
      setMapping(autoMap)
      setStep(CSV_STEPS.MAPPING)
    } catch (err) {
      setUploadError(err.message || 'Failed to parse file')
    }
  }

  async function scoreContacts() {
    const hasSplit = mapping._splitName || (splitName.first && !mapping.name)
    if (!mapping.name && !hasSplit) {
      alert('Please map the Name column (or ensure First Name / Last Name columns are detected).')
      return
    }

    const contacts = allRows
      .filter(r => {
        if (hasSplit) return r[splitName.first] || r[splitName.last]
        return r[mapping.name]
      })
      .map(r => {
        let name = ''
        if (hasSplit) {
          const first = (r[splitName.first] || '').trim()
          const last  = (r[splitName.last]  || '').trim()
          name = [first, last].filter(Boolean).join(' ')
        } else {
          name = r[mapping.name] || ''
        }
        return {
          name,
          email:   mapping.email   ? (r[mapping.email]   || '') : '',
          company: mapping.company ? (r[mapping.company] || '') : '',
          school:  mapping.school  ? (r[mapping.school]  || '') : '',
          role:    mapping.role    ? (r[mapping.role]    || '') : '',
        }
      })
      .filter(c => c.name)

    try {
      const data = await apiFetch('/find/score-contacts', {
        method: 'POST',
        body: JSON.stringify({ contacts }),
      })
      const sc = data.contacts || []
      setScored(sc)
      const autoSel = new Set()
      sc.forEach((c, i) => { if (c.matchLevel === 'High' && !c.alreadyContacted) autoSel.add(i) })
      setSelected(autoSel)
      setEmails({})
      setStep(CSV_STEPS.CONTACTS)
    } catch (err) {
      alert('Scoring failed: ' + err.message)
    }
  }

  function toggle(i) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(i) ? s.delete(i) : s.add(i)
      return s
    })
  }
  function selectHigh() {
    setSelected(new Set(scored.map((c, i) => c.matchLevel === 'High' ? i : null).filter(i => i !== null)))
  }
  function selectAll()   { setSelected(new Set(scored.map((_, i) => i))) }
  function deselectAll() { setSelected(new Set()) }

  async function generateBatch() {
    const list = [...selected].sort((a, b) => a - b)
    if (skipPreview) { await generateAndSaveDirectly(list); return }

    setStep(CSV_STEPS.GENERATING)
    setGenProgress({ n: 0, total: list.length, name: '' })
    const result = {}

    for (let n = 0; n < list.length; n++) {
      const idx = list[n]
      const contact = scored[idx]
      setGenProgress({ n: n + 1, total: list.length, name: contact.name })
      try {
        const data = await apiFetch('/find/generate-batch', {
          method: 'POST',
          body: JSON.stringify({
            contacts: [contact],
            userProfile: profile,
            assumedSchool: profile?.school || '',
          }),
        })
        const r = data.results?.[0]
        if (r) result[idx] = { subject: r.subject, body: r.body }
      } catch (_) {
        result[idx] = { subject: '', body: '[Generation failed — try again]' }
      }
      setEmails({ ...result })
    }
    setStep(CSV_STEPS.EMAILS)
    setDbName(fileName.replace(/\.(csv|xlsx|xls)$/i, ''))
    setDbSaved(false)
    setSaveStatuses({})
  }

  async function generateAndSaveDirectly(list) {
    setStep(CSV_STEPS.GENERATING)
    setGenProgress({ n: 0, total: list.length, name: '' })
    for (let n = 0; n < list.length; n++) {
      const idx = list[n]
      const contact = scored[idx]
      setGenProgress({ n: n + 1, total: list.length, name: contact.name })
      try {
        const data = await apiFetch('/find/generate-batch', {
          method: 'POST',
          body: JSON.stringify({ contacts: [contact], userProfile: profile, assumedSchool: profile?.school || '' }),
        })
        const r = data.results?.[0]
        if (r) {
          await apiFetch('/auth/gmail/draft', {
            method: 'POST',
            body: JSON.stringify({ subject: r.subject, body: r.body }),
          })
        }
      } catch (_) {}
      if (n < list.length - 1) await new Promise(r => setTimeout(r, 2000))
    }
    setStep(CSV_STEPS.CONTACTS)
    setSelected(new Set())
  }

  async function saveAllDrafts() {
    setSavingAll(true)
    const list = Object.keys(emails).map(Number)
    const statuses = {}
    for (let n = 0; n < list.length; n++) {
      const idx = list[n]
      const e = emails[idx]
      setSaveStatuses(prev => ({ ...prev, [idx]: 'saving' }))
      try {
        await apiFetch('/auth/gmail/draft', {
          method: 'POST',
          body: JSON.stringify({ subject: e.subject, body: e.body }),
        })
        statuses[idx] = 'saved'
      } catch (_) {
        statuses[idx] = 'error'
      }
      setSaveStatuses(prev => ({ ...prev, ...statuses }))
      if (n < list.length - 1) await new Promise(r => setTimeout(r, 2000))
    }
    setSavingAll(false)
  }

  async function saveDatabase() {
    try {
      await apiFetch('/find/save-database', {
        method: 'POST',
        body: JSON.stringify({ filename: dbName || fileName, contacts: scored }),
      })
      setDbSaved(true)
      loadSavedDBs()
    } catch (err) {
      alert('Failed to save: ' + err.message)
    }
  }

  async function loadDatabase(id) {
    const db = savedDBs.find(d => d.id === id)
    if (!db) return
    try {
      const data = await apiFetch(`/find/databases/${id}`)
      const data2 = await apiFetch('/find/score-contacts', {
        method: 'POST',
        body: JSON.stringify({ contacts: data.contacts || [], userSchool: profile?.school || '' }),
      })
      const sc = data2.contacts || []
      setScored(sc)
      setFileName(db.filename)
      setDbName(db.filename)
      const autoSel = new Set()
      sc.forEach((c, i) => { if (c.matchLevel === 'High' && !c.alreadyContacted) autoSel.add(i) })
      setSelected(autoSel)
      setEmails({})
      setStep(CSV_STEPS.CONTACTS)
    } catch (err) { alert('Load failed: ' + err.message) }
  }

  async function deleteDatabase(id) {
    if (!confirm('Delete this database?')) return
    try {
      await apiFetch(`/find/databases/${id}`, { method: 'DELETE' })
      setSavedDBs(prev => prev.filter(d => d.id !== id))
    } catch (_) {}
  }

  function reset() {
    setStep(CSV_STEPS.IDLE)
    setColumns([]); setAllRows([]); setMapping({}); setScored([])
    setSelected(new Set()); setEmails({}); setUploadError('')
  }

  const highCount   = scored.filter(c => c.matchLevel === 'High').length
  const mediumCount = scored.filter(c => c.matchLevel === 'Medium').length
  const lowCount    = scored.filter(c => c.matchLevel === 'Low').length
  const genDone = Object.keys(emails).length === [...selected].length && [...selected].length > 0

  return (
    <SectionCard option="Option B" title="Alumni Database">
      <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
        Upload a CSV or Excel file of alumni contacts. ColdMatch scores each contact by finance fit, then generates personalized emails in bulk.
      </p>

      {/* Upload zone */}
      {step === CSV_STEPS.IDLE && (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
            className={`border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-all duration-150 ${
              dragOver ? 'border-[#0D7377] bg-[#0D7377]/5' : 'border-[#D4D2CF] hover:border-[#0D7377] hover:bg-[#0D7377]/5'
            }`}
          >
            <svg className="mx-auto mb-3 text-gray-300" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>
            </svg>
            <p className="text-[13px] text-gray-600">
              Drag and drop your file, or{' '}
              <span className="text-[#0D7377] font-semibold">browse</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-1">CSV or Excel (.xlsx, .xls) up to 20 MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = '' }}
          />
          {uploadError && <p className="mt-2 text-[12px] text-red-500">{uploadError}</p>}

          {savedDBs.length > 0 && (
            <div className="mt-5">
              <div className="field-label">Saved databases</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {savedDBs.map(db => (
                  <span
                    key={db.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#0D7377]/8 border border-[#0D7377]/20 rounded-full text-xs font-medium text-[#0D7377] cursor-pointer hover:bg-[#0D7377]/14 transition-colors"
                    onClick={() => loadDatabase(db.id)}
                  >
                    {db.filename}
                    <span className="text-gray-400">({db.contact_count})</span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteDatabase(db.id) }}
                      className="text-gray-400 hover:text-red-500 leading-none bg-transparent border-0 cursor-pointer ml-0.5"
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Column mapping */}
      {step === CSV_STEPS.MAPPING && (
        <div>
          <p className="text-[13px] text-gray-600 mb-4">
            <span className="font-medium">{fileName}</span> — {allRows.length} rows detected. Map the columns below.
          </p>

          {/* Split name detection notice */}
          {(splitName.first || splitName.last) && (
            <div className="mb-4 px-3 py-2.5 bg-[#d4eced]/50 border border-[#0D7377]/20 rounded-lg text-[12px] text-[#0A5F63]">
              <span className="font-semibold">Split name detected</span> — will combine{' '}
              <span className="font-mono bg-white/60 px-1 rounded">{splitName.first}</span>
              {splitName.last && <> + <span className="font-mono bg-white/60 px-1 rounded">{splitName.last}</span></>}
              {' '}into a single full name automatically.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {/* Name field — show read-only when split detected, editable otherwise */}
            <div>
              <label className="field-label">
                {(splitName.first || splitName.last) ? 'Name (auto)' : 'Name *'}
              </label>
              {(splitName.first || splitName.last) ? (
                <div className="w-full px-2.5 py-2 border border-[#D4D2CF] rounded-md text-[12px] text-gray-400 bg-gray-50 cursor-not-allowed">
                  {[splitName.first, splitName.last].filter(Boolean).join(' + ')}
                </div>
              ) : (
                <select
                  value={mapping.name || ''}
                  onChange={e => setMapping(prev => ({ ...prev, name: e.target.value || undefined }))}
                  className="w-full px-2.5 py-2 border border-[#D4D2CF] rounded-md text-[12px] text-gray-900 bg-white outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-[#0D7377]/10"
                >
                  <option value="">— skip —</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>

            {/* Other fields */}
            {MAP_FIELDS.filter(f => f.key !== 'name').map(f => (
              <div key={f.key}>
                <label className="field-label">{f.label}</label>
                <select
                  value={mapping[f.key] || ''}
                  onChange={e => setMapping(prev => ({ ...prev, [f.key]: e.target.value || undefined }))}
                  className="w-full px-2.5 py-2 border border-[#D4D2CF] rounded-md text-[12px] text-gray-900 bg-white outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-[#0D7377]/10"
                >
                  <option value="">— skip —</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={scoreContacts} className="btn-primary">Score contacts</button>
            <button onClick={reset} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* Generating progress */}
      {step === CSV_STEPS.GENERATING && (
        <div className="py-4">
          <div className="flex items-center gap-3 text-[13px] text-gray-600 mb-4">
            <Spinner size="sm" />
            <span>
              {genProgress.n > 0
                ? `Generating email ${genProgress.n} of ${genProgress.total} — ${genProgress.name}`
                : 'Starting…'}
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0D7377] rounded-full transition-all duration-500"
              style={{ width: genProgress.total > 0 ? `${(genProgress.n / genProgress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Contacts list */}
      {step === CSV_STEPS.CONTACTS && (
        <div>
          <div className="flex items-center justify-between mb-3 gap-3">
            <p className="text-[12px] text-gray-500">
              {scored.length} contacts — {highCount} High, {mediumCount} Medium, {lowCount} Low
              <span className="ml-2 font-medium text-gray-700">{selected.size} selected</span>
            </p>
            <div className="flex gap-1.5 flex-shrink-0">
              <button onClick={selectHigh} className="btn-sm">Select High</button>
              <button onClick={selectAll} className="btn-sm">All</button>
              <button onClick={deselectAll} className="btn-sm">None</button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 max-h-[380px] overflow-y-auto scrollbar-thin mb-4 pr-0.5">
            {scored.map((c, i) => {
              const isSelected = selected.has(i)
              const meta = [c.role, c.company, c.email].filter(Boolean).join(' · ')
              return (
                <div
                  key={i}
                  onClick={() => toggle(i)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-all duration-100 ${
                    isSelected
                      ? 'border-[#0D7377] bg-[#0D7377]/5'
                      : 'border-[#E8E6E3] bg-[#fafaf9] hover:border-[#C0BEBA]'
                  } ${c.alreadyContacted ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(i)}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 accent-[#0D7377] flex-shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{c.name}</div>
                    {meta && <div className="text-[11px] text-gray-500 truncate mt-0.5">{meta}</div>}
                    {c.matchReason && <div className="text-[10px] text-gray-400 truncate mt-0.5 italic">{c.matchReason}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <MatchBadge level={c.matchLevel} />
                    {c.alreadyContacted && (
                      <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">Contacted</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={generateBatch}
              disabled={selected.size === 0}
              className="btn-primary"
            >
              {skipPreview ? `Generate & save ${selected.size} drafts` : `Generate ${selected.size} email${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button onClick={reset} className="btn-ghost">Start over</button>
            <label className="ml-auto flex items-center gap-2 text-[12px] text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={skipPreview}
                onChange={e => {
                  setSkipPreview(e.target.checked)
                  localStorage.setItem('cm_skip_preview', e.target.checked)
                }}
                className="accent-[#0D7377]"
              />
              Skip preview
            </label>
          </div>
        </div>
      )}

      {/* Email preview cards */}
      {step === CSV_STEPS.EMAILS && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-gray-600">
              {Object.keys(emails).length} email{Object.keys(emails).length !== 1 ? 's' : ''} generated. Edit before saving.
            </p>
            <button onClick={() => setStep(CSV_STEPS.CONTACTS)} className="btn-sm">← Back</button>
          </div>

          <div className="flex flex-col gap-3 mb-5">
            {Object.entries(emails).map(([idxStr, email]) => {
              const idx = Number(idxStr)
              const contact = scored[idx]
              const status = saveStatuses[idx]
              return (
                <div key={idx} className="bg-[#fafaf9] border border-[#E8E6E3] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E6E3]">
                    <div>
                      <span className="text-[13px] font-semibold text-gray-900">{contact.name}</span>
                      {contact.company && <span className="text-[12px] text-gray-500 ml-2">at {contact.company}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <MatchBadge level={contact.matchLevel} />
                      {status === 'saved' && <span className="text-[11px] text-green-600 font-medium">✓ Saved</span>}
                      {status === 'error' && <span className="text-[11px] text-red-500">Failed</span>}
                      {status === 'saving' && <Spinner size="xs" />}
                    </div>
                  </div>
                  <div className="px-4 py-2 border-b border-[#E8E6E3] text-[11px] text-gray-500">
                    Subject: <span className="text-gray-700">{email.subject}</span>
                  </div>
                  <textarea
                    value={email.body}
                    onChange={e => setEmails(prev => ({
                      ...prev,
                      [idx]: { ...prev[idx], body: e.target.value }
                    }))}
                    className="w-full min-h-[100px] px-4 py-3 bg-transparent text-[12px] text-gray-900 leading-relaxed resize-y outline-none border-0"
                  />
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={saveAllDrafts} disabled={savingAll} className="btn-primary">
              {savingAll ? <><Spinner size="xs" className="border-white/30 border-t-white" /> Saving drafts…</> : 'Save all to Gmail drafts'}
            </button>
          </div>

          {/* Save DB section */}
          <div className="mt-6 pt-5 border-t border-[#E8E6E3]">
            <p className="text-[12px] font-medium text-gray-700 mb-2">Save this database for later</p>
            {dbSaved ? (
              <p className="text-[12px] text-green-600 font-medium">✓ Database saved</p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={dbName}
                  onChange={e => setDbName(e.target.value)}
                  placeholder="Database name…"
                  className="input-base flex-1"
                />
                <button onClick={saveDatabase} className="btn-ghost whitespace-nowrap">Save database</button>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ── Section C: Apollo ──────────────────────────────────────────────────────────

function ApolloSection() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!email.trim()) return
    setLoading(true)
    try {
      await apiFetch('/find/apollo-waitlist', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setSubmitted(true)
    } catch (_) {}
    setLoading(false)
  }

  return (
    <SectionCard
      option="Option C"
      title="Search for People"
      disabled
      badge={
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-gray-100 text-gray-400">
          Coming Soon
        </span>
      }
    >
      <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
        Search for contacts by firm, school, or role using Apollo. Automatically build targeted lists without uploading a CSV.
      </p>
      <div className="pointer-events-auto opacity-100">
        <p className="text-[12px] text-gray-500 mb-2">Get notified when this launches:</p>
        {submitted ? (
          <p className="text-[13px] text-green-600 font-medium">You're on the list!</p>
        ) : (
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="input-base flex-1"
              placeholder="you@email.com"
            />
            <button onClick={submit} disabled={loading || !email.trim()} className="btn-primary whitespace-nowrap">
              {loading ? <Spinner size="xs" className="border-white/30 border-t-white" /> : 'Notify me'}
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── Main Find page ─────────────────────────────────────────────────────────────

export default function Find({ profile }) {
  const gmailConnected = localStorage.getItem('gmail_connected') === 'true'

  return (
    <div className="space-y-4">
      <div className="mb-7">
        <h2 className="text-2xl font-light tracking-tight text-gray-900">Find People</h2>
        <p className="text-[14px] text-gray-500 mt-1">Score alumni contacts, generate personalized outreach, and save Gmail drafts in bulk.</p>
      </div>

      {!gmailConnected && (
        <div className="flex items-center justify-between gap-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 mb-2">
          <p className="text-[13px] text-green-700">Connect Gmail to save email drafts directly from ColdMatch.</p>
          <button
            onClick={async () => {
              try {
                const data = await apiFetch('/auth/gmail/auth')
                if (data.authUrl) window.location.href = data.authUrl
              } catch (_) {}
            }}
            className="btn-sm flex-shrink-0 text-green-700 border-green-300 hover:bg-green-50"
          >
            Connect Gmail
          </button>
        </div>
      )}

      <LinkedInSection profile={profile} />
      <CSVSection profile={profile} />
      <ApolloSection />
    </div>
  )
}

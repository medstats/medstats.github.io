import * as pdfjsLib from './vendor/pdf.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const generateBtn = $('generate');
const statusBox = $('status');

// If this line runs, the JavaScript module and PDF.js loaded successfully.
statusBox.className = 'ok';
statusBox.textContent = 'PDF engine loaded. Choose any discharge-summary PDF.';
if (fileInput.files?.length) generateBtn.disabled = false;

fileInput.addEventListener('change', () => {
  generateBtn.disabled = !fileInput.files?.length;
  statusBox.className = '';
  statusBox.textContent = fileInput.files?.length
    ? `Ready: ${fileInput.files[0].name}`
    : 'Choose any discharge-summary PDF.';
});

generateBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  generateBtn.disabled = true;
  setStatus('Reading PDF…');
  try {
    const parsed = await extractFullSummary(file);
    setStatus(`Parsed summary for ${parsed.metadata.patientName || parsed.metadata.admissionNo || 'Patient'}. Generating Word file…`);
    
    const rtf = buildRtf({
      metadata: parsed.metadata,
      report: parsed.report,
      otherInvestigations: parsed.otherInvestigations,
    });
    
    const stem = file.name.replace(/\.pdf$/i, '');
    const filename = parsed.metadata.admissionNo
      ? `${parsed.metadata.admissionNo}_compact_investigations.rtf`
      : `${stem}_compact_investigations.rtf`;
      
    downloadBlob(new Blob([rtf], { type: 'application/rtf' }), filename);
    
    const labSummary = parsed.rows.length
      ? `${parsed.rows.length} lab rows parsed across ${parsed.report.serialDates.length} dates`
      : 'No serial lab tables';
    const otherSummary = parsed.otherInvestigations.length
      ? `${parsed.otherInvestigations.length} imaging / other reports`
      : 'No imaging reports';

    setStatus(
      `Done.\n` +
      `Patient: ${parsed.metadata.patientName || 'N/A'} | Age/Sex: ${parsed.metadata.ageGender || 'N/A'} | IP: ${parsed.metadata.admissionNo || 'N/A'}\n` +
      `${labSummary} | ${otherSummary}\n` +
      `Word-compatible RTF downloaded: ${filename}`,
      true
    );
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err?.message || err}`, false, true);
  } finally {
    generateBtn.disabled = false;
  }
});

function setStatus(text, ok = false, error = false) {
  statusBox.textContent = text;
  statusBox.className = ok ? 'ok' : error ? 'err' : '';
}

function clean(s) {
  return String(s ?? '')
    .replace(/[\u00ad\u2010-\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fold(s) { return ` ${clean(s).toLowerCase()} `; }

function parseDateComponents(s) {
  const m = clean(s).match(/^(\d{1,2})[\s\-\/]*([A-Za-z]{3}|\d{1,2})[\s\-\/]*(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  let monthIdx = 0, monthStr = 'Jan';
  if (/^\d+$/.test(m[2])) {
    monthIdx = Math.max(0, Math.min(11, Number(m[2]) - 1));
    monthStr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIdx];
  } else {
    monthIdx = months[m[2].toLowerCase()] ?? 0;
    monthStr = titleCase(m[2]);
  }
  return { day, monthStr, monthIdx, year };
}

function isDate(s) { return !!parseDateComponents(s); }

function dateKey(s) {
  const d = parseDateComponents(s);
  if (!d) return Number.MAX_SAFE_INTEGER;
  return new Date(d.year, d.monthIdx, d.day).getTime();
}

function shortDate(s) {
  const d = parseDateComponents(s);
  if (!d) return clean(s);
  return `${String(d.day).padStart(2, '0')}-${titleCase(d.monthStr)}`;
}

function isTemplateNoise(s) {
  return /santosh\s+hospitals?|ambedkar\s+rd|www\.|fax\s*:|created\s+by|print\s+by|page\s+\d+\s+of\s+\d+|registrar\s+consultant|in\s+case\s+of\s+emergency/i.test(s);
}

function titleCase(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }

function groupTextItems(items, pageNo = 1) {
  const usable = items
    .filter(it => clean(it.str) && !isTemplateNoise(it.str))
    .map(it => ({ str: clean(it.str), x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
    .filter(it => pageNo === 1 || (it.y > 40 && it.y < 850))
    .sort((a,b) => (b.y - a.y) || (a.x - b.x));

  const rows = [];
  const tolerance = 2.6;
  for (const item of usable) {
    let row = rows.find(r => Math.abs(r.y - item.y) <= tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  rows.sort((a,b) => b.y - a.y);
  for (const row of rows) {
    row.items.sort((a,b) => a.x - b.x);
    row.text = row.items.map(i => i.str).join(' ');
  }
  return rows;
}

function detectColumns(items) {
  const upper = items.map(i => ({...i, u: i.str.toUpperCase()}));
  const p = upper.find(i => i.u.includes('PARAMETER') || i.u === 'TEST');
  const r = upper.find(i => i.u === 'RESULT' || i.u.includes('RESULT') || i.u.includes('OBSERVED'));
  const u = upper.find(i => i.u === 'UNITS' || i.u.includes('UNITS') || i.u.includes('UNIT'));
  const n = upper.find(i => i.u.includes('NORMAL') || i.u.includes('REF') || i.u.includes('REFERENCE'));
  if (!p || !r || !u || !n || !(p.x < r.x && r.x < u.x && u.x < n.x)) return null;
  return { parameter: p.x, result: r.x, units: u.x, reference: n.x };
}

function rowToCells(items, cols) {
  const out = { parameter: [], result: [], units: [], reference_range: [] };
  const b1 = (cols.parameter + cols.result) / 2;
  const b2 = (cols.result + cols.units) / 2;
  const b3 = (cols.units + cols.reference) / 2;
  for (const it of items) {
    if (it.x < cols.parameter - 10) continue;
    if (it.x < b1) out.parameter.push(it.str);
    else if (it.x < b2) out.result.push(it.str);
    else if (it.x < b3) out.units.push(it.str);
    else out.reference_range.push(it.str);
  }
  return Object.fromEntries(Object.entries(out).map(([k,v]) => [k, clean(v.join(' '))]));
}

function appendUnique(a, b) {
  a = clean(a); b = clean(b);
  if (!a) return b;
  if (!b || a.toLowerCase().includes(b.toLowerCase())) return a;
  return `${a} ${b}`;
}

function dedupeNarrative(lines) {
  const seen = new Set();
  return lines.filter(x => { const k = clean(x).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = [r.date, r.test_group, r.parameter, r.result, r.units].map(x => clean(x).toLowerCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

// ---------------------- Classification ----------------------
const aliases = {
  hba1c:['glycosylated hemoglobin','glycated hemoglobin','hba1c'],
  hb:['haemoglobin','hemoglobin'], mcv:['mcv','mean corpuscular volume'],
  tlc:['wbc total count','total leucocyte count','total leukocyte count','tlc'],
  neut:['neutrophils','neutrophil'], lymph:['lymphocytes','lymphocyte'], mono:['monocytes','monocyte'], eos:['eosinophils','eosinophil'],
  platelet:['platelet count','platelets','platelet'],
  urea:['blood urea','serum urea','urea'], creatinine:['creatinine'], sodium:['sodium'], potassium:['potassium'], uric_acid:['uric acid'], phosphorus:['phosphorus','phosphate'],
  bilirubin_total:['bilirubin (total)','bilirubin total','total bilirubin'], bilirubin_direct:['bilirubin (direct)','bilirubin direct','direct bilirubin'],
  ast:['sgot','ast'], alt:['sgpt','alt'], alp:['alkaline phosphatase','alp'], albumin:['albumin'], globulin:['globulin'],
  urine_wbc:['pus cells','urine wbc','white blood cells'], urine_rbc:['red blood cells','urine rbc'], nitrite:['nitrite'], ketone:['urine ketones','ketones','ketone'], urine_glucose:['urine glucose','glucose (sugar)','urine sugar'],
  crp:['crp quantitative','c-reactive protein','crp'], procalcitonin:['procalcitonin'], ntprobnp:['nt-probnp','nt probnp','pro-bnp','probnp'],
  cholesterol:['cholesterol'], triglycerides:['triglycerides','triglyceride'], hdl:['hdl cholesterol','hdl'], ldl:['ldl cholesterol','ldl'],
  t3:['triiodothyronine','t3'], t4:['thyroxine','t4'], tsh:['tsh','thyroid stimulating hormone']
};
const serialParams = {
  'CBC':['hb','mcv','tlc','neut','lymph','mono','eos','platelet'],
  'KFT':['urea','creatinine','sodium','potassium','uric_acid','phosphorus'],
  'LFT':['bilirubin_total','bilirubin_direct','ast','alt','alp','albumin','globulin'],
  'Urine R/M':['urine_wbc','urine_rbc','nitrite','ketone','urine_glucose'],
  'CRP':['crp'], 'Procalcitonin':['procalcitonin'], 'NT-proBNP':['ntprobnp']
};
const panelOrder = ['CBC','KFT','LFT','Urine R/M','CRP','Procalcitonin','NT-proBNP'];
const microWords = ['culture','sputum','afb','gram stain','widal','typhidot','typhi','malaria','dengue','leptospira','scrub','weil felix','hiv','hbsag','hepatitis','hcv','cbnaat','genexpert','gene xpert','microbiology','fungal','koh'];
const metabolicWords = ['hba1c','glycosylated','glycated','lipid profile','thyroid profile'];

function canonicalParam(p) {
  const s = fold(p);
  if (s.includes(' absolute ') && ['neutrophil','lymphocyte','monocyte','eosinophil','basophil'].some(x => s.includes(x))) return null;
  for (const [key, vals] of Object.entries(aliases)) {
    for (const a of vals) {
      const needle = a.toLowerCase();
      if (s.includes(needle)) {
        if (key === 'ldl' && s.includes('hdl')) continue;
        if (key === 'hdl' && s.includes('ldl')) continue;
        return key;
      }
    }
  }
  return null;
}
function panelFromRow(r) {
  const g = fold(r.test_group), cp = canonicalParam(r.parameter);
  if ((g.includes('cbc') || g.includes('complete blood count')) && serialParams['CBC'].includes(cp)) return 'CBC';
  if ((g.includes('kft') || g.includes('kidney function') || g.includes('electrolyte')) && serialParams['KFT'].includes(cp)) return 'KFT';
  if ((g.includes('lft') || g.includes('liver function')) && serialParams['LFT'].includes(cp)) return 'LFT';
  if ((g.includes('urine routine') || g.includes('urine r/m') || g.includes('urine rm')) && serialParams['Urine R/M'].includes(cp)) return 'Urine R/M';
  if (cp === 'crp') return 'CRP'; if (cp === 'procalcitonin') return 'Procalcitonin'; if (cp === 'ntprobnp') return 'NT-proBNP';
  for (const [panel, params] of Object.entries(serialParams)) if (params.includes(cp)) return panel;
  return null;
}
function isMetabolic(r) {
  const g = fold(r.test_group), cp = canonicalParam(r.parameter);
  return metabolicWords.some(x => g.includes(x)) || ['hba1c','cholesterol','triglycerides','hdl','ldl','t3','t4','tsh'].includes(cp);
}
function isMicro(r) { const s = `${fold(r.test_group)} ${fold(r.parameter)}`; return microWords.some(x => s.includes(x)); }
function isCommonGroup(g) { const s = fold(g); return ['cbc','complete blood count','kft','kidney function','electrolyte','lft','liver function','urine routine','urine r/m','c-reactive protein','crp','procalcitonin','nt-probnp','probnp'].some(x => s.includes(x)); }
function firstVal(rows, cp) { const r = rows.find(x => canonicalParam(x.parameter) === cp); return formatNumber(r?.result || ''); }
function formatNumber(v) { v = clean(v); if (/^[+-]?\d+(\.\d+)?$/.test(v)) return String(Number(v)); return v; }

function serialCell(panel, rows) {
  const v = Object.fromEntries(serialParams[panel].map(p => [p, firstVal(rows,p)]));
  if (panel === 'CBC') {
    const dlc = [['N','neut'],['L','lymph'],['M','mono'],['E','eos']].filter(([,k])=>v[k]).map(([c,k])=>c+v[k]).join('');
    return [v.hb&&`Hb ${v.hb}`, v.mcv&&`MCV ${v.mcv}`, v.tlc&&`TLC ${v.tlc}`, dlc, v.platelet&&`Plt ${v.platelet}`].filter(Boolean).join('; ');
  }
  if (panel === 'KFT') return [['Urea','urea'],['Cr','creatinine'],['Na','sodium'],['K','potassium'],['UA','uric_acid'],['P','phosphorus']].filter(([,k])=>v[k]).map(([l,k])=>`${l} ${v[k]}`).join('; ');
  if (panel === 'LFT') {
    const bil = v.bilirubin_total && v.bilirubin_direct ? `Bil ${v.bilirubin_total}/${v.bilirubin_direct}` : v.bilirubin_total ? `Bil ${v.bilirubin_total}` : v.bilirubin_direct ? `D.Bil ${v.bilirubin_direct}` : '';
    return [bil, ...[['AST','ast'],['ALT','alt'],['ALP','alp'],['Alb','albumin'],['Glob','globulin']].filter(([,k])=>v[k]).map(([l,k])=>`${l} ${v[k]}`)].filter(Boolean).join('; ');
  }
  if (panel === 'Urine R/M') return [['WBC','urine_wbc'],['RBC','urine_rbc'],['Nit','nitrite'],['Ket','ketone'],['Glu','urine_glucose']].filter(([,k])=>v[k]).map(([l,k])=>`${l} ${v[k]}`).join('; ');
  return v[serialParams[panel][0]] || '';
}

function buildCompactReport(rows) {
  const serialDates = [...new Set(rows.filter(panelFromRow).map(r=>r.date))].sort((a,b)=>dateKey(a)-dateKey(b));
  const serial = {};
  for (const panel of panelOrder) {
    serial[panel] = {};
    for (const date of serialDates) {
      const subset = rows.filter(r => r.date === date && panelFromRow(r) === panel);
      serial[panel][date] = serialCell(panel, subset);
    }
  }

  const metabolicRows = rows.filter(isMetabolic);
  const microRows = rows.filter(isMicro);
  const otherRows = rows.filter(r => !isCommonGroup(r.test_group) && !panelFromRow(r) && !isMetabolic(r) && !isMicro(r));

  return {
    serialDates, serial,
    metabolic: metabolicSummary(metabolicRows),
    microbiology: narrativeByGroup(microRows),
    otherLab: narrativeByGroup(otherRows),
  };
}

function metabolicSummary(rows) {
  const out = [];
  const dates = [...new Set(rows.map(r=>r.date))].sort((a,b)=>dateKey(a)-dateKey(b));
  for (const d of dates) {
    const dr = rows.filter(r=>r.date===d);
    const hba = firstVal(dr,'hba1c'); if (hba) out.push(`HbA1c (${shortDate(d)}): ${hba}%`);
    const lip = [['Chol','cholesterol'],['TG','triglycerides'],['HDL','hdl'],['LDL','ldl']].map(([l,k])=>[l,firstVal(dr,k)]).filter(([,v])=>v);
    if (lip.length) out.push(`Lipid profile (${shortDate(d)}): ${lip.map(([l,v])=>`${l} ${v}`).join('; ')}`);
    const th = [['T3','t3'],['T4','t4'],['TSH','tsh']].map(([l,k])=>[l,firstVal(dr,k)]).filter(([,v])=>v);
    if (th.length) out.push(`Thyroid profile (${shortDate(d)}): ${th.map(([l,v])=>`${l} ${v}`).join('; ')}`);
  }
  return [...new Set(out)];
}

function narrativeByGroup(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.test_group}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .sort((a,b)=>dateKey(a[0].split('|')[0])-dateKey(b[0].split('|')[0]))
    .map(([key,rs]) => {
      const [date, group] = key.split('|');
      const items = [];
      const seen = new Set();
      for (const r of rs) {
        const p=clean(r.parameter), v=clean(r.result); if (!p || !v || /^(comment|general examination|chemical examination|microscopic examination)$/i.test(p)) continue;
        const k=(p+'|'+v).toLowerCase(); if (seen.has(k)) continue; seen.add(k); items.push(`${p}: ${v}`); if (items.length>=8) break;
      }
      return items.length ? `${shortDate(date)} - ${clean(group)}: ${items.join('; ')}` : '';
    }).filter(Boolean);
}

// ---------------------- RTF output ----------------------
function rtfEscape(s) {
  s = String(s ?? '');
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

function rtfParagraph(text, opts={}) {
  const { bold=false, size=20, before=0, after=40 } = opts;
  return `\\pard\\sb${before}\\sa${after}\\fs${size}${bold?'\\b':''} ${rtfEscape(text)}${bold?'\\b0':''}\\par\n`;
}

function rtfTable(headers, bodyRows) {
  const usable = 10850, first = 1400, rest = Math.floor((usable-first)/(headers.length-1));
  const cellEnds = [first]; for (let i=1;i<headers.length;i++) cellEnds.push(first + rest*i);
  const borders = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
  const makeRow = (cells, header=false) => {
    let s = `\\trowd\\trgaph40\\trleft0\\trkeep`;
    for (const x of cellEnds) s += borders + (header ? '\\clcbpat1' : '') + `\\cellx${x}`;
    s += '\n';
    cells.forEach((c,i) => {
      const size = header ? 16 : (i===0 ? 15 : 14);
      s += `\\intbl\\pard\\qc\\fs${size}${header||i===0?'\\b':''} ${rtfEscape(c||'')}${header||i===0?'\\b0':''}\\cell\n`;
    });
    return s + '\\row\n';
  };
  let out = makeRow(headers,true);
  for (const r of bodyRows) out += makeRow(r,false);
  return out + '\\pard\\sa40\\par\n';
}

function chunk(arr,n) { const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

function buildRtf({ metadata, report, otherInvestigations }) {
  let r = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red240\\green243\\blue246;}\\paperw11907\\paperh16840\\margl500\\margr500\\margt420\\margb420\\f0\n`;
  
  // Header: Just Patient Name, Age, Sex, IP Number
  const parts = [];
  if (metadata.patientName) parts.push(`Patient: ${metadata.patientName}`);
  if (metadata.ageGender) parts.push(`Age/Sex: ${metadata.ageGender}`);
  if (metadata.admissionNo) parts.push(`IP No: ${metadata.admissionNo}`);
  
  const headerLine = parts.length ? parts.join('   |   ') : 'Patient Details';
  r += rtfParagraph(headerLine, { bold:true, size:22, after:60 });

  const hasAny = report.serialDates.length > 0 ||
    report.metabolic.length > 0 ||
    report.microbiology.length > 0 ||
    report.otherLab.length > 0 ||
    (otherInvestigations && otherInvestigations.length > 0);

  if (!hasAny) {
    r += rtfParagraph('No investigations found.', { size:18, before:40, after:40 });
    return r + '}';
  }

  // Serial Tables
  if (report.serialDates.length > 0) {
    r += rtfParagraph('Serial Investigations', { bold:true, size:19, before:15, after:25 });
    const dateChunks = chunk(report.serialDates, 5);
    dateChunks.forEach((dates, idx) => {
      if (idx) r += rtfParagraph('Serial investigations - continued', { bold:true, size:16, after:20 });
      const body = panelOrder.map(panel => [panel, ...dates.map(d => report.serial[panel][d] || '')]).filter(row => row.slice(1).some(Boolean));
      r += rtfTable(['Investigation', ...dates.map(shortDate)], body);
    });
  }

  const section = (name, lines) => {
    if (!lines || !lines.length) return;
    r += rtfParagraph(name, { bold:true, size:18, before:25, after:15 });
    for (const line of lines) r += rtfParagraph(line, { size:15, after:14 });
  };

  section('Metabolic / Endocrine Investigations', report.metabolic);
  section('Microbiology / Infectious Workup', report.microbiology);
  section('Other Laboratory Investigations', report.otherLab);

  if (otherInvestigations && otherInvestigations.length) {
    section('Radiology / Imaging & Other Investigations', otherInvestigations);
  }

  return r + '}';
}

async function extractFullSummary(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const rows = [];
  let inInvestigations = false;
  let inOther = false;
  let columns = null;
  let currentDate = '';
  let currentGroup = '';
  let pendingParameter = '';
  let lastRow = null;
  
  const metadata = {
    admissionNo: '',
    patientName: '',
    ageGender: ''
  };
  const otherLines = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const pageRows = groupTextItems(tc.items, pageNo);

    if (pageNo === 1) {
      const pageText = pageRows.map(r => r.text).join('\n');
      const mAdm = pageText.match(/Admission\s+No\s*:\s*([A-Z0-9-]+)/i);
      if (mAdm) metadata.admissionNo = mAdm[1].toUpperCase();
      const mName = pageText.match(/Name\s*:\s*([^\n:]+?)(?:\s+Admission\s+Dt|\s+Age|\s+Gender|\n|$)/i);
      if (mName) metadata.patientName = clean(mName[1]);
      const mAge = pageText.match(/Age\/Gender\s*:\s*([^\n:]+?)(?:\s+Discharge|\s+UMR|\n|$)/i);
      if (mAge) metadata.ageGender = clean(mAge[1]);
    }

    for (const row of pageRows) {
      const text = clean(row.text);
      if (!text) continue;

      if (/^OTHER\s+INVESTIGATION[S]?\s*:/i.test(text)) {
        inOther = true;
        inInvestigations = false;
        const inline = clean(text.replace(/^OTHER\s+INVESTIGATION[S]?\s*:/i, ''));
        if (inline) otherLines.push(inline);
        continue;
      }
      if (/^INVESTIGATION[S]?\s*:/i.test(text)) {
        inInvestigations = true;
        inOther = false;
        continue;
      }
      if (inOther && /^(ADVICE\s+ON\s+DISCHARGE|FOLLOW\s*UP|REPORT\s+IN\s+CASE\s+OF|COURSE\s+IN\s+HOSPITAL|TREATMENT\s+GIVEN)\s*:/i.test(text)) {
        inOther = false;
      }
      if (inOther) {
        if (!isTemplateNoise(text)) otherLines.push(text);
        continue;
      }
      if (!inInvestigations) continue;

      const detected = detectColumns(row.items);
      if (detected) {
        columns = detected;
        continue;
      }
      if (!columns) continue;

      const dateMatch = text.match(/^(\d{1,2})[\s\-\/]*([A-Za-z]{3}|\d{1,2})[\s\-\/]*(\d{2,4})\b\s*(.*)$/i);
      if (dateMatch) {
        const d = parseDateComponents(dateMatch[0].split(' ')[0]);
        if (d) {
          currentDate = `${String(d.day).padStart(2,'0')}-${titleCase(d.monthStr)}-${d.year}`;
        } else {
          currentDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        }
        currentGroup = clean(dateMatch[4]);
        pendingParameter = '';
        lastRow = null;
        continue;
      }
      if (!currentDate || !currentGroup) continue;

      const cells = rowToCells(row.items, columns);
      let parameter = cells.parameter;
      let result = cells.result;
      let units = cells.units;
      let reference = cells.reference_range;
      if (!parameter && !result && !units && !reference) continue;

      if (!parameter) {
        if (lastRow) {
          if (result) lastRow.result = appendUnique(lastRow.result, result);
          if (units) lastRow.units = appendUnique(lastRow.units, units);
          if (reference) lastRow.reference_range = appendUnique(lastRow.reference_range, reference);
        } else if (pendingParameter && (result || units || reference)) {
          parameter = pendingParameter;
        } else {
          continue;
        }
      }

      if (parameter && !result && !units && !reference) {
        pendingParameter = parameter;
        continue;
      }
      if (!parameter) continue;

      const obj = {
        date: currentDate,
        test_group: currentGroup,
        parameter: clean(parameter || pendingParameter),
        result: clean(result),
        units: clean(units),
        reference_range: clean(reference),
        page: pageNo,
      };
      rows.push(obj);
      lastRow = obj;
      pendingParameter = '';
    }
  }

  const report = buildCompactReport(dedupeRows(rows));
  const dedupedOther = dedupeNarrative(otherLines);

  return {
    metadata,
    rows: dedupeRows(rows),
    report,
    otherInvestigations: dedupedOther,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

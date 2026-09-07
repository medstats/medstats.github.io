import * as pdfjsLib from './vendor/pdf.min.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const generateBtn = $('generate');
const statusBox = $('status');

// If this line runs, the JavaScript module and PDF.js loaded successfully.
statusBox.className = 'ok';
statusBox.textContent = 'PDF engine loaded. Choose a text-based discharge-summary PDF.';
if (fileInput.files?.length) generateBtn.disabled = false;

fileInput.addEventListener('change', () => {
  generateBtn.disabled = !fileInput.files?.length;
  statusBox.className = '';
  statusBox.textContent = fileInput.files?.length
    ? `Ready: ${fileInput.files[0].name}`
    : 'Choose a text-based discharge-summary PDF.';
});

generateBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  generateBtn.disabled = true;
  setStatus('Reading PDF…');
  try {
    const parsed = await extractPdf(file);
    if (!parsed.rows.length) {
      throw new Error('No investigation rows were parsed. Check that the PDF contains an INVESTIGATIONS section in the expected table format.');
    }
    setStatus(`Parsed ${parsed.rows.length} rows. Building compact Word file…`);
    const report = buildCompactReport(parsed.rows);
    const rtf = buildRtf({
      title: parsed.admissionNo ? `Investigations - ${parsed.admissionNo}` : 'Compact Investigations',
      report,
      otherInvestigations: parsed.otherInvestigations,
    });
    const stem = file.name.replace(/\.pdf$/i, '');
    downloadBlob(new Blob([rtf], { type: 'application/rtf' }), `${stem}_compact_investigations.rtf`);
    setStatus(
      `Done.\n` +
      `${parsed.rows.length} investigation rows parsed\n` +
      `${report.serialDates.length} serial/core dates\n` +
      `${Math.ceil(report.serialDates.length / 5)} serial table(s)\n` +
      `Word-compatible RTF downloaded.`,
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
function isDate(s) { return /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(clean(s)); }
function dateKey(s) {
  const m = clean(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  return new Date(Number(m[3]), months[m[2].toLowerCase()] ?? 0, Number(m[1])).getTime();
}
function shortDate(s) {
  const m = clean(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m ? `${String(Number(m[1])).padStart(2,'0')}-${m[2]}` : clean(s);
}

async function extractPdf(file) {
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
  let admissionNo = '';
  const otherLines = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const pageRows = groupTextItems(tc.items);

    // Metadata can appear only on the first page.
    if (!admissionNo) {
      const pageText = pageRows.map(r => r.text).join('\n');
      const m = pageText.match(/Admission\s+No\s*:\s*([A-Z]{1,5}\d[0-9A-Z-]*)/i);
      if (m) admissionNo = m[1].toUpperCase();
    }

    for (const row of pageRows) {
      const text = clean(row.text);
      if (!text) continue;

      if (/^INVESTIGATIONS\s*:/i.test(text)) {
        inInvestigations = true;
        inOther = false;
        continue;
      }
      if (/^OTHER\s+INVESTIGATIONS?\s*:/i.test(text)) {
        inInvestigations = false;
        inOther = true;
        const inline = clean(text.replace(/^OTHER\s+INVESTIGATIONS?\s*:/i, ''));
        if (inline) otherLines.push(inline);
        continue;
      }
      if (inOther && /^(ADVICE\s+ON\s+DISCHARGE|FOLLOW\s*UP|REPORT\s+IN\s+CASE\s+OF)\s*:/i.test(text)) {
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

      const dateMatch = text.match(/^(\d{1,2})\s*-\s*([A-Za-z]{3})\s*-\s*(\d{4})\b\s*(.*)$/);
      if (dateMatch) {
        currentDate = `${String(Number(dateMatch[1])).padStart(2,'0')}-${titleCase(dateMatch[2])}-${dateMatch[3]}`;
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
        // Headings such as "(DLC) Differential Leucocytes Count" or a wrapped parameter.
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

  return {
    admissionNo,
    rows: dedupeRows(rows),
    otherInvestigations: dedupeNarrative(otherLines).join(' '),
  };
}

function groupTextItems(items) {
  // PDF coordinates have the origin at the bottom. Group by near-identical Y.
  const usable = items
    .filter(it => clean(it.str))
    .map(it => ({ str: clean(it.str), x: it.transform[4], y: it.transform[5], w: it.width || 0 }))
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
  const p = upper.find(i => i.u.includes('PARAMETER'));
  const r = upper.find(i => i.u === 'RESULT' || i.u.includes('RESULT'));
  const u = upper.find(i => i.u === 'UNITS' || i.u.includes('UNITS'));
  const n = upper.find(i => i.u.includes('NORMAL VALUE') || i.u.includes('NORMAL'));
  if (!p || !r || !u || !n || !(p.x < r.x && r.x < u.x && u.x < n.x)) return null;
  return { parameter: p.x, result: r.x, units: u.x, reference: n.x };
}

function rowToCells(items, cols) {
  const out = { parameter: [], result: [], units: [], reference_range: [] };
  const b1 = (cols.parameter + cols.result) / 2;
  const b2 = (cols.result + cols.units) / 2;
  const b3 = (cols.units + cols.reference) / 2;
  for (const it of items) {
    if (it.x < cols.parameter - 10) continue; // date/footer column
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
function titleCase(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }
function isTemplateNoise(s) { return /santosh\s+hospitals?|ambedkar\s+rd|www\.|fax\s*:|created\s+by|print\s+by/i.test(s); }
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
  const { bold=false, size=18, before=0, after=40 } = opts;
  return `\\pard\\sb${before}\\sa${after}\\fs${size}${bold?'\\b':''} ${rtfEscape(text)}${bold?'\\b0':''}\\par\n`;
}
function rtfTable(headers, bodyRows) {
  const usable = 10850, first = 1250, rest = Math.floor((usable-first)/(headers.length-1));
  const cellEnds = [first]; for (let i=1;i<headers.length;i++) cellEnds.push(first + rest*i);
  const makeRow = (cells, header=false) => {
    let s = `\\trowd\\trgaph35\\trleft0\\trkeep`;
    for (const x of cellEnds) s += `\\cellx${x}`;
    s += '\n';
    cells.forEach((c,i) => {
      const size = header ? 15 : (i===0 ? 15 : 14);
      s += `\\intbl\\pard\\qc\\fs${size}${header||i===0?'\\b':''} ${rtfEscape(c||'')}${header||i===0?'\\b0':''}\\cell\n`;
    });
    return s + '\\row\n';
  };
  let out = makeRow(headers,true);
  for (const r of bodyRows) out += makeRow(r,false);
  return out + '\\pard\\sa40\\par\n';
}
function chunk(arr,n) { const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }
function buildRtf({title, report, otherInvestigations}) {
  let r = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\paperw11907\\paperh16840\\margl500\\margr500\\margt420\\margb420\\f0\n`;
  r += rtfParagraph(title,{bold:true,size:24,after:70});
  r += rtfParagraph('Serial / Common Investigations',{bold:true,size:19,after:35});
  const dateChunks = chunk(report.serialDates,5);
  if (!dateChunks.length) r += rtfParagraph('No serial/core investigations identified.',{size:16});
  dateChunks.forEach((dates, idx) => {
    if (idx) r += rtfParagraph('Serial investigations - continued',{bold:true,size:16,after:20});
    const body = panelOrder.map(panel => [panel, ...dates.map(d => report.serial[panel][d] || '')]).filter(row => row.slice(1).some(Boolean));
    r += rtfTable(['Investigation', ...dates.map(shortDate)], body);
  });
  const section = (name, lines) => {
    if (!lines?.length) return;
    r += rtfParagraph(name,{bold:true,size:19,before:30,after:20});
    for (const line of lines) r += rtfParagraph(line,{size:16,after:18});
  };
  section('Metabolic / Endocrine Investigations', report.metabolic);
  section('Microbiology / Infectious Workup', report.microbiology);
  section('Other Laboratory Investigations', report.otherLab);
  if (clean(otherInvestigations)) section('Other Investigations', [clean(otherInvestigations)]);
  return r + '}';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

import type { Finding, Report, ReportEntry } from '@upgradepilot/shared';

/** Escape Markdown-significant characters in untrusted text. */
function esc(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/[\\|`<>[\]*_#!()~&]/g, (c) => `\\${c}`);
}

/** A link for http(s) URLs only; anything else renders as plain text. */
function link(label: string, url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return esc(label);
    return `[${esc(label)}](${u.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  } catch {
    return esc(label);
  }
}

function originMark(origin: Finding['origin']): string {
  return origin === 'ai' ? ' _(AI)_' : origin === 'unverified' ? ' _(unverified AI claim)_' : '';
}

function finding(f: Finding): string {
  return `${esc(f.text)}${f.sourceUrl ? ` (${link('source', f.sourceUrl)})` : ''}${originMark(f.origin)}`;
}

function section(title: string, items: string[]): string[] {
  return items.length > 0 ? [`**${title}**`, '', ...items.map((i) => `- ${i}`), ''] : [];
}

function entryLines(e: ReportEntry): string[] {
  const a = e.analysis;
  const lines = [
    `### ${esc(e.packageName)} ${esc(e.currentVersion)} → ${esc(e.targetVersion)} (${e.upgradeType}, risk ${e.riskLevel}, ${e.recommendation})`,
    '',
    `Declared in: ${e.manifests.map((m) => `${esc(m.path)} (${m.dependencyType}, ${esc(m.declaredRange)})`).join('; ')}`,
    '',
  ];
  if (e.deprecation) lines.push(`Deprecated: ${esc(e.deprecation)}`, '');
  if (a) {
    lines.push(
      `AI summary (confidence ${Math.round(a.confidence * 100)}%): ${esc(a.summary)}${a.inconclusive ? ' _Inconclusive: the evidence was not enough to judge._' : ''}`,
      '',
    );
  } else if (e.analysisNote) {
    lines.push(`_${esc(e.analysisNote)}_`, '');
  }
  lines.push(
    ...section('Why update', [
      ...e.advisoriesFixed.map((adv) => `Fixes ${link(adv.title, adv.url)} (${adv.severity})`),
      ...e.reasons.map(finding),
    ]),
    ...section('What could break', [
      ...e.risks.map(finding),
      ...(a?.deprecatedFeatures.map((f) => `Deprecated: ${finding(f)}`) ?? []),
    ]),
    ...section('Migration steps', a?.migrationSteps.map(finding) ?? []),
    ...section(
      'Potentially affected files',
      a?.potentiallyAffectedFiles.map((f) => `${esc(f.path)}: ${esc(f.reason)}${originMark(f.origin)}`) ?? [],
    ),
    ...section(
      'Evidence',
      e.evidence.map((ev) => `${link(ev.sourceUrl, ev.sourceUrl)} (${ev.sourceType}, ${ev.retrievalStatus})`),
    ),
  );
  return lines;
}

export function renderMarkdown(report: Report): string {
  const { repository: r, totals: t, ai } = report;
  const aiLine = ai.provider
    ? `AI analysis: ${esc(ai.provider)}/${esc(ai.model ?? 'unknown')}, ${ai.analyzed} upgrades analysed`
    : ai.note?.startsWith('AI analysis')
      ? esc(ai.note)
      : `AI analysis: off${ai.note ? ` (${esc(ai.note)})` : ''}`;
  const out: string[] = [
    `# Upgrade report: ${esc(r.owner)}/${esc(r.name)}`,
    '',
    `Branch: ${esc(r.branch)}${r.commitSha ? ` | Commit: ${r.commitSha.slice(0, 7)}` : ''} | Generated: ${esc(report.generatedAt)} | ${aiLine}`,
    '',
    '## Summary',
    '',
    esc(report.executiveSummary),
    '',
    '| Dependencies | Outdated | Patch | Minor | Major | Up to date | High risk | Deprecated | Unresolved | Security fixes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${[t.dependencies, t.outdated, t.patch, t.minor, t.major, t.upToDate, t.highRisk, t.deprecated, t.unresolved, t.securityFixes].join(' | ')} |`,
    '',
  ];

  if (report.upgradePlan.length > 0) {
    out.push('## Upgrade plan', '');
    for (const p of report.upgradePlan) {
      const risk = p.group === 'highRisk' ? 'high risk' : p.group === 'review' ? 'review' : 'safe';
      out.push(`${p.order}. **${esc(p.packageName)}** ${esc(p.from)} → ${esc(p.to)} (${risk}) - ${esc(p.reason)}`);
    }
    out.push('');
  }

  const detailed: [string, ReportEntry[]][] = [
    ['High-risk migrations', report.groups.highRisk],
    ['Review before upgrading', report.groups.review],
  ];
  for (const [title, entries] of detailed) {
    if (entries.length === 0) continue;
    out.push(`## ${title}`, '');
    for (const e of entries) out.push(...entryLines(e));
  }

  if (report.groups.safe.length > 0) {
    out.push('## Safe candidates', '', '| Package | From | To | Type | Manifests |', '| --- | --- | --- | --- | --- |');
    for (const e of report.groups.safe) {
      out.push(
        `| ${esc(e.packageName)} | ${esc(e.currentVersion)} | ${esc(e.targetVersion)} | ${e.upgradeType} | ${e.manifests.map((m) => esc(m.path)).join(', ')} |`,
      );
    }
    out.push('');
  }

  if (report.migrationChecklist.length > 0) {
    out.push('## Migration checklist', '');
    for (const c of report.migrationChecklist) {
      out.push(
        `- [ ] **${esc(c.packageName)}**: ${esc(c.step)}${c.sourceUrl ? ` (${link('source', c.sourceUrl)})` : ''}${originMark(c.origin)}`,
      );
    }
    out.push('');
  }

  if (report.unresolved.length > 0) {
    out.push('## Unresolved dependencies', '', '| Package | Manifest | Declared | Reason |', '| --- | --- | --- | --- |');
    for (const u of report.unresolved) {
      out.push(`| ${esc(u.packageName)} | ${esc(u.manifestPath)} | ${esc(u.declaredRange)} | ${esc(u.reason)} |`);
    }
    out.push('');
  }

  if (report.warnings.length > 0) {
    out.push('## Warnings', '', ...report.warnings.map((w) => `- ${esc(w)}`), '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

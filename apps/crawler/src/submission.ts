/** Issue-form submission → `enrich --pr` glue used by `.github/workflows/submission.yml`. */

import { parseIssueForm, type SubmissionForm } from './issue-form.js';
import { enrich, type EnrichOptions, type EnrichResult } from './enrich.js';

export interface SubmissionOptions extends Omit<
  EnrichOptions,
  'url' | 'discoveredBy' | 'issueNumber' | 'submissionEvidence'
> {
  body: string;
  issueNumber: number;
}

export interface SubmissionResult {
  form: SubmissionForm;
  url: string;
  enrich: EnrichResult;
}

/**
 * Pick the repository URL when supplied, otherwise the online URL. The
 * submission issue needs at least one of them.
 */
export function submissionUrl(form: SubmissionForm): string | null {
  return form.repoUrl ?? form.onlineUrl;
}

export async function processSubmission(options: SubmissionOptions): Promise<SubmissionResult> {
  const form = parseIssueForm(options.body);
  const url = submissionUrl(form);
  if (url === null) {
    throw new Error('submission issue has no 在线地址 or 仓库地址');
  }
  const evidence = [
    form.evidence !== null ? `issue evidence: ${form.evidence}` : null,
    form.ownWork === true ? '作者自述：本人作品' : null,
    form.ownWork === false ? '投稿人：非本人作品' : null,
    form.contact !== null ? `联系方式：${form.contact}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');
  const result = await enrich({
    ...options,
    url,
    discoveredBy: 'submission',
    issueNumber: options.issueNumber,
    submissionEvidence: evidence === '' ? null : evidence,
  });
  return { form, url, enrich: result };
}

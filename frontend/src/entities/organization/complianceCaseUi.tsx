import React from 'react';
import { Badge } from '../../shared/ui';
import { CASE_TYPE_LABEL, type ComplianceCaseStatus, type ComplianceCaseType } from './complianceCases';

// Shared by the compliance case list and detail pages (screen 3.6).
export const CaseStatusBadge: React.FC<{ status: ComplianceCaseStatus }> = ({ status }) =>
  status === 'OPEN' ? <Badge tone="active">Open</Badge> : <Badge tone="ended">Closed</Badge>;

export const CaseTypeBadge: React.FC<{ type: ComplianceCaseType }> = ({ type }) => (
  <Badge>{CASE_TYPE_LABEL[type]}</Badge>
);

import type { GatewayChatApprovalEvent } from './gateway/gateway-types.js';
import { formatGatewayChatApprovalSummary } from './gateway/chat-approval.js';

export function formatTuiApprovalSummary(
  approval: Pick<GatewayChatApprovalEvent, 'approvalId' | 'intent' | 'reason'>,
): string {
  return formatGatewayChatApprovalSummary(approval);
}

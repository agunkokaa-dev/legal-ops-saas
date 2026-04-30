interface EventDotProps {
  eventType: string;
  priority: string;
}

export function EventDot({ eventType, priority }: EventDotProps) {
  const colorMap: Record<string, string> = {
    hearing: 'bg-red-400',
    signature_deadline: 'bg-yellow-400',
    filing_deadline: 'bg-yellow-400',
    contract_renewal: 'bg-emerald-400',
    compliance_review: 'bg-emerald-400',
    client_meeting: 'bg-blue-400',
    board_meeting: 'bg-blue-400',
    internal_review: 'bg-blue-400',
    other: 'bg-zinc-400',
  };

  const color = priority === 'high' && !colorMap[eventType]
    ? 'bg-red-400'
    : colorMap[eventType] || 'bg-zinc-400';

  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

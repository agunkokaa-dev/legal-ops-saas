interface IconProps {
  name?: string;
  className?: string;
}

const iconMap: Record<string, string> = {
  assistant: 'auto_awesome',
  check: 'check',
  clause: 'contract_edit',
  document: 'description',
  genealogy: 'account_tree',
  globe: 'public',
  lock: 'lock',
  menu: 'menu',
  playbook: 'rule',
  shield: 'verified_user',
  spark: 'spark',
  workflow: 'hub',
  x: 'close',
};

export function Icon({ name = 'spark', className = 'h-5 w-5' }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined inline-flex items-center justify-center leading-none ${className}`}
    >
      {iconMap[name] || name}
    </span>
  );
}

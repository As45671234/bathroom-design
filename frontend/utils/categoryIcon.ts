/**
 * Category photos are raw supplier catalog shots — wildly inconsistent aspect
 * ratios and plain white backgrounds, never commissioned as a "category cover".
 * Fighting that material (cropping, blurred backdrops, hunting stock photos)
 * kept producing something that looked accidental. An icon tile sidesteps the
 * problem entirely: always clean, independent of what photos happen to exist.
 */
export function getCategoryIcon(title: string): string {
  const t = String(title || '').toLowerCase();
  if (/аксессуар/.test(t)) return 'fa-soap';
  if (/ванн/.test(t)) return 'fa-bath';
  if (/лотк|трап|дренаж|слив/.test(t)) return 'fa-grip-lines';
  if (/поддон|огражден|кабин/.test(t)) return 'fa-vector-square';
  if (/систем.*душ|душ/.test(t)) return 'fa-shower';
  if (/инсталляц/.test(t)) return 'fa-toolbox';
  if (/керамик/.test(t)) return 'fa-water';
  if (/полотенцесушител/.test(t)) return 'fa-grip-lines-vertical';
  if (/смесител/.test(t)) return 'fa-faucet-drip';
  if (/унитаз|биде/.test(t)) return 'fa-toilet';
  return 'fa-bath';
}

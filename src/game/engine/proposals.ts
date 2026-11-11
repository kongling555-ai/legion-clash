import type { Faction, Reach } from "./types.ts";

/**
 * Design record for the four cards that were pending confirmation.
 * They are now playable in catalog.ts with these level-1 numbers.
 * Growth uses the existing curve. Speed does not change who acts first.
 * The numbers are still an untested draft.
 */
export interface Proposal {
  id: string;
  name: string;
  faction: Faction;
  role: string;
  reach: Reach;
  hp: number;
  atk: number;
  def: number;
  wp: number;
  active: string;
  activeText: string;
  passive: string;
  passiveText: string;
  note: string;
}

export const PROPOSALS: Proposal[] = [
  {
    id: "draft-commander",
    name: "指挥官",
    faction: "imperial",
    role: "指挥",
    reach: "ranged",
    hp: 100,
    atk: 18,
    def: 20,
    wp: 0,
    active: "号令",
    activeText:
      "消耗自己的行动，指定另一名存活友军。该友军下一次造成伤害的攻击在进入伤害公式前攻击+12，打出后消失；若到下个己方阶段结束仍未攻击，效果消失。无资源消耗，冷却2个己方阶段。不能选自己。",
    passive: "阵线统筹",
    passiveText: "自身存活时，位于后排的其他友军攻击+2。",
    note: "待确认。强化只作用于下一次攻击的攻击力，不另加暴击。",
  },
  {
    id: "draft-assault",
    name: "突击兵",
    faction: "imperial",
    role: "突击",
    reach: "melee",
    hp: 115,
    atk: 32,
    def: 18,
    wp: 0,
    active: "突入后排",
    activeText:
      "可指定一名存活的敌方后排，即使敌方前排还在。以120%攻击力计算物理攻击。若敌方后排已空，改为合法近战目标。普攻仍然不能越过前排。无消耗，冷却2个己方阶段。",
    passive: "先锋",
    passiveText: "位于前排时防御+4。",
    note: "待确认。越线能力只在这个技能上，不改普攻规则。",
  },
  {
    id: "draft-transfer",
    name: "生命转移",
    faction: "chaos",
    role: "支援",
    reach: "ranged",
    hp: 130,
    atk: 16,
    def: 16,
    wp: 0,
    active: "血契",
    activeText:
      "选择另一名受伤的存活友军，自己先失去14点生命（不经护盾、不经防御），对方恢复28点。自身生命不足以支付时不能施放，也不会因此阵亡。不能选自己或满血友军。无灵能消耗，冷却2个己方阶段。",
    passive: "忍痛",
    passiveText: "自身生命高于40%时，血契的治疗额外+8。",
    note: "待确认。支付的生命不是攻击，不触发守护分担。",
  },
  {
    id: "draft-breaker",
    name: "破盾者",
    faction: "chaos",
    role: "破盾",
    reach: "melee",
    hp: 120,
    atk: 26,
    def: 22,
    wp: 0,
    active: "碎盾",
    activeText:
      "对合法近战目标。若目标有护盾，先移除最多20点护盾，再以100%攻击力计算物理攻击。若目标没有护盾，改为以70%攻击力计算，故意低于狂战士和终结者的普攻。无消耗，冷却2个己方阶段。",
    passive: "识盾",
    passiveText: "仅碎盾：目标带盾时，这次攻击再忽略15%防御。对无盾目标没有额外收益。",
    note: "待确认。克制护盾，但不是无盾目标的最高输出。",
  },
];

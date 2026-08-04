export type RankSnapshotComparable = {
  queueType: string;
  tier: string;
  division: string | null;
  leaguePoints: number;
  wins: number;
  losses: number;
  veteran: boolean;
  inactive: boolean;
  freshBlood: boolean;
  hotStreak: boolean;
};

/** Returns true when a new snapshot differs materially from the latest stored one. */
export function hasRankSnapshotChanged(
  previous: RankSnapshotComparable | null | undefined,
  next: RankSnapshotComparable,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    previous.queueType !== next.queueType ||
    previous.tier !== next.tier ||
    previous.division !== next.division ||
    previous.leaguePoints !== next.leaguePoints ||
    previous.wins !== next.wins ||
    previous.losses !== next.losses ||
    previous.veteran !== next.veteran ||
    previous.inactive !== next.inactive ||
    previous.freshBlood !== next.freshBlood ||
    previous.hotStreak !== next.hotStreak
  );
}
